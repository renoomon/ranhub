/* ============================================================
   config.js — الثوابت، التخزين المحلي، وحالة التطبيق
   ============================================================ */

window.CS = window.CS || {};

(function (CS) {
  'use strict';

  /* ---------- الثوابت ---------- */

  CS.config = {
    version: '4.6.4',
    tmdb: {
      base: 'https://api.themoviedb.org/3',
      img: 'https://image.tmdb.org/t/p',
      poster: { sm: 'w185', md: 'w342', lg: 'w500' },
      backdrop: { md: 'w780', lg: 'w1280' },
      profile: 'w185',
      logo: 'w92'
    },
    limits: {
      wikiSearch: 14,     // كم نتيجة نسحب من ويكيبيديا
      wikiResolve: 10,    // كم نتيجة نحاول نطابقها مع TMDB
      keywordSeeds: 3,    // كم كلمة مفتاحية نبني عليها الاستكشاف
      pageSize: 50,       // كم بطاقة نعرض بالدفعة الواحدة
      suggest: 7,
      history: 12
    },
    defaults: { lang: 'ar', region: 'SA', mode: 'auto' },

    /* مفتاح TMDB مشترك مثبّت في الموقع عشان يشتغل لكل زائر بدون تسجيل.
       الزائر يقدر يحط مفتاحه الخاص من الإعدادات ويتجاوز هذا. */
    sharedKey: '8ad8b250b2860ecbd1f5fe336165322f'
  };

  /* ---------- مفاتيح التخزين ---------- */

  CS.KEYS = {
    apiKey:    'cs.tmdb_key',
    lang:      'cs.lang',
    region:    'cs.region',
    mode:      'cs.mode',
    favorites: 'cs.favorites',
    history:   'cs.history',
    noticeOff: 'cs.notice_off',
    email:     'cs.tr_email',
    trCache:   'cs.tr_cache',
    taste:     'cs.taste',
    certTier:  'cs.cert_tier',
    adultOn:   'cs.adult_on',
    omdbKey:   'cs.omdb_key',
    fanartKey: 'cs.fanart_key',
    traktKey:  'cs.trakt_key',
    autoTr:    'cs.auto_tr',
    tab:       'cs.tab',
    dataSources: 'cs.data_sources',
    dsMigrated:  'cs.ds_migrated',
    adultLevel: 'cs.adult_level',
    adultOnly: 'cs.adult_only'
  };

  /* ---------- التخزين المحلي (آمن ضد الأوضاع الخاصة) ---------- */

  var memory = {};

  CS.store = {
    get: function (key, fallback) {
      try {
        var raw = window.localStorage.getItem(key);
        if (raw === null) return key in memory ? memory[key] : fallback;
        return JSON.parse(raw);
      } catch (e) {
        return key in memory ? memory[key] : fallback;
      }
    },
    set: function (key, value) {
      memory[key] = value;
      try { window.localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* وضع خاص */ }
      return value;
    },
    remove: function (key) {
      delete memory[key];
      try { window.localStorage.removeItem(key); } catch (e) { /* تجاهل */ }
    }
  };

  /* ---------- حالة التطبيق ---------- */

  var userKey = CS.store.get(CS.KEYS.apiKey, '') || '';

  CS.state = {
    userKey: userKey,                                   // مفتاح الزائر لو حطّه
    apiKey:  userKey || CS.config.sharedKey,            // المستخدم فعليًا
    lang:    CS.store.get(CS.KEYS.lang, CS.config.defaults.lang),
    region:  CS.store.get(CS.KEYS.region, CS.config.defaults.region),
    mode:    CS.store.get(CS.KEYS.mode, CS.config.defaults.mode),
    genres:  { movie: {}, tv: {} },
    results: [],
    shown:   0,
    query:   '',
    view:    'home'
  };

  CS.hasKey = function () { return !!(CS.state.apiKey && CS.state.apiKey.length > 10); };

  /* ---------- سجل البحث ---------- */

  CS.history = {
    all: function () {
      var list = CS.store.get(CS.KEYS.history, []);
      return Array.isArray(list) ? list : [];
    },
    push: function (q) {
      q = (q || '').trim();
      if (q.length < 2) return;
      var list = CS.history.all().filter(function (x) { return x !== q; });
      list.unshift(q);
      CS.store.set(CS.KEYS.history, list.slice(0, CS.config.limits.history));
    }
  };

  /* ---------- أدوات عامة ---------- */

  CS.util = {
    esc: function (str) {
      return String(str == null ? '' : str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    },

    /* نزع وسوم HTML (مقتطفات ويكيبيديا تجي فيها <span>) */
    stripTags: function (str) {
      return String(str || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
    },

    year: function (dateStr) {
      var m = /^(\d{4})/.exec(String(dateStr || ''));
      return m ? +m[1] : null;
    },

    /* «Inception (film)» أو «البداية (فيلم)» ← «Inception» */
    cleanTitle: function (title) {
      return String(title || '').replace(/\s*\([^)]*\)\s*$/, '').trim();
    },

    /* استخراج سنة من نص حر: «2010 film by …» */
    yearFrom: function (text) {
      var m = /\b(18|19|20)\d{2}\b/.exec(String(text || ''));
      return m ? +m[0] : null;
    },

    minutes: function (n) {
      if (!n) return null;
      var h = Math.floor(n / 60), m = n % 60;
      if (!h) return m + ' د';
      return h + ' س' + (m ? ' ' + m + ' د' : '');
    },

    money: function (n) {
      if (!n || n < 1000) return null;
      if (n >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, '') + ' مليار $';
      if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + ' مليون $';
      return (n / 1e3).toFixed(0) + ' ألف $';
    },

    debounce: function (fn, wait) {
      var t;
      return function () {
        var ctx = this, args = arguments;
        clearTimeout(t);
        t = setTimeout(function () { fn.apply(ctx, args); }, wait);
      };
    },

    /* توزيع الطلبات على دفعات عشان ما نخنق الشبكة */
    pool: function (items, size, worker) {
      var out = [], i = 0;
      function next() {
        if (i >= items.length) return Promise.resolve();
        var batch = items.slice(i, i + size);
        i += size;
        return Promise.all(batch.map(worker)).then(function (res) {
          out = out.concat(res);
          return next();
        });
      }
      return next().then(function () { return out; });
    },

    /* هل النص عربي؟ */
    isArabic: function (str) { return /[؀-ۿ]/.test(String(str || '')); },

    words: function (str) {
      return String(str || '').trim().split(/\s+/).filter(Boolean);
    }
  };

})(window.CS);
