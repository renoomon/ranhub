/* ============================================================
   feed.js — خلاصة موحّدة: شبكة واحدة بترقيم لا نهائي

   الأقسام الثلاثة تمشي على نفس الطريق بالضبط: نفس بناء الاستعلام،
   نفس حجم الدفعة، نفس عدد الجولات، نفس حدّ الصفحات. الفرق بينها
   مفرداتها لا آليتها — وهذا اللي كان يخلّي Explicit ينتهي بعد
   بضع صفحات بينما General يكمّل: مفرداته كانت خمس كلمات مقابل ٤٨.
   ============================================================ */

(function (CS) {
  'use strict';

  var PAGE = 50;          /* كم عمل نضيف مع كل «اعرض المزيد» */
  var TMDB_PAGE = 20;     /* TMDB يرجّع ٢٠ لكل صفحة دائمًا */

  /* ------------------------------------------------------------
     مفردات الأقسام.

     الأرقام تحت مؤكَّدة من استجابات TMDB فعلية (لا تخمين). الكلمات
     اللي بلا رقم تُحلّ وقت التشغيل بمطابقة حرفية من /search/keyword —
     ما نأخذ أول نتيجة عشوائية أبدًا، ولو ما لقينا الكلمة عند TMDB
     تسقط بهدوء ولا نخترع لها رقمًا.
     ------------------------------------------------------------ */

  /* مفردات القسم العام. المصطلحات الملتبسة — seduction · intimacy ·
     affair · taboo · arthouse — مقصاة عمدًا: توقع على دراما وإثارة
     عامة، فتسحب معها أعمالًا ما لها علاقة. */
  var GENERAL_WORDS = [
    'sensual', 'sensuality', 'erotica', 'eroticism', 'erotic thriller',
    'erotic drama', 'erotic romance', 'erotic movie', 'sex scene', 'sex comedy',
    'steamy', 'nudie', 'women in prison', 'nunsploitation',
    'full frontal nudity', 'male nudity', 'softcore', 'sexploitation'
  ];

  /* سينما الجنس الصريح — أعمال سينمائية بمشاهد جنس حقيقي، لا أفلام porn.
     المؤكَّد منها: unsimulated sex (282903) · roman porno (348517) ·
     sex scene (354470) · pinku eiga (381597).

     القائمة وُسّعت عمدًا: القسم كان يعيش على خمس كلمات فينفد بعد
     صفحتين بينما General يمشي على ٤٨. وكل كلمة هنا تقابل صنف
     «صريح» في certs.js — فما نطلب من TMDB أعمالًا ترميها البوابة
     بعد وصولها ونحرق طلبًا بلا نتيجة. */
  var EXPLICIT_WORDS = [
    'explicit sex', 'graphic sex', 'sexual intercourse', 'unsimulated oral sex',
    'hardcore sex', 'simulated sex', 'nikkatsu roman porno', 'sexual explicitness',
    'explicit nudity', 'sex act'
  ];

  var SECTIONS = {
    general:  { seed: [], words: GENERAL_WORDS, useCategories: true },
    /* البذور المؤكَّدة لقسم Explicit — ومعها كل ما تحلّه الكلمات */
    explicit: { seed: [282903, 348517, 354470, 381597], words: EXPLICIT_WORDS },
    /* توصيتي — ما ينبني من الكلمات، ينبني من أعمالك اللي عجبتك */
    foryou:   { seed: [], words: [], fromTaste: true }
  };

  var DEFAULT_SECTION = 'general';

  /* ------------------------------------------------------------
     تصنيفات TMDB — أرقام مُتحقَّق منها من استجابات حقيقية
     (اسم الكلمة + عدد الأعمال)، فما فيه رقم مخمَّن ولا كلمة وهمية.
     ------------------------------------------------------------ */
  var CATEGORIES = [
    { id: 155477, name: 'Softcore' },
    { id: 33998,  name: 'Lesbian' },
    { id: 155262, name: 'Threesome' },
    { id: 190370, name: 'Erotic' },
    { id: 2426,   name: 'Group Sex' },
    { id: 2699,   name: 'Fetish' },
    { id: 158713, name: 'BDSM' },
    { id: 33841,  name: 'Taboo' },
    { id: 1817,   name: 'Orgy' },
    { id: 596,    name: 'Adultery' },
    { id: 13059,  name: 'Prostitution' },
    { id: 3182,   name: 'Seduction' },
    { id: 910,    name: 'Bondage' },
    { id: 178649, name: 'Voyeurism' },
    { id: 170827, name: 'Sex Comedy' },
    { id: 4076,   name: 'Massage' },
    { id: 10053,  name: 'Sexploitation' },
    { id: 5921,   name: 'Stepmother' },
    { id: 9835,   name: 'Sexual Fantasy' },
    { id: 10968,  name: 'Lingerie' },
    { id: 207767, name: 'Erotic Thriller' },
    { id: 281741, name: 'Nudity' },
    { id: 190178, name: 'Sex Worker' },
    { id: 359980, name: 'Female Nudity' },
    { id: 162804, name: 'Sexual Awakening' },
    { id: 11869,  name: 'Mistress' },
    { id: 213417, name: 'Nudist' },
    { id: 6373,   name: 'Sadomasochism' },
    { id: 7089,   name: 'Dominatrix' },
    { id: 41404,  name: 'Sexual Desire' },
    { id: 4378,   name: 'Striptease' },
    { id: 348517, name: 'Roman Porno' },
    { id: 329968, name: 'Bisexual' },
    { id: 156391, name: 'Peeping Tom' },
    { id: 195222, name: 'Nunsploitation' },
    { id: 41260,  name: 'Sensuality' },
    { id: 302868, name: 'Erotic Comedy' },
    { id: 325693, name: 'Erotica' },
    { id: 244648, name: 'Wife Swapping' },
    { id: 323690, name: 'Gay' },
    { id: 282903, name: 'Unsimulated Sex' },
    { id: 176127, name: 'Open Marriage' },
    { id: 354470, name: 'Sex Scene' },
    { id: 14914,  name: 'Swinging' },
    { id: 298666, name: 'Erotic Romance' },
    { id: 364719, name: 'Erotic Drama' },
    { id: 343572, name: 'Erotic Film' },
    { id: 381597, name: 'Pinku Eiga' }
  ];

  /* ------------------------------------------------------------
     تصنيفات إضافية تُحلّ وقت التشغيل.

     ما نكتب لها أرقامًا: نسأل TMDB عن الاسم بمطابقة حرفية، فاللي
     يوجد عنده يظهر كزرّ واللي ما يوجد يسقط بهدوء. يعني ما فيه
     تصنيف مخترع في الواجهة أبدًا، والقائمة تكبر كل ما كبر TMDB.
     النتيجة تُحفظ في المتصفّح فما نعيد الحلّ كل زيارة.
     ------------------------------------------------------------ */
  var EXTRA_NAMES = [
    'sensual cinema', 'erotic anime', 'softcore porn', 'sex education',
    'sexual obsession', 'sexual repression', 'sexual tension', 'sexual violence',
    'female sexuality', 'male gaze', 'burlesque', 'strip club', 'brothel',
    'harem', 'geisha', 'courtesan', 'call girl', 'escort', 'polyamory',
    'infidelity', 'forbidden love', 'age difference', 'student teacher relationship',
    'nudism', 'skinny dipping', 'topless', 'bathhouse', 'sauna',
    'erotic horror', 'erotic mystery', 'sex addiction', 'swinger',
    'exhibitionism', 'sex therapy', 'first time', 'honeymoon',
    'seductress', 'femme fatale', 'love triangle', 'summer romance'
  ];

  var EXTRA_KEY = 'cs.extra_cats';
  var EXTRA_TTL = 14 * 24 * 3600 * 1000;
  var extraCats = null;          /* [{id,name}] بعد الحلّ */
  var extraPending = null;

  function cachedExtras() {
    var box = CS.store.get(EXTRA_KEY, null);
    if (!box || !Array.isArray(box.list) || !box.at) return null;
    if (Date.now() - box.at > EXTRA_TTL) return null;
    return box.list;
  }

  /* يرجّع التصنيفات الإضافية المتحقَّقة — ووعدًا واحدًا مهما تكرّر النداء */
  function resolveExtras() {
    if (extraCats) return Promise.resolve(extraCats);
    var cached = cachedExtras();
    if (cached) { extraCats = cached; return Promise.resolve(extraCats); }
    if (extraPending) return extraPending;
    if (!CS.hasKey()) return Promise.resolve([]);

    extraPending = CS.util.pool(EXTRA_NAMES, 4, function (w) {
      return CS.tmdb.searchKeywords(w).then(function (list) {
        var exact = (list || []).filter(function (k) {
          return String(k.name || '').toLowerCase() === w.toLowerCase();
        })[0];
        return exact ? { id: exact.id, name: title(exact.name) } : null;
      }).catch(function () { return null; });
    }).then(function (rows) {
      var have = {};
      CATEGORIES.forEach(function (c) { have[c.id] = true; });
      extraCats = rows.filter(function (r) {
        if (!r || have[r.id]) return false;
        have[r.id] = true;
        return true;
      });
      CS.store.set(EXTRA_KEY, { at: Date.now(), list: extraCats });
      extraPending = null;
      return extraCats;
    }).catch(function () { extraPending = null; extraCats = []; return []; });

    return extraPending;
  }

  function title(s) {
    return String(s || '').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }

  /* القائمة المعروضة = المؤكَّدة + المتحقَّقة وقت التشغيل */
  function allCategories() {
    return CATEGORIES.concat(extraCats || cachedExtras() || []);
  }

  /* أسماء البذور المؤكَّدة — من استجابات TMDB حقيقية */
  var SEED_NAMES = {
    190370: 'erotic movie', 155477: 'softcore', 10053: 'sexploitation',
    281741: 'nudity', 267122: 'sex', 339680: 'female nudity',
    7344: 'porn star', 158436: 'porn actress', 195997: 'adult filmmaking',
    282903: 'unsimulated sex', 348517: 'roman porno', 354470: 'sex scene',
    381597: 'pinku eiga', 343572: 'erotic film'
  };

  function sectionFor(tab) { return SECTIONS[tab] ? tab : DEFAULT_SECTION; }

  function tagNameOf(id) {
    var list = allCategories();
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === +id) return list[i].name;
    }
    return '';
  }

  /* أرقام الكلمات لكل قسم — تُحلّ مرة وحدة وتنحفظ في الذاكرة */
  var resolved = {};
  var names = {};

  function keywordNames() { return names; }

  function keywordIds(tab) {
    var key = sectionFor(tab);
    if (resolved[key]) return Promise.resolve(resolved[key]);

    var conf = SECTIONS[key];
    Object.keys(SEED_NAMES).forEach(function (id) { names[id] = SEED_NAMES[id]; });

    /* القسم العام يعتمد كل التصنيفات المؤكَّدة + المتحقَّقة */
    if (conf.useCategories) {
      return resolveExtras().then(function () {
        var list = allCategories();
        resolved[key] = list.map(function (c) { return c.id; });
        list.forEach(function (c) { names[c.id] = c.name.toLowerCase(); });
        return resolved[key];
      });
    }

    if (!conf.words.length) { resolved[key] = conf.seed.slice(); return Promise.resolve(resolved[key]); }

    return CS.util.pool(conf.words, 4, function (w) {
      return CS.tmdb.searchKeywords(w).then(function (list) {
        /* المطابقة الحرفية فقط — «hardcore» ما يصير «hardcore band» */
        var exact = (list || []).filter(function (k) {
          return String(k.name || '').toLowerCase() === w.toLowerCase();
        })[0];
        if (exact) names[exact.id] = exact.name;
        return exact ? exact.id : null;
      }).catch(function () { return null; });
    }).then(function (ids) {
      resolved[key] = conf.seed.concat(ids.filter(Boolean)).filter(function (v, i, a) {
        return a.indexOf(v) === i;
      });
      return resolved[key];
    }).catch(function () {
      /* حتى لو سقط /search/keyword كله، البذور المؤكَّدة تكفي لتشغيل القسم */
      resolved[key] = conf.seed.slice();
      return resolved[key];
    });
  }

  function eroticKeywordIds() { return keywordIds('general'); }

  /* ------------------------------------------------------------
     التغيير الحيّ: القسم ما يعرض نفس الأعمال كل مرة.
     ------------------------------------------------------------ */

  var WINDOW = 9;          /* كم كلمة في الاستعلام الواحد */

  function shuffleBy(list, seed) {
    var out = list.slice();
    var r = seed >>> 0;
    for (var i = out.length - 1; i > 0; i--) {
      r = (r * 1664525 + 1013904223) >>> 0;      /* LCG — يكفي لخلط عرض */
      var j = r % (i + 1);
      var t = out[i]; out[i] = out[j]; out[j] = t;
    }
    return out;
  }

  function windowOf(ids, seed, page) {
    var take = Math.min(WINDOW, Math.max(3, Math.ceil(ids.length * 0.5)));
    if (ids.length <= 3) return ids;
    /* 2654435761 = نسبة ذهبية ٣٢-بت — تفرّق البذور المتقاربة */
    var mixed = shuffleBy(ids, (seed ^ (page * 2654435761)) >>> 0);
    return mixed.slice(0, take);
  }

  var PAGES_KEY = 'cs.feed_pages';

  function pagesKey(type) { return state.tab + '|' + (state.mediaType || 'all') + '|' + type; }

  function knownPages(type) {
    var m = CS.store.get(PAGES_KEY, {});
    var v = m && m[pagesKey(type)];
    return (typeof v === 'number' && v > 1) ? Math.min(v, 500) : 0;
  }

  function rememberPages(type, n) {
    if (!(n > 1)) return;
    var m = CS.store.get(PAGES_KEY, {});
    if (!m || typeof m !== 'object' || Array.isArray(m)) m = {};
    m[pagesKey(type)] = Math.min(n, 500);
    CS.store.set(PAGES_KEY, m);
  }

  /* الصفحة اللي نطلبها فعلًا من TMDB — مزاحة وملفوفة داخل المتاح لهذا النوع */
  function apiPage(type, n) {
    var max = Math.max(1, Math.min((state.maxPages && state.maxPages[type]) || 1, 500));
    if (max === 1) return 1;
    var jump = (state.pageOffset + (n - 1) * (1 + (state.seed % 7))) % max;
    return (jump % max) + 1;
  }

  /* أدنى نسبة تطابق يقبلها قسم «توصيتي» */
  var FORYOU_MIN = 80;

  /* ---------- حالة الخلاصة ---------- */

  function blank() {
    return {
      tab: DEFAULT_SECTION,
      sort: 'popularity.desc',
      origLang: '',
      minRating: 0,
      mediaType: '',                       /* '' الكل · movie · tv · reality */
      yearFrom: 0,
      yearTo: 0,
      country: '',
      quality: '',                         /* '' · any · solid · proven */
      forYouMin: FORYOU_MIN,
      strong: false,
      tag: 0,
      seed: (Math.random() * 0x7fffffff) | 0,
      pageOffset: Math.floor(Math.random() * 97),
      rewound: false,
      roundFailed: false,
      hardFail: false,
      maxPages: { movie: 1, tv: 1 },
      items: [], seen: {}, page: 0, exhausted: false, loading: false, token: 0,
      lastError: '',
      lastErrorHost: ''
    };
  }

  var state = blank();

  function reset(patch) {
    var t = state.token + 1;
    state = blank();
    Object.keys(patch || {}).forEach(function (k) { state[k] = patch[k]; });
    state.token = t;
    state.maxPages = {
      movie: Math.max(knownPages('movie'), 6),
      tv: Math.max(knownPages('tv'), 2)
    };
    return state;
  }

  function current() { return state; }

  /* ---------- الفلاتر والترتيب ---------- */

  /* الترتيبات المعروضة — «الأبجدي» يُرتَّب عندنا لأن TMDB ما يدعمه */
  var SORTS = [
    { id: 'popularity.desc',           label: 'الأكثر مشاهدة' },
    { id: 'primary_release_date.desc', label: 'الأحدث' },
    { id: 'vote_average.desc',         label: 'الأعلى تقييمًا' },
    { id: 'vote_count.desc',           label: 'الأكثر تصويتًا' },
    { id: 'revenue.desc',              label: 'الأعلى إيرادًا' },
    { id: 'title.asc',                 label: 'أبجدي (أ ← ي)' },
    { id: 'foryou',                    label: '🎯 على ذوقي' }
  ];

  /* عتبات الجودة — «الجودة» هنا رصانة البيانات لا دقّة الفيديو:
     كم شخصًا قيّم العمل فعلًا. هذا كل ما تعطيه المصادر المجانية. */
  var QUALITY = {
    '':       { label: 'أي عمل', votes: 0 },
    solid:    { label: 'له تقييمات (٢٠+ صوت)', votes: 20 },
    proven:   { label: 'معروف (١٠٠+ صوت)', votes: 100 },
    landmark: { label: 'راسخ (٥٠٠+ صوت)', votes: 500 }
  };

  var COUNTRIES = [
    { code: '',   name: 'كل البلدان' },
    { code: 'US', name: 'أمريكا' },   { code: 'FR', name: 'فرنسا' },
    { code: 'IT', name: 'إيطاليا' },  { code: 'JP', name: 'اليابان' },
    { code: 'ES', name: 'إسبانيا' },  { code: 'DE', name: 'ألمانيا' },
    { code: 'GB', name: 'بريطانيا' }, { code: 'KR', name: 'كوريا' },
    { code: 'HK', name: 'هونغ كونغ' },{ code: 'BR', name: 'البرازيل' },
    { code: 'MX', name: 'المكسيك' },  { code: 'SE', name: 'السويد' },
    { code: 'IN', name: 'الهند' },    { code: 'TR', name: 'تركيا' },
    { code: 'EG', name: 'مصر' },      { code: 'LB', name: 'لبنان' }
  ];

  function baseParams() {
    var p = {};
    if (state.origLang) p.with_original_language = state.origLang;
    if (state.minRating) p['vote_average.gte'] = state.minRating;
    if (state.country) p.with_origin_country = state.country;

    var q = QUALITY[state.quality || ''];
    if (q && q.votes) p['vote_count.gte'] = q.votes;

    /* الترتيب: TMDB ما يعرف «على ذوقي» ولا «أبجدي» — نحوّلهما لشهرة
       ونرتّب محليًا بعد الجلب */
    var sort = state.sort;
    if (sort === 'foryou' || sort === 'title.asc') sort = 'popularity.desc';
    p.sort_by = sort;

    /* مدى سنوات الإنتاج */
    if (state.yearFrom) p['primary_release_date.gte'] = state.yearFrom + '-01-01';
    if (state.yearTo)   p['primary_release_date.lte'] = state.yearTo + '-12-31';

    if (state.sort === 'vote_average.desc' && !p['vote_count.gte']) p['vote_count.gte'] = 120;

    /* وضع «تحديث قوي»: أعمال أقوى لا مجرد أعمال جديدة */
    if (state.strong) {
      p.sort_by = 'popularity.desc';
      p['vote_count.gte'] = Math.max(80, +p['vote_count.gte'] || 0);
    }

    return p;
  }

  /* أسماء حقول التاريخ تختلف بين الأفلام والمسلسلات */
  function forTv(p) {
    var q = Object.assign({}, p);
    if (q.sort_by === 'primary_release_date.desc') q.sort_by = 'first_air_date.desc';
    if (q['primary_release_date.gte']) { q['first_air_date.gte'] = q['primary_release_date.gte']; delete q['primary_release_date.gte']; }
    if (q['primary_release_date.lte']) { q['first_air_date.lte'] = q['primary_release_date.lte']; delete q['primary_release_date.lte']; }
    delete q.certification; delete q['certification.gte']; delete q.certification_country;
    return q;
  }

  /* أنواع TMDB للبرامج الواقعية */
  var REALITY_GENRES = '10764|10767';

  /* ------------------------------------------------------------
     أي نداءات TMDB يحتاجها القسم الحالي لهذه الصفحة.
     الأقسام كلها تمرّ من نفس الطريق: كلمات مفتاحية على /discover،
     نداء مفرد لكل كلمة عشان نعرف أي كلمة جابت أي عمل بلا طلب زائد.
     ------------------------------------------------------------ */
  function sourcesFor(page) {
    var p = baseParams();
    /* تُعاد كل جولة: بدون التصفير كانت جولة ساقطة سابقة تخلّي
       الجولة التالية تُعلن انقطاعًا وهي سليمة */
    state.roundFailed = false;

    /* أعمال الكبار ما توصل أي حد أصوات إلا لو المستخدم طلبه صراحةً */
    if (!state.quality && !state.strong && state.sort !== 'vote_average.desc') {
      delete p['vote_count.gte'];
    }

    if (SECTIONS[sectionFor(state.tab)].fromTaste) return fromTaste(page);

    /* تصنيف مختار: التصنيف مقطوعًا مع مفردة القسم القوية (AND بفاصلة) */
    if (state.tag) {
      var tagKw = String(state.tag);
      var tagJobs = [];

      if (state.mediaType !== 'tv' && state.mediaType !== 'reality') {
        ['popularity.desc', 'vote_count.desc'].forEach(function (sb, i) {
          tagJobs.push(CS.tmdb.discover('movie', Object.assign({}, p, {
            with_keywords: tagKw, sort_by: sb
          }), page + i));
        });
      }
      if (state.mediaType !== 'movie') {
        var tq2 = Object.assign({}, forTv(p), { with_keywords: tagKw, sort_by: 'popularity.desc' });
        if (state.mediaType === 'reality') tq2.with_genres = REALITY_GENRES;
        else if (state.mediaType === 'tv') tq2.without_genres = '10764,10767';
        tagJobs.push(CS.tmdb.discover('tv', tq2, page));
      }
      var tagName = tagNameOf(state.tag);
      return Promise.all(tagJobs).then(function (lists) {
        var failedT = (lists || []).filter(function (l) { return l && l.failed; }).length;
        state.roundFailed = lists.length > 0 && failedT === lists.length;
        (lists || []).forEach(function (l) {
          if (l && l.failed) { state.lastError = l.failed; state.lastErrorHost = l.failedHost || ''; }
          if (tagName && CS.certs.seedKeyword) {
            (l || []).forEach(function (it) { CS.certs.seedKeyword(it, tagName); });
          }
        });
        return lists;
      });
    }

    return keywordIds(state.tab).then(function (all) {
      if (!all || !all.length) return [];

      var ids = windowOf(all, state.seed, page);
      var want = state.mediaType;
      var jobs = [];
      var kinds = [];
      var nameMap = keywordNames();

      /* نقدّم الكلمات القوية داخل النافذة.
         العمل الراجع من /discover بكلمة قوية (erotic · softcore …)
         يحمل تلك الكلمة قطعًا، فseedKeyword يفتح له البوابة مجانًا.
         الكلمة الضعيفة (Lesbian · Taboo …) ما تفتحها، فكل بطاقة
         منها تكلّف نداء /keywords — وهذا كان أكبر بند في الفاتورة. */
      var strong = [], weak = [];
      ids.forEach(function (id) {
        var nm = nameMap[id] || tagNameOf(id);
        if (CS.certs.isStrongName && CS.certs.isStrongName(nm)) strong.push(id);
        else weak.push(id);
      });
      var ordered = strong.concat(weak);
      var picks = ordered.slice(0, 5);

      if (want !== 'tv' && want !== 'reality') {
        picks.forEach(function (kid) {
          var mq = Object.assign({}, p, { with_keywords: String(kid) });
          jobs.push(CS.tmdb.discover('movie', mq, apiPage('movie', page)));
          kinds.push({ type: 'movie', kw: kid });
        });
      }
      if (want !== 'movie') {
        var tq = forTv(p);
        if (want === 'reality') tq.with_genres = REALITY_GENRES;
        else if (want === 'tv') tq.without_genres = '10764,10767';
        picks.forEach(function (kid) {
          var q2 = Object.assign({}, tq, { with_keywords: String(kid) });
          jobs.push(CS.tmdb.discover('tv', q2, apiPage('tv', page)));
          kinds.push({ type: 'tv', kw: kid });
        });
      }

      return Promise.all(jobs).then(function (sets) {
        /* كل نداءات الجولة سقطت؟ إذن المشكلة في الاتصال لا في
           الفلاتر — نوقف فورًا بدل ما ندور ست جولات بإعادة محاولة
           لكل واحدة، فيقعد المستخدم دقيقة أمام هياكل فاضية. */
        var failed = (sets || []).filter(function (l) { return l && l.failed; }).length;
        state.roundFailed = sets.length > 0 && failed === sets.length;

        sets.forEach(function (l, i) {
          var k = kinds[i];
          if (!k || !l) return;
          if (l.failed) { state.lastError = l.failed; state.lastErrorHost = l.failedHost || ''; }
          /* دليل المصدر: كل عمل في هذي القائمة يحمل هذي الكلمة قطعًا */
          var nm = nameMap[k.kw];
          if (nm && CS.certs.seedKeyword) {
            l.forEach(function (it) { CS.certs.seedKeyword(it, nm); });
          }
          if (!l.totalPages) return;
          state.maxPages[k.type] = Math.max(state.maxPages[k.type] || 1, l.totalPages);
          rememberPages(k.type, state.maxPages[k.type]);
        });
        return sets;
      });
    });
  }

  /* ------------------------------------------------------------
     قسم «توصيتي» — من أعمالك اللي عجبتك، على القصة والوسوم
     والمخرج والممثلين لا على الشهرة.
     ------------------------------------------------------------ */
  /* اسم الوسم ← رقمه، من التصنيفات المتحقَّقة ومن ما حلّيناه */
  var nameToId = null, nameToIdStamp = 0;
  function keywordIdByName(name) {
    var stamp = allCategories().length;
    if (!nameToId || nameToIdStamp !== stamp) {
      nameToId = {};
      allCategories().forEach(function (c) { nameToId[String(c.name).toLowerCase()] = c.id; });
      Object.keys(names).forEach(function (id) { nameToId[String(names[id]).toLowerCase()] = +id; });
      nameToIdStamp = stamp;
    }
    return nameToId[String(name || '').toLowerCase()] || 0;
  }

  /**
   * أرقام وسوم عمل محبوب.
   * الإعجاب من على البوستر ما يحمل keywordIds — تُملأ من تفاصيل
   * العمل وحدها، وأغلب الإعجابات تصير من الشبكة لا من صفحة العمل.
   * فكانت نداءات «كلمات العمل» في التوصيات تمشي فاضية. نكمّلها من
   * ذاكرة الوسوم اللي سحبتها البوابة أصلًا — بلا أي طلب جديد.
   */
  /* رقم الوسم من اسمه والعكس — المحرّكان يتكلّمان لغتين */
  function keywordNameOf(id) {
    var n = names[id];
    if (n) return String(n).toLowerCase();
    var list = allCategories();
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === +id) return String(list[i].name).toLowerCase();
    }
    return '';
  }

  function seedKeywordIds(it) {
    var ids = (it.keywordIds || []).filter(Boolean);
    if (ids.length) return ids;
    var heat = CS.certs && CS.certs.cachedHeat(it);
    var out = [];
    ((heat && heat.names) || []).forEach(function (n) {
      var id = keywordIdByName(n);
      if (id && out.indexOf(id) === -1) out.push(id);
    });
    return out;
  }

  function likedSeeds() {
    var p = CS.reco ? CS.reco.tasteProfile() : null;
    var pool = ((p && p.seeds) || CS.taste.likes() || []).filter(function (it) {
      return it && it.source === 'tmdb' && (it.type === 'movie' || it.type === 'tv');
    });
    if (!pool.length) return pool;

    var mixed = shuffleBy(pool, state.seed);
    var take = Math.max(1, Math.min(5, Math.ceil(mixed.length * 0.7)));
    var start = (state.seed >>> 0) % mixed.length;
    var out = [];
    for (var i = 0; i < take; i++) out.push(mixed[(start + i) % mixed.length]);
    return out;
  }

  function fromTaste(page) {
    var seeds = likedSeeds();
    if (!seeds.length) return Promise.resolve([]);

    var prof = CS.reco ? CS.reco.tasteProfile() : null;
    var pg = ((page - 1 + (state.seed % 3)) % 5) + 1;
    var ADULT = SECTIONS.explicit.seed;
    var p0 = baseParams();
    delete p0['vote_count.gte'];

    return CS.util.pool(seeds, 4, function (it) {
      var jobs = [
        CS.tmdb.relatedPage(it.type, it.id, 'recommendations', pg),
        CS.tmdb.relatedPage(it.type, it.id, 'similar', pg)
      ];

      /* نداء لكل كلمة من كلمات العمل على حدة — لا اتحادها: الاتحاد
         (OR) يرجّع أشهر الأفلام لأن كلمة عامة توقع على دراما عادية. */
      var own = seedKeywordIds(it).slice(0, 3);
      var themeAt = own.length ? jobs.length : -1;
      own.forEach(function (kw) {
        jobs.push(CS.tmdb.discover(it.type, Object.assign({}, p0, { with_keywords: String(kw) }), pg));
      });

      /* أعمال المخرج نفسه وأعمال الممثلين — محورا القرب اللي كانا
         غائبين تمامًا عن هذا القسم */
      var peopleAt = jobs.length;
      var people = ((prof && prof.people) || []).slice(0, 2);
      people.forEach(function (pid) {
        jobs.push(CS.tmdb.discover(it.type, Object.assign({}, p0, { with_people: String(pid) }), 1));
      });

      /* حشو: كتالوج الموقع بنفس التصنيف — يملأ القسم إذا الموضوع ضيّق.
         نعلّمه صراحةً عشان ما يتقدّم على نتائج الموضوع: هو استعلام
         على كتالوج الموقع كله لا على ذوقك. */
      var fillerAt = jobs.length;
      var genres = (it.genreIds || []).slice(0, 2).join('|');
      jobs.push(CS.tmdb.discover(it.type, Object.assign({}, p0, {
        with_keywords: ADULT.join('|'),
        with_genres: genres
      }), pg + 3));

      return Promise.all(jobs).then(function (r) {
        /* discover يرجّع مصفوفة عارية وrelatedPage يرجّع {items} */
        var pick = function (x) { return Array.isArray(x) ? x : ((x && x.items) || []); };
        var theme = [], person = [], rest = [];
        r.forEach(function (x, i) {
          var list = pick(x);
          if (themeAt >= 0 && i >= themeAt && i < themeAt + own.length) {
            list.forEach(function (m) { m.themeHit = true; m.seedOf = it; });
            theme = theme.concat(list);
          } else if (i >= peopleAt && i < peopleAt + people.length) {
            list.forEach(function (m) { m.personHit = true; m.seedOf = it; });
            person = person.concat(list);
          } else {
            var isFiller = i === fillerAt;
            list.forEach(function (m) { m.seedOf = it; if (isFiller) m.fillerHit = true; });
            rest = rest.concat(list);
          }
        });
        /* الموضوع أولًا: absorb يحجز المفاتيح بالترتيب */
        return theme.concat(person, rest);
      }).catch(function () { return []; });
    }).then(function (sets) { return sets; });
  }

  /* ---------- التحميل ---------- */

  /**
   * يحمّل الدفعة التالية ويضيفها للقائمة.
   * onRound (اختياري): يُنادى بعد كل جولة بما تجمّع حتى الآن، عشان
   * الواجهة ترسم المحسوم من أول جولة بدل ما تنتظر الدفعة كاملة.
   * يرجّع { items, added, exhausted }
   */
  function loadMore(onRound) {
    if (state.loading || state.exhausted) {
      return Promise.resolve({ items: state.items, added: 0, exhausted: state.exhausted });
    }
    if (!CS.hasKey()) return Promise.reject(new Error('NO_KEY'));

    state.loading = true;
    var token = state.token;
    /* نفس حجم الدفعة لكل الأقسام — التصنيف المختار وحده أصغر لأنه
       يرسم أسرع، وهذا اختيار عرض لا حدّ على المادة */
    var target = state.items.length + (state.tag ? 24 : PAGE);
    var emptyRounds = 0;

    function round() {
      if (token !== state.token) return Promise.resolve();
      if (state.items.length >= target || state.exhausted) return Promise.resolve();

      state.page += 1;
      if (state.page > 500) { state.exhausted = true; return Promise.resolve(); }

      return sourcesFor(state.page).then(function (sets) {
        if (token !== state.token) return;

        var before = state.items.length;
        (sets || []).forEach(function (list) { absorb(list); });

        /* اتصال ساقط: نخرج فورًا ونترك الواجهة تقول السبب الحقيقي */
        if (state.roundFailed && state.items.length === before) {
          state.exhausted = true;
          state.hardFail = true;
          return;
        }

        /* الواجهة ترسم المحسوم الآن بدل ما تنتظر بقيّة الجولات */
        if (onRound && state.items.length > before) {
          try { onRound(state.items); } catch (e) { /* الرسم ما يوقف التحميل */ }
        }

        if (state.items.length === before) {
          emptyRounds++;
          /* الإزاحة قد تقع بعد آخر صفحة — نرجع للأولى مرة وحدة قبل
             ما نعلن «خلصت المادة» */
          if (emptyRounds >= 2 && !state.rewound) {
            state.rewound = true;
            state.pageOffset = 0;
            state.page = 0;
            emptyRounds = 0;
            return round();
          }
          /* كل جولة تسحب نافذة كلمات جديدة، فجولة فاضية ما تعني
             «خلصت المادة». نفس الحدّ لكل الأقسام بلا استثناء. */
          if (emptyRounds >= 6) { state.exhausted = true; return; }
        } else {
          emptyRounds = 0;
        }
        return round();
      });
    }

    return round()
      .then(function () {
        if (token !== state.token) return { items: [], added: 0, exhausted: false };
        state.loading = false;
        rank();
        return { items: state.items, added: state.items.length, exhausted: state.exhausted };
      })
      .catch(function (err) {
        state.loading = false;
        throw err;
      });
  }

  /* يضيف عناصر جديدة بعد التصفية وإزالة التكرار */
  function absorb(list) {
    var taste = CS.taste.seenSet();

    (list || []).forEach(function (it) {
      if (!it) return;
      var k = it.type + ':' + it.id;
      /* منع التكرار: العمل الواحد ما يدخل مرتين مهما جابه أكثر من
         نداء أو أكثر من مصدر */
      if (state.seen[k]) return;

      /* الإباحي ما يظهر إلا في قسم يطلبه */
      if (it.adult && !CS.certs.adultAllowed()) return;
      /* صنف العمل لازم يطابق صنف القسم — إلا عند تصنيف مختار */
      if (!state.tag && CS.certs.kindFits && CS.certs.kindFits(it) === false) return;
      /* الأعمال اللي صوّت عليها ما تتكرر في الاستكشاف */
      if (taste[k]) return;
      /* بلا بوستر = بطاقة فاضية */
      if (!it.poster) return;

      /* «توصيتي»: العتبة لا تُطبَّق هنا.
         وقت الاستيعاب ما تكون وسوم العمل قد وصلت بعد، فالنسبة
         تُحسب من النوع السينمائي وحده وترسب كل النتائج — القسم
         يطلع فاضيًا ومعك عشرات الإعجابات. التصفية صارت بعد وصول
         الوسوم في app.paintFeed، وهناك النسبة حقيقية. */

      state.seen[k] = true;
      state.items.push(it);
    });
  }

  /* الترتيب المحلي — للترتيبات اللي ما يدعمها TMDB */
  function rank() {
    if (state.tab === 'foryou') {
      /* الموضوع ثم الأشخاص ثم النسبة */
      state.items.sort(function (a, b) {
        var t = (b.themeHit ? 2 : 0) + (b.personHit ? 1 : 0) -
                ((a.themeHit ? 2 : 0) + (a.personHit ? 1 : 0));
        if (t) return t;
        return (b.matchPct || 0) - (a.matchPct || 0);
      });
      return;
    }

    if (state.sort === 'title.asc') {
      state.items.sort(function (a, b) {
        return String(a.title || '').localeCompare(String(b.title || ''), 'ar');
      });
      return;
    }

    if (state.strong) {
      state.items.forEach(function (it) {
        it.strongScore = Math.log10((it.votes || 0) + 1) * 3 + (it.rating || 0) +
                         Math.log10((it.popularity || 0) + 1);
      });
      state.items.sort(function (a, b) { return (b.strongScore || 0) - (a.strongScore || 0); });
      return;
    }

    if (state.sort !== 'foryou') return;
    var p = CS.taste.profile();
    if (!p.genres.length) return;

    var weight = {};
    p.genres.forEach(function (g, i) { weight[g] = 4 - i; });
    p.avoidGenres.forEach(function (g) { weight[g] = -4; });

    state.items.forEach(function (it) {
      var s = 0;
      (it.genreIds || []).forEach(function (g) { s += weight[g] || 0; });
      it.tasteScore = s + Math.min(3, Math.log10((it.popularity || 0) + 1));
    });
    state.items.sort(function (a, b) { return (b.tasteScore || 0) - (a.tasteScore || 0); });
  }

  /* ------------------------------------------------------------
     صفوف جاهزة — الأعلى تقييمًا · الأحدث · الأكثر رواجًا
     كلها تمرّ من نفس بوابة المحتوى، فما فيه صف يتسرّب منه عمل عام.
     ------------------------------------------------------------ */
  function shelf(kind, limit) {
    var sortBy = kind === 'top' ? 'vote_average.desc'
               : kind === 'new' ? 'primary_release_date.desc'
               : 'popularity.desc';

    return keywordIds('general').then(function (ids) {
      if (!ids || !ids.length) return [];
      var pick = shuffleBy(ids, (Date.now() / 3600000) | 0).slice(0, 2);
      var p = { sort_by: sortBy };
      if (kind === 'top') p['vote_count.gte'] = 60;
      return CS.util.pool(pick, 4, function (id) {
        return CS.tmdb.discover('movie', Object.assign({}, p, { with_keywords: String(id) }), 1)
          .then(function (l) {
            var nm = keywordNames()[id];
            if (nm && CS.certs.seedKeyword) (l || []).forEach(function (it) { CS.certs.seedKeyword(it, nm); });
            return l || [];
          });
      }).then(function (sets) {
        var seen = {}, out = [];
        sets.forEach(function (l) {
          (l || []).forEach(function (it) {
            var k = it.type + ':' + it.id;
            if (seen[k] || !it.poster) return;
            seen[k] = true;
            out.push(it);
          });
        });
        if (kind === 'top') out.sort(function (a, b) { return (b.rating || 0) - (a.rating || 0); });
        if (kind === 'new') out.sort(function (a, b) { return (b.year || 0) - (a.year || 0); });
        return out.slice(0, limit || 20);
      });
    }).catch(function () { return []; });
  }

  CS.feed = {
    PAGE: PAGE,
    TMDB_PAGE: TMDB_PAGE,
    SECTIONS: SECTIONS,
    DEFAULT_SECTION: DEFAULT_SECTION,
    FORYOU_MIN: FORYOU_MIN,
    CATEGORIES: CATEGORIES,
    SORTS: SORTS,
    QUALITY: QUALITY,
    COUNTRIES: COUNTRIES,
    allCategories: allCategories,
    resolveExtras: resolveExtras,
    tagNameOf: tagNameOf,
    keywordNameOf: keywordNameOf,
    keywordIdOf: keywordIdByName,
    reset: reset,
    current: current,
    loadMore: loadMore,
    shelf: shelf,
    keywordIds: keywordIds,
    keywordNames: keywordNames,
    eroticKeywordIds: eroticKeywordIds
  };

})(window.CS);
