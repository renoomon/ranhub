/* ============================================================
   config.js — الثوابت، التخزين المحلي، وحالة التطبيق
   ============================================================ */

window.CS = window.CS || {};

(function (CS) {
  'use strict';

  /* ---------- الثوابت ---------- */

  CS.config = {
    version: '5.0.1',
    tmdb: {
      base: 'https://api.themoviedb.org/3',
      img: 'https://image.tmdb.org/t/p',
      /* مرآة بديلة لصور TMDB — تُستعمل تلقائيًا لو المضيف الأول سقط */
      imgAlt: 'https://media.themoviedb.org/t/p',
      poster: { sm: 'w185', md: 'w342', lg: 'w500' },
      backdrop: { md: 'w780', lg: 'w1280' },
      still: 'w300',
      profile: 'w185',
      logo: 'w92'
    },
    limits: {
      wikiSearch: 14,     // كم نتيجة نسحب من ويكيبيديا
      wikiResolve: 10,    // كم نتيجة نحاول نطابقها مع TMDB
      keywordSeeds: 3,    // كم كلمة مفتاحية نبني عليها الاستكشاف
      pageSize: 50,       // كم بطاقة نعرض بالدفعة الواحدة
      suggest: 8,
      history: 12
    },
    defaults: { lang: 'ar', region: 'SA', mode: 'auto', theme: 'dark' }
  };

  /* ------------------------------------------------------------
     المفتاح المشترك

     كن صريحًا مع نفسك: هذا موقع ساكن، وأي مفتاح يستعمله المتصفّح
     يقدر الزائر يقرأه من لوح الشبكة مهما خبّأناه في الشيفرة. التشويش
     تحت يمنع الكشط الآلي (بحث نصّي في المستودع أو في الملف) ولا
     يمنع إنسانًا يفتح أدوات المطوّر.

     الحماية الحقيقية الوحيدة: وسيط على خادم (Cloudflare Worker مثلًا)
     يحتفظ بالمفتاح عنده ويمرّر الطلبات. الموقع يدعمه: حط رابط الوسيط
     في الإعدادات ← ما يغادر أي مفتاح متصفّحك بعدها أبدًا.
     ------------------------------------------------------------ */
  var PAD = 'ranhub-4.7-shared-access';
  var PARTS = ['SgAKUBdQGARMBRV', 'FWAQRBwAcB1YFAE', 'BARFBYXUZQH1I='];

  function unveil() {
    try {
      var raw = window.atob(PARTS.join(''));
      var out = '';
      for (var i = 0; i < raw.length; i++) {
        out += String.fromCharCode(raw.charCodeAt(i) ^ PAD.charCodeAt(i % PAD.length));
      }
      return out;
    } catch (e) { return ''; }
  }

  var sharedKey = null;
  Object.defineProperty(CS.config, 'sharedKey', {
    get: function () { if (sharedKey === null) sharedKey = unveil(); return sharedKey; },
    enumerable: false
  });

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
    adultOnly: 'cs.adult_only',

    /* الجديد */
    theme:      'cs.theme',            /* dark · light · auto */
    explicitOn: 'cs.explicit_on',      /* إظهار قسم Explicit */
    proxy:      'cs.proxy_base',       /* وسيط يخفي المفتاح */
    srcOff:     'cs.src_off',          /* مصادر المحتوى الموقوفة */
    filters:    'cs.filters',          /* آخر فلاتر مستعملة */
    viewPrefs:  'cs.view_prefs',       /* تفضيلات المشاهدة الخارجية */
    alertsOn:   'cs.alerts_on'         /* تنبيهات الحلقات الجديدة */
  };

  /* ---------- التخزين المحلي (آمن ضد الأوضاع الخاصة) ---------- */

  var memory = {};
  var lsBroken = false;
  var unsaved = {};   /* مفاتيح فشلت كتابتها — الرام أحدث من القرص فيها وحدها */

  CS.store = {
    get: function (key, fallback) {
      /* ترتيب القراءة يهم.
         كان فيه خلل: أول كتابة تفشل (امتلأت الحصّة) ترفع lsBroken،
         وبعدها كل قراءة تتجاهل localStorage كليًا — فبيانات المستخدم
         المحفوظة من قبل تصير كأنها غير موجودة بقيّة الجلسة. الامتلاء
         يمنع الكتابة لا القراءة. فالقرص هو المرجع دائمًا، إلا مفتاحًا
         فشلت كتابته في هذه الجلسة: فيه وحده الرام أحدث من القرص. */
      if (unsaved[key] === 1) return memory[key];
      if (unsaved[key] === 2) return fallback;      /* حُذف ولم يُحذف من القرص */
      try {
        var raw = window.localStorage.getItem(key);
        if (raw !== null) return JSON.parse(raw);
      } catch (e) { /* وضع خاص أو قيمة تالفة — نكمل للرام */ }
      return key in memory ? memory[key] : fallback;
    },
    set: function (key, value) {
      memory[key] = value;
      try {
        window.localStorage.setItem(key, JSON.stringify(value));
        delete unsaved[key];
      }
      catch (e) {
        /* الحصّة امتلأت أو الوضع خاص — نبقى شغّالين في الرام، ونبلّغ
           مرة واحدة بدل ما نفشل بصمت كما كان يحصل */
        unsaved[key] = 1;
        if (!lsBroken) {
          lsBroken = true;
          try { window.dispatchEvent(new CustomEvent('cs:storage-full', { detail: { key: key } })); }
          catch (e2) { /* متصفّح قديم */ }
        }
      }
      return value;
    },
    remove: function (key) {
      delete memory[key];
      delete unsaved[key];
      try { window.localStorage.removeItem(key); }
      catch (e) { unsaved[key] = 2; }
    },
    /* كم بايت يشغّل الموقع في localStorage — تُعرض في الإعدادات */
    bytes: function () {
      var total = 0;
      try {
        for (var i = 0; i < window.localStorage.length; i++) {
          var k = window.localStorage.key(i);
          if (!k || k.indexOf('cs.') !== 0) continue;
          total += k.length + (window.localStorage.getItem(k) || '').length;
        }
      } catch (e) {}
      return total * 2;   /* UTF-16 */
    },
    healthy: function () { return !lsBroken; }
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

  /* وسيط المستخدم — لو مضبوط، ما يغادر أي مفتاح المتصفّح */
  CS.proxyBase = function () {
    var v = CS.store.get(CS.KEYS.proxy, '') || '';
    v = String(v).trim().replace(/\/+$/, '');
    return /^https:\/\/[^\s]+$/i.test(v) ? v : '';
  };

  CS.usingProxy = function () { return !!CS.proxyBase(); };

  /* مع الوسيط ما نحتاج مفتاحًا أصلًا */
  CS.hasKey = function () {
    if (CS.usingProxy()) return true;
    return !!(CS.state.apiKey && CS.state.apiKey.length > 10);
  };

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
    },
    clear: function () { CS.store.set(CS.KEYS.history, []); }
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
    isArabic: function (str) { return /[\u0600-\u06FF]/.test(String(str || '')); },

    words: function (str) {
      return String(str || '').trim().split(/\s+/).filter(Boolean);
    },

    /* قيمة صالحة للوضع داخل سمة HTML */
    attr: function (v) { return String(v == null ? '' : v).replace(/(["\\])/g, '\\$1'); },

    clamp: function (n, lo, hi) { return Math.max(lo, Math.min(hi, n)); },

    /* تاريخ عربي مختصر */
    date: function (s) {
      if (!s) return '';
      var d = new Date(s);
      if (isNaN(d.getTime())) return String(s);
      try { return d.toLocaleDateString('ar-SA-u-ca-gregory', { year: 'numeric', month: 'short', day: 'numeric' }); }
      catch (e) { return String(s).slice(0, 10); }
    },

    /* «قبل ٣ أيام» */
    ago: function (ts) {
      if (!ts) return '';
      var diff = Math.max(0, Date.now() - ts);
      var mins = Math.floor(diff / 60000);
      if (mins < 1) return 'الآن';
      if (mins < 60) return 'قبل ' + mins + ' دقيقة';
      var hours = Math.floor(mins / 60);
      if (hours < 24) return 'قبل ' + hours + ' ساعة';
      var days = Math.floor(hours / 24);
      if (days < 30) return 'قبل ' + days + ' يوم';
      var months = Math.floor(days / 30);
      if (months < 12) return 'قبل ' + months + ' شهر';
      return 'قبل ' + Math.floor(months / 12) + ' سنة';
    },

    /* رابط آمن للفتح — نمنع javascript: وdata: */
    safeUrl: function (url) {
      var u = String(url || '').trim();
      if (!/^https?:\/\//i.test(u)) return '';
      return u;
    }
  };

})(window.CS);
