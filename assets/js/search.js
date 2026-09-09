/* ============================================================
   search.js — منسّق البحث متعدد المحركات
   1) بالاسم    : TMDB /search/multi
   2) بوصف القصة: ويكيبيديا (نص كامل) ← مطابقة مع TMDB
   3) بالثيمة   : TMDB keywords ← discover
   ثم دمج + ترتيب + إضافة الأعمال ذات الصلة.
   ============================================================ */

(function (CS) {
  'use strict';

  var LIM = CS.config.limits;

  /* ---------- تطبيع النصوص للمقارنة ---------- */

  function norm(str) {
    return String(str || '')
      .toLowerCase()
      .replace(/[ً-ٰٟ]/g, '')      // تشكيل
      .replace(/[أإآٱ]/g, 'ا')
      .replace(/[ىی]/g, 'ي')
      .replace(/ؤ/g, 'و').replace(/ئ/g, 'ي').replace(/ة/g, 'ه')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function similarity(a, b) {
    a = norm(a); b = norm(b);
    if (!a || !b) return 0;
    if (a === b) return 1;
    if (a.indexOf(b) === 0 || b.indexOf(a) === 0) return .88;
    if (a.indexOf(b) !== -1 || b.indexOf(a) !== -1) return .74;

    var wa = a.split(' '), wb = b.split(' ');
    var hit = wa.filter(function (w) { return w.length > 2 && wb.indexOf(w) !== -1; }).length;
    return hit ? Math.min(.7, hit / Math.max(wa.length, wb.length)) : 0;
  }

  /* ---------- نية الاستعلام ---------- */

  var PLOT_HINTS = /(عن |قصة|حكاية|يحكي|يتكلم|فيه واحد|رجل |امرأة |ولد |شاب |فتاة |بطل |يعيش|يحاول|يكتشف|ينتقم|about |story |guy who|man who|woman who|where a |a movie|a series|في مسلسل|في فيلم)/i;

  function detectIntent(query) {
    var words = CS.util.words(query);
    if (words.length >= 6) return 'plot';
    if (PLOT_HINTS.test(query) && words.length >= 4) return 'plot';
    if (words.length <= 3) return 'title';
    return 'mixed';
  }

  /* ------------------------------------------------------------
     بوابة المحتوى — لا يمرّ منها إلا عمل وسمه TMDB بمحتوى جنسي.
     تُطبَّق على مخرجات كل المحرّكات بلا استثناء، بعد سحب الوسوم.
     العمل اللي ما وصلت وسومه يُمنع، لا يُعرض «على الشك» —
     البوابة تُغلق عند الجهل لا تُفتح.
     ------------------------------------------------------------ */

  var GATE_CAP = 72;      /* كم مرشّحًا نسحب وسومه قبل الحكم */

  function gate(items, meta) {
    var list = (items || []).filter(Boolean);
    var before = list.length;

    /* ويكيبيديا بلا مقابل في TMDB ما لها وسوم نتحقق منها — تسقط هنا */
    var checkable = list.filter(function (it) { return it.source === 'tmdb'; });

    /* نرتّب حسب قوة الدليل قبل ما نقصّ، عشان القصّ ما يضيّع الأقوى */
    checkable.sort(function (a, b) { return (b.engineScore || 0) - (a.engineScore || 0); });

    var need = checkable.filter(function (it) { return CS.certs.isAdultWork(it) === null; })
                        .slice(0, GATE_CAP);

    return CS.util.pool(need, 8, function (it) {
      return CS.certs.fetchHeat(it).catch(function () { return null; });
    }).then(function () {
      var kept = checkable.filter(function (it) { return CS.certs.isAdultWork(it) === true; });
      if (meta) {
        meta.gateIn = before;
        meta.gateOut = kept.length;
        meta.gateDropped = before - kept.length;
      }
      return kept;
    });
  }

  /* ------------------------------------------------------------
     محرك ٠: الفهرس المحلي — المحرّك الأساسي للبحث بالوصف.
     TMDB ما يبحث في نص القصة، وويكيبيديا بطيئة وضيّقة. الفهرس
     عندنا يحمل ملخّصات مئات الأعمال الجنسية، فمطابقة الوصف تصير
     محليًا وفوريًا — وما فيه فيه عمل عام أصلًا ليتسرّب.
     ------------------------------------------------------------ */
  function engineCatalog(q, qEn, meta) {
    if (!CS.catalog || !CS.catalog.size()) return [];

    /* المصطلحات: العربية كما هي (الفهرس فيه ملخّصات عربية كمان)،
       والإنجليزية من الترجمة، وإن سقطت الترجمة فمن المعجم. */
    var terms = contentWords(q);
    if (qEn && qEn !== q) terms = terms.concat(contentWords(qEn));
    else if (CS.util.isArabic(q)) {
      var lex = lexTranslate(q);
      if (lex.length) {
        terms = terms.concat(lex);
        if (meta) meta.lexFallback = lex.length;
      }
    }
    terms = terms.filter(function (t, i, a) { return a.indexOf(t) === i; });
    if (!terms.length) return [];

    var hits = CS.catalog.search(terms, { phrase: qEn || q, limit: 60 });
    if (!hits.length) return [];

    return hits.map(function (item, i) {
      item.why = 'catalog';
      item.hits = item.catalogHits || [];
      var n = item.hits.length;
      item.whyText = n > 1
        ? 'يطابق ' + n + ' من عناصر وصفك: ' + item.hits.slice(0, 4).join(' + ')
        : 'يطابق «' + (item.hits[0] || '') + '» في القصة';

      /* مقياس مطلق لا نسبة للأفضل: القسمة على أعلى درجة كانت تعطي
         المتصدّر ١٠٨ دائمًا حتى لو مطابقته كلمة واحدة ضعيفة، فيدخل
         نتيجة رديئة على رأس القائمة بثقة ما تستحقها. */
      var cov = item.catalogCoverage || 0;
      item.engineScore = 18 + cov * 62 + Math.min(26, (item.catalogScore || 0) / 14)
                       - Math.min(i, 20) * 0.35;
      return item;
    });
  }

  /* ---------- محرك 1: بالاسم ---------- */

  /**
   * البحث بالاسم على مرحلتين:
   *  أ) نبحث بالنص كما كتبه المستخدم — TMDB يفهرس العناوين العربية
   *  ب) ما لقينا تطابقًا قويًا؟ عندها فقط نستعين بالترجمة الإنجليزية
   * الترتيب هذا يمنع الترجمة من إغراق نتيجة عربية صحيحة.
   */
  function engineTitle(q, qEn) {
    if (!CS.hasKey()) return engineTitleWiki(q, qEn);

    function score(items, viaTranslation) {
      return items.map(function (item, i) {
        var sim = Math.max(similarity(item.title, q), similarity(item.originalTitle, q),
                           qEn ? similarity(item.title, qEn) : 0,
                           qEn ? similarity(item.originalTitle, qEn) : 0);
        item.titleSim = sim;
        item.why = item.viaPerson ? 'person' : 'title';
        item.whyText = item.viaPerson ? ('من أعمال ' + item.viaPerson)
                     : viaTranslation ? 'مطابقة بالاسم (عبر الترجمة)' : 'مطابقة بالاسم';

        var base = item.viaPerson ? 34 : 66;
        if (viaTranslation) base -= 16;              /* الترجمة أضعف دليلًا */
        if (sim >= .85) base += 55;                  /* تطابق شبه تام ← يتصدّر */
        else if (sim >= .7) base += 26;
        item.engineScore = base + sim * 40 - Math.min(i, 14);
        return item;
      });
    }

    var native = Promise.all([
      CS.tmdb.searchMulti(q).catch(function () { return { items: [] }; }),
      CS.tmdb.searchTitleBoth(q).catch(function () { return []; })
    ]).then(function (r) {
      var seen = {}, out = [];
      (r[0].items || []).concat(r[1]).forEach(function (it) {
        var k = it.type + ':' + it.id;
        if (seen[k]) return;
        seen[k] = true;
        out.push(it);
      });
      return score(out, false);
    });

    return native.then(function (items) {
      var best = items.reduce(function (m, x) { return Math.max(m, x.titleSim || 0); }, 0);

      /* لقينا العمل بالعربي؟ خلاص، ما نحتاج نترجم */
      if (best >= .7 || !qEn || norm(qEn) === norm(q)) return items;

      return CS.tmdb.searchMulti(qEn)
        .catch(function () { return { items: [] }; })
        .then(function (r) {
          var have = {};
          items.forEach(function (x) { have[x.type + ':' + x.id] = true; });
          var extra = (r.items || []).filter(function (x) { return !have[x.type + ':' + x.id]; });
          return items.concat(score(extra, true));
        });
    });
  }

  /* بديل بدون مفتاح: نبحث بالاسم داخل ويكيبيديا */
  function engineTitleWiki(q, qEn) {
    var jobs = [CS.wiki.findWorks('ar', q, 10)];
    if (qEn && qEn !== q) jobs.push(CS.wiki.findWorks('en', qEn, 10));
    else if (!CS.util.isArabic(q)) jobs.push(CS.wiki.findWorks('en', q, 10));

    return Promise.all(jobs).then(function (sets) {
      var out = [];
      sets.forEach(function (set) {
        set.forEach(function (w) {
          var item = fromWiki(w);
          item.why = 'title';
          item.whyText = 'مطابقة بالاسم (ويكيبيديا)';
          item.engineScore = 58 + similarity(w.cleanTitle, q) * 40 - w.rank;
          out.push(item);
        });
      });
      return out;
    });
  }

  /**
   * يبني عنصرًا من صفحة ويكيبيديا ما لقينا لها مقابلًا في TMDB.
   * كانت هذي الدالة تُستدعى في ثلاثة مواضع وهي غير معرّفة أصلًا، فترمي
   * ReferenceError يبتلعه catch في آخر enginePlot — فيرجع المحرّك [] كاملًا.
   * يعني: أي بحث بالوصف تفشل فيه نتيجة واحدة في المطابقة كان يخسر
   * نتائج القصة كلها. وهذي بالضبط الأعمال النادرة اللي البحث بالوصف موجود لها.
   */
  function fromWiki(w) {
    return {
      id: 'w' + (w.wikiPageId || 0),
      type: w.type === 'tv' ? 'tv' : 'movie',
      title: w.cleanTitle || w.wikiTitle || '',
      originalTitle: '',
      year: w.year || null,
      poster: w.thumb || '',
      posterLarge: w.thumb || '',
      backdrop: '',
      rating: 0,
      votes: 0,
      popularity: 0,
      overview: w.description || (w.extract || '').slice(0, 300),
      plotSnippet: w.extract || '',
      genreIds: [],
      adult: false,
      source: 'wiki',
      wikiPageId: w.wikiPageId,
      wikiTitle: w.wikiTitle,
      wikiLang: w.wikiLang,
      wikiUrl: w.wikiUrl
    };
  }

  /* ---------- محرك 2: بوصف القصة ---------- */

  function enginePlot(q, qEn, asTitle) {
    /* الويكي العربية كانت تُستدعى حتى للاستعلام الإنجليزي الصرف، وتأخذ
       أفضلية رتبة على الإنجليزية — فيتقدّم ضجيج عربي على نتيجة صحيحة.
       نستدعي كل ويكي بلغتها فقط، وبلا أفضلية لأي منهما. */
    var isAr = CS.util.isArabic(q);
    var english = qEn || (!isAr ? q : '');
    var jobs = [];
    if (isAr) jobs.push(CS.wiki.findWorks('ar', q, LIM.wikiSearch));
    if (english) jobs.push(CS.wiki.findWorks('en', english, LIM.wikiSearch));
    if (!jobs.length) jobs.push(CS.wiki.findWorks('ar', q, LIM.wikiSearch));

    return Promise.all(jobs).then(function (sets) {
      /* دمج نتائج الويكيين قبل المطابقة */
      var seen = {}, works = [];
      sets.forEach(function (set) {
        set.forEach(function (w) {
          var k = norm(w.cleanTitle) + '|' + (w.year || '');
          if (seen[k]) { seen[k].rank = Math.min(seen[k].rank, w.rank); return; }
          seen[k] = w;
          works.push(w);
        });
      });
      works.sort(function (a, b) { return a.rank - b.rank; });
      works = works.slice(0, LIM.wikiResolve);

      /* كم من كلمات وصفك موجودة فعلًا في مقتطف ويكيبيديا؟
         المقتطف يجي مع البحث بلا تكلفة، وكان يُرمى — والترتيب كان
         يعتمد على موقع النتيجة في ويكيبيديا وحده بلا أي مقارنة بالنص. */
      var terms = contentWords(english || q);
      function coverage(w) {
        if (!terms.length) return 0;
        var hay = ((w.snippet || '') + ' ' + (w.description || '') + ' ' +
                   (w.extract || '').slice(0, 600)).toLowerCase();
        var hit = terms.filter(function (t) { return hay.indexOf(t.toLowerCase()) !== -1; }).length;
        return hit / terms.length;
      }

      /* على بحث بالاسم نصنّف النتيجة كمطابقة عنوان لا كمطابقة قصة */
      function label(w, resolved) {
        if (!asTitle) return resolved ? 'مطابقة في القصة' : 'مطابقة في القصة (ويكيبيديا)';
        return 'مطابقة بالاسم (ويكيبيديا)';
      }
      function bonus(w, item) {
        if (!asTitle) return 0;
        var sim = Math.max(similarity(w.cleanTitle, q), similarity((item || {}).title || '', q));
        if (item) item.titleSim = Math.max(item.titleSim || 0, sim);
        return sim >= .85 ? 52 : sim >= .7 ? 24 : 0;
      }

      if (!CS.hasKey()) {
        return works.map(function (w) {
          var item = fromWiki(w);
          item.why = asTitle ? 'title' : 'plot';
          item.whyText = label(w, false);
          item.engineScore = 52 - w.rank * 1.1 + coverage(w) * 46 + bonus(w, item);
          return item;
        });
      }

      /* مطابقة كل عمل مع TMDB عشان نجيب البوستر والتقييم والمشابهات */
      return CS.util.pool(works, 4, function (w) {
        return CS.tmdb.searchByTitle(w.type, w.cleanTitle, w.year).then(function (cands) {
          var best = pickBest(cands, w);
          if (!best) {
            var fb = fromWiki(w);
            fb.why = asTitle ? 'title' : 'plot';
            fb.whyText = label(w, false);
            fb.engineScore = 40 - w.rank * 1.1 + coverage(w) * 46 + bonus(w, fb);
            return fb;
          }
          best.why = asTitle ? 'title' : 'plot';
          best.whyText = label(w, true);
          best.wikiUrl = w.wikiUrl;
          best.wikiTitle = w.wikiTitle;
          best.wikiLang = w.wikiLang;
          best.plotSnippet = w.extract;
          best.engineScore = 58 - w.rank * 1.1 + coverage(w) * 52 + bonus(w, best);
          return best;
        });
      });
    });
  }

  function pickBest(cands, work) {
    if (!cands || !cands.length) return null;
    var scored = cands.slice(0, 6).map(function (c) {
      var s = similarity(c.title, work.cleanTitle) * 40
            + similarity(c.originalTitle || '', work.cleanTitle) * 40;
      if (work.year && c.year) {
        var d = Math.abs(c.year - work.year);
        s += d === 0 ? 40 : d === 1 ? 22 : d <= 3 ? 6 : -25;
      }
      s += Math.min(10, Math.log10((c.popularity || 0) + 1) * 5);
      return { c: c, s: s };
    }).sort(function (a, b) { return b.s - a.s; });

    return scored[0].s > 18 ? scored[0].c : null;
  }

  /* ---------- محرك 3: بالثيمة (الكلمات المفتاحية) ---------- */

  /* كلمات لا تحمل معنى للبحث — إبقاؤها يضيّع نداءات ويجيب نتائج عشوائية */
  var STOP = ('the a an of in on at to for and or but is are was were be been with from by '
    + 'that this these those his her its their he she they it as into over under about after '
    + 'before who whom which what when where why how not no there then than out up down off '
    /* مفردات صياغة البحث نفسها: «أدور فيلم عن…» — كانت تُحسب كلمات
       وصف فتنزل نسبة التغطية وتتقدّم أعمال طابقت الحشو لا القصة */
    + 'film films movie movies series show shows season episode watch looking search find want '
    + 'something anything remember forgot name title called saw seen watched please help know '
    + 'يكون تكون التي الذي الذين هذا هذه ذلك تلك في من على عن الى إلى مع بعد قبل عند كل بعض '
    + 'غير هو هي هم انا أنا انت أنت لكن ايضا أيضا كان كانت صار صارت جدا جدًا حيث لما عندما '
    + 'فيلم افلام أفلام مسلسل مسلسلات حلقه حلقة موسم عمل اعمال أعمال قصه قصة احداث أحداث '
    + 'ابغى أبغى ابي أبي ابحث أبحث ادور أدور اريد أريد شفت شاهدت اتذكر أتذكر نسيت اسم اسمه '
    + 'ممكن ياليت لو سمحت ايش أيش وش شي شيء واحد وحده يعني تقريبا تقريبًا مره مرة').split(/\s+/);

  function isStop(w) { return STOP.indexOf(String(w).toLowerCase()) !== -1; }

  /* الكلمات ذات المعنى في الاستعلام.
     كانت تُرتَّب بالطول وتُقصّ على ست: الطول ليس دليل دلالة —
     «stranded» أدلّ من «description» وأقصر منها. الآن نبقيها
     بترتيبها ونوسّع العدد، ووزن الندرة (IDF) في الفهرس هو اللي
     يقرّر أي كلمة تستحق أكثر. */
  function contentWords(text) {
    return CS.util.words(text)
      .map(function (w) { return String(w).replace(/^[«»"'(),.؟?!:;]+|[«»"'(),.؟?!:;]+$/g, ''); })
      .filter(function (w) { return w.length >= 3 && !isStop(w); })
      .filter(function (w, i, a) { return a.indexOf(w) === i; })
      .slice(0, 12);
  }

  /* ------------------------------------------------------------
     معجم وصف مصغّر عربي ← إنجليزي.
     ملخّصات TMDB لهذي الأعمال إنجليزية في الغالب، والترجمة الحيّة
     قد تسقط (شبكة، حد استخدام، خدمة مقفلة). بدونها كان الوصف
     العربي يطابق فهرسًا إنجليزيًا فيرجع صفرًا — وهذا أهم استخدام
     للموقع. المعجم يغطّي مفردات وصف القصص الشائعة فقط، وما يدّعي
     ترجمة جملة: هدفه أن يبقى البحث شغّالًا لا أن يحل محل الترجمة.
     ------------------------------------------------------------ */
  var AR_EN = {
    'رجل':'man','رجال':'men','امراه':'woman','امرأة':'woman','نساء':'women','ولد':'boy',
    'بنت':'girl','فتاه':'girl','فتاة':'girl','شاب':'young man','شابه':'young woman',
    'زوج':'husband','زوجه':'wife','زوجة':'wife','زواج':'marriage','متزوجه':'married',
    'متزوج':'married','عشيق':'lover','عشيقه':'mistress','حبيب':'lover','حبيبه':'lover',
    'عائله':'family','عائلة':'family','اسره':'family','ام':'mother','اب':'father',
    'ابن':'son','ابنه':'daughter','اخت':'sister','اخ':'brother','جار':'neighbor',
    'جاره':'neighbor','خادمه':'maid','مربيه':'nanny','ممرضه':'nurse','طبيب':'doctor',
    'معلم':'teacher','معلمه':'teacher','طالب':'student','طالبه':'student','استاذ':'professor',
    'راقصه':'dancer','ممثله':'actress','ممثل':'actor','مصور':'photographer','رسام':'painter',
    'كاتب':'writer','مخرج':'director','عارضه':'model','صياد':'fisherman','بحار':'sailor',
    'جندي':'soldier','ضابط':'officer','شرطي':'police','لص':'thief','سجين':'prisoner',
    'سجن':'prison','قاتل':'killer','جريمه':'crime','انتقام':'revenge','خيانه':'betrayal',
    'خيانة':'infidelity','سر':'secret','اسرار':'secrets','كذب':'lie','حب':'love',
    'شهوه':'lust','شهوة':'lust','رغبه':'desire','رغبة':'desire','اغراء':'seduction',
    'اغواء':'seduction','هوس':'obsession','غيره':'jealousy','وحده':'loneliness',
    'انتقال':'moves','يعيش':'lives','يكتشف':'discovers','تكتشف':'discovers',
    'يقع':'falls','تقع':'falls','يهرب':'escapes','تهرب':'escapes','يبحث':'searches',
    'تبحث':'searches','يعود':'returns','تعود':'returns','يلتقي':'meets','تلتقي':'meets',
    'ينتقم':'avenges','يخون':'cheats','تخون':'cheats','يغري':'seduces','تغري':'seduces',
    'بيت':'house','منزل':'house','فيلا':'villa','شقه':'apartment','فندق':'hotel',
    'قصر':'mansion','مزرعه':'farm','قريه':'village','مدينه':'city','جزيره':'island',
    'شاطئ':'beach','بحر':'sea','غابه':'forest','صحراء':'desert','جبل':'mountain',
    'قطار':'train','سياره':'car','سفينه':'ship','طائره':'plane','مستشفى':'hospital',
    'مدرسه':'school','جامعه':'university','كنيسه':'church','دير':'convent','ملهى':'nightclub',
    'حفله':'party','رحله':'trip','صيف':'summer','شتاء':'winter','ليل':'night','نهار':'day',
    'حرب':'war','ثوره':'revolution','ماضي':'past','ذكريات':'memories','حلم':'dream',
    'كابوس':'nightmare','مراهقه':'teenager','مراهق':'teenager','عاريه':'naked','عاري':'naked',
    'عري':'nudity','تعري':'nudity','جنس':'sex','جنسي':'erotic','اثاره':'erotic',
    'حسي':'sensual','مثير':'steamy','خيال':'fantasy','رعب':'horror','غموض':'mystery'
  };

  /* ترجمة كلمة بكلمة للوصف — بديل احتياطي لا أكثر */
  function lexTranslate(q) {
    var out = [];
    CS.util.words(String(q || '')).forEach(function (w) {
      var k = CS.catalog ? CS.catalog.norm(w) : String(w).toLowerCase();
      var stemmed = CS.catalog ? CS.catalog.stem(k) : k;
      var hit = AR_EN[k] || AR_EN[stemmed];
      if (hit) out.push(hit);
    });
    return out.filter(function (v, i, a) { return a.indexOf(v) === i; });
  }

  /**
   * محرك الثيمة — أُعيد بناؤه.
   * قبل: يبحث بالجملة كاملة ككلمة مفتاحية واحدة، وإذا فشلت يجرّب أطول كلمة وحدها.
   * جملة مثل «The mother is naked in front of her son» ما تطابق أي كلمة مفتاحية،
   * فكانت النتيجة تنبني على كلمة واحدة عشوائية.
   * الآن: نفكّك الجملة لكلماتها الدالة، نحلّ كل وحدة لكلمة TMDB مفتاحية،
   * ثم نرتّب الأعمال حسب كم كلمة من كلماتك تحملها — العمل اللي يجمع
   * «mother» و«nudity» و«son» يتقدّم على اللي يحمل وحدة فقط.
   */
  function engineTheme(q, qEn, wantWide) {
    if (!CS.hasKey()) return Promise.resolve([]);
    var probe = qEn || q;

    /* الجملة كاملة أولًا: أحيانًا تكون هي نفسها كلمة مفتاحية («time loop») */
    var terms = [probe].concat(contentWords(probe));

    return CS.util.pool(terms, 4, function (t) {
      return CS.tmdb.searchKeywords(t).then(function (list) {
        /* المطابقة الحرفية أدق من أول نتيجة، ونقبل أقرب واحدة عند غيابها */
        var exact = (list || []).filter(function (k) {
          return String(k.name || '').toLowerCase() === String(t).toLowerCase();
        })[0];
        var pick = exact || (list || [])[0];
        return pick ? { id: pick.id, name: pick.name, term: t, exact: !!exact } : null;
      }).catch(function () { return null; });
    }).then(function (found) {
      var kws = found.filter(Boolean).filter(function (k, i, a) {
        return a.map(function (x) { return x.id; }).indexOf(k.id) === i;
      });
      if (!kws.length) return [];

      var seeds = kws.slice(0, Math.max(LIM.keywordSeeds, 6));
      var names = seeds.map(function (k) { return k.name; }).join('، ');

      /* نستكشف كل كلمة على حدة عشان نعرف أي عمل يحمل كم كلمة منها */
      return CS.util.pool(seeds, 3, function (k) {
        return Promise.all([
          CS.tmdb.discoverByKeywords('movie', [k.id]),
          CS.tmdb.discoverByKeywords('tv', [k.id])
        ]).then(function (r) {
          return { kw: k, items: (r[0] || []).concat(r[1] || []) };
        }).catch(function () { return { kw: k, items: [] }; });
      }).then(function (sets) {
        var byKey = {};

        sets.forEach(function (set) {
          (set.items || []).forEach(function (item, i) {
            var k = item.type + ':' + item.id;
            if (!byKey[k]) {
              item.why = 'theme';
              item.hits = [];
              item.engineScore = 0;
              byKey[k] = item;
            }
            var cur = byKey[k];
            if (cur.hits.indexOf(set.kw.name) === -1) cur.hits.push(set.kw.name);
            /* كل كلمة إضافية ترفع العمل بوضوح — هذا جوهر البحث بالوصف */
            cur.engineScore += (set.kw.exact ? 22 : 14) - Math.min(i, 12) * 0.5;
          });
        });

        var out = Object.keys(byKey).map(function (k) { return byKey[k]; });
        out.forEach(function (item) {
          var n = item.hits.length;
          if (n > 1) item.engineScore += (n - 1) * 26;   /* التقاطع هو الإشارة الأقوى */
          item.whyText = n > 1
            ? 'يجمع ' + n + ' من عناصر وصفك: ' + item.hits.join(' + ')
            : 'نفس الثيمة: ' + item.hits[0];
        });

        out.sort(function (a, b) { return b.engineScore - a.engineScore; });
        return out.slice(0, wantWide ? 120 : 60);
      });
    }).catch(function () { return []; });
  }

  function merge(sets) {
    var byKey = {}, order = [];

    sets.forEach(function (list) {
      (list || []).forEach(function (item) {
        if (!item) return;
        var key = item.source === 'wiki'
          ? 'w:' + norm(item.title) + ':' + (item.year || '')
          : item.type + ':' + item.id;

        /* المحتوى الإباحي ما يظهر إلا لو الفلتر يسمح به صراحة */
        if (item.adult && CS.certs && !CS.certs.adultAllowed()) return;

        if (byKey[key]) {
          var prev = byKey[key];
          /* نفس العمل طلع من أكثر من محرك ← نرفع ثقته */
          prev.score = Math.max(prev.score, item.engineScore || 0) + 12;
          prev.titleSim = Math.max(prev.titleSim || 0, item.titleSim || 0);
          prev.engines = prev.engines || [];
          if (prev.engines.indexOf(item.why) === -1) prev.engines.push(item.why);
          if (!prev.wikiUrl && item.wikiUrl) { prev.wikiUrl = item.wikiUrl; prev.wikiTitle = item.wikiTitle; prev.wikiLang = item.wikiLang; }
          if (!prev.plotSnippet && item.plotSnippet) prev.plotSnippet = item.plotSnippet;
          if (!prev.overview && item.overview) prev.overview = item.overview;
          return;
        }

        /* merge() تُنادى مرتين (مرة للمحرّكات ومرة مع الأعمال القريبة).
           كانت تصفّر score وengines في النداء الثاني فتضيع كل مكافآت
           التقاطع بين المحرّكات — العمل اللي لقيه محرّكان ينزل لآخر القائمة.
           الحين ما نصفّر إلا أول مرة نشوف فيها العنصر. */
        if (item.merged !== true) {
          item.score = item.engineScore || 0;
          item.engines = [item.why];
          item.merged = true;
        }
        byKey[key] = item;
        order.push(item);
      });
    });

    /* مكافآت الجودة — مرة واحدة لكل عنصر مهما تكرّر الدمج */
    order.forEach(function (item) {
      if (item.qualityScored) return;
      item.qualityScored = true;
      item.score += Math.min(11, Math.log10((item.popularity || 0) + 1) * 5.5);
      if (item.votes > 120) item.score += Math.min(6, (item.rating || 0) * .65);
      if (!item.poster) item.score -= 9;
      if (item.source === 'wiki') item.score -= 4;
      /* تطابق العنوان يغلب أي إشارة ثانية */
      if ((item.titleSim || 0) >= .85) item.score += 40;
    });

    /* النسبة كانت رتبة لا ثقة: الأول يقرأ ٩٩٪ دائمًا حتى لو النتيجة ضعيفة.
       الآن سقف مطلق يعتمد على قوة الدليل نفسه — تقاطع محرّكات وتطابق عنوان. */
    var top = order.reduce(function (m, x) { return Math.max(m, x.score || 0); }, 1);
    order.forEach(function (item) {
      var rel = (item.score / top) * 99;
      /* السقف يتبع قوة الدليل نفسه لا رتبة العنصر.
         مطابقة الفهرس أقوى دليل على «الوصف» عندنا: تغطية عالية
         لكلمات نادرة داخل ملخّص العمل نفسه. */
      var cov = item.catalogCoverage || 0;
      var nh  = (item.catalogHits || item.hits || []).length;
      var cap = (item.titleSim || 0) >= .85 ? 99
              : (item.why === 'catalog' && cov >= .8 && nh >= 3) ? 96
              : (item.engines || []).length > 1 ? 92
              : (item.why === 'catalog' && cov >= .6) ? 88
              : (item.hits && item.hits.length > 1) ? 88
              : item.why === 'catalog' ? 80
              : item.why === 'plot' ? 78
              : 70;
      item.matchBasis = 'query';
      item.matchPct = Math.max(25, Math.min(cap, Math.round(rel)));
    });

    order.sort(function (a, b) { return b.score - a.score; });
    return order;
  }

  /* ---------- الأعمال ذات الصلة (من أفضل نتيجة) ---------- */

  function relatedTo(top) {
    if (!CS.hasKey() || !top || top.source !== 'tmdb') return Promise.resolve([]);

    return Promise.all([
      CS.tmdb.req('/' + top.type + '/' + top.id + '/recommendations', { page: 1 }).catch(function () { return {}; }),
      CS.tmdb.req('/' + top.type + '/' + top.id + '/similar', { page: 1 }).catch(function () { return {}; })
    ]).then(function (res) {
      var out = [];
      var label = 'قريب من «' + top.title + '»';
      [res[0], res[1]].forEach(function (json, k) {
        CS.tmdb.normalizeList((json || {}).results || [], top.type).forEach(function (item, i) {
          item.why = 'related';
          item.whyText = label;
          item.engineScore = (k === 0 ? 30 : 24) - Math.min(i, 16);
          out.push(item);
        });
      });
      return out;
    }).catch(function () { return []; });
  }

  /* ---------- الواجهة الرئيسية ---------- */

  /**
   * run(query, mode) → { items, meta }
   * mode: auto | title | plot | theme
   */
  function run(query, mode) {
    var q = String(query || '').trim();
    if (!q) return Promise.resolve({ items: [], meta: {} });

    mode = mode === 'theme' ? 'theme' : 'auto';
    var intent = mode === 'auto' ? detectIntent(q) : mode;
    var isAr = CS.util.isArabic(q);
    var meta = {
      query: q, mode: mode, intent: intent, engines: [],
      translated: '', noKey: !CS.hasKey(), gated: true
    };

    /* نترجم للإنجليزي: ملخّصات TMDB وكلماته المفتاحية وويكيبيديا
       الإنجليزية كلها إنجليزية، والوصف العربي ما يطابقها بدون ترجمة */
    var prep = isAr ? CS.wiki.toEnglish(q) : Promise.resolve(q);

    return prep.then(function (qEn) {
      if (qEn && qEn !== q) meta.translated = qEn;

      var tagOnly   = mode === 'theme';
      var wantTitle = !tagOnly;
      var wantPlot  = !tagOnly && intent !== 'title';
      var wantTheme = true;

      var jobs = [];

      /* فحص صحة TMDB بالتوازي — نفرّق بين «ما فيه نتيجة» و«المفتاح ميت» */
      if (CS.hasKey()) {
        jobs.push(
          CS.tmdb.req('/configuration', {}, { fresh: true })
            .then(function () { return []; })
            .catch(function (e) { meta.tmdbError = CS.tmdb.explain(e); return []; })
        );
      }

      /* ١) الفهرس المحلي — فوري، بلا طلب، ومقصور على كتالوج الكبار */
      if (!tagOnly) {
        var local = engineCatalog(q, qEn, meta);
        if (local.length) { meta.engines.push('catalog'); meta.catalogHits = local.length; }
        meta.catalogSize = CS.catalog ? CS.catalog.size() : 0;
        jobs.push(Promise.resolve(local));
      }

      if (wantTitle) { meta.engines.push('title'); jobs.push(engineTitle(q, qEn)); }
      if (wantPlot)  { meta.engines.push('plot');  jobs.push(enginePlot(q, qEn, false)); }
      if (wantTheme) { meta.engines.push('theme'); jobs.push(engineTheme(q, qEn, tagOnly || intent === 'plot')); }

      return Promise.all(jobs.map(function (p) {
        return Promise.resolve(p).catch(function () { return []; });
      })).then(function (sets) { return { sets: sets, qEn: qEn }; });

    }).then(function (bag) {
      var sets = bag.sets;

      /* استعلام وصفي: مطابقة الاسم ما تتصدّر على مطابقة القصة،
         لأن المستخدم كتب قصة لا عنوانًا */
      if (intent === 'plot' || intent === 'mixed') {
        sets = sets.map(function (list) {
          return (list || []).filter(function (it) {
            if (!it) return false;
            /* على استعلام وصفي، «مطابقة بالاسم» بلا تشابه اسم حقيقي
               ضجيج صرف: المستخدم كتب قصة لا عنوانًا. كانت تُخصم فقط
               فتبقى في القائمة وتاكل من حصّة البوابة. */
            if (it.why === 'title' && (it.titleSim || 0) < .5) return false;
            if (it.why === 'title' && (it.titleSim || 0) < .7) it.engineScore -= 55;
            if (it.why === 'catalog') it.engineScore += 34;
            if (it.why === 'plot') it.engineScore += 22;
            if (it.why === 'theme' && it.hits && it.hits.length > 1) it.engineScore += 20;
            return true;
          });
        });
      }

      /* حصص لكل محرّك قبل البوابة: البوابة تسحب وسوم ٧٢ مرشّحًا فقط،
         ومحرّك الثيمة وحده يقدر يرمي ١٢٠ عملًا عامًا فيبتلع الحصّة
         ويجوّع المطابقات الحقيقية. الفهرس أولًا لأنه كتالوج كبار أصلًا. */
      var QUOTA = { catalog: 60, plot: 24, theme: 26, title: 12 };
      var used = {};
      var raw = [];
      sets.forEach(function (l) {
        (l || []).forEach(function (x) {
          if (!x) return;
          var w = x.why || 'other';
          var cap = QUOTA[w];
          if (cap !== undefined) {
            used[w] = (used[w] || 0) + 1;
            if (used[w] > cap) return;
          }
          raw.push(x);
        });
      });
      meta.candidates = raw.length;

      /* ٢) البوابة — قبل أي دمج أو ترتيب. ما يعدّيها ما يُعرض. */
      return gate(raw, meta).then(function (clean) {
        var items = merge([clean]);
        meta.core = items.length;

        /* ٣) الفهرس يتغذّى من كل بحث: ما وصلنا له الآن يخدم البحث الجاي */
        if (CS.catalog) CS.catalog.add(clean);

        var strong = items.some(function (x) { return (x.titleSim || 0) >= .85; });
        if (strong && intent === 'title') meta.translated = '';

        var top = items[0];
        if (!top) return { items: items, meta: meta };

        /* ٤) الأعمال ذات الصلة بأفضل نتيجة — وتمرّ من نفس البوابة */
        return relatedTo(top).then(function (rel) {
          if (!rel.length) return { items: items, meta: meta };
          return gate(rel, null).then(function (relClean) {
            if (!relClean.length) return { items: items, meta: meta };
            var all = merge([items, relClean]);
            meta.related = relClean.length;
            meta.relatedOf = top.title;
            if (CS.catalog) CS.catalog.add(relClean);
            return { items: all, meta: meta };
          });
        });
      });
    });
  }

  /* ---------- اقتراحات فورية أثناء الكتابة ---------- */

  /* الاقتراحات الفورية تمرّ من البوابة كمان — كانت تقترح أعمالًا
     عامة تحت خانة بحث موقع كله محتوى واحد. الفهرس المحلي يجاوب
     أولًا بلا أي طلب، وTMDB يكمّل ما نقص. */
  function suggest(q) {
    var local = CS.catalog
      ? CS.catalog.search(contentWords(q), { phrase: q, limit: LIM.suggest * 3 })
      : [];
    var ready = local.filter(function (it) { return CS.certs.isAdultWork(it) === true; });
    if (ready.length >= LIM.suggest || !CS.hasKey()) {
      return Promise.resolve(ready.slice(0, LIM.suggest));
    }

    return CS.tmdb.searchMulti(q)
      .then(function (r) {
        var cands = (r.items || []).filter(function (i) { return !i.viaPerson; }).slice(0, 14);
        var need = cands.filter(function (it) { return CS.certs.isAdultWork(it) === null; }).slice(0, 10);
        return CS.util.pool(need, 6, function (it) {
          return CS.certs.fetchHeat(it).catch(function () { return null; });
        }).then(function () {
          var seen = {};
          ready.forEach(function (it) { seen[it.type + ':' + it.id] = true; });
          cands.forEach(function (it) {
            if (seen[it.type + ':' + it.id]) return;
            if (CS.certs.isAdultWork(it) !== true) return;
            ready.push(it);
          });
          return ready.slice(0, LIM.suggest);
        });
      })
      .catch(function () { return ready.slice(0, LIM.suggest); });
  }

  /* ============================================================
     الاستكشاف المبني على الذوق
     ============================================================ */

  function dedupe(list, seen, taken) {
    return list.filter(function (it) {
      var k = it.type + ':' + it.id;
      if (seen[k] || taken[k]) return false;
      if (it.adult && CS.certs && !CS.certs.adultAllowed()) return false;
      taken[k] = true;
      return true;
    });
  }

  /**
   * يرجّع صفوف صفحة الاستكشاف حسب ما أعجب المستخدم.
   * كل صف: { key, title, hint, items }
   */
  /* discoverRows/buildRows انشالت: كانت تبني صفوف استكشاف بمحتوى
     عام (رائج · أعلى تقييمًا · يُعرض الآن) بلا أي مرور على البوابة.
     ما عاد لها نداء بعد ما صار الاستكشاف قسمًا واحدًا بكلمات مفتاحية،
     وإبقاؤها كان يعني بابًا جاهزًا لمحتوى عام لو رجع أحد يستدعيها. */

  CS.search = {
    run: run,
    suggest: suggest,
    detectIntent: detectIntent,
    similarity: similarity,
    norm: norm
  };

})(window.CS);
