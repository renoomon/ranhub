/* ============================================================
   certs.js — التصنيف العمري للأعمال
   TMDB يعطي التصنيف لكل دولة: أفلام عبر release_dates
   ومسلسلات عبر content_ratings. نحوّله لمستوى موحّد ٠..٥.
   ============================================================ */

(function (CS) {
  'use strict';

  /* ٠ عائلي · ١ إرشاد أبوي · ٢ +١٣ · ٣ +١٧ · ٤ +١٨ · ٥ إباحي صريح */
  var TIERS = [
    { n: 0, label: 'عائلي',    short: 'ع',    emoji: '🟢', color: '#3fbf7f' },
    { n: 1, label: 'إرشاد أبوي', short: 'PG',  emoji: '🟢', color: '#6cc27a' },
    { n: 2, label: '+13',      short: '13+',  emoji: '🟡', color: '#e6c455' },
    { n: 3, label: '+17',      short: '17+',  emoji: '🟠', color: '#e08b3f' },
    { n: 4, label: '+18',      short: '18+',  emoji: '🔴', color: '#e0523f' },
    { n: 5, label: 'إباحي صريح', short: '🔥',  emoji: '🔥', color: '#c2185b' }
  ];

  /* التصنيفات الحرفية المعروفة عبر الدول */
  var MAP = {
    /* أمريكا — أفلام ومسلسلات */
    'G': 0, 'TV-Y': 0, 'TV-Y7': 0, 'TV-G': 0,
    'PG': 1, 'TV-PG': 1,
    'PG-13': 2, 'TV-14': 2,
    'R': 3, 'TV-MA': 3,
    'NC-17': 4, 'AO': 4, '18+': 4,
    /* بريطانيا: 18 مقيّد للبالغين، R18 يُباع في محلات مرخّصة فقط ← إباحي */
    'U': 0, 'Uc': 0, '12A': 2, '12': 2, '15': 3, '18': 4, 'R18': 5,
    /* أستراليا: X 18+ إباحي صراحةً حسب تعريف TMDB */
    'M': 2, 'MA15+': 3, 'MA 15+': 3, 'R18+': 4, 'R 18+': 4,
    'X': 5, 'X18+': 5, 'X 18+': 5, 'RC': 4,
    /* فرنسا والبرازيل */
    'TP': 0, 'Livre': 0,
    /* أوروبا وغيرها — أرقام صافية */
    '0': 0, '6': 0, '7': 0, '9': 1, '10': 1, '11': 1,
    '13': 2, '14': 2, '16': 3, '17': 3
  };

  function tierFromCert(cert) {
    if (!cert) return null;
    var c = String(cert).trim().toUpperCase();
    if (MAP[c] !== undefined) return MAP[c];

    /* «PG13» أو «TV14» بدون شرطة */
    var squashed = c.replace(/[\s-]/g, '');
    var alt = Object.keys(MAP).filter(function (k) {
      return k.toUpperCase().replace(/[\s-]/g, '') === squashed;
    })[0];
    if (alt) return MAP[alt];

    /* رقم صافي مثل «١٦» أو «18» */
    var num = parseInt(c, 10);
    if (!isNaN(num)) {
      if (num >= 18) return 4;
      if (num >= 16) return 3;
      if (num >= 12) return 2;
      if (num >= 8) return 1;
      return 0;
    }
    return null;
  }

  function tierInfo(n) {
    return TIERS[Math.max(0, Math.min(5, n == null ? 2 : n))];
  }

  /* ---------- سحب التصنيف من TMDB ---------- */

  /* 'SA|movie:550' → { tier, cert, country }
     التصنيفات ما تتغير، فنخزّنها في المتصفح ونوفّر عشرات الطلبات كل زيارة */
  var CACHE_KEY = 'cs.cert_cache';
  var MAX_CACHE = 1500;

  var cache = (function () {
    var c = CS.store.get(CACHE_KEY, {});
    return (c && typeof c === 'object' && !Array.isArray(c)) ? c : {};
  })();

  var pending = {};
  var saveTimer;

  function persist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      var keys = Object.keys(cache);
      if (keys.length > MAX_CACHE) {
        keys.slice(0, keys.length - MAX_CACHE).forEach(function (k) { delete cache[k]; });
      }
      CS.store.set(CACHE_KEY, cache);
    }, 800);
  }

  /* TMDB ما عنده تصنيفات للسعودية ولا الإمارات ولا مصر — تحققنا من قائمته.
     فنبدأ بمنطقة المستخدم (لو صادف عندها لوح) ثم دول عندها تصنيفات فعلًا. */
  function order() {
    var r = CS.state.region || 'SA';
    return [r, 'US', 'GB', 'AU', 'DE'].filter(function (v, i, a) { return a.indexOf(v) === i; });
  }

  function fromMovie(json) {
    var results = (json || {}).results || [];
    var wanted = order();

    for (var i = 0; i < wanted.length; i++) {
      var block = results.filter(function (r) { return r.iso_3166_1 === wanted[i]; })[0];
      var cert = pickCert(block);
      if (cert) return { cert: cert, country: wanted[i] };
    }
    /* أي دولة فيها تصنيف */
    for (var j = 0; j < results.length; j++) {
      var any = pickCert(results[j]);
      if (any) return { cert: any, country: results[j].iso_3166_1 };
    }
    return null;
  }

  /* أنواع الإصدار عند TMDB: ٣ سينمائي · ٢ محدود · ٤ رقمي · ٥ مادي · ٦ تلفزيوني · ١ عرض أول.
     ترتيب المصفوفة غير مضمون، فناخذ التصنيف السينمائي أولًا لا الأول في القائمة. */
  var TYPE_PREF = [3, 2, 4, 5, 6, 1];

  function pickCert(block) {
    if (!block) return '';
    var dates = (block.release_dates || []).filter(function (d) {
      return (d.certification || '').trim();
    });
    if (!dates.length) return '';

    for (var i = 0; i < TYPE_PREF.length; i++) {
      var hit = dates.filter(function (d) { return d.type === TYPE_PREF[i]; })[0];
      if (hit) return hit.certification.trim();
    }
    return dates[0].certification.trim();
  }

  function fromTv(json) {
    var results = (json || {}).results || [];
    var wanted = order();
    for (var i = 0; i < wanted.length; i++) {
      var hit = results.filter(function (r) {
        return r.iso_3166_1 === wanted[i] && (r.rating || '').trim();
      })[0];
      if (hit) return { cert: hit.rating.trim(), country: wanted[i] };
    }
    var any = results.filter(function (r) { return (r.rating || '').trim(); })[0];
    return any ? { cert: any.rating.trim(), country: any.iso_3166_1 } : null;
  }

  /* يقرأ التصنيف من كائن التفاصيل الكامل (بدون طلب إضافي) */
  function fromDetails(raw, type, adult) {
    if (adult) return { tier: 5, cert: 'Adult', country: '' };
    var found = type === 'movie'
      ? fromMovie(raw.release_dates)
      : fromTv(raw.content_ratings);
    if (!found) return null;
    var tier = tierFromCert(found.cert);
    if (tier === null) return null;
    return { tier: tier, cert: found.cert, country: found.country };
  }

  /* يجيب التصنيف لعنصر من الشبكة (طلب خفيف واحد، مع تخزين) */
  function cacheKey(item) {
    return (CS.state.region || 'SA') + '|' + item.type + ':' + item.id;
  }

  function fetchFor(item) {
    if (!item || item.source !== 'tmdb') return Promise.resolve(null);
    if (item.adult) return Promise.resolve({ tier: 5, cert: 'Adult', country: '' });

    var k = cacheKey(item);
    if (cache[k] !== undefined) return Promise.resolve(cache[k]);
    if (pending[k]) return pending[k];

    var path = item.type === 'movie'
      ? '/movie/' + item.id + '/release_dates'
      : '/tv/' + item.id + '/content_ratings';

    pending[k] = CS.tmdb.req(path, { language: undefined })
      .then(function (json) {
        var found = item.type === 'movie' ? fromMovie(json) : fromTv(json);
        var out = null;
        if (found) {
          var tier = tierFromCert(found.cert);
          if (tier !== null) out = { tier: tier, cert: found.cert, country: found.country };
        }
        cache[k] = out;
        delete pending[k];
        persist();
        return out;
      })
      .catch(function () { cache[k] = null; delete pending[k]; persist(); return null; });

    return pending[k];
  }

  function cachedFor(item) {
    if (!item) return undefined;
    if (item.adult) return { tier: 5, cert: 'Adult', country: '' };
    if (item.certTier != null) return { tier: item.certTier, cert: item.cert || '', country: '' };
    return cache[cacheKey(item)];
  }

  function put(item, info) {
    cache[cacheKey(item)] = info;
    persist();
  }

  /* ---------- فلتر المستوى ---------- */

  /**
   * mature: هذا فلتر «للكبار فقط» — يعرض المستويات المحددة ولا شي غيرها،
   *         وأي عمل بلا تصنيف معروف يُستبعد (ما نبي محتوى عام يتسلل).
   * needsAdult: يحتاج موافقة صريحة قبل التفعيل.
   */
  var FILTERS = {
    all:      { label: 'كل التصنيفات', min: 0, max: 4 },

    /* وضع «للبالغين فقط» على مستوى الموقع كله: R / TV-MA / 15 / 18 / NC-17.
       حصره في المستوى ٤ وحده يفرّغ الكتالوج — NC-17 كله بضع عشرات الأفلام. */
    adults:   { label: 'للبالغين فقط (+17 فما فوق)', min: 3, max: 4, mature: true, needsAdult: true },
    /* العتبة الأضيق: المصنّف +18 وحده — NC-17 · 18 · R18+ · AO */
    adults18: { label: 'للبالغين فقط (+18 حصرًا)', min: 4, max: 4, mature: true, needsAdult: true },

    /* ------------------------------------------------------------
       أقسام الموقع الثلاثة — كلها مبنية على كلمات TMDB المفتاحية،
       لا على التصنيف العمري. التصنيف وحده كان يمرّر أفلامًا عادية
       مصنّفة R (دراما، أكشن، رعب) وهذا اللي كان يظهر في الأقسام.
       الآن البوابة هي الكلمة المفتاحية: العمل ما يدخل القسم إلا إذا
       TMDB نفسه واسمه بـ erotic / softcore / nudity وأخواتها.
       ولأن أغلب هذي الأعمال بلا تصنيف أمريكي رسمي، التصنيف المجهول
       يعدّي (keywordGated) ولا يُستخدم إلا لطرد إيجابية كاذبة
       معروفة التصنيف وأقل من الحد: عمل موسوم erotica لكن تصنيفه
       PG-13 أو أقل ما هو من هذا النوع، فيطلع.
       ------------------------------------------------------------ */
    /* «عام» سينما جنسية: إيحاء وتعري. الإباحي الفعلي ممنوع منه —
       ولا include_adult حتى، وإلا سكب TMDB الإباحي في القسم. */
    general:  { label: 'General', min: 3, max: 4,
                mature: true, needsAdult: true, keywords: true, keywordGated: true,
                kinds: ['tease', 'nudity'], includeAdult: false },
    /* «إباحي» وحده يفتح include_adult ويقبل الإباحي الفعلي */
    /* «Explicit» سينما الجنس الصريح: أعمال سينمائية بمشاهد جنس حقيقي
       (unsimulated sex · roman porno) — لا أفلام porn. لذلك ما نفتح
       includeAdult، والصنف المقبول 'explicit' وحده. */
    explicit: { label: 'Explicit', min: 3, max: 5,
                mature: true, needsAdult: true, keywords: true, keywordGated: true,
                kinds: ['explicit'], includeAdult: false }
  };

  /* مفاتيح أقسام قديمة محفوظة في متصفّح المستخدم — تُحوَّل بدل ما تسقط
     على «الكل» فيتسرّب محتوى عام في قسم للكبار */
  var LEGACY_FILTER = {
    mature: 'explicit', erotic: 'general', sensual: 'general',
    softcore: 'general', movie: 'general', tv: 'general',
    reality: 'general', doc: 'general', foryou: 'general'
  };

  function currentFilter() {
    var k = CS.store.get(CS.KEYS.certTier, 'all');
    if (FILTERS[k]) return k;
    return LEGACY_FILTER[k] || 'all';
  }

  function current() { return FILTERS[currentFilter()]; }

  /* كل أقسام الكبار الثلاثة تفتح include_adult — بموافقة محفوظة.
     ربطها بالمستوى ٥ وحده كان يقفل الإيروتيك و+18 بلا سبب. */
  /* هل نطلب من TMDB أن يُدخل الأعمال المعلَّمة adult؟
     كانت تُفتح لكل وضع كبار، فيرجع /discover إباحيًا حقيقيًا داخل
     قسم السينما الجنسية ويغرقه — «صار المحتوى porn بدل أعمال
     سينمائية». الآن قسم Explicit وحده يطلبه. */
  function adultAllowed() {
    var f = current();
    if (!f.needsAdult || CS.store.get(CS.KEYS.adultOn, false) !== true) return false;
    return f.includeAdult === true;
  }

  /* موافقة الكبار محفوظة؟ (مستقلة عن طلب المحتوى الإباحي من TMDB) */
  function adultConsent() {
    return CS.store.get(CS.KEYS.adultOn, false) === true;
  }

  /* هل الفلتر الحالي «للكبار فقط»؟ يعني ما نعرض إلا المستويات المطلوبة */
  function matureOnly() { return !!current().mature; }


  /**
   * هل يعدّي العنصر الفلتر الحالي؟
   * ترجع true / false / null (null = التصنيف لسه ما وصل، انتظر)
   */
  function passes(item) {
    var key = currentFilter();
    var f = FILTERS[key];
    var info = cachedFor(item);

    /* العمل المعلَّم adult في TMDB مستواه ٥ — كان يتخطّى حدود الفلتر
       كليًا فيدخل قسم الأفلام العادي في أي وضع كبار. الآن يخضع للحدود
       مثل غيره، فما يظهر إلا في قسم يطلب المستوى ٥ فعلًا. */
    if (item && item.adult) {
      return !!f.needsAdult && adultAllowed() && f.max >= 5;
    }

    if (key === 'all') return true;

    /* الأقسام المبنية على الكلمات المفتاحية: العمل عدّى البوابة وقت
       الاستكشاف. أغلب الإيروتيك والسوفت‌كور بلا تصنيف أمريكي رسمي،
       فرفض المجهول هنا كان يفرّغ الأقسام الثلاثة من مادتها الحقيقية.
       التصنيف يُستخدم للطرد فقط: معروف وأقل من الحد ← يطلع. */
    if (f.keywordGated) {
      if (info === undefined || info === null) return true;
      return info.tier >= f.min && info.tier <= f.max;
    }

    if (info === undefined) return null;          /* التصنيف لسه ما وصل */

    /* بلا تصنيف معروف = ما نعرفه. أي فلتر غير «الكل» يستبعده،
       وإلا يتسرّب محتوى غير مصنّف تحت «عائلي فقط» */
    if (info === null) return false;

    return info.tier >= f.min && info.tier <= f.max;
  }

  /* TMDB يقبل فلترة التصنيف في /discover للأفلام فقط، وبتصنيفات أمريكا */
  /* certification.lte وحده يسحب NR (الرتبة صفر) — أي غير المصنّف — فنحدّ الطرفين.
     ولا نضع تصنيفًا لوضع «الإباحي»: علم adult محور منفصل تمامًا عن NC-17،
     ولو فلترنا بـ NC-17 هناك رجعت أفلام عادية يرفضها passes() فتطلع النتيجة صفرًا. */
  var DISCOVER_CERT = {
    /* وضع الموقع للبالغين: R فما فوق حسب لوح أمريكا */
    adults:   { 'certification.gte': 'R' },
    adults18: { 'certification.gte': 'NC-17' }
    /* الأقسام الثلاثة ما تمرّ من هنا نهائيًا: أي certification.gte
       يسقط كل عمل بلا تصنيف أمريكي — وهذا وصف أغلب الإيروتيك
       والسوفت‌كور والسِكسبلويتيشن. البوابة هناك with_keywords. */
  };

  function discoverCert(type) {
    if (type !== 'movie') return null;
    var map = DISCOVER_CERT[currentFilter()];
    if (!map) return null;
    var out = { certification_country: 'US' };
    Object.keys(map).forEach(function (k) { out[k] = map[k]; });
    return out;
  }

  /* ------------------------------------------------------------
     وسوم المحتوى الحسّي — من بيانات TMDB الحقيقية فقط.
     مصدران: واصفات مجالس التصنيف الرسمية، وكلمات TMDB المفتاحية.
     ما نخترع نسبة ولا مدة مشاهد: ما فيه أي مصدر مجاني يعطيها.
     ------------------------------------------------------------ */

  /* واصفات رسمية موجودة فعلًا في release_dates وموزّعة على الدول،
     فنجمعها من كلها — أمريكا غالبًا فاضية وكندا والبرازيل أغنى */
  /* واصفات المجالس تُوحَّد على مصطلح إنجليزي واحد — الوسم قابل للضغط
     فلازم يكون مصطلحًا يفهمه بحث TMDB لا ترجمة عربية */
  var DESC_EN = [
    [/nudity|nude/i, 'nudity'],
    [/\bsex\b|sexual content|sexual/i, 'sex'],
    [/extreme violence/i, 'extreme violence'],
    [/violence|gore/i, 'violence'],
    [/substance abuse|drug/i, 'drugs'],
    [/coarse language|inappropriate language|profanity/i, 'profanity'],
    [/fear|horror|disturbing/i, 'horror']
  ];

  function descriptorsOf(json, type) {
    var out = [];
    ((json || {}).results || []).forEach(function (block) {
      var list = type === 'movie'
        ? (block.release_dates || []).reduce(function (a, d) { return a.concat(d.descriptors || []); }, [])
        : (block.descriptors || []);
      list.forEach(function (raw) {
        DESC_EN.forEach(function (pair) {
          if (pair[0].test(String(raw)) && out.indexOf(pair[1]) === -1) out.push(pair[1]);
        });
      });
    });
    return out;
  }

  /* كلمات TMDB المفتاحية — الأرقام مؤكَّدة من استجابات حقيقية */
  /* الوسم يحمل مصطلح TMDB الإنجليزي نفسه — لأنه هو اللي يشتغل
     لما تضغط الوسم فيبحث عنه ككلمة مفتاحية حقيقية */
  var HEAT = [
    { re: /^(pornography|porn|hardcore|porn star|porn actress|adult filmmaking)$/i, w: 100, en: 'pornography' },
    { re: /(softcore|erotic|erotica|sexploitation)/i,      w: 78, en: 'erotic' },
    { re: /(full frontal nudity|frontal nudity)/i,         w: 74, en: 'full frontal nudity' },
    { re: /(sex scene|explicit sex|graphic sex|unsimulated sex)/i, w: 68, en: 'sex scene' },
    { re: /^(female nudity|male nudity|nudity|topless)$/i,  w: 62, en: 'nudity' },
    { re: /^(sex|sexuality|sexual)$/i,                      w: 46, en: 'sex' },
    { re: /(bdsm|fetish|voyeurism|orgy|threesome)/i,        w: 55, en: 'bdsm' },
    { re: /(strip club|stripper|prostitution|prostitute|brothel)/i, w: 40, en: 'prostitution' }
  ];

  /**
   * يرجّع { score: 0..100, tags: [...] }
   * score = أقوى وسم موجود فعلًا، مو تقديرًا لمدة المشاهد.
   */
  function heatOf(keywords, adult, descriptors) {
    var tags = [], score = 0;

    /* الواصفات الرسمية أقوى دليل — تجي من مجالس التصنيف نفسها */
    (descriptors || []).forEach(function (d) {
      if (tags.indexOf(d) === -1) tags.push(d);
      if (/nudity/i.test(d)) score = Math.max(score, 70);
      else if (/\bsex\b/i.test(d)) score = Math.max(score, 66);
      else if (/sexual/i.test(d)) score = Math.max(score, 48);
    });

    (keywords || []).forEach(function (k) {
      var name = (k && k.name) || '';
      HEAT.forEach(function (h) {
        if (!h.re.test(name)) return;
        if (tags.indexOf(h.en) === -1) tags.push(h.en);
        score = Math.max(score, h.w);
      });
    });

    if (adult) { score = 100; if (tags.indexOf('pornography') === -1) tags.unshift('pornography'); }

    /* الأسماء الخام تُحفظ كمان: heatOf يوحّد عدة كلمات في وسم واحد
       («softcore» و«erotica» يصيران «erotic»)، فتضيع تفرقة البوابة
       بين الوسم القوي والضعيف لو اعتمدت على الموحَّد وحده. */
    var names = (keywords || []).map(function (k) { return (k && k.name) || ''; })
      .filter(Boolean).slice(0, 24);

    return { score: score, tags: tags.slice(0, 6), names: names };
  }

  /* ------------------------------------------------------------
     نوع المحتوى بالعربي — إباحي · تعري · إيحاء
     يُشتقّ من نفس بيانات TMDB الحقيقية (علم adult · التصنيف ·
     الوسوم والواصفات)، فما فيه طلب إضافي ولا تخمين.
     يرجّع null لو ما وصلت البيانات بعد — البطاقة تعرض مكانه
     شارة انتظار وتستبدلها أول ما توصل، فما فيه بوستر بلا شارة.
     ------------------------------------------------------------ */
  var KIND = {
    porn:    { ar: 'إباحي', emoji: '⛔', color: '#e11d48',
               why: 'جنس حقيقي غير تمثيلي — علم adult عند TMDB أو تصنيف R18 · ممنوع من الموقع كله' },
    explicit:{ ar: 'صريح',  emoji: '🎬', color: '#a855f7',
               why: 'سينما بجنس صريح غير تمثيلي (unsimulated sex · roman porno) — عمل سينمائي لا فيلم porn' },
    nudity:  { ar: 'تعري',  emoji: '🔥', color: '#f97316',
               why: 'عُري صريح — وسم nudity أو واصف رسمي من مجلس التصنيف' },
    tease:   { ar: 'إيحاء', emoji: '🌶️', color: '#ec4899',
               why: 'إيحاء ومشاهد حميمة بلا عُري صريح مسجّل' },
    none:    { ar: 'بدون',  emoji: '⚪', color: '#64748b',
               why: 'ما فيه في TMDB أي وسم حسّي لهذا العمل' }
  };

  /* الأسماء الخام — heatOf يوحّد «porn star» و«pornography» في وسم
     واحد، فيصير فيلم عن صناعة الإباحية إباحيًا. النوع يُقرأ من
     الأسماء نفسها: ما يصنع «إباحيًا» إلا الجنس الحقيقي. */
  /* الإباحي وحده — الجنس الصريح داخل عمل سينمائي له وسمه الخاص تحت،
     وكان مخلوطًا هنا فيُصنَّف porn ويُحال إلى قسم الإباحي. */
  var PORN_NAME = /^(pornography|porn|hardcore pornography|adult video|hentai)$/;
  /* «صريح» = جنس غير تمثيلي داخل عمل سينمائي. القائمة وُسّعت لتطابق
     مفردات قسم Explicit في feed.js حرفًا بحرف: كل كلمة يطلبها القسم
     من TMDB لازم تُصنَّف صريحة هنا، وإلا رجعت أعمال ترميها البوابة. */
  var EXPLICIT_NAME = /^(unsimulated sex|explicit sex|graphic sex|sex scene|sex act|sexual intercourse|unsimulated oral sex|hardcore sex|simulated sex|sexual explicitness|explicit nudity|roman porno|nikkatsu roman porno|pinku eiga)$/;
  var NUDE_NAME = /^(nudity|female nudity|male nudity|topless|nude|full frontal nudity|frontal nudity)$/;
  var TEASE_NAME = /^(erotic|erotica|eroticism|erotic movie|erotic film|erotic cinema|erotic thriller|erotic drama|erotic romance|erotic comedy|softcore|soft core|sexploitation|nunsploitation|nudie|sensual|sensuality|steamy|sex|sexual|sexuality|sex scene|sex comedy|women in prison|bdsm|fetish|prostitution|striptease|seduction|porn star|porn actress|adult filmmaking|adult film|adult movie)$/;

  function contentKind(item) {
    if (!item) return null;

    /* أقوى دليلين ما يحتاجان أي طلب */
    if (item.adult) return 'porn';
    var info = cachedFor(item);
    if (info && info.tier === 5) return 'porn';

    var heat = cachedHeat(item);
    if (heat === undefined) return null;        /* لسه ما وصلت */
    if (heat === null) return null;             /* الطلب فشل — نبقى صادقين */

    var names = (heat.names || []).map(function (t) { return String(t).trim().toLowerCase(); });
    if (!names.length) return null;
    if (names.some(function (t) { return PORN_NAME.test(t); })) return 'porn';
    if (names.some(function (t) { return EXPLICIT_NAME.test(t); })) return 'explicit';
    if (names.some(function (t) { return NUDE_NAME.test(t); })) return 'nudity';
    if (names.some(function (t) { return TEASE_NAME.test(t); })) return 'tease';
    return 'none';
  }

  function kindInfo(key) { return KIND[key] || null; }

  /* هل هذا العمل من نوع القسم الحالي؟
     البوابة تقول «محتوى جنسي أو لا»، وهذي تقول «من أي صنف»:
       General  → إيحاء وتعري (سينما)
       Explicit → إباحي فعلي وحده
     بدونها القسمان يعرضان نفس البركة، فيغرق العام بالإباحي. */
  function kindFits(item) {
    var f = current();
    if (!f.kinds) return true;
    var k = contentKind(item);
    if (k === null) return null;            /* البيانات ما وصلت */
    return f.kinds.indexOf(k) !== -1;
  }

  /* ------------------------------------------------------------
     بوابة المحتوى — الشرط الوحيد لظهور أي عمل في البحث.
     الموقع كله لمحتوى واحد، فالسؤال ما هو «هل تصنيفه +18؟»
     بل «هل TMDB نفسه وسمه بمحتوى جنسي؟».

     الوسوم مقسومة قسمين لأن قوّتها ليست واحدة:
       قوي  = وسم لا يوجد إلا على سينما جنسية (erotic · softcore ·
              sexploitation · pornography · full frontal nudity …)
       ضعيف = وسم قد يقع على عمل عام فيه مشهد واحد (nudity · sex ·
              prostitution …). واحد منه لا يكفي، ثلاثة تكفي.

     ترجع: true (يدخل) · false (يُمنع) · null (الوسوم ما وصلت بعد).
     null ما يُعرض أبدًا — يُسحب وسمه أولًا ثم يُحكم عليه.
     ------------------------------------------------------------ */
  /* ------------------------------------------------------------
     جدول القبول — بالنقاط لا بالثنائية.
     الوسم الواحد لا يكفي وحده إلا إذا كان لا يقع إلا على سينما
     جنسية. الباقي يتراكم، ولازم مع التراكم إشارة «قلب» (عُري أو
     جنس) وإلا فالعمل دراما فيها إغواء وخيانة لا عمل جنسي.
     ------------------------------------------------------------ */

  /* قوي = ٤ نقاط. مثبَّت الطرفين ^…$ عمدًا: «homoerotic» ما هو
     «erotic»، و«autoerotic asphyxiation» ما هو سينما جنسية. */
  var STRONG_NAME = /^(erotic|erotica|eroticism|erotic movie|erotic film|erotic cinema|erotic thriller|erotic drama|erotic romance|erotic comedy|erotic anime|softcore|soft core|softcore porn|sexploitation|nunsploitation|pinku eiga|roman porno|nikkatsu roman porno|pornography|porn|hardcore pornography|adult film|adult video|adult movie|adult animation|hentai|ecchi|unsimulated sex|unsimulated oral sex|explicit sex|graphic sex|hardcore sex|sexual explicitness|explicit nudity|full frontal nudity|frontal nudity)$/;

  /* القلب = ٢ نقطة، وهو شرط لازم لأي قبول بالتراكم */
  var CORE_NAME = [
    [/^(nudity|female nudity|male nudity|topless|nude|nudism|nudist)$/, 'nudity'],
    [/^(sex|sexual|sexuality|sexual content)$/,                        'sex']
  ];

  /* متوسط = ٢ نقطة. هذي أوصاف نوع لا أوصاف محتوى: «sex comedy»
     تقع على كوميديا مراهقين عادية، و«women in prison» على دراما
     سجون. تتراكم ولا تقبل وحدها. */
  var MEDIUM_NAME = /^(sex scene|sex act|sexual intercourse|simulated sex|love scene|hardcore|porn star|porn actress|adult filmmaking|sex comedy|women in prison|nudie|sensual|sensuality|sensual cinema|steamy|striptease|burlesque|sexual awakening|sexual obsession|sexual desire|sexual tension|sexual repression)$/;

  /* ضعيف = نقطة. كل مجموعة مفهوم واحد يُعدّ مرة. */
  /* ضعيف = نقطة. كل مجموعة مفهوم واحد يُعدّ مرة.
     القائمة وُسّعت لتغطّي أسماء أزرار التصنيفات في الموقع: كان
     خمسة عشر اسمًا منها (Roman Porno · Nudist · Swinging · Group Sex ·
     Dominatrix · Wife Swapping · Open Marriage · Peeping Tom ·
     Stepmother · Mistress · Sexual Fantasy …) صفرًا عند البوابة —
     يعني الزرّ يطلب من TMDB ويرمي كل ما رجع، ويطلع القسم فاضيًا
     بعد ثمانية عشر طلبًا. */
  var WEAK_NAME = [
    [/^(prostitution|prostitute|brothel|strip club|stripper|escort|sex worker|call girl|courtesan|geisha)$/, 'prostitution'],
    [/^(bdsm|sadomasochism|sadomasochist|masochism|sadism|fetish|voyeurism|voyeur|peeping tom|orgy|group sex|threesome|foursome|swinger|swinging|wife swapping|open marriage|polyamory|bondage|dominatrix|submission|exhibitionism)$/, 'kink'],
    [/^(infidelity|adultery|affair|extramarital affair|cheating wife|cheating husband)$/, 'affair'],
    [/^(seduction|seductress|temptation|lust|desire|sexual fantasy|sexual attraction|femme fatale)$/, 'seduction'],
    [/^(intimate|intimacy|love making|making love|taboo|forbidden love|stepmother|stepfather|stepdaughter|stepson|mistress|harem)$/, 'intimacy'],
    [/^(lingerie|bathhouse|sauna|skinny dipping|massage parlor|arthouse)$/, 'undress']
  ];

  /* أنواع TMDB اللي تنقض القبول مهما كانت الوسوم */
  var VETO_GENRES = [10751 /* عائلي */, 10762 /* أطفال */, 10763 /* أخبار */, 10767 /* حواري */];
  var ANIMATION = 16;

  function tagStrength(item) {
    var heat = cachedHeat(item);
    if (heat === undefined || heat === null) return null;

    /* الأسماء الخام حصرًا. heat.tags أسماء موحَّدة يبنيها heatOf
       بتعابير غير مثبَّتة الطرفين («homoerotic» يصير وسم «erotic»)،
       وفيها كمان واصفات مجالس التصنيف اللي تعطي «عُري» و«جنس»
       مجانًا لأي عمل مصنّف. القراءة منها كانت تفتح البوابة بلا وسم.
       السجل القديم اللي ما فيه names يُعامل كمجهول لا كمقبول. */
    if (!heat.names) return null;
    var raw = heat.names;

    var pts = 0, strong = 0, core = 0, buckets = {};

    raw.forEach(function (n) {
      var t = String(n || '').trim().toLowerCase();
      if (!t) return;

      if (STRONG_NAME.test(t)) {
        if (!buckets['s:' + t]) { buckets['s:' + t] = true; pts += 4; strong++; }
        return;
      }
      for (var i = 0; i < CORE_NAME.length; i++) {
        if (CORE_NAME[i][0].test(t)) {
          if (!buckets[CORE_NAME[i][1]]) { buckets[CORE_NAME[i][1]] = true; pts += 2; core++; }
          return;
        }
      }
      if (MEDIUM_NAME.test(t)) {
        if (!buckets['m:' + t]) { buckets['m:' + t] = true; pts += 2; }
        return;
      }
      for (var j = 0; j < WEAK_NAME.length; j++) {
        if (WEAK_NAME[j][0].test(t)) {
          if (!buckets[WEAK_NAME[j][1]]) { buckets[WEAK_NAME[j][1]] = true; pts += 1; }
          return;
        }
      }
    });

    /* نسبة الوسوم الجنسية من وسوم العمل كلها. «Game of Thrones» يحمل
       nudity وsex وprostitution — خمس نقاط وقلب — لكنها ٣ من ٤٠ وسمًا.
       العمل الجنسي وسومه الجنسية جزء معتبر من قائمته، لا استثناء فيها. */
    var matched = Object.keys(buckets).length;
    var share = raw.length ? matched / raw.length : 0;

    return { points: pts, strong: strong, core: core, total: raw.length,
             share: share, buckets: Object.keys(buckets), score: heat.score || 0 };
  }

  function isAdultWork(item) {
    if (!item) return false;
    /* نتيجة ويكيبيديا بلا مقابل في TMDB ما نقدر نتحقق منها — تُمنع */
    if (item.source !== 'tmdb') return false;

    /* الإباحي الصريح ممنوع من الموقع كله: قسم Explicit صار لسينما
       الجنس الصريح لا لأفلام porn، فوسم adult أو تصنيف R18 يُسقط العمل. */
    if (item.adult) return false;

    var info = cachedFor(item);
    if (info && info.tier === 5) return false;

    /* ونفس المنع بوسوم TMDB: عمل موسوم pornography أو adult video
       ما يُعرض في أي قسم مهما كان. */
    var hard = cachedHeat(item);
    if (hard && hard.names && hard.names.some(function (t) { return PORN_NAME.test(String(t).trim().toLowerCase()); })) return false;
    /* نقض بالتصنيف: عمل تصنيفه الرسمي +13 فما تحت ما هو محتوى
       جنسي مهما قالت وسومه — الوسم غلط لا العمل. السينما الجنسية
       الحقيقية إما بلا تصنيف أو R فما فوق، فالنقض ما يقص منها شيئًا.
       التصنيف يُقرأ من الذاكرة فقط، بلا أي طلب إضافي. */
    if (info && info.tier <= 2) return false;

    /* نقض بالنوع: عائلي · أطفال · أخبار · حواري ما تكون محتوى جنسيًا
       مهما قالت وسومها، والرسوم المتحركة تحتاج وسمًا قويًا صراحةً */
    var g = item.genreIds || [];
    if (g.some(function (x) { return VETO_GENRES.indexOf(x) !== -1; })) return false;

    var s = tagStrength(item);
    if (s === null) return null;

    if (g.indexOf(ANIMATION) !== -1 && s.strong < 1) return false;

    /* مساران فقط:
       أ) وسم قوي واحد يكفي — «erotic movie» و«softcore» لا تقع إلا هنا.
       ب) بلا وسم قوي: خمس نقاط ومعها إشارة قلب. أربع نقاط بلا قوي
          تصف عملًا عامًا فيه مشهد — «nudity + sexual» هي بالضبط
          وسوم فيلم رعب فيه لقطة، وكانت تعدّي. */
    if (s.strong >= 1) return true;

    /* بلا وسم قوي: خمس نقاط، ومعها قلب، ومعهما أن تكون الوسوم
       الجنسية ربع قائمة العمل على الأقل. العمل اللي وسومه أربعون
       وثلاثة منها جنسية ليس عملًا جنسيًا. */
    if (s.points < 5 || s.core < 1) return false;
    if (s.total >= 4 && s.share < 0.25) return false;
    return true;
  }

  /* ---------- وسوم المحتوى للبطاقات (طلب خفيف مع تخزين) ---------- */

  var HEAT_KEY = 'cs.heat_cache';
  var heatCache = (function () {
    var c = CS.store.get(HEAT_KEY, {});
    if (!c || typeof c !== 'object' || Array.isArray(c)) return {};
    /* سجلّات محفوظة قبل ما نضيف حقل names: البوابة تقرأها «مجهولة»
       للأبد، وfetchHeat ما يعيد طلبها لأن المفتاح موجود — فالعمل
       يختفي نهائيًا عند كل زائر قديم. نحذفها عشان تُطلب من جديد. */
    Object.keys(c).forEach(function (k) { if (c[k] && !c[k].names) delete c[k]; });
    return c;
  })();
  var heatPending = {};
  var heatTimer;

  function heatPersist() {
    clearTimeout(heatTimer);
    heatTimer = setTimeout(function () {
      var keys = Object.keys(heatCache);
      if (keys.length > MAX_CACHE) {
        keys.slice(0, keys.length - MAX_CACHE).forEach(function (k) { delete heatCache[k]; });
      }
      CS.store.set(HEAT_KEY, heatCache);
    }, 900);
  }

  function heatKeyOf(item) { return item.type + ':' + item.id; }

  function cachedHeat(item) {
    if (!item) return undefined;
    if (item.heat) return item.heat;
    return heatCache[heatKeyOf(item)];
  }

  function putHeat(item, heat) {
    heatCache[heatKeyOf(item)] = heat;
    heatPersist();
  }

  /* بذرة وسم من المصدر: عمل رجع من /discover بكلمة مفتاحية واحدة
     يحمل تلك الكلمة قطعًا — دليل مجاني بلا أي طلب. نسجّله فقط لو
     ما عندنا قائمة وسوم كاملة، وما نمحو الكاملة أبدًا. */
  function seedKeyword(item, name) {
    if (!item || item.source !== 'tmdb' || !name) return;
    var t = String(name).trim().toLowerCase();

    /* نبذر الدليل اللي يفتح البوابة فقط. بذرة وسم ضعيف («nudity»
       وحدها) تكتب سجلًّا ناقصًا يقرأه isAdultWork «مرفوض»، وfetchHeat
       ما يعيد الطلب لأن المفتاح صار موجودًا — فعمل إيروتيكي حقيقي
       ينحجب للأبد بسبب كنسة كانت تحاول تضيفه. */
    if (!STRONG_NAME.test(t)) return;

    var k = heatKeyOf(item);
    var cur = heatCache[k];

    /* قائمة كاملة موجودة؟ ما نمسّها. */
    if (cur && cur.names && !cur.partial) return;

    /* سجل ناقص: نراكم عليه بدل ما نتجاهل. العمل الواحد يرجع من عدة
       نداءات بكلمات مختلفة، وحفظ الأولى فقط كان يترك الفهرس يعرف
       وسمًا واحدًا لكل عمل — فيضعف قياس التشابه في «ذات صلة». */
    var names = (cur && cur.names) ? cur.names.slice() : [];
    if (names.indexOf(t) !== -1) return;
    names.push(t);

    var h = heatOf(names.map(function (n) { return { name: n }; }), item.adult);
    h.partial = true;
    heatCache[k] = h;
    heatPersist();
  }

  /**
   * fetchHeat(item, upgrade)
   * upgrade=true يعيد الطلب للسجلّ الناقص (بذرة كلمة واحدة من المصدر).
   * البذرة تكفي البوابة لكنها ما تكفي الشارة: عمل بذرته «softcore»
   * وسومه الحقيقية قد تحمل «nudity» فيتغيّر تصنيفه من «إيحاء» لـ«تعري».
   */
  function fetchHeat(item, upgrade) {
    if (!item || item.source !== 'tmdb') return Promise.resolve(null);
    var k = heatKeyOf(item);
    var cur = heatCache[k];
    var stale = upgrade && cur && cur.partial;
    if (cur !== undefined && !stale) return Promise.resolve(cur);
    if (heatPending[k]) return heatPending[k];

    heatPending[k] = CS.tmdb.req('/' + item.type + '/' + item.id + '/keywords', { language: undefined })
      .then(function (json) {
        var kws = (json.keywords || json.results || []);
        var h = heatOf(kws, item.adult);
        heatCache[k] = h;
        delete heatPending[k];
        heatPersist();
        return h;
      })
      .catch(function () { heatCache[k] = null; delete heatPending[k]; return null; });

    return heatPending[k];
  }

  /* هل هذا الاسم وسم لا يقع إلا على سينما جنسية؟
     الخلاصة تستعمله لتفضيل الكلمات اللي تثبت نفسها: العمل الراجع
     من /discover بكلمة قوية يعدّي البوابة بلا أي طلب إضافي، والراجع
     بكلمة ضعيفة يكلّف نداء /keywords لكل بطاقة. */
  function isStrongName(name) {
    return STRONG_NAME.test(String(name || '').trim().toLowerCase());
  }

  CS.certs = {
    TIERS: TIERS,
    isStrongName: isStrongName,
    heatOf: heatOf,
    KIND: KIND,
    contentKind: contentKind,
    kindInfo: kindInfo,
    isAdultWork: isAdultWork,
    kindFits: kindFits,
    adultConsent: adultConsent,
    tagStrength: tagStrength,
    fetchHeat: fetchHeat,
    seedKeyword: seedKeyword,
    cachedHeat: cachedHeat,
    putHeat: putHeat,
    discoverCert: discoverCert,
    matureOnly: matureOnly,
    current: current,
    FILTERS: FILTERS,
    tierFromCert: tierFromCert,
    tierInfo: tierInfo,
    fromDetails: fromDetails,
    descriptorsOf: descriptorsOf,
    fetchFor: fetchFor,
    cachedFor: cachedFor,
    put: put,
    currentFilter: currentFilter,
    adultAllowed: adultAllowed,
    passes: passes
  };

})(window.CS);
