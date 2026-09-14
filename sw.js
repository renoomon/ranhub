/* ============================================================
   sw.js — عامل الخدمة: تثبيت الموقع وتشغيله بلا اتصال

   ما يفعله:
     · يخزّن هيكل الموقع (HTML · CSS · JS · الأيقونات) عند أول زيارة،
       فالفتحة الثانية تبدأ من القرص لا من الشبكة.
     · لما ينقطع الاتصال يعرض آخر نسخة محفوظة من الصفحة، والبحث
       يشتغل من الفهرس المحلي في IndexedDB.
     · يخزّن البوسترات اللي شُوهدت فعلًا (حد ٣٠٠ صورة) فما تطلع
       الصفحة المحفوظة بلا صور.

   ما لا يفعله:
     · ما يخزّن ردود TMDB — تلك لها ذاكرتها في net.js، وتخزينها
       هنا كمان يضاعف المساحة ويعطي بيانات قديمة.
   ============================================================ */

'use strict';

var VERSION = 'ranhub-v5.0.1';
var SHELL = VERSION + '-shell';
var IMGS  = VERSION + '-img';
var IMG_MAX = 300;

var SHELL_FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './assets/css/style.css?v=5.0.1',
  './assets/icons/icon-192.svg',
  './assets/icons/icon-512.svg',
  './assets/js/config.js?v=5.0.1',
  './assets/js/db.js?v=5.0.1',
  './assets/js/net.js?v=5.0.1',
  './assets/js/theme.js?v=5.0.1',
  './assets/js/fuzzy.js?v=5.0.1',
  './assets/js/taste.js?v=5.0.1',
  './assets/js/library.js?v=5.0.1',
  './assets/js/certs.js?v=5.0.1',
  './assets/js/tmdb.js?v=5.0.1',
  './assets/js/catalog.js?v=5.0.1',
  './assets/js/reco.js?v=5.0.1',
  './assets/js/wiki.js?v=5.0.1',
  './assets/js/contentsources.js?v=5.0.1',
  './assets/js/sources.js?v=5.0.1',
  './assets/js/datasources.js?v=5.0.1',
  './assets/js/links.js?v=5.0.1',
  './assets/js/feed.js?v=5.0.1',
  './assets/js/freecatalog.js?v=5.0.1',
  './assets/js/search.js?v=5.0.1',
  './assets/js/ui.js?v=5.0.1',
  './assets/js/app.js?v=5.0.1'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(SHELL).then(function (c) {
      /* addAll يسقط كله لو سقط ملف واحد — نضيفهم فرادى */
      return Promise.all(SHELL_FILES.map(function (u) {
        return c.add(new Request(u, { cache: 'reload' })).catch(function () { return null; });
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== SHELL && k !== IMGS) return caches.delete(k);
        return null;
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

function trimCache(name, max) {
  return caches.open(name).then(function (c) {
    return c.keys().then(function (keys) {
      if (keys.length <= max) return null;
      return Promise.all(keys.slice(0, keys.length - max).map(function (k) { return c.delete(k); }));
    });
  });
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;

  var url;
  try { url = new URL(req.url); } catch (err) { return; }

  /* صور البوسترات: من الذاكرة أولًا ثم الشبكة، ونحفظ ما نجح */
  if (/(^|\.)tmdb\.org$/.test(url.hostname) || /(^|\.)themoviedb\.org$/.test(url.hostname)) {
    if (/\/t\/p\//.test(url.pathname)) {
      e.respondWith(
        caches.open(IMGS).then(function (c) {
          return c.match(req).then(function (hit) {
            if (hit) return hit;
            return fetch(req).then(function (res) {
              if (res && (res.ok || res.type === 'opaque')) {
                c.put(req, res.clone());
                trimCache(IMGS, IMG_MAX);
              }
              return res;
            }).catch(function () {
              return new Response('', { status: 504, statusText: 'offline' });
            });
          });
        })
      );
    }
    return;   /* نداءات الـAPI تمرّ كما هي — ذاكرتها في net.js */
  }

  /* غير نطاقنا: لا نتدخّل */
  if (url.origin !== self.location.origin) return;

  /* التنقّل: الشبكة أولًا ثم آخر نسخة محفوظة — فالتحديث يصل بسرعة
     والانقطاع ما يعطي صفحة خطأ المتصفّح */
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(SHELL).then(function (c) { c.put('./index.html', copy); });
        return res;
      }).catch(function () {
        return caches.match('./index.html').then(function (hit) {
          return hit || caches.match('./') || new Response(
            '<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;background:#08090d;color:#eee;' +
            'display:grid;place-items:center;height:100vh;margin:0"><p>🟠 أنت غير متصل، وما فيه نسخة محفوظة بعد.</p>',
            { headers: { 'content-type': 'text/html; charset=utf-8' } });
        });
      })
    );
    return;
  }

  /* الملفات الساكنة: الذاكرة أولًا (مبصومة بـ?v=) ثم الشبكة */
  e.respondWith(
    caches.match(req).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (res) {
        if (res && res.ok && /\.(css|js|svg|webmanifest)$/.test(url.pathname)) {
          var copy = res.clone();
          caches.open(SHELL).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () {
        /* ما نرجّع index.html بدل ملف جافاسكربت أو CSS ساقط.
           الملف الناقص كان يوصل للمتصفّح صفحةَ HTML بنوع خاطئ،
           فيرمي «Unexpected token '<'» بدل خطأ شبكة مفهوم، ويضيع
           السبب الحقيقي. الاحتياط لصفحات التنقّل وحدها، وهو فوق. */
        return new Response('', { status: 504, statusText: 'Offline' });
      });
    })
  );
});

self.addEventListener('message', function (e) {
  if (e.data === 'skipWaiting') self.skipWaiting();
});
