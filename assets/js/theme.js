/* ============================================================
   theme.js — الوضع الليلي والنهاري

   ثلاث حالات لا اثنتان: داكن · فاتح · يتبع النظام.
   الاختيار يُحفظ، ويُطبَّق على <html data-theme> قبل أول رسم
   (سكربت صغير في <head>) فما فيه وميض أبيض عند الفتح.
   ============================================================ */

(function (CS) {
  'use strict';

  var MODES = ['dark', 'light', 'auto'];
  var LABEL = { dark: '🌙 ليلي', light: '☀️ نهاري', auto: '🖥️ يتبع النظام' };
  var NEXT  = { dark: 'light', light: 'auto', auto: 'dark' };

  function stored() {
    var v = CS.store.get(CS.KEYS.theme, 'dark');
    return MODES.indexOf(v) === -1 ? 'dark' : v;
  }

  function systemDark() {
    try { return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches; }
    catch (e) { return true; }
  }

  /* الوضع الفعلي المطبَّق الآن — «auto» تتحوّل لواحد منهما */
  function effective(mode) {
    var m = mode || stored();
    if (m === 'auto') return systemDark() ? 'dark' : 'light';
    return m;
  }

  var watchers = [];

  function apply(mode) {
    var eff = effective(mode);
    var root = document.documentElement;
    root.setAttribute('data-theme', eff);
    root.style.colorScheme = eff;
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', eff === 'light' ? '#f6f7fb' : '#08090d');
    watchers.forEach(function (f) { try { f(eff, mode); } catch (e) {} });
    return eff;
  }

  function set(mode) {
    if (MODES.indexOf(mode) === -1) mode = 'dark';
    CS.store.set(CS.KEYS.theme, mode);
    return apply(mode);
  }

  function cycle() {
    var next = NEXT[stored()] || 'dark';
    set(next);
    return next;
  }

  /* تغيّر تفضيل النظام ونحن على «auto» ← نتبعه فورًا */
  try {
    var mq = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)');
    if (mq) {
      var onChange = function () { if (stored() === 'auto') apply('auto'); };
      if (mq.addEventListener) mq.addEventListener('change', onChange);
      else if (mq.addListener) mq.addListener(onChange);
    }
  } catch (e) { /* متصفّح قديم */ }

  CS.theme = {
    MODES: MODES,
    LABEL: LABEL,
    get: stored,
    effective: effective,
    set: set,
    cycle: cycle,
    apply: function () { return apply(stored()); },
    onChange: function (fn) { watchers.push(fn); }
  };

  apply(stored());

})(window.CS);
