/* ============================================================
   catalog.js — الفهرس المحلي لأعمال الكبار

   لماذا يوجد هذا الملف:
   TMDB ما عنده بحث في نص القصة. /search/movie يطابق العناوين فقط،
   فالبحث بوصف القصة ما كان له أي مصدر حقيقي داخل TMDB — وهذا سبب
   إنه كان يرجّع أعمالًا خارج الوصف تمامًا.

   الحل: نبني فهرسًا محليًا. كل عمل يمرّ على الموقع (من الأقسام أو
   من كنس مخصّص) ينحفظ عندنا بملخّصه ووسومه. البحث بالوصف يصير
   مطابقة نصية على هذا الفهرس — فوريّة، بلا طلبات، وأهم من هذا:
   الفهرس نفسه مبني من كلمات الكبار المفتاحية، فما فيه أصلًا عمل
   عام داخله ليتسرّب.

   الفهرس ليس المصدر الوحيد — محرّكات TMDB وويكيبيديا تبقى شغّالة
   للاتساع، لكن كلها تمرّ من بوابة المحتوى قبل العرض.
   ============================================================ */

(function (CS) {
  'use strict';

  var KEY = 'cs.catalog';
  var VER = 2;
  /* حد السجلات. القياس الفعلي: ٧٨٥ بايت للسجل (عنوان + ملخّص +
     وسوم + حقل مطابقة)، فالحد يعني ١٫٣ ميغابايت تقريبًا — ضمن حصة
     localStorage المعتادة مع مخزون التصنيفات والوسوم، وعند الامتلاء
     يقصّ الفهرس نفسه نصفين بدل ما يفشل الحفظ بصمت. */
  var MAX = 1800;
  var SWEEP_KEY = 'cs.catalog_sweep';
  var SWEEP_FULL = 6 * 60 * 60 * 1000;    /* فهرس ناضج: كنس كل ٦ ساعات */
  var SWEEP_WARM = 40 * 60 * 1000;        /* فهرس صغير: كل ٤٠ دقيقة حتى يكبر */
  var WARM_AT = 500;                      /* بعدها يُعتبر ناضجًا */

  /* ---------- التخزين ---------- */

  function fresh() { return { v: VER, m: {}, n: 0 }; }

  var db = (function () {
    var raw = CS.store.get(KEY, null);
    if (!raw || raw.v !== VER || !raw.m || typeof raw.m !== 'object' || Array.isArray(raw.m)) return fresh();
    raw.n = Object.keys(raw.m).length;
    /* سجلّات محفوظة بصيغة قديمة (حقل مطابقة بلا مسافات محيطة) */
    Object.keys(raw.m).forEach(function (k) {
      var r = raw.m[k];
      if (r && r.q && r.q.charAt(0) !== ' ') { r.q = ' ' + r.q + ' '; }
      if (r && !r.qt) r.qt = ' ' + norm((r.n || '') + ' ' + (r.o || '')) + ' ';
    });
    return raw;
  })();

  function trimTo(limit) {
    var keys = Object.keys(db.m);
    if (keys.length <= limit) return;

    /* الترتيب بالشهرة وحدها كان يرمي الأعمال المقبولة قبل المرفوضة.
       المرفوض أولًا (ما يخرج في بحث أبدًا)، ثم المجهول، ثم الأقل شهرة. */
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

      /* CS.store.set يبلع خطأ امتلاء التخزين بصمت، فالفهرس يوقف عن
         الحفظ بلا ما يدري أحد ويرجع فاضيًا كل جلسة. نكتب مباشرة
         ونقصّ النصف عند الامتلاء بدل ما نخسره كله. */
      for (var attempt = 0; attempt < 3; attempt++) {
        try {
          window.localStorage.setItem(KEY, JSON.stringify(db));
          return;
        } catch (e) {
          trimTo(Math.floor(Object.keys(db.m).length / 2));
          db.n = Object.keys(db.m).length;
          if (!db.n) return;
        }
      }
    }, 1200);
  }

  function keyOf(item) { return (item.type === 'tv' ? 'v' : 'm') + item.id; }

  /* ---------- تطبيع النص للمطابقة ---------- */

  /* نفس تطبيع البحث: نزع التشكيل وتوحيد الألف والياء والهاء */
  function norm(str) {
    return String(str || '')
      .toLowerCase()
      .replace(/[ً-ٰٟ]/g, '')
      .replace(/[أإآٱ]/g, 'ا')
      .replace(/[ىی]/g, 'ي')
      .replace(/ؤ/g, 'و').replace(/ئ/g, 'ي').replace(/ة/g, 'ه')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /* ------------------------------------------------------------
     صور الكلمة للمطابقة.
     القصّ العدواني كان يخرّب أكثر مما يصلح: «فيلم» تصير «يلم»
     و«فتاة» تصير «تاه» — الفاء والواو حروف أصلية في كلمات كثيرة.
     البديل: ما نقصّ الكلمة، بل نولّد صورها المحتملة ونقبل مطابقة
     أي وحدة منها. «والبحر» تُجرَّب كـ«والبحر» و«البحر» و«بحر»،
     و«فيلم» تبقى «فيلم» ولا تُشوّه.
     ------------------------------------------------------------ */
  function variants(w) {
    var base = String(w || '');
    var out = [base];

    if (/[؀-ۿ]/.test(base)) {
      /* أل التعريف، بمفردها أو بعد لاصقة */
      var noAl = base.replace(/^(?:[وفبكل])?(?:ال)/, '');
      if (noAl && noAl !== base && noAl.length >= 3) out.push(noAl);
      /* «لل» = اللام + أل */
      var noLil = base.replace(/^لل/, '');
      if (noLil !== base && noLil.length >= 3) out.push(noLil);
      /* لاصقة مفردة بلا أل — نضيفها صورةً لا نستبدل بها */
      if (base.length >= 5) {
        var noClitic = base.replace(/^[وفبكل]/, '');
        if (noClitic.length >= 4) out.push(noClitic);
      }
      /* لواحق الجمع والضمائر */
      if (base.length > 5) {
        var noSuffix = base.replace(/(ون|ين|ات|ان|ها|هم|نا|كم)$/, '');
        if (noSuffix.length >= 4 && noSuffix !== base) out.push(noSuffix);
      }
    }

    /* جمع إنجليزي بسيط — «killers» ≡ «killer» */
    if (/^[a-z]{5,}s$/.test(base) && !/(ss|us|is)$/.test(base)) out.push(base.slice(0, -1));

    return out.filter(function (v, i, a) { return v && a.indexOf(v) === i; });
  }

  /* الصورة الأساسية — تُستعمل مفتاحًا لجدول التكرار */
  function stem(w) { return variants(w)[0]; }

  /* ---------- السجل ---------- */

  /* نخزّن ما يلزم للبحث والعرض فقط. البوسترات تُخزَّن كمسار قصير
     لا كرابط كامل — الرابط يُعاد بناؤه عند القراءة. */
  function shrinkImg(url) {
    var m = /\/([^\/]+\.(?:jpg|png|webp))$/i.exec(String(url || ''));
    return m ? m[1] : '';
  }

  function put(item, extra) {
    if (!item || item.source !== 'tmdb' || !item.id) return;
    /* الفهرس عضويته مشروطة: العمل اللي البوابة رفضته صراحةً ما يدخل
       أصلًا. اللي لسه ما وصلت وسومه (null) يدخل مؤقتًا ويُفرز عند
       البحث — تخزينه مجاني ووسومه تجي لاحقًا. */
    if (CS.certs && CS.certs.isAdultWork(item) === false) { drop(item); return; }
    var k = keyOf(item);
    var rec = db.m[k] || {};

    rec.i = item.id;
    rec.t = item.type === 'tv' ? 'v' : 'm';
    rec.n = item.title || rec.n || '';
    rec.o = item.originalTitle || rec.o || '';
    rec.y = item.year || rec.y || null;
    /* الملخّص هو مادة البحث كلها. TMDB يرجّع ملخّصًا فاضيًا كثيرًا
       تحت language=ar-SA للأعمال النادرة، فلو خزّنا حقلًا واحدًا
       صار الفهرس عناوين بلا قصة. نفصل: العربي في d والإنجليزي في e،
       والاثنان يدخلان حقل المطابقة. */
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

    if (extra && extra.keywords) {
      /* أسماء الكلمات هي أقوى مادة مطابقة عندنا بعد الملخّص */
      rec.w = extra.keywords.map(function (x) { return x.name || x; })
        .filter(Boolean).slice(0, 24);
    } else {
      /* الوسوم موجودة أصلًا في مخزون البوابة — العمل ما يدخل الفهرس
         إلا بعد ما تُسحب. عدم قراءتها هنا كان يترك كل سجل بلا وسوم،
         فتشابه «ذات صلة» يفقد أقوى إشاراته ويرجع شبه فاضٍ. */
      var h = CS.certs && CS.certs.cachedHeat(item);
      if (h && h.names && h.names.length > (rec.w || []).length) rec.w = h.names.slice(0, 24);
    }
    if (extra && extra.overviewEn && extra.overviewEn.length > (rec.e || '').length) {
      rec.e = extra.overviewEn;
    }
    if (extra && extra.overviewAr && extra.overviewAr.length > (rec.d || '').length) {
      rec.d = extra.overviewAr;
    }

    /* الحقل المطابَق يُبنى مرة وحدة عند الكتابة لا مع كل بحث.
       نحيطه بمسافات ونطابق ببداية الكلمة: indexOf المجرّد كان يخلي
       «son» تطابق prison و person و lesson، و«حب» تطابق «صاحب». */
    rec.q = ' ' + norm([rec.n, rec.o, rec.d, rec.e, (rec.w || []).join(' ')].join(' ')) + ' ';
    rec.qt = ' ' + norm(rec.n + ' ' + rec.o) + ' ';

    /* العدّاد يُحدَّث فورًا لا عند الحفظ: persist مؤجَّل ١٢٠٠ملّي، فكان
       size() يرجّع رقمًا قديمًا وsweep يحسب «ما انضاف شي» وهو أضاف. */
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

  /* وسوم العمل تصل متأخرة عن بياناته — نلحقها بالسجل أول ما تجي */
  function attachKeywords(item, keywords) {
    if (!item || !keywords) return;
    var k = keyOf(item);
    if (!db.m[k]) { put(item); }
    if (!db.m[k]) return;
    put(item, { keywords: keywords });
  }

  function toItem(rec) {
    var img = CS.tmdb.img;
    var path = rec.p ? '/' + rec.p : '';
    return {
      id: rec.i,
      type: rec.t === 'v' ? 'tv' : 'movie',
      title: rec.n,
      originalTitle: rec.o || '',
      year: rec.y || null,
      date: rec.y ? String(rec.y) : '',
      poster: path ? img(path, CS.config.tmdb.poster.md) : '',
      posterLarge: path ? img(path, CS.config.tmdb.poster.lg) : '',
      backdrop: '',
      rating: rec.r || 0,
      votes: rec.c || 0,
      popularity: rec.x || 0,
      /* الملخّص الإنجليزي كان يُخزَّن ولا يُقرأ، فبطاقات الفهرس تطلع
         بلا سطر قصة أصلًا — وهي أهم ما فيها */
      overview: rec.d || rec.e || '',
      overviewEn: rec.e || '',
      genreIds: rec.g || [],
      adult: rec.a === 1,
      source: 'tmdb',
      fromCatalog: true
    };
  }

  /* ---------- البحث النصي ---------- */

  /* الكلمة النادرة تدل أكثر من الشائعة: «سفينة» أدل من «رجل».
     نحسب التكرار داخل الفهرس نفسه — لا جدول ثابت نخترعه. */
  /* تكرار كل كلمة داخل الفهرس — يُحسب في نفس المرور اللي نبحث فيه.
     النسخة الأولى كانت تمرّ على كل السجلات مرة لكل كلمة ثم مرة
     للبحث: سبعة أضعاف العمل على استعلام من ست كلمات. */
  var dfCache = {}, dfStamp = -1;

  function dfFor(term) {
    if (dfStamp !== db.n) { dfCache = {}; dfStamp = db.n; }
    return dfCache[term];
  }

  /**
   * search(terms, opts) → [{ item, score, hits }]
   * terms: كلمات الوصف بعد التنظيف (عربي و/أو إنجليزي)
   * opts.phrase: الجملة كاملة — تطابقها الحرفي أقوى دليل ممكن
   */
  function search(terms, opts) {
    opts = opts || {};
    /* كل مصطلح يصير مجموعة صور، والمطابقة على أي وحدة منها */
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

    /* مرور واحد: نجمع التكرار والمطابقات معًا، ثم نزن بالتكرار بعده */
    var known = list.every(function (t) { return dfFor(t.key) !== undefined; });
    var df = {};
    list.forEach(function (t) { df[t.key] = known ? dfCache[t.key] : 0; });

    var raw = [];
    Object.keys(db.m).forEach(function (k) {
      var rec = db.m[k];
      var hay = rec.q || '';
      if (!hay) return;

      /* دفاع في العمق: حتى لو دخل سجل قبل ما نعرف وسومه، ما يخرج
         من البحث إلا إذا البوابة قالت نعم صراحةً */
      var it0 = toItem(rec);
      if (CS.certs && CS.certs.isAdultWork(it0) !== true) return;
      if (CS.certs && CS.certs.kindFits && CS.certs.kindFits(it0) === false) return;

      var hits = [], inTitle = {};
      var titleHay = rec.qt || (' ' + norm(rec.n + ' ' + rec.o) + ' ');
      list.forEach(function (t) {
        /* بداية الكلمة لا وسطها — يسمح بالسوابق واللواحق ويمنع
           «son» من مطابقة «prison». أي صورة من صور المصطلح تكفي. */
        var hit = t.forms.some(function (f) { return hay.indexOf(' ' + f) !== -1; });
        if (!hit) return;
        hits.push(t.key);
        if (!known) df[t.key] = (df[t.key] || 0) + 1;
        if (t.forms.some(function (f) { return titleHay.indexOf(' ' + f) !== -1; })) inTitle[t.key] = true;
      });
      if (!hits.length) return;

      raw.push({ rec: rec, hits: hits, inTitle: inTitle,
                 phraseHit: !!(phrase && phrase.length >= 14 && hay.indexOf(phrase) !== -1) });
    });

    if (!known) { list.forEach(function (t) { dfCache[t.key] = df[t.key] || 0; }); dfStamp = db.n; }

    raw.forEach(function (r) {
      var score = 0, titleAdd = 0;
      r.hits.forEach(function (t) {
        /* وزن معكوس التكرار: كلمة في ١٪ من الفهرس تساوي أضعاف كلمة في نصفه */
        var idf = Math.log((total + 1) / ((df[t] || 0) + 1)) + 1;
        score += idf * 10;
        /* الكلمة في العنوان ترجّح قليلًا فقط: ٦ أضعاف كانت تقلب
           البحث بالوصف إلى بحث بالاسم — عمل اسمه فيه كلماتك يتقدّم
           على عمل قصته هي وصفك بالضبط */
        if (r.inTitle[t]) titleAdd += idf * 2.2;
      });

      /* سقف لمساهمة العنوان كلها — ما تتجاوز خُمس درجة الجسد */
      score += Math.min(titleAdd, score * 0.2);

      /* تغطية الوصف: عمل يحمل ٤ من ٥ كلمات أقوى بكثير من واحد يحمل ١ */
      var cov = r.hits.length / list.length;
      score *= (0.45 + cov * 1.55);
      if (r.hits.length >= 3) score += 28;
      if (r.hits.length >= 5) score += 34;

      /* التطابق الحرفي للجملة دليل قوي لكنه ما يلغي التغطية:
         ٢٦٠ نقطة كانت تخلي مطابقة عرَضية واحدة تتصدّر على عمل
         يجمع كل كلمات الوصف. صار مضاعفًا مشروطًا بالتغطية. */
      if (r.phraseHit && cov >= 0.5) score += 60 + cov * 90;

      /* الشهرة ترجّح قليلًا عند التساوي، وما تقلب الترتيب */
      score += Math.min(8, Math.log10((r.rec.x || 0) + 1) * 3.2);

      out.push({ rec: r.rec, score: score, hits: r.hits, coverage: cov });
    });

    out.sort(function (a, b) { return b.score - a.score; });
    return out.slice(0, opts.limit || 80).map(function (r) {
      var item = toItem(r.rec);
      item.catalogScore = r.score;
      item.catalogHits = r.hits;
      item.catalogCoverage = r.coverage;
      return item;
    });
  }

  /* ------------------------------------------------------------
     الأعمال ذات الصلة — من الفهرس، بتشابه حقيقي.
     ترشيحات TMDB لعمل إيروتيكي نادر رديئة أصلًا (مبنيّة على شهرة
     ومشاهدات لا على محتوى)، وبعد ما تمرّ من البوابة ما يبقى منها
     إلا عمل أو اثنان بلا علاقة. الفهرس عندنا مئات الأعمال المقبولة
     مع وسومها وملخّصاتها، فالتشابه يُحسب فعليًا:

       ١) الوسوم المشتركة، موزونة بندرتها — «nunsploitation» تدل
          أضعاف ما تدل «nudity» لأن الأخيرة على كل عمل تقريبًا.
       ٢) تقاطع كلمات القصة بين الملخّصين.
       ٣) النوع، ثم قرب السنة — مرجّحات لا أساس.
     ------------------------------------------------------------ */

  /* عتبة «الوسم النادر»: تحتها الوسم شائع فمشاركته لا تدل */
  var RARE_IDF = 2.2;

  /* تكرار كل وسم داخل الفهرس — يُحسب مرة ويُعاد بناؤه لما يكبر */
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

  /* كلمات القصة الدالة — نفس تطبيع البحث، بلا كلمات الحشو */
  var PLOT_STOP = (' the a an of in on at to for and or but is are was were be been with from by '
    + 'that this these those his her its their he she they it as into over under about after his '
    + 'her when where who while them him them one two his own new life world man woman young '
    + 'في من على عن الى مع بعد قبل عند كل بعض غير هو هي هم التي الذي هذا هذه ذلك تلك بين ثم لكن '
    + 'حياة عالم رجل امراه شاب فتاه سنه عام قصه فيلم مسلسل ').split(/\s+/);

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
   * similarTo(base, opts) → قائمة أعمال مرتّبة بالأقرب
   * base: عمل فيه keywords و overview (صفحة العمل تعطيهما معًا)
   * opts.limit · opts.exclude (مفاتيح نستبعدها)
   */
  function similarTo(base, opts) {
    opts = opts || {};
    if (!base) return [];

    var selfKey = keyOf(base);
    var exclude = opts.exclude || {};
    var df = keywordDf();
    var total = Math.max(1, db.n || Object.keys(db.m).length);

    /* وسوم العمل: من التفاصيل مباشرة، وإلا من سجلّه في الفهرس */
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
    var baseGenres = base.genreIds || (rec0 && rec0.g) || [];
    var kwNames = Object.keys(baseKw);

    /* بلا وسوم ولا قصة ما فيه شي نقيس عليه */
    if (!kwNames.length && !baseTerms.length) return [];

    var out = [];
    Object.keys(db.m).forEach(function (k) {
      if (k === selfKey || exclude[k]) return;
      var rec = db.m[k];
      var it0 = toItem(rec);
      if (CS.certs && CS.certs.isAdultWork(it0) !== true) return;
      if (CS.certs && CS.certs.kindFits && CS.certs.kindFits(it0) === false) return;

      var score = 0, why = [];

      /* ١) الوسوم المشتركة موزونة بالندرة */
      var kwHits = 0, bestIdf = 0;
      (rec.w || []).forEach(function (n) {
        var t = String(n || '').toLowerCase();
        if (!baseKw[t]) return;
        kwHits++;
        var idf = Math.log((total + 1) / ((df[t] || 0) + 1)) + 1;
        if (idf > bestIdf) bestIdf = idf;
        score += 14 * idf;
        if (why.length < 4) why.push(t);
      });
      /* التقاطع نفسه إشارة: وسمان مشتركان أقوى من ضعف وسم واحد */
      if (kwHits > 1) score += (kwHits - 1) * 18;

      /* ٢) تقاطع كلمات القصة */
      var hay = rec.q || '';
      var termHits = 0;
      baseTerms.forEach(function (t) {
        if (hay.indexOf(' ' + t) === -1) return;
        termHits++;
        score += 7;
      });
      if (termHits > 2) score += (termHits - 2) * 6;

      /* أرضية الصلة: وسم عام واحد مشترك ما يكفي. «erotica» على نصف
         الكتالوج، فمشاركتها لا تجعل العملين متشابهين. المطلوب إما
         وسمان، أو وسم نادر، أو تقاطع حقيقي في القصة. */
      var weak = kwHits < 2 && termHits < 2 && bestIdf < RARE_IDF;
      if ((!kwHits && termHits < 2) || weak) return;

      /* ٣) مرجّحات */
      var g = rec.g || [];
      var sharedG = g.filter(function (x) { return baseGenres.indexOf(x) !== -1; }).length;
      score += sharedG * 4;
      if (rec.y && base.year) score -= Math.min(7, Math.abs(rec.y - base.year) / 7);
      score += Math.min(5, Math.log10((rec.x || 0) + 1) * 2);

      out.push({ rec: rec, score: score, kwHits: kwHits, termHits: termHits, why: why });
    });

    out.sort(function (a, b) { return b.score - a.score; });

    return out.slice(0, opts.limit || 200).map(function (r) {
      var item = toItem(r.rec);
      item.relScore = r.score;
      item.relKw = r.why;
      item.relKwHits = r.kwHits;
      item.relTermHits = r.termHits;
      return item;
    });
  }

  /* ---------- الكنس: توسيع الفهرس في الخلفية ---------- */

  var sweeping = false;
  var inFlight = null;         /* الكنسة الجارية — نشاركها بدل ما نرفض */
  var round = 0;               /* كل كنسة تحرث أرضًا جديدة لا نفس الأرض */
  var sweptThisLoad = false;   /* كنسة واحدة لكل فتحة صفحة مهما تنقّلت */

  /**
   * يوسّع الفهرس بصفحات من كتالوج الكبار.
   * ما ينادى إلا على فترات — الهدف تغطية أوسع للبحث لا تحميل الصفحة.
   */
  function sweep(force) {
    if (!CS.hasKey()) return Promise.resolve(0);

    /* كنسة جارية؟ نرجّع نفسها بدل صفرٍ فوري. الضغط على زرّ الفهرس
       أثناء كنسة الخلفية كان يرجع بلا شي فيبان الزرّ معطّلًا. */
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

      /* كل نداء بكلمة واحدة لا باتحاد كلمات. الفرق جوهري:
         العمل الراجع من with_keywords=<id> واحد يحمل تلك الكلمة
         قطعًا، فنعرف وسمه مجانًا بلا طلب /keywords لكل عمل.
         الاتحاد كان يرجّع أعمالًا ما ندري أي كلمة جابتها. */
      var names = CS.feed.keywordNames ? CS.feed.keywordNames('general') : {};

      /* حجم الكنسة يتبع نضج الفهرس: الزيارات الأولى توسّع بجدّية،
         وبعد ما يكبر تكفي جولة خفيفة تلتقط الجديد. */
      var mature = db.n >= WARM_AT;
      var SORTS = ['popularity.desc', 'vote_count.desc', 'primary_release_date.desc',
                   'vote_average.desc', 'revenue.desc'];

      /* كل جولة تنقل الترتيب والصفحة. بدونها كانت الكنسة الثانية تطلب
         نفس الروابط حرفيًا، فتُخدَم من ذاكرة الطلبات وترجع نفس الأعمال
         وما يزيد الفهرس شيئًا — والزرّ يبان كأنه ما سوّى شي. */
      round++;
      var pageBase = 1 + ((round - 1) * 2) % 8;
      var plan = [];
      ids.slice(0, mature ? 8 : 14).forEach(function (id, i) {
        var sortBy = SORTS[(i + round) % SORTS.length];
        plan.push({ type: 'movie', id: id, sort_by: sortBy, page: pageBase });
        if (!mature) plan.push({ type: 'movie', id: id, sort_by: sortBy, page: pageBase + 1 });
        if (i % 2 === 0) plan.push({ type: 'tv', id: id, sort_by: sortBy, page: 1 + (round % 3) });
      });

      var before = db.n;
      return CS.util.pool(plan, 4, function (job) {
        var q = {
          with_keywords: String(job.id),
          /* الملخّص الإنجليزي هو مادة البحث: TMDB يرجّع ملخّصًا فاضيًا
             تحت ar-SA لأغلب هذي الأعمال، فالكنس يطلب الإنجليزي صراحةً
             ويخزّنه في حقل منفصل عن العربي. */
          language: 'en-US',
          sort_by: job.type === 'tv' && job.sort_by === 'primary_release_date.desc'
            ? 'first_air_date.desc' : job.sort_by
        };
        /* الترتيب بالتقييم بلا حد أصوات يرفع أعمالًا بصوت واحد */
        if (job.sort_by === 'vote_average.desc') q['vote_count.gte'] = 15;
        return CS.tmdb.discover(job.type, q, job.page)
          .then(function (list) {
            var name = names[job.id];
            (list || []).forEach(function (it) {
              /* دليل المصدر: هذا العمل يحمل هذي الكلمة، بلا طلب */
              if (name && CS.certs.seedKeyword) CS.certs.seedKeyword(it, name);
            });
            add(list);
            return (list || []).length;
          })
          .catch(function () { return 0; });
      }).then(function () {
        sweeping = false; inFlight = null;
        return db.n - before;
      });
    }).catch(function () { sweeping = false; inFlight = null; return 0; });

    return inFlight;
  }

  CS.catalog = {
    add: add,
    drop: drop,
    put: put,
    attachKeywords: attachKeywords,
    search: search,
    similarTo: similarTo,
    plotTerms: plotTerms,
    keywordIdf: function (name) {
      var df = keywordDf();
      var total = Math.max(1, db.n || Object.keys(db.m).length);
      return Math.log((total + 1) / ((df[String(name || '').toLowerCase()] || 0) + 1)) + 1;
    },
    sweep: sweep,
    size: function () { return db.n || Object.keys(db.m).length; },
    has: function (item) { return !!db.m[keyOf(item)]; },
    record: function (item) { return db.m[keyOf(item)] || null; },
    toItem: toItem,
    norm: norm,
    stem: stem,
    variants: variants,
    clear: function () { db = fresh(); CS.store.set(KEY, db); CS.store.remove(SWEEP_KEY); }
  };

})(window.CS);
