/* ============================================================
   feed.js — خلاصة موحّدة: شبكة واحدة بترقيم لا نهائي
   بدل الصفوف المنفصلة، كل الأعمال في مكان واحد وتتحمّل صفحة صفحة.
   ============================================================ */

(function (CS) {
  'use strict';

  var PAGE = 50;          /* كم عمل نضيف مع كل «اعرض المزيد» */
  var TMDB_PAGE = 20;     /* TMDB يرجّع ٢٠ لكل صفحة دائمًا */

  /* ------------------------------------------------------------
     مفردات التصنيف — كل المصطلحات اللي طلبتها، بلا استثناء:
       Sensual · Sensual Cinema · Erotic · Erotic Cinema · Erotic Drama
       Erotic Thriller · Erotic Romance · Softcore · Sexploitation
       Sex Comedy · Steamy · Suggestive · Sexually Charged
       Intimate / Intimacy · Nudity · Arthouse Erotic · Adult Film
       Pornographic / Porn

     الأرقام تحت مؤكَّدة من استجابات TMDB فعلية (لا تخمين):
       190370 erotic movie · 155477 softcore · 10053 sexploitation
       445 pornography · 281741 nudity · 267122 sex
       339680 female nudity · 7344 porn star · 158436 porn actress
       195997 adult filmmaking
     والباقي يُحلّ وقت التشغيل بمطابقة حرفية من /search/keyword —
     ما نأخذ أول نتيجة عشوائية أبدًا.
     ------------------------------------------------------------ */

  /* المفردة اللي ما لها رقم مؤكَّد تُحلّ وقت التشغيل */
  /* مفردات القسم العام. المصطلحات الملتبسة — seduction · intimacy ·
     affair · taboo · arthouse — مقصاة عمدًا: توقع على دراما وإثارة
     عامة، فتسحب معها أعمالًا ما لها علاقة. البوابة تطردها لاحقًا،
     لكن الأفضل ألا نطلبها من TMDB أصلًا فنوفّر الطلب والضجيج. */
  var GENERAL_WORDS = [
    'sensual', 'sensuality', 'erotica', 'eroticism', 'erotic thriller',
    'erotic drama', 'erotic romance', 'erotic movie', 'sex scene', 'sex comedy',
    'steamy', 'nudie', 'women in prison', 'nunsploitation',
    'full frontal nudity', 'male nudity', 'softcore', 'sexploitation'
  ];

  var EXPLICIT_WORDS = [
    'pornography', 'hardcore', 'unsimulated sex', 'explicit sex',
    'adult video', 'adult film', 'porn'
  ];

  var SECTIONS = {
    /* عام — سينما جنسية. «porn star» و«porn actress» و«adult filmmaking»
       تصف أعمالًا *عن* صناعة الإباحية (Boogie Nights وأمثاله) لا أعمالًا
       إباحية، فمكانها هنا لا في القسم الإباحي. */
    general:  { seed: [190370, 155477, 10053, 267122, 339680, 281741, 7344, 158436, 195997],
                words: GENERAL_WORDS },
    /* إباحي — جنس حقيقي غير تمثيلي. البذرة الوحيدة المؤكَّدة هي
       «pornography»، والباقي يأتي من علم adult عند TMDB — وهذا
       القسم وحده يطلبه. */
    explicit: { seed: [445], words: EXPLICIT_WORDS },
    /* توصيتي — ما ينبني من الكلمات، ينبني من أعمالك اللي عجبتك */
    foryou:   { seed: [], words: [], fromTaste: true }
  };

  var DEFAULT_SECTION = 'general';

  /* أسماء البذور المؤكَّدة — من استجابات TMDB حقيقية */
  var SEED_NAMES = {
    190370: 'erotic movie', 155477: 'softcore', 10053: 'sexploitation',
    445: 'pornography', 281741: 'nudity', 267122: 'sex', 339680: 'female nudity',
    7344: 'porn star', 158436: 'porn actress', 195997: 'adult filmmaking'
  };

  function sectionFor(tab) { return SECTIONS[tab] ? tab : DEFAULT_SECTION; }

  /* أرقام الكلمات لكل قسم — تُحلّ مرة وحدة وتنحفظ في الذاكرة.
     ونحفظ الاسم مقابل الرقم كمان: الفهرس يحتاجه عشان يعرف أي وسم
     جاب أي عمل بلا ما يسأل TMDB مرة ثانية. */
  var resolved = {};
  var names = {};

  function keywordNames() { return names; }

  function keywordIds(tab) {
    var key = sectionFor(tab);
    if (resolved[key]) return Promise.resolve(resolved[key]);

    var conf = SECTIONS[key];
    /* البذور المؤكَّدة أسماؤها معروفة مسبقًا */
    SEED_NAMES && Object.keys(SEED_NAMES).forEach(function (id) { names[id] = SEED_NAMES[id]; });
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

  /* اسم قديم — كان يخدم قسم الإيروتيك وحده */
  function eroticKeywordIds() { return keywordIds('general'); }

  /* ------------------------------------------------------------
     التغيير الحيّ: القسم ما يعرض نفس الأعمال كل مرة.
     محورا التغيير حقيقيان لا شكليان:
       ١) نافذة كلمات دوّارة — نخلط المفردات ببذرة الجلسة ونأخذ
          نافذة منها تتحرّك مع كل صفحة، فالاستعلام نفسه يتغيّر.
       ٢) إزاحة صفحات — نبدأ من صفحة عشوائية داخل ما يسمح به
          TMDB فعلًا، ونلفّ عليها بدل ما نبدأ من الصفحة ١ دائمًا.
     ------------------------------------------------------------ */

  var WINDOW = 9;          /* كم كلمة في الاستعلام الواحد */

  /* خلط ثابت لبذرة معيّنة — نفس البذرة تعطي نفس الترتيب دائمًا،
     فالصفحة الثانية تكمّل على الأولى ولا تتضارب معها */
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

  /* نافذة كل صفحة عيّنة مستقلة، لا انزلاقًا على قائمة واحدة.
     النسخة القديمة كانت تزحزح نافذة متّصلة بمقدار ٣، فبعد ٨ صفحات
     تكون قد مرّت على كل المفردات — واتحاد أي زيارتين يصير متطابقًا
     ١٠٠٪ مهما اختلفت البذرة. الآن البذرة تُخلط مع رقم الصفحة، فكل
     صفحة عيّنة جديدة والاتحاد ما يتقارب أبدًا. */
  function windowOf(ids, seed, page) {
    /* المفردات القليلة (قسم Explicit ≤ ١١) كانت ترجع كما هي بلا أي
       تنويع. نأخذ منها عيّنة كمان — أضيق لكنها تتغيّر فعلًا. */
    var take = Math.min(WINDOW, Math.max(3, Math.ceil(ids.length * 0.5)));
    if (ids.length <= 3) return ids;

    /* 2654435761 = نسبة ذهبية ٣٢-بت — تفرّق البذور المتقاربة */
    var mixed = shuffleBy(ids, (seed ^ (page * 2654435761)) >>> 0);
    return mixed.slice(0, take);
  }

  /* آخر عدد صفحات شفناه لكل قسم — يُحفظ عشان الزيارة الجاية تقدر
     تقفز من أول طلب. بدونه maxPages تبدأ من ١ فترجع apiPage(1)=1
     دائمًا، ويصير أول ٤٠ عملًا في كل زيارة هي نفسها حرفيًا. */
  var PAGES_KEY = 'cs.feed_pages';

  /* عدد الصفحات يُحفظ لكل (قسم · نوع الوسيط · فيلم أو مسلسل).
     كان مشتركًا بين الأفلام والمسلسلات، وكتالوج المسلسلات أصغر
     بكثير — فأغلب نداءات المسلسلات كانت تطلب صفحة بعد آخرها
     وترجع فاضية: نصف الطلبات تضيع بلا نتيجة. */
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
    /* الإزاحة تتقدّم بخطوة مبعثرة لا بخطوة واحدة، وإلا صارت زيارتان
       متجاورتا الإزاحة تمشيان على نفس الصفحات تقريبًا */
    var jump = (state.pageOffset + (n - 1) * (1 + (state.seed % 7))) % max;
    return (jump % max) + 1;
  }

  /* أدنى نسبة تطابق يقبلها قسم «توصيتي» */
  var FORYOU_MIN = 80;

  /* ---------- حالة الخلاصة ---------- */

  function blank() {
    return {
      tab: DEFAULT_SECTION, sort: 'popularity.desc', origLang: '', minRating: 0,
      mediaType: '',                       /* '' الكل · movie · tv · reality */
      forYouMin: FORYOU_MIN,               /* عتبة التوصيات — ثابتة، ما تنزل */
      /* بذرة الجلسة: تتغيّر مع كل فتح للقسم فتتغيّر الأعمال المعروضة */
      seed: (Math.random() * 0x7fffffff) | 0,
      pageOffset: Math.floor(Math.random() * 97),
      rewound: false,
      maxPages: { movie: 1, tv: 1 },
      items: [], seen: {}, page: 0, exhausted: false, loading: false, token: 0
    };
  }

  var state = blank();

  function reset(patch) {
    var t = state.token + 1;
    state = blank();
    Object.keys(patch || {}).forEach(function (k) { state[k] = patch[k]; });
    state.token = t;
    /* نبدأ من العدد اللي تعلّمناه آخر زيارة، فالقفزة العشوائية تشتغل
       من الطلب الأول لا من الثاني */
    /* أول زيارة ما نعرف فيها عدد الصفحات، فكانت apiPage تلتصق بالصفحة
       الأولى — أي أشهر الأعمال، نفسها لكل زائر أول مرة. نفترض حدًّا
       متحفّظًا (كتالوج الأفلام لهذي الكلمات أكبر منه بكثير)، ولو طلع
       غلطًا فالرجوع للصفحة الأولى في loadMore يصحّحه من أول جولة. */
    state.maxPages = {
      movie: Math.max(knownPages('movie'), 6),
      tv: Math.max(knownPages('tv'), 2)
    };
    return state;
  }

  function current() { return state; }

  /* ---------- بناء معاملات الاستكشاف ---------- */

  function baseParams() {
    var p = {};
    if (state.origLang) p.with_original_language = state.origLang;
    if (state.minRating) p['vote_average.gte'] = state.minRating;

    /* الترتيب: TMDB ما يعرف «على ذوقي» — نحوّله لشهرة ثم نرتّب محليًا */
    p.sort_by = state.sort === 'foryou' ? 'popularity.desc' : state.sort;

    /* حد الأصوات يمنع الأعمال المجهولة تمامًا من إغراق النتائج،
       لكن نخفّضه بشدة عشان ما ينحصر العرض في المشهور العالمي فقط */
    if (state.sort === 'vote_average.desc') p['vote_count.gte'] = 120;
    else if (!CS.certs.adultAllowed()) p['vote_count.gte'] = 8;

    return p;
  }

  /* أنواع TMDB للبرامج الواقعية */
  var REALITY_GENRES = '10764|10767';

  /* أي نداءات TMDB يحتاجها القسم الحالي لهذه الصفحة.
     الأقسام كلها تمرّ من نفس الطريق: كلمات مفتاحية + include_adult
     على /discover. ما فيه فرع «عام» بلا كلمات، فما فيه طريق يدخل
     منه عمل غير مقصود. */
  function sourcesFor(page) {
    var p = baseParams();

    /* أعمال الكبار ما توصل أي حد أصوات — الحد يفرّغ القسم */
    delete p['vote_count.gte'];

    if (SECTIONS[sectionFor(state.tab)].fromTaste) return fromTaste(page);

    return keywordIds(state.tab).then(function (all) {
      if (!all || !all.length) return [];

      var ids = windowOf(all, state.seed, page);
      var want = state.mediaType;
      var jobs = [];
      var kinds = [];
      var names = keywordNames();

      /* نداء لكل كلمة على حدة بدل اتحاد الكلمات.
         الاتحاد كان يرجّع أعمالًا ما ندري أي كلمة جابتها، فكل عمل
         يكلّف طلب /keywords عشان البوابة تحكم عليه — عشرات الطلبات
         لرسم صفحة وحدة. النداء المفرد يعطي الدليل مع النتيجة نفسها. */
      var picks = ids.slice(0, 5);

      if (want !== 'tv' && want !== 'reality') {
        picks.forEach(function (kid) {
          var mq = Object.assign({}, p, { with_keywords: String(kid) });
          jobs.push(CS.tmdb.discover('movie', mq, apiPage('movie', page)));
          kinds.push({ type: 'movie', kw: kid });
        });
      }
      if (want !== 'movie') {
        var tq = Object.assign({}, p, { with_keywords: ids.join('|') });
        /* التاريخ في المسلسلات اسمه مختلف، والتصنيف غير مدعوم فيها أصلًا */
        if (tq.sort_by === 'primary_release_date.desc') tq.sort_by = 'first_air_date.desc';
        delete tq.certification; delete tq['certification.gte']; delete tq.certification_country;
        /* «مسلسلات» تستبعد البرامج الواقعية، و«برامج واقعية» تحصر فيها */
        if (want === 'reality') tq.with_genres = REALITY_GENRES;
        else if (want === 'tv') tq.without_genres = '10764,10767';
        picks.forEach(function (kid) {
          var q2 = Object.assign({}, tq, { with_keywords: String(kid) });
          jobs.push(CS.tmdb.discover('tv', q2, apiPage('tv', page)));
          kinds.push({ type: 'tv', kw: kid });
        });
      }

      return Promise.all(jobs).then(function (sets) {
        sets.forEach(function (l, i) {
          var k = kinds[i];
          if (!k || !l) return;
          /* دليل المصدر: كل عمل في هذي القائمة يحمل هذي الكلمة قطعًا */
          var nm = names[k.kw];
          if (nm && CS.certs.seedKeyword) {
            l.forEach(function (it) { CS.certs.seedKeyword(it, nm); });
          }
          /* نتعلّم أقصى صفحة لكل نوع على حدة */
          if (!l.totalPages) return;
          state.maxPages[k.type] = Math.max(state.maxPages[k.type] || 1, l.totalPages);
          rememberPages(k.type, state.maxPages[k.type]);
        });
        return sets;
      });
    });
  }

  /* ------------------------------------------------------------
     قسم «توصيتي» — ما ينبني من كلمات، ينبني من أعمالك اللي عجبتك.
     نأخذ ترشيحات TMDB ومشابهاته لكل عمل صوّت له 👍، ونرتّبها
     بنسبة تطابق حقيقية من ملف ذوقك. النسبة اللي تظهر على البطاقة
     هي نفسها اللي رتّبنا بها — ما فيه رقم للعرض ورقم للترتيب.
     ------------------------------------------------------------ */
  function likedSeeds() {
    var liked = CS.taste.likes() || [];
    /* نخلط بالبذرة عشان التوصيات تتغيّر مع كل فتح بدل ما تتجمّد
       على آخر عملين أعجباك */
    var pool = liked.filter(function (it) {
      return it && it.source === 'tmdb' && (it.type === 'movie' || it.type === 'tv');
    });
    if (!pool.length) return pool;

    /* الخلط ثم القصّ كان يرمي البذرة: بأقل من ٩ إعجابات ترجع نفس
       القائمة دائمًا. ندوّر البداية بالبذرة قبل القصّ، فالبذور
       المختلفة تعطي بدايات مختلفة حتى مع عملين اثنين. */
    var mixed = shuffleBy(pool, state.seed);
    /* أخذ ثمانية من قائمة طولها ثمانية يرجّع نفس المجموعة مهما دارت
       — البذرة تضيع. نأخذ جزءًا أصغر عشان الاختيار نفسه يتغيّر. */
    var take = Math.max(1, Math.min(5, Math.ceil(mixed.length * 0.7)));
    var start = (state.seed >>> 0) % mixed.length;
    var out = [];
    for (var i = 0; i < take; i++) out.push(mixed[(start + i) % mixed.length]);
    return out;
  }

  function fromTaste(page) {
    var seeds = likedSeeds();
    if (!seeds.length) return Promise.resolve([]);

    /* الصفحة تُزاح بالبذرة كمان: بعملين اثنين محبوبين، الصفحة هي
       المحور الوحيد الباقي للتغيير بين الزيارات */
    var pg = ((page - 1 + (state.seed % 3)) % 5) + 1;
    var ADULT = SECTIONS.general.seed;

    return CS.util.pool(seeds, 4, function (it) {
      var jobs = [
        CS.tmdb.relatedPage(it.type, it.id, 'recommendations', pg),
        CS.tmdb.relatedPage(it.type, it.id, 'similar', pg)
      ];

      /* ترشيحات TMDB لأعمال الكبار ترجع أعمالًا عادية، وبوابة المحتوى
         ترميها كلها فيطلع القسم ببطاقتين أو فاضيًا. نطلب من TMDB بدلها
         من كتالوج الموقع نفسه: كلمات العمل المفتاحية + نوعه + نوعه
         السينمائي، وداخل مفردات القسم — فالناتج شبيه فعلًا ويعدّي
         البوابة بدل ما يُرمى. */
      var own = (it.keywordIds || []).slice(0, 4);
      var genres = (it.genreIds || []).slice(0, 2).join('|');
      if (own.length) {
        jobs.push(CS.tmdb.discover(it.type, {
          with_keywords: own.join('|'),
          with_genres: genres
        }, pg));
      }
      jobs.push(CS.tmdb.discover(it.type, {
        with_keywords: ADULT.join('|'),
        with_genres: genres
      }, pg + 3));

      return Promise.all(jobs).then(function (r) {
        return r.reduce(function (acc, x) { return acc.concat((x && x.items) || []); }, []);
      }).catch(function () { return []; });
    }).then(function (sets) {
      /* «توصيتي» ما يستعمل apiPage — صفحاته من relatedPage مباشرة */
      return sets;
    });
  }

  /* ---------- التحميل ---------- */

  /**
   * يحمّل الدفعة التالية ويضيفها للقائمة.
   * يرجّع { items, added, exhausted }
   */
  function loadMore() {
    if (state.loading || state.exhausted) {
      return Promise.resolve({ items: state.items, added: 0, exhausted: state.exhausted });
    }
    if (!CS.hasKey()) return Promise.reject(new Error('NO_KEY'));

    state.loading = true;
    var token = state.token;
    var target = state.items.length + PAGE;
    var emptyRounds = 0;

    function round() {
      if (token !== state.token) return Promise.resolve();
      if (state.items.length >= target || state.exhausted) return Promise.resolve();

      state.page += 1;
      /* TMDB يرفض ما بعد الصفحة ٥٠٠ */
      if (state.page > 500) { state.exhausted = true; return Promise.resolve(); }

      return sourcesFor(state.page).then(function (sets) {
        if (token !== state.token) return;

        var before = state.items.length;
        (sets || []).forEach(function (list) { absorb(list); });

        if (state.items.length === before) {
          emptyRounds++;
          /* ثلاث صفحات متتالية بلا جديد ← خلصت المادة.
             «توصيتي» ما ينزّل عتبته أبدًا: العتبة ٨٠٪ هي المطلوبة،
             وقسم قصير صادق أفضل من قسم طويل بنِسَب مضروبة. */
          /* الإزاحة قد تقع بعد آخر صفحة فيرجع كل شي فاضيًا ونعلن
             «خلصت المادة» والشبكة فاضية من أول تحميل. قبل ما نستسلم
             نرجع للصفحة الأولى مرة وحدة — هي مضمونة دائمًا. */
          if (emptyRounds >= 2 && !state.rewound) {
            state.rewound = true;
            state.pageOffset = 0;
            state.page = 0;
            emptyRounds = 0;
            return round();
          }
          /* كل جولة تسحب نافذة كلمات جديدة، فجولة فاضية ما تعني
             «خلصت المادة» — تعني إن هذي العيّنة ما كانت منتجة.
             ثلاث جولات كانت تُنهي القسم مبكرًا وتترك شبكة شبه فاضية. */
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
      if (state.seen[k]) return;

      /* الإباحي ما يظهر إلا في قسم يطلبه */
      if (it.adult && !CS.certs.adultAllowed()) return;
      /* وصنف العمل لازم يطابق صنف القسم: سينما في «عام»، إباحي في
         «Explicit». بدونها القسمان يعرضان نفس البركة. */
      if (CS.certs.kindFits && CS.certs.kindFits(it) === false) return;
      /* الأعمال اللي صوّت عليها ما تتكرر في الاستكشاف */
      if (taste[k]) return;
      /* بلا بوستر = بطاقة فاضية */
      if (!it.poster) return;

      /* «توصيتي»: النسبة تُحسب هنا، والعمل ما يدخل إلا إذا عدّى العتبة.
         نفس الرقم اللي يظهر على البطاقة هو اللي رتّبنا وفلترنا به —
         ما فيه رقم للعرض وآخر للترتيب. */
      if (state.tab === 'foryou') {
        it.matchPct = CS.taste.matchPct(it);
        it.matchStamp = CS.taste.version ? CS.taste.version() : 0;
        if ((it.matchPct || 0) < state.forYouMin) return;
      }

      state.seen[k] = true;
      state.items.push(it);
    });
  }

  /* «على ذوقي» يرتّب محليًا حسب أنواعك المفضلة */
  function rank() {
    /* قسم التوصيات يترتّب بنسبة التطابق نفسها، أعلاها أولًا */
    if (state.tab === 'foryou') {
      state.items.sort(function (a, b) { return (b.matchPct || 0) - (a.matchPct || 0); });
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

  CS.feed = {
    PAGE: PAGE,
    TMDB_PAGE: TMDB_PAGE,
    SECTIONS: SECTIONS,
    DEFAULT_SECTION: DEFAULT_SECTION,
    FORYOU_MIN: FORYOU_MIN,
    reset: reset,
    current: current,
    loadMore: loadMore,
    keywordIds: keywordIds,
    keywordNames: keywordNames,
    eroticKeywordIds: eroticKeywordIds
  };

})(window.CS);
