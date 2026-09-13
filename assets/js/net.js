/* ============================================================
   net.js — طبقة الطلبات الموحّدة

   كل نداء خارجي في الموقع يمرّ من هنا، فيأخذ أربع خدمات دفعة واحدة:

     ١) ذاكرة مؤقتة على طبقتين — رام للجلسة، وقرص (IndexedDB) للردود
        الثابتة (الوسوم · التصنيفات · التفاصيل · الأنواع). يعني فتح
        الموقع مرة ثانية ما يعيد نفس الطلبات من الصفر.
     ٢) منع التكرار الطائر — عشرة نداءات لنفس الرابط في نفس اللحظة
        تصير طلبًا واحدًا وكلهم ينتظرونه.
     ٣) حدّ للطلبات — سقف للتزامن ودلو رموز للمعدّل، مع تراجع أسّي
        عند 429 أو خطأ شبكة. هذا اللي يحمي مفتاح TMDB من الحظر.
     ٤) تبديل تلقائي بين المصادر — chain() تجرّب البدائل بالترتيب
        حتى ينجح واحد، فما يتوقف الجلب لأن مصدرًا سقط.
   ============================================================ */

(function (CS) {
  'use strict';

  /* ---------- الإعدادات ---------- */

  var CONF = {
    concurrency: 8,        /* كم طلب متزامن كحدّ أقصى */
    /* TMDB يسمح عمليًا بحوالي ٥٠ طلبًا في الثانية. نبقى عند ٣٠ —
       تحت الحدّ بهامش واضح، وفوق ما يجعل الصفحة الأولى تنتظر. */
    ratePerSec: 30,
    burst: 40,             /* دفعة مسموحة بعد فترة هدوء */
    retries: 3,
    timeout: 15000,
    memTtl: 10 * 60 * 1000,        /* ذاكرة الرام الافتراضية */
    diskTtl: 21 * 24 * 3600 * 1000 /* القرص: ثلاثة أسابيع للردود الثابتة */
  };

  /* أي مسارات تستحق الحفظ على القرص: ردود ما تتغيّر عمليًا */
  var PERSIST_RE = /\/(keywords|release_dates|content_ratings|genre\/\w+\/list|configuration)$|^\/(movie|tv)\/\d+$|\/person\/\d+$|\/season\/\d+$/;

  var stats = { sent: 0, served: 0, fromMem: 0, fromDisk: 0, retried: 0, failed: 0, queued: 0 };

  /* ---------- ذاكرة الرام ---------- */

  var mem = {};          /* url → { at, ttl, data } */
  var MEM_MAX = 900;
  var memOrder = [];

  function memGet(key) {
    var e = mem[key];
    if (!e) return undefined;
    if (Date.now() - e.at > e.ttl) { delete mem[key]; return undefined; }
    return e.data;
  }

  function memPut(key, data, ttl) {
    if (!(key in mem)) {
      memOrder.push(key);
      if (memOrder.length > MEM_MAX) {
        var drop = memOrder.splice(0, Math.floor(MEM_MAX / 4));
        drop.forEach(function (k) { delete mem[k]; });
      }
    }
    mem[key] = { at: Date.now(), ttl: ttl || CONF.memTtl, data: data };
  }

  /* ---------- ذاكرة القرص ---------- */

  var DISK_INDEX = 'net.index';
  var diskIndex = null;           /* key → at */
  var diskDirty = false;
  var DISK_MAX = 2600;

  function diskKey(url) { return 'net:' + hash(url); }

  function hash(str) {
    var h = 5381, i = str.length;
    while (i) h = (h * 33) ^ str.charCodeAt(--i);
    return (h >>> 0).toString(36) + '-' + str.length.toString(36);
  }

  function loadIndex() {
    if (diskIndex) return Promise.resolve(diskIndex);
    return CS.db.get(DISK_INDEX).then(function (v) {
      diskIndex = (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
      return diskIndex;
    }).catch(function () { diskIndex = {}; return diskIndex; });
  }

  var indexTimer;
  function saveIndex() {
    diskDirty = true;
    clearTimeout(indexTimer);
    indexTimer = setTimeout(function () {
      if (!diskDirty || !diskIndex) return;
      diskDirty = false;
      /* تقليم: نرمي الأقدم لما يتجاوز الحد */
      var keys = Object.keys(diskIndex);
      if (keys.length > DISK_MAX) {
        keys.sort(function (a, b) { return diskIndex[a] - diskIndex[b]; });
        var kill = keys.slice(0, keys.length - DISK_MAX);
        kill.forEach(function (k) { delete diskIndex[k]; CS.db.del(k); });
      }
      CS.db.set(DISK_INDEX, diskIndex);
    }, 2500);
  }

  function diskGet(url, ttl) {
    return loadIndex().then(function (idx) {
      var k = diskKey(url);
      var at = idx[k];
      if (!at) return undefined;
      if (Date.now() - at > (ttl || CONF.diskTtl)) { delete idx[k]; CS.db.del(k); saveIndex(); return undefined; }
      return CS.db.get(k);
    }).catch(function () { return undefined; });
  }

  function diskPut(url, data) {
    var k = diskKey(url);
    return CS.db.set(k, data).then(function (ok) {
      if (!ok) return;
      return loadIndex().then(function (idx) { idx[k] = Date.now(); saveIndex(); });
    }).catch(function () {});
  }

  /* ---------- حدّ الطلبات: سقف تزامن + دلو رموز ---------- */

  var active = 0;
  var queue = [];
  var tokens = CONF.burst;
  var lastRefill = Date.now();
  var pausedUntil = 0;           /* يُرفع عند 429 — تراجع عام */

  function refill() {
    var now = Date.now();
    var add = ((now - lastRefill) / 1000) * CONF.ratePerSec;
    if (add >= 0.05) {
      tokens = Math.min(CONF.burst, tokens + add);
      lastRefill = now;
    }
  }

  function pump() {
    if (!queue.length) return;
    var now = Date.now();
    if (now < pausedUntil) { setTimeout(pump, Math.min(1200, pausedUntil - now)); return; }
    refill();
    while (queue.length && active < CONF.concurrency && tokens >= 1) {
      tokens -= 1;
      active++;
      var job = queue.shift();
      stats.queued = queue.length;
      job();
    }
    if (queue.length) setTimeout(pump, 90);
  }

  function schedule(fn) {
    return new Promise(function (resolve, reject) {
      queue.push(function () {
        fn().then(function (v) { active--; pump(); resolve(v); },
                  function (e) { active--; pump(); reject(e); });
      });
      stats.queued = queue.length;
      pump();
    });
  }

  /* تراجع عام عند 429 — كل الطلبات تنتظر، لا هذا الطلب وحده */
  function backOffAll(ms) {
    pausedUntil = Math.max(pausedUntil, Date.now() + Math.min(ms || 2000, 30000));
  }

  /* ------------------------------------------------------------
     قاطع الدائرة.

     لما تسقط الخدمة كليًا، إعادة المحاولة تضرّ ولا تنفع: الموقع
     يقعد دقيقة كاملة يعيد عشرات الطلبات والمستخدم أمام هياكل
     فاضية بلا أي رسالة. بعد سلسلة إخفاقات متصلة بلا نجاح واحد
     نفتح القاطع: كل طلب جديد يفشل فورًا بنفس الخطأ، فالواجهة
     تعرض السبب في ثانية بدل دقيقة. وأول نجاح بعد الفترة يقفله.
     ------------------------------------------------------------ */
  var CIRCUIT_AT = 8;             /* كم إخفاقًا متتاليًا يفتح القاطع */
  var CIRCUIT_MS = 12000;         /* كم يبقى مفتوحًا قبل محاولة جديدة */
  var consecutiveFails = 0;
  var circuitUntil = 0;
  var lastError = null;

  function circuitOpen() { return Date.now() < circuitUntil; }

  function noteFail(err) {
    /* ٤٠٤ ليس عطلًا في الخدمة — عمل غير موجود فقط. لا نحسبه هنا
       وإلا فتحت بضعة روابط ميتة القاطع على موقع سليم تمامًا.
       نحسب: انقطاع الشبكة · المهلة · 429 · 401/403 · أخطاء الخادم. */
    var s = err && err.status;
    var systemic = !s || s === 0 || s === 429 || s === 401 || s === 403 || s >= 500;
    if (!systemic) return;
    lastError = err;
    consecutiveFails++;
    if (consecutiveFails >= CIRCUIT_AT) circuitUntil = Date.now() + CIRCUIT_MS;
  }

  function noteOk() { consecutiveFails = 0; circuitUntil = 0; }

  /* ---------- الطلب الفعلي ---------- */

  var inflight = {};

  function fetchOnce(url, opts) {
    var ctl = ('AbortController' in window) ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctl) ctl.abort(); }, opts.timeout || CONF.timeout);

    stats.sent++;
    return fetch(url, {
      headers: opts.headers || { accept: 'application/json' },
      method: opts.method || 'GET',
      body: opts.body,
      mode: opts.mode,
      credentials: 'omit',
      signal: ctl ? ctl.signal : undefined
    }).then(function (res) {
      clearTimeout(timer);
      if (res.status === 429) {
        var ra = +(res.headers.get('retry-after') || 0);
        backOffAll(ra ? ra * 1000 : 2500);
        var e429 = new Error('RATE_LIMIT'); e429.status = 429; throw e429;
      }
      if (res.status === 401 || res.status === 403) {
        var e401 = new Error('BAD_KEY'); e401.status = res.status; throw e401;
      }
      if (!res.ok) {
        var e = new Error('HTTP_' + res.status); e.status = res.status; throw e;
      }
      return opts.text ? res.text() : res.json();
    }, function (err) {
      clearTimeout(timer);
      if (err && err.name === 'AbortError') { var t = new Error('TIMEOUT'); t.status = 0; throw t; }
      throw err;
    });
  }

  function retriable(err) {
    var s = err && err.status;
    if (s === 429) return true;
    if (s >= 500) return true;
    if (s === 0) return true;                       /* مهلة */
    if (!s && err) return true;                     /* خطأ شبكة */
    return false;
  }

  function withRetry(url, opts) {
    var tries = opts.retries === undefined ? CONF.retries : opts.retries;
    var attempt = 0;

    function go() {
      /* القاطع مفتوح؟ نفشل فورًا بالخطأ الأخير بلا طابور ولا إعادة */
      if (circuitOpen()) {
        var e = lastError || new Error('SERVICE_DOWN');
        return Promise.reject(e);
      }
      return schedule(function () { return fetchOnce(url, opts); })
        .then(function (v) { noteOk(); return v; })
        .catch(function (err) {
          noteFail(err);
          if (circuitOpen()) throw err;
          if (attempt >= tries || !retriable(err)) throw err;
          attempt++;
          stats.retried++;
          /* تراجع أسّي مع رجّة عشوائية عشان ما ترجع الطلبات دفعة واحدة */
          var wait = Math.min(8000, 350 * Math.pow(2, attempt)) * (0.7 + Math.random() * 0.6);
          return new Promise(function (r) { setTimeout(r, wait); }).then(go);
        });
    }
    return go();
  }

  /* ---------- الواجهة ---------- */

  /**
   * json(url, opts) — الطلب مع الذاكرة ومنع التكرار والحدّ والتراجع.
   * opts: { headers, ttl, persist, retries, timeout, fresh, text }
   */
  function json(url, opts) {
    opts = opts || {};
    var key = url + (opts.headers && opts.headers.Authorization ? '|auth' : '');

    if (!opts.fresh) {
      var hit = memGet(key);
      if (hit !== undefined) { stats.served++; stats.fromMem++; return Promise.resolve(hit); }
    }
    if (inflight[key]) return inflight[key];

    var persist = opts.persist !== undefined ? opts.persist : false;

    var chainP = (!opts.fresh && persist)
      ? diskGet(url, opts.ttl).then(function (v) {
          if (v !== undefined) {
            stats.served++; stats.fromDisk++;
            memPut(key, v, opts.ttl || CONF.memTtl);
            return v;
          }
          return undefined;
        })
      : Promise.resolve(undefined);

    inflight[key] = chainP.then(function (cached) {
      if (cached !== undefined) return cached;
      return withRetry(url, opts).then(function (data) {
        stats.served++;
        memPut(key, data, opts.ttl || CONF.memTtl);
        if (persist) diskPut(url, data);
        return data;
      });
    }).then(function (v) {
      delete inflight[key];
      return v;
    }, function (e) {
      delete inflight[key];
      stats.failed++;
      throw e;
    });

    return inflight[key];
  }

  /**
   * chain(tasks, opts) — تبديل تلقائي بين المصادر.
   * tasks: مصفوفة دوال ترجّع وعودًا. نجرّبها بالترتيب حتى ينجح واحد
   * ويرجّع قيمة يقبلها opts.accept (الافتراضي: أي قيمة غير فاضية).
   * ترجّع { value, index, tried, errors } أو ترمي لو سقطت كلها.
   */
  function chain(tasks, opts) {
    opts = opts || {};
    var accept = opts.accept || function (v) {
      if (v === null || v === undefined || v === false) return false;
      if (Array.isArray(v)) return v.length > 0;
      return true;
    };
    var errors = [];

    function step(i) {
      if (i >= tasks.length) {
        var e = new Error('ALL_SOURCES_FAILED');
        e.errors = errors;
        if (opts.soft) return Promise.resolve({ value: opts.fallback, index: -1, tried: tasks.length, errors: errors });
        return Promise.reject(e);
      }
      return Promise.resolve()
        .then(function () { return tasks[i](); })
        .then(function (v) {
          if (accept(v)) return { value: v, index: i, tried: i + 1, errors: errors };
          errors.push({ index: i, reason: 'EMPTY' });
          return step(i + 1);
        })
        .catch(function (err) {
          errors.push({ index: i, reason: (err && err.message) || String(err) });
          return step(i + 1);
        });
    }
    return step(0);
  }

  /* كم طلبًا ننتظر الآن — الواجهة تعرض مؤشّر تحميل عام بناءً عليه */
  function busy() { return active + queue.length; }

  var watchers = [];
  function onBusy(fn) { watchers.push(fn); }
  function notify() {
    var n = busy();
    watchers.forEach(function (f) { try { f(n); } catch (e) {} });
  }
  setInterval(notify, 250);

  function clearCache() {
    mem = {}; memOrder = [];
    return loadIndex().then(function (idx) {
      var ks = Object.keys(idx);
      diskIndex = {};
      saveIndex();
      return Promise.all(ks.map(function (k) { return CS.db.del(k); }));
    });
  }

  CS.net = {
    CONF: CONF,
    json: json,
    chain: chain,
    busy: busy,
    onBusy: onBusy,
    stats: function () {
      return {
        sent: stats.sent, served: stats.served, fromMem: stats.fromMem,
        fromDisk: stats.fromDisk, retried: stats.retried, failed: stats.failed,
        queued: queue.length, active: active
      };
    },
    shouldPersist: function (path) { return PERSIST_RE.test(path); },
    clearCache: clearCache,
    backOffAll: backOffAll
  };

})(window.CS);
