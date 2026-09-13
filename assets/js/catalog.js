/* ============================================================
   catalog.js — الفهرس المحلي لأعمال الموقع

   لماذا يوجد هذا الملف:
   TMDB ما عنده بحث في نص القصة. /search/movie يطابق العناوين فقط،
   فالبحث بوصف القصة ما كان له أي مصدر حقيقي داخل TMDB.

   الحل: فهرس محلي. كل عمل يمرّ على الموقع ينحفظ بملخّصه ووسومه
   وطاقمه، والبحث بالوصف يصير مطابقة نصية عليه — فوريّة وبلا طلبات.

   التخزين: IndexedDB لا localStorage. الحصّة هناك مئات الميغابايت
   بدل خمسة، وكان الفهرس يمتلئ فيتوقف الحفظ بصمت ويرجع فاضيًا كل
   جلسة. البيانات القديمة تُنقل تلقائيًا ولا يضيع منها شي.
   ============================================================ */

(function (CS) {
  'use strict';

  var LS_KEY = 'cs.catalog';          /* المخزن القديم — للترحيل فقط */
  var DB_KEY = 'catalog.v3';
  var VER = 3;
  var MAX = 6000;                     /* الحصّة صارت تسمح بفهرس أوسع بكثير */
  var SWEEP_KEY = 'cs.catalog_sweep';
  var CURSOR_KEY = 'cs.catalog_cursor';   /* أين وقفت آخر كنسة */
  var SWEEP_FULL = 6 * 60 * 60 * 1000;    /* فهرس ناضج: كنس كل ٦ ساعات */
  var SWEEP_WARM = 40 * 60 * 1000;        /* فهرس صغير: كل ٤٠ دقيقة حتى يكبر */
  var WARM_AT = 500;

  /* ---------- التخزين ---------- */

  function fresh() { return { v: VER, m: {}, n: 0 }; }

  var db = fresh();
  var loaded = false;

  function upgradeRecords(raw) {
    if (!raw || !raw.m || typeof raw.m !== 'object' || Array.isArray(raw.m)) return fresh();
    Object.keys(raw.m).forEach(function (k) {
      var r = raw.m[k];
      if (!r) { delete raw.m[k]; return; }
      if (r.q && r.q.charAt(0) !== ' ') r.q = ' ' + r.q + ' ';
      if (!r.qt) r.qt = ' ' + norm((r.n || '') + ' ' + (r.o || '')) + ' ';
    });
    raw.v = VER;
    raw.n = Object.keys(raw.m).length;
    return raw;
  }

  /* التحميل من IndexedDB، ومعه ترحيل ما كان في localStorage */
  var ready = CS.db.get(DB_KEY).then(function (stored) {
    if (stored && stored.m) {
      db = upgradeRecords(stored);
    } else {
      var old = CS.store.get(LS_KEY, null);
      if (old && old.m) {
        db = upgradeRecords(old);
        /* ننقل ثم نفرّغ المخزن القديم — الحصّة كانت مخنوقة به */
        CS.db.set(DB_KEY, db).then(function (ok) {
          if (ok) CS.store.remove(LS_KEY);
        });
      }
    }
    loaded = true;
    return db.n;
  }).catch(function () { loaded = true; return 0; });

  function trimTo(limit) {
    var keys = Object.keys(db.m);
    if (keys.length <= limit) return;

    /* المرفوض أولًا (ما يخرج في بحث أبدًا)، ثم المجهول، ثم الأقل شهرة */
    function rank(k) {
      var v = CS.certs ? CS.certs.isAdultWork(toItem(db.m[k])) : null;
      return v === false ? 0 : v === null ? 1 : 2;
    }
    keys.sort(function (a, b) {
      var ra = rank(a), rb = rank(b);
      if (ra !== rb) return ra - rb;
      return (db.m[a].x || 0) - (db.m[b].x || 0);
    }).slice(0, keys.length - limit).forEach(function (k) { delete db.m[k]; });
  }

  var saveTimer;
  function persist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      trimTo(MAX);
      db.n = Object.keys(db.m).length;
      CS.db.set(DB_KEY, db).then(function (ok) {
        if (ok) return;
        /* حتى IndexedDB قد ترفض — نقصّ النصف ونعيد مرة واحدة */
        trimTo(Math.floor(Object.keys(db.m).length / 2));
        db.n = Object.keys(db.m).length;
        CS.db.set(DB_KEY, db);
      });
    }, 1500);
  }

  function keyOf(item) { return (item.type === 'tv' ? 'v' : 'm') + item.id; }

  /* ---------- تطبيع النص للمطابقة ---------- */

  function norm(str) {
    return String(str || '')
      .toLowerCase()
      .replace(/[ً-ٰٟ]/g, '')
      .replace(/[أإآٱ]/g, 'ا')
      .replace(/[ىی]/g, 'ي')
      .replace(/ؤ/g, 'و').replace(/ئ/g, 'ي').replace(/ة/g, 'ه')
      .replace(/ـ/g, '')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /* ------------------------------------------------------------
     صور الكلمة للمطابقة — ما نقصّ الكلمة، بل نولّد صورها المحتملة
     ونقبل مطابقة أي وحدة منها.
     ------------------------------------------------------------ */
  function variants(w) {
    var base = String(w || '');
    var out = [base];

    if (/[؀-ۿ]/.test(base)) {
      var noAl = base.replace(/^(?:[وفبكل])?(?:ال)/, '');
      if (noAl && noAl !== base && noAl.length >= 3) out.push(noAl);
      var noLil = base.replace(/^لل/, '');
      if (noLil !== base && noLil.length >= 3) out.push(noLil);
      if (base.length >= 5) {
        var noClitic = base.replace(/^[وفبكل]/, '');
        if (noClitic.length >= 4) out.push(noClitic);
      }
      if (base.length > 5) {
        var noSuffix = base.replace(/(ون|ين|ات|ان|ها|هم|نا|كم)$/, '');
        if (noSuffix.length >= 4 && noSuffix !== base) out.push(noSuffix);
      }
    }

    /* جمع إنجليزي بسيط — «killers» ≡ «killer» */
    if (/^[a-z]{5,}s$/.test(base) && !/(ss|us|is)$/.test(base)) out.push(base.slice(0, -1));

    return out.filter(function (v, i, a) { return v && a.indexOf(v) === i; });
  }

  function stem(w) { return variants(w)[0]; }

  /* ---------- السجل ---------- */

  function shrinkImg(url) {
    var m = /\/([^\/]+\.(?:jpg|png|webp))$/i.exec(String(url || ''));
    return m ? m[1] : '';
  }

  function put(item, extra) {
    if (!item || item.source !== 'tmdb' || !item.id) return;
    /* العمل اللي البوابة رفضته صراحةً ما يدخل. اللي لسه ما وصلت
       وسومه يدخل مؤقتًا ويُفرز عند البحث.

       لكن الرفض المبنيّ على سجلّ وسوم ناقص (بذرة كلمة واحدة من
       الكنس) ما يكفي للطرد: كانت الكنسة العميقة تحذف أعمالًا
       مقبولة أصلًا فيصغر الفهرس بدل ما يكبر. الناقص يُترك كما هو. */
    if (CS.certs && CS.certs.isAdultWork(item) === false) {
      var h0 = CS.certs.cachedHeat(item);
      if (!h0 || !h0.partial) drop(item);
      return;
    }
    var k = keyOf(item);
    var rec = db.m[k] || {};

    rec.i = item.id;
    rec.t = item.type === 'tv' ? 'v' : 'm';
    rec.n = item.title || rec.n || '';
    rec.o = item.originalTitle || rec.o || '';
    rec.y = item.year || rec.y || null;

    /* الملخّص هو مادة البحث كلها — العربي في d والإنجليزي في e */
    var ov = (item.overview || '').trim();
    if (ov) {
      var ar = /[؀-ۿ]/.test(ov);
      if (ar) { if (ov.length > (rec.d || '').length) rec.d = ov; }
      else    { if (ov.length > (rec.e || '').length) rec.e = ov; }
    }
    rec.g = (item.genreIds || rec.g || []).slice(0, 8);
    rec.p = shrinkImg(item.poster) || rec.p || '';
    rec.r = item.rating || rec.r || 0;
    rec.c = item.votes || rec.c || 0;
    rec.x = Math.max(rec.x || 0, item.popularity || 0);
    if (item.adult) rec.a = 1;

    /* محاور القرب الجديدة: اللغة · الممثلون · المخرج.
       بدونها ما كان يقدر «أعمال مثل هذا» يقيس على طاقم العمل. */
    if (item.languageOf || item.originalLanguage) rec.l = item.languageOf || item.originalLanguage;
    if (item.castIds && item.castIds.length) rec.cr = item.castIds.slice(0, 10);
    else if (item.cast && item.cast.length) rec.cr = item.cast.map(function (c) { return c.id; }).slice(0, 10);
    if (item.directors && item.directors.length) rec.dr = item.directors.slice(0, 3);

    if (extra && extra.keywords) {
      rec.w = extra.keywords.map(function (x) { return x.name || x; })
        .filter(Boolean).slice(0, 24);
    } else {
      var h = CS.certs && CS.certs.cachedHeat(item);
      if (h && h.names && h.names.length > (rec.w || []).length) rec.w = h.names.slice(0, 24);
    }
    if (extra && extra.overviewEn && extra.overviewEn.length > (rec.e || '').length) rec.e = extra.overviewEn;
    if (extra && extra.overviewAr && extra.overviewAr.length > (rec.d || '').length) rec.d = extra.overviewAr;
    /* العنوان العربي الرسمي من TMDB — كان يُسحب ويُرمى، فالبحث
       بالاسم العربي ما يلقى العمل في الفهرس أبدًا */
    if (extra && extra.titleAr && String(extra.titleAr).trim()) rec.na = String(extra.titleAr).trim();

    /* الحقل المطابَق يُبنى مرة وحدة عند الكتابة لا مع كل بحث.
       نحيطه بمسافات ونطابق ببداية الكلمة: indexOf المجرّد كان يخلي
       «son» تطابق prison و person. */
    rec.q = ' ' + norm([rec.n, rec.o, rec.na, rec.d, rec.e, (rec.w || []).join(' '),
                        (rec.dr || []).join(' ')].join(' ')) + ' ';
    rec.qt = ' ' + norm([rec.n, rec.o, rec.na].join(' ')) + ' ';

    if (!db.m[k]) db.n = (db.n || 0) + 1;
    db.m[k] = rec;
    persist();
  }

  function drop(item) {
    var k = keyOf(item);
    if (db.m[k]) { delete db.m[k]; db.n = Math.max(0, (db.n || 1) - 1); persist(); }
  }

  function add(list, extra) {
    (list || []).forEach(function (it) { put(it, extra); });
  }

  function attachKeywords(item, keywords) {
    if (!item || !keywords) return;
    put(item, { keywords: keywords });
  }

  function toItem(rec) {
    var img = CS.tmdb.img;
    var path = rec.p ? '/' + rec.p : '';
    return {
      id: rec.i,
      type: rec.t === 'v' ? 'tv' : 'movie',
      title: rec.n,
      arTitle: rec.na || '',
      originalTitle: rec.o || '',
      year: rec.y || null,
      date: rec.y ? String(rec.y) : '',
      poster: path ? img(path, CS.config.tmdb.poster.md) : '',
      posterLarge: path ? img(path, CS.config.tmdb.poster.lg) : '',
      posterPath: path,
      backdrop: '',
      rating: rec.r || 0,
      votes: rec.c || 0,
      popularity: rec.x || 0,
      overview: rec.d || rec.e || '',
      overviewEn: rec.e || '',
      genreIds: rec.g || [],
      originalLanguage: rec.l || '',
      languageOf: rec.l || '',
      castIds: rec.cr || [],
      directors: rec.dr || [],
      adult: rec.a === 1,
      source: 'tmdb',
      fromCatalog: true
    };
  }

  /* ---------- البحث النصي ---------- */

  var dfCache = {}, dfStamp = -1;

  function dfFor(term) {
    if (dfStamp !== db.n) { dfCache = {}; dfStamp = db.n; }
    return dfCache[term];
  }

  /* مفردات الفهرس — تُستعمل لتصحيح الأخطاء الإملائية */
  var vocabCache = null, vocabStamp = -1;

  function vocabulary() {
    if (vocabCache && vocabStamp === db.n) return vocabCache;
    var seen = {};
    var out = [];
    Object.keys(db.m).forEach(function (k) {
      var rec = db.m[k];
      (rec.qt || '').split(' ').forEach(function (w) {
        if (w.length < 4 || seen[w]) return;
        seen[w] = 1; out.push(w);
      });
      (rec.w || []).forEach(function (name) {
        String(name || '').toLowerCase().split(/\s+/).forEach(function (w) {
          if (w.length < 4 || seen[w]) return;
          seen[w] = 1; out.push(w);
        });
      });
    });
    vocabCache = out.slice(0, 6000);
    vocabStamp = db.n;
    return vocabCache;
  }

  /**
   * search(terms, opts) → قائمة أعمال مرتّبة
   * terms: كلمات الوصف بعد التنظيف (عربي و/أو إنجليزي)
   * opts.phrase: الجملة كاملة — تطابقها الحرفي أقوى دليل ممكن
   * opts.fuzzy: نسامح الأخطاء الإملائية (الافتراضي: نعم)
   */
  function search(terms, opts) {
    opts = opts || {};
    var fuzzyOn = opts.fuzzy !== false && !!CS.fuzzy;

    var list = [];
    (terms || []).forEach(function (t) {
      var n = norm(t);
      if (n.length < 3) return;
      if (list.some(function (x) { return x.key === n; })) return;
      list.push({ key: n, forms: variants(n).filter(function (v) { return v.length >= 3; }) });
    });
    if (!list.length) return [];

    var total = db.n || Object.keys(db.m).length;
    if (!total) return [];

    var phrase = opts.phrase ? norm(opts.phrase) : '';
    var out = [];

    var known = list.every(function (t) { return dfFor(t.key) !== undefined; });
    var df = {};
    list.forEach(function (t) { df[t.key] = known ? dfCache[t.key] : 0; });

    var raw = [];
    Object.keys(db.m).forEach(function (k) {
      var rec = db.m[k];
      var hay = rec.q || '';
      if (!hay) return;

      /* دفاع في العمق: ما يخرج من البحث إلا ما قالت البوابة نعم له */
      var it0 = toItem(rec);
      if (CS.certs && CS.certs.isAdultWork(it0) !== true) return;
      if (CS.certs && CS.certs.kindFits && CS.certs.kindFits(it0) === false) return;

      var hits = [], inTitle = {}, fuzzyHits = 0, exactHits = 0;
      var titleHay = rec.qt || (' ' + norm(rec.n + ' ' + rec.o) + ' ');
      list.forEach(function (t) {
        /* بداية الكلمة لا وسطها — يسمح بالسوابق واللواحق ويمنع
           «son» من مطابقة «prison». أي صورة من صور المصطلح تكفي. */
        var hit = t.forms.some(function (f) { return hay.indexOf(' ' + f) !== -1; });
        var weight = hit ? 1 : 0;

        /* ما لقينا الكلمة حرفيًا؟ نجرّب قريبها — خطأ إملائي بحرف
           أو حرفين كان يرجّع صفرًا من الفهرس كله */
        if (!weight && fuzzyOn && t.key.length >= 4) {
          weight = CS.fuzzy.inText(hay, t.key);
          if (weight) fuzzyHits++;
        }
        if (!weight) return;

        if (hit) exactHits++;
        hits.push(t.key);
        t.w = weight;
        if (!known) df[t.key] = (df[t.key] || 0) + 1;
        if (t.forms.some(function (f) { return titleHay.indexOf(' ' + f) !== -1; })) inTitle[t.key] = true;
      });
      if (!hits.length) return;

      /* حاجز ضد إيجابية التقريب الكاذبة: استعلام هراء («zqxwv plurgh»)
         كان يلقى «قريبًا» من كلمة أو كلمتين فيرجّع نتائج بلا معنى.
         التقريب وحده ما يكفي إلا إذا غطّى أغلب كلمات الاستعلام. */
      if (!exactHits && hits.length / list.length < 0.6) return;

      raw.push({ rec: rec, hits: hits, inTitle: inTitle, fuzzy: fuzzyHits,
                 phraseHit: !!(phrase && phrase.length >= 14 && hay.indexOf(phrase) !== -1) });
    });

    if (!known) { list.forEach(function (t) { dfCache[t.key] = df[t.key] || 0; }); dfStamp = db.n; }

    raw.forEach(function (r) {
      var score = 0, titleAdd = 0;
      r.hits.forEach(function (t) {
        /* وزن معكوس التكرار: كلمة في ١٪ من الفهرس تساوي أضعاف كلمة في نصفه */
        var idf = Math.log((total + 1) / ((df[t] || 0) + 1)) + 1;
        score += idf * 10;
        if (r.inTitle[t]) titleAdd += idf * 2.2;
      });

      /* المطابقة التقريبية تُحتسب أقل من الحرفية — دليل أضعف */
      if (r.fuzzy) score *= (1 - Math.min(0.3, r.fuzzy * 0.1));

      score += Math.min(titleAdd, score * 0.2);

      var cov = r.hits.length / list.length;
      score *= (0.45 + cov * 1.55);
      if (r.hits.length >= 3) score += 28;
      if (r.hits.length >= 5) score += 34;

      if (r.phraseHit && cov >= 0.5) score += 60 + cov * 90;

      score += Math.min(8, Math.log10((r.rec.x || 0) + 1) * 3.2);

      out.push({ rec: r.rec, score: score, hits: r.hits, coverage: cov, fuzzy: r.fuzzy });
    });

    out.sort(function (a, b) { return b.score - a.score; });
    return out.slice(0, opts.limit || 80).map(function (r) {
      var item = toItem(r.rec);
      item.catalogScore = r.score;
      item.catalogHits = r.hits;
      item.catalogCoverage = r.coverage;
      item.catalogFuzzy = r.fuzzy;
      return item;
    });
  }

  /* ------------------------------------------------------------
     الأعمال ذات الصلة من الفهرس — القياس صار في reco.js على ستة
     محاور. هنا نجهّز المرشّحين ونمرّرهم له.
     ------------------------------------------------------------ */

  var kwDf = null, kwDfStamp = -1;

  function keywordDf() {
    if (kwDf && kwDfStamp === db.n) return kwDf;
    kwDf = {};
    Object.keys(db.m).forEach(function (k) {
      (db.m[k].w || []).forEach(function (name) {
        var t = String(name || '').toLowerCase();
        if (t) kwDf[t] = (kwDf[t] || 0) + 1;
      });
    });
    kwDfStamp = db.n;
    return kwDf;
  }

  var PLOT_STOP = (' the a an of in on at to for and or but is are was were be been with from by '
    + 'that this these those his her its their he she they it as into over under about after his '
    + 'her when where who while them him them one two his own new life world man woman young '
    + 'في من على عن الى مع بعد قبل عند كل بعض غير هو هي هم التي الذي هذا هذه ذلك تلك بين ثم لكن '
    + 'حياه عالم رجل امراه شاب فتاه سنه عام قصه فيلم مسلسل ').split(/\s+/);

  function plotTerms(text, cap) {
    var seen = {}, out = [];
    norm(text).split(' ').forEach(function (w) {
      if (w.length < 4) return;
      if (PLOT_STOP.indexOf(w) !== -1) return;
      if (seen[w]) return;
      seen[w] = true;
      out.push(w);
    });
    return out.slice(0, cap || 24);
  }

  /**
   * candidates(base, opts) — المرشّحون من الفهرس، مقصوصون مبدئيًا
   * بوسم أو كلمة قصة مشتركة، عشان reco.js ما يقيس على الفهرس كله.
   */
  function candidates(base, opts) {
    opts = opts || {};
    if (!base) return [];
    var selfKey = keyOf(base);
    var exclude = opts.exclude || {};

    var rec0 = db.m[selfKey];
    var baseKw = {};
    ((base.keywords && base.keywords.length ? base.keywords.map(function (k) { return k.name; })
       : (rec0 && rec0.w) || [])).forEach(function (n) {
      var t = String(n || '').toLowerCase();
      if (t) baseKw[t] = true;
    });

    var baseTerms = plotTerms(
      (base.overview || '') + ' ' + ((rec0 && (rec0.d || '')) || '') + ' ' + ((rec0 && (rec0.e || '')) || ''),
      26);
    var basePeople = {};
    ((base.castIds && base.castIds.length) ? base.castIds : ((rec0 && rec0.cr) || []))
      .forEach(function (id) { basePeople[id] = true; });
    var baseDirs = (base.directors && base.directors.length ? base.directors : ((rec0 && rec0.dr) || []))
      .map(function (d) { return String(d).toLowerCase(); });

    var kwNames = Object.keys(baseKw);
    if (!kwNames.length && !baseTerms.length && !baseDirs.length && !Object.keys(basePeople).length) return [];

    var out = [];
    Object.keys(db.m).forEach(function (k) {
      if (k === selfKey || exclude[k]) return;
      var rec = db.m[k];
      var it0 = toItem(rec);
      if (CS.certs && CS.certs.isAdultWork(it0) !== true) return;
      if (CS.certs && CS.certs.kindFits && CS.certs.kindFits(it0) === false) return;

      /* قصّ رخيص: لازم إشارة واحدة على الأقل قبل القياس الكامل */
      var touch = (rec.w || []).some(function (n) { return baseKw[String(n).toLowerCase()]; }) ||
                  (rec.cr || []).some(function (id) { return basePeople[id]; }) ||
                  (rec.dr || []).some(function (d) { return baseDirs.indexOf(String(d).toLowerCase()) !== -1; }) ||
                  baseTerms.some(function (t) { return (rec.q || '').indexOf(' ' + t) !== -1; });
      if (!touch) return;

      out.push(it0);
    });
    return out.slice(0, opts.limit || 400);
  }

  /* التوافق للخلف: similarTo كانت تقيس بنفسها، الآن تمرّ من reco */
  function similarTo(base, opts) {
    var cands = candidates(base, opts);
    if (!cands.length) return [];
    if (!CS.reco) return cands;
    return CS.reco.rank(base, cands, { exclude: (opts && opts.exclude) || {}, keepWeak: false })
      .slice(0, (opts && opts.limit) || 200);
  }

  /* ---------- الكنس: توسيع الفهرس في الخلفية ---------- */

  var sweeping = false;
  var inFlight = null;
  var round = 0;
  var sweptThisLoad = false;

  function sweep(force) {
    if (!CS.hasKey()) return Promise.resolve(0);
    if (sweeping && inFlight) return inFlight;
    if (sweeping) return Promise.resolve(0);
    if (!force && sweptThisLoad) return Promise.resolve(0);

    var last = CS.store.get(SWEEP_KEY, 0);
    var now = +new Date();
    var gap = db.n >= WARM_AT ? SWEEP_FULL : SWEEP_WARM;
    if (!force && now - last < gap) return Promise.resolve(0);

    sweeping = true;
    sweptThisLoad = true;
    CS.store.set(SWEEP_KEY, now);

    inFlight = CS.feed.keywordIds('general').then(function (ids) {
      if (!ids || !ids.length) { sweeping = false; inFlight = null; return 0; }

      var names = CS.feed.keywordNames ? CS.feed.keywordNames() : {};
      var mature = db.n >= WARM_AT;
      var SORTS = ['popularity.desc', 'vote_count.desc', 'primary_release_date.desc',
                   'vote_average.desc', 'revenue.desc'];

      /* مؤشّر محفوظ: كل كنسة تبدأ من حيث وقفت السابقة بدل ما تعيد
         حرث أول ثماني كلمات إلى الأبد. كانت الكنستان المتتاليتان
         تكلّفان ٧٠ طلبًا وتضيفان صفرًا. */
      round++;
      var cursor = CS.store.get(CURSOR_KEY, { kw: 0, page: 0 });
      if (!cursor || typeof cursor !== 'object') cursor = { kw: 0, page: 0 };

      var take = mature ? 10 : 16;
      var start = (cursor.kw || 0) % ids.length;
      var slice = [];
      for (var s = 0; s < Math.min(take, ids.length); s++) slice.push(ids[(start + s) % ids.length]);

      var pageBase = 1 + ((cursor.page || 0) % 10);
      var plan = [];
      slice.forEach(function (id, i) {
        var sortBy = SORTS[(i + round) % SORTS.length];
        plan.push({ type: 'movie', id: id, sort_by: sortBy, page: pageBase });
        if (!mature) plan.push({ type: 'movie', id: id, sort_by: sortBy, page: pageBase + 1 });
        if (i % 2 === 0) plan.push({ type: 'tv', id: id, sort_by: sortBy, page: 1 + (round % 3) });
      });

      CS.store.set(CURSOR_KEY, {
        kw: (start + slice.length) % ids.length,
        page: (cursor.page || 0) + (start + slice.length >= ids.length ? 1 : 0)
      });

      var before = db.n;
      return CS.util.pool(plan, 4, function (job) {
        return harvest(job, names);
      }).then(function () {
        sweeping = false; inFlight = null;
        return db.n - before;
      });
    }).catch(function () { sweeping = false; inFlight = null; return 0; });

    return inFlight;
  }

  function harvest(job, names) {
    var q = {
      with_keywords: String(job.id),
      /* TMDB يرجّع ملخّصًا فاضيًا تحت ar-SA لأغلب هذي الأعمال، فالكنس
         يطلب الإنجليزي صراحةً ويخزّنه في حقل منفصل عن العربي */
      language: 'en-US',
      sort_by: job.type === 'tv' && job.sort_by === 'primary_release_date.desc'
        ? 'first_air_date.desc' : job.sort_by
    };
    if (job.sort_by === 'vote_average.desc') q['vote_count.gte'] = 15;
    return CS.tmdb.discover(job.type, q, job.page)
      .then(function (list) {
        var name = names[job.id];
        (list || []).forEach(function (it) {
          if (name && CS.certs.seedKeyword) CS.certs.seedKeyword(it, name);
        });
        add(list);
        return (list || []).length;
      })
      .catch(function () { return 0; });
  }

  /**
   * تحديث قوي — كنسة أوسع من الزرّ العادي.
   */
  function deepSweep() {
    if (!CS.hasKey() || !CS.feed) return Promise.resolve(0);
    if (sweeping && inFlight) return inFlight;
    if (sweeping) return Promise.resolve(0);

    sweeping = true;
    CS.store.set(SWEEP_KEY, +new Date());

    inFlight = Promise.all([
      CS.feed.keywordIds('general'),
      CS.feed.keywordIds('explicit')
    ]).then(function (sets) {
      var ids = [];
      sets.forEach(function (list) {
        (list || []).forEach(function (id) { if (ids.indexOf(id) === -1) ids.push(id); });
      });
      if (!ids.length) { sweeping = false; inFlight = null; return 0; }

      var names = CS.feed.keywordNames ? CS.feed.keywordNames() : {};

      var SORTS = ['popularity.desc', 'vote_count.desc', 'primary_release_date.desc',
                   'vote_average.desc', 'revenue.desc'];
      round++;
      /* الخطة كانت ١٢٦ نداء استكشاف من ضغطة واحدة — ومعها ترطيب
         البطاقات تجاوز الطلبات ٢٨٠. الحدّ هنا صريح، والجولة القادمة
         تكمّل من حيث وقفت هذي بفضل المؤشّر المحفوظ. */
      var DEEP_MAX = 28;
      var cur = CS.store.get(CURSOR_KEY, { kw: 0, page: 0 });
      var from = (cur && cur.kw) || 0;
      var plan = [];
      for (var i = 0; i < ids.length && plan.length < DEEP_MAX; i++) {
        var id = ids[(from + i) % ids.length];
        for (var j = 0; j < SORTS.length && plan.length < DEEP_MAX; j++) {
          plan.push({ type: 'movie', id: id, sort_by: SORTS[j], page: 1 + ((round + i + j) % 6) });
        }
        if (plan.length < DEEP_MAX) plan.push({ type: 'tv', id: id, sort_by: 'popularity.desc', page: 1 + ((round + i) % 4) });
        if (plan.length < DEEP_MAX) plan.push({ type: 'tv', id: id, sort_by: 'first_air_date.desc', page: 1 + ((round + i) % 3) });
      }
      CS.store.set(CURSOR_KEY, { kw: (from + Math.ceil(DEEP_MAX / 7)) % ids.length, page: (cur && cur.page) || 0 });

      var before = db.n;
      return CS.util.pool(plan, 5, function (job) {
        return harvest(job, names);
      }).then(function () {
        sweeping = false; inFlight = null;
        return db.n - before;
      });
    }).catch(function () { sweeping = false; inFlight = null; return 0; });

    return inFlight;
  }

  CS.catalog = {
    ready: ready,
    loaded: function () { return loaded; },
    add: add,
    drop: drop,
    put: put,
    attachKeywords: attachKeywords,
    search: search,
    vocabulary: vocabulary,
    candidates: candidates,
    similarTo: similarTo,
    plotTerms: plotTerms,
    keywordIdf: function (name) {
      var df = keywordDf();
      var total = Math.max(1, db.n || Object.keys(db.m).length);
      return Math.log((total + 1) / ((df[String(name || '').toLowerCase()] || 0) + 1)) + 1;
    },
    sweep: sweep,
    deepSweep: deepSweep,
    size: function () { return db.n || Object.keys(db.m).length; },
    has: function (item) { return !!db.m[keyOf(item)]; },
    record: function (item) { return db.m[keyOf(item)] || null; },
    toItem: toItem,
    norm: norm,
    stem: stem,
    variants: variants,
    clear: function () {
      db = fresh();
      dfCache = {}; dfStamp = -1; kwDf = null; kwDfStamp = -1; vocabCache = null; vocabStamp = -1;
      CS.db.set(DB_KEY, db);
      CS.store.remove(SWEEP_KEY);
      CS.store.remove(CURSOR_KEY);
      CS.store.remove(LS_KEY);
    }
  };

})(window.CS);
