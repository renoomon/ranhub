/* ============================================================
   contentsources.js — سجلّ مصادر المحتوى المجانية

   الفرق بين هذا وdatasources.js:
     datasources.js   = مزوّدون يضيفهم المستخدم بمفتاحه لعرض بيانات
                        إضافية في صفحة العمل.
     contentsources.js = المصادر اللي يجيب منها الموقع المحتوى نفسه —
                        الأعمال والقصص والصور والمواعيد. كلها مجانية،
                        وأغلبها بلا مفتاح.

   كل مصدر هنا:
     · مفتاح تشغيل/إيقاف يحفظه المستخدم
     · حالة صحّة حيّة (آخر نجاح · آخر فشل · عدد الإخفاقات المتتالية)
     · إيقاف مؤقّت تلقائي بعد ثلاثة إخفاقات متتالية، ثم إعادة محاولة
     · مكانه في سلسلة البدائل — لما يسقط واحد ينتقل الجلب للي بعده
   ============================================================ */

(function (CS) {
  'use strict';

  var LIST = [
    {
      id: 'tmdb', name: 'TMDB', role: 'core',
      hint: 'قاعدة الأعمال والبوسترات والوسوم — محرّك الموقع الأساسي',
      keyless: false, required: true,
      test: function () { return CS.tmdb.req('/configuration', {}, { fresh: true, persist: false }); }
    },
    {
      id: 'wikipedia', name: 'ويكيبيديا', role: 'plot',
      hint: 'القصة الكاملة والبحث بوصف الأحداث — بلا مفتاح',
      keyless: true,
      test: function () { return CS.wiki.findWorks('en', 'film', 2); }
    },
    {
      id: 'wikidata', name: 'Wikidata', role: 'ids',
      hint: 'معرّفات المواقع الأخرى فتصير روابطها مباشرة لا بحثًا',
      keyless: true,
      test: function () { return CS.sources.wikidata.byImdb('tt1375666'); }
    },
    {
      id: 'tvmaze', name: 'TVmaze', role: 'catalog',
      hint: 'مواعيد الحلقات والشبكة الناقلة + كتالوج مسلسلات للبحث',
      keyless: true,
      test: function () { return CS.sources.tvmaze.byImdb('tt0944947'); }
    },
    {
      id: 'jikan', name: 'MyAnimeList', role: 'catalog',
      hint: 'كتالوج الأنمي — يوسّع البحث لأعمال تفوت TMDB',
      keyless: true,
      test: function () { return CS.freeCatalog.probe('jikan'); }
    },
    {
      id: 'archive', name: 'Internet Archive', role: 'catalog',
      hint: 'أفلام محفوظة للعامة — أسماء أعمال قديمة ونادرة',
      keyless: true,
      test: function () { return CS.freeCatalog.probe('archive'); }
    },
    {
      id: 'mymemory', name: 'MyMemory', role: 'translate',
      hint: 'الترجمة الآلية المجانية بين العربي والإنجليزي',
      keyless: true,
      test: function () { return CS.wiki.translate('night', 'en', 'ar'); }
    },
    {
      id: 'omdb', name: 'OMDb', role: 'ratings',
      hint: 'تقييمات IMDb وروتن توميتوز — يحتاج مفتاحًا مجانيًا من الإعدادات',
      keyless: false,
      test: function () { return CS.sources.omdb.byImdb('tt1375666'); }
    }
  ];

  function byId(id) {
    for (var i = 0; i < LIST.length; i++) if (LIST[i].id === id) return LIST[i];
    return null;
  }

  /* ---------- التشغيل والإيقاف ---------- */

  function offMap() {
    var m = CS.store.get(CS.KEYS.srcOff, {});
    return (m && typeof m === 'object' && !Array.isArray(m)) ? m : {};
  }

  function enabled(id) {
    var s = byId(id);
    if (!s) return false;
    if (s.required) return true;          /* TMDB ما ينطفي — بدونه ما فيه موقع */
    return offMap()[id] !== true;
  }

  function setEnabled(id, on) {
    var s = byId(id);
    if (!s || s.required) return false;
    var m = offMap();
    if (on) delete m[id]; else m[id] = true;
    CS.store.set(CS.KEYS.srcOff, m);
    if (on) { var h = health[id]; if (h) { h.fails = 0; h.mutedUntil = 0; } }
    return true;
  }

  /* ---------- الصحّة ---------- */

  var health = {};
  LIST.forEach(function (s) {
    health[s.id] = { ok: null, detail: '', at: 0, fails: 0, mutedUntil: 0, calls: 0 };
  });

  var MUTE_AFTER = 3;
  var MUTE_MS = 90 * 1000;

  function note(id, ok, detail) {
    var h = health[id];
    if (!h) return;
    h.at = Date.now();
    h.ok = ok;
    h.detail = detail || '';
    if (ok) { h.fails = 0; h.mutedUntil = 0; }
    else {
      h.fails++;
      if (h.fails >= MUTE_AFTER) h.mutedUntil = Date.now() + MUTE_MS;
    }
  }

  /* هل نناديه الآن؟ مطفأ يدويًا أو مكتوم تلقائيًا ← لا */
  function live(id) {
    if (!enabled(id)) return false;
    var h = health[id];
    if (h && h.mutedUntil && Date.now() < h.mutedUntil) return false;
    return true;
  }

  /**
   * call(id, fn) — ينادي المصدر ويسجّل صحّته.
   * يرجّع null بهدوء لو المصدر مطفأ أو مكتوم أو سقط.
   */
  function call(id, fn) {
    if (!live(id)) return Promise.resolve(null);
    var h = health[id];
    if (h) h.calls++;
    return Promise.resolve()
      .then(fn)
      .then(function (v) { note(id, true, ''); return v; })
      .catch(function (e) {
        note(id, false, (e && e.message) || 'ما رد');
        return null;
      });
  }

  /**
   * race(defs, opts) — سلسلة بدائل: نجرّب بالترتيب حتى ينجح واحد.
   * defs: [{ id, run }]  — الموقوف والمكتوم يُتخطّى بلا محاولة.
   * يرجّع { value, from } أو { value: null, from: '' }.
   */
  function race(defs, opts) {
    opts = opts || {};
    var usable = (defs || []).filter(function (d) { return live(d.id); });
    if (!usable.length) return Promise.resolve({ value: null, from: '', tried: 0 });

    return CS.net.chain(usable.map(function (d) {
      return function () { return call(d.id, d.run); };
    }), { soft: true, fallback: null, accept: opts.accept }).then(function (r) {
      return { value: r.value, from: r.index >= 0 ? usable[r.index].id : '', tried: r.tried };
    });
  }

  /**
   * gather(defs) — كل المصادر الحيّة معًا، واللي يسقط يُتجاهل.
   * يرجّع { byId: {...}, ok: [ids], failed: [ids] }
   */
  function gather(defs) {
    var usable = (defs || []).filter(function (d) { return live(d.id); });
    return Promise.all(usable.map(function (d) {
      return call(d.id, d.run).then(function (v) { return { id: d.id, value: v }; });
    })).then(function (rows) {
      var out = { byId: {}, ok: [], failed: [], skipped: [] };
      (defs || []).forEach(function (d) { if (!live(d.id)) out.skipped.push(d.id); });
      rows.forEach(function (r) {
        out.byId[r.id] = r.value;
        if (r.value === null || r.value === undefined) out.failed.push(r.id);
        else out.ok.push(r.id);
      });
      return out;
    });
  }

  /* فحص يدوي من الإعدادات */
  function test(id) {
    var s = byId(id);
    if (!s) return Promise.resolve({ ok: false, detail: 'مصدر غير معروف' });
    var h = health[id];
    if (h) { h.mutedUntil = 0; h.fails = 0; }
    return Promise.resolve()
      .then(function () { return s.test(); })
      .then(function (v) {
        var empty = v === null || v === undefined ||
                    (Array.isArray(v) && !v.length) ||
                    (typeof v === 'string' && !v);
        if (empty) { note(id, false, 'رد بلا بيانات'); return { ok: false, detail: 'رد بلا بيانات' }; }
        note(id, true, 'شغّال');
        return { ok: true, detail: 'شغّال' };
      })
      .catch(function (e) {
        var d = (CS.tmdb && CS.tmdb.explain) ? CS.tmdb.explain(e) : ((e && e.message) || 'فشل');
        note(id, false, d);
        return { ok: false, detail: d };
      });
  }

  function all() {
    return LIST.map(function (s) {
      var h = health[s.id] || {};
      return {
        id: s.id, name: s.name, hint: s.hint, role: s.role,
        keyless: s.keyless, required: !!s.required,
        enabled: enabled(s.id),
        muted: !!(h.mutedUntil && Date.now() < h.mutedUntil),
        ok: h.ok, detail: h.detail, at: h.at, calls: h.calls, fails: h.fails
      };
    });
  }

  CS.contentSources = {
    LIST: LIST,
    byId: byId,
    all: all,
    enabled: enabled,
    live: live,
    setEnabled: setEnabled,
    call: call,
    race: race,
    gather: gather,
    note: note,
    test: test,
    health: health
  };

})(window.CS);
