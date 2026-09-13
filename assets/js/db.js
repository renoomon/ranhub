/* ============================================================
   db.js — تخزين غير متزامن في IndexedDB مع بديل localStorage

   ليه موجود:
   الفهرس المحلي وذاكرة الطلبات كانا في localStorage، وحصّته ٥
   ميغابايت مشتركة مع كل شي ثاني. أول ما تمتلئ يفشل الحفظ بصمت
   فيرجع الفهرس فاضيًا كل جلسة. IndexedDB حصّته مئات الميغابايت
   وغير متزامن فما يجمّد الواجهة.

   الواجهة كلها وعود (Promises)، ومعها ذاكرة أمامية في الرام عشان
   القراءة المتكرّرة ما تنتظر القرص.
   ============================================================ */

(function (CS) {
  'use strict';

  var DB_NAME = 'ranhub';
  var DB_VER  = 1;
  var STORE   = 'kv';

  var mem = {};                 /* ذاكرة أمامية: المفتاح ← القيمة */
  var idb = null;               /* اتصال IndexedDB أو null لو مو مدعوم */
  var opening = null;

  function supported() {
    try { return typeof window.indexedDB !== 'undefined' && window.indexedDB !== null; }
    catch (e) { return false; }
  }

  function open() {
    if (opening) return opening;
    if (!supported()) { opening = Promise.resolve(null); return opening; }

    opening = new Promise(function (resolve) {
      var req;
      try { req = window.indexedDB.open(DB_NAME, DB_VER); }
      catch (e) { resolve(null); return; }

      /* المتصفّح قد يعلّق الطلب في الوضع الخاص بلا أي حدث — مهلة
         تضمن إن الإقلاع ما ينتظر للأبد */
      var done = false;
      var timer = setTimeout(function () { if (!done) { done = true; resolve(null); } }, 3000);

      req.onupgradeneeded = function () {
        var d = req.result;
        if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE);
      };
      req.onsuccess = function () {
        if (done) return;
        done = true; clearTimeout(timer);
        idb = req.result;
        idb.onversionchange = function () { try { idb.close(); } catch (e) {} idb = null; };
        resolve(idb);
      };
      req.onerror = function () {
        if (done) return;
        done = true; clearTimeout(timer);
        resolve(null);
      };
      req.onblocked = function () {
        if (done) return;
        done = true; clearTimeout(timer);
        resolve(null);
      };
    });
    return opening;
  }

  function tx(mode) {
    return open().then(function (d) {
      if (!d) return null;
      try { return d.transaction(STORE, mode).objectStore(STORE); }
      catch (e) { return null; }
    });
  }

  /* بديل localStorage — يشتغل لو IndexedDB مقفول (وضع خاص مثلًا) */
  var LS_PREFIX = 'cs.db.';
  function lsGet(key) {
    try {
      var raw = window.localStorage.getItem(LS_PREFIX + key);
      return raw === null ? undefined : JSON.parse(raw);
    } catch (e) { return undefined; }
  }
  function lsSet(key, val) {
    try { window.localStorage.setItem(LS_PREFIX + key, JSON.stringify(val)); return true; }
    catch (e) { return false; }
  }
  function lsDel(key) {
    try { window.localStorage.removeItem(LS_PREFIX + key); } catch (e) {}
  }

  function get(key) {
    if (key in mem) return Promise.resolve(mem[key]);
    return tx('readonly').then(function (store) {
      if (!store) { var v = lsGet(key); mem[key] = v; return v; }
      return new Promise(function (resolve) {
        var r = store.get(key);
        r.onsuccess = function () { mem[key] = r.result; resolve(r.result); };
        r.onerror = function () { resolve(undefined); };
      });
    }).catch(function () { return undefined; });
  }

  function set(key, value) {
    mem[key] = value;
    return tx('readwrite').then(function (store) {
      if (!store) return lsSet(key, value);
      return new Promise(function (resolve) {
        var r;
        try { r = store.put(value, key); } catch (e) { resolve(false); return; }
        r.onsuccess = function () { resolve(true); };
        r.onerror = function () { resolve(false); };
      });
    }).catch(function () { return false; });
  }

  function del(key) {
    delete mem[key];
    return tx('readwrite').then(function (store) {
      if (!store) { lsDel(key); return true; }
      return new Promise(function (resolve) {
        var r = store.delete(key);
        r.onsuccess = function () { resolve(true); };
        r.onerror = function () { resolve(false); };
      });
    }).catch(function () { return false; });
  }

  function keys() {
    return tx('readonly').then(function (store) {
      if (!store) {
        var out = [];
        try {
          for (var i = 0; i < window.localStorage.length; i++) {
            var k = window.localStorage.key(i);
            if (k && k.indexOf(LS_PREFIX) === 0) out.push(k.slice(LS_PREFIX.length));
          }
        } catch (e) {}
        return out;
      }
      return new Promise(function (resolve) {
        var r = store.getAllKeys();
        r.onsuccess = function () { resolve(r.result || []); };
        r.onerror = function () { resolve([]); };
      });
    }).catch(function () { return []; });
  }

  function clear() {
    mem = {};
    return tx('readwrite').then(function (store) {
      if (!store) {
        keys().then(function (list) { list.forEach(lsDel); });
        return true;
      }
      return new Promise(function (resolve) {
        var r = store.clear();
        r.onsuccess = function () { resolve(true); };
        r.onerror = function () { resolve(false); };
      });
    }).catch(function () { return false; });
  }

  /* كم مساحة مستعملة — تُعرض في الإعدادات */
  function estimate() {
    if (navigator.storage && navigator.storage.estimate) {
      return navigator.storage.estimate().then(function (e) {
        return { usage: e.usage || 0, quota: e.quota || 0 };
      }).catch(function () { return { usage: 0, quota: 0 }; });
    }
    return Promise.resolve({ usage: 0, quota: 0 });
  }

  CS.db = {
    ready: open().then(function (d) { return !!d; }),
    usable: supported,
    get: get, set: set, del: del, keys: keys, clear: clear, estimate: estimate,
    /* للقراءة المتزامنة بعد ما تُحمّل مسبقًا */
    peek: function (key) { return mem[key]; },
    warm: function (key) { return get(key); }
  };

})(window.CS);
