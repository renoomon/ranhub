/* ============================================================
   fuzzy.js — تحمّل الأخطاء الإملائية في البحث

   لماذا:
   المطابقة كانت حرفية بالكامل — «erotik» ما توصل «erotic»،
   و«ايروتك» ما توصل «إيروتيك». الخطأ بحرف واحد كان يرجّع صفرًا.

   ثلاث أدوات:
     ١) مسافة تحرير محدودة (دامرو-ليفنشتاين) مع خروج مبكّر — رخيصة
        لأننا نوقف أول ما نتجاوز الحدّ المسموح.
     ٢) تشابه ثلاثيات الحروف (Dice) — يمسك تبديل ترتيب الحروف
        والكلمات الطويلة اللي فيها أكثر من خطأ.
     ٣) تصحيح من مفردات معروفة — عناوين الفهرس ووسوم TMDB.
   ============================================================ */

(function (CS) {
  'use strict';

  /* تطبيع موحّد مع بقية الموقع */
  function norm(str) {
    return String(str || '')
      .toLowerCase()
      .replace(/[ً-ٰٟ]/g, '')       /* تشكيل */
      .replace(/[أإآٱ]/g, 'ا') /* أ إ آ ٱ ← ا */
      .replace(/[ىی]/g, 'ي')             /* ى ی ← ي */
      .replace(/ؤ/g, 'و').replace(/ئ/g, 'ي').replace(/ة/g, 'ه')
      .replace(/ـ/g, '')                      /* تطويل */
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * مسافة دامرو-ليفنشتاين محدودة.
   * ترجّع المسافة، أو max+1 لو تجاوزتها (فنوقف الحساب مبكّرًا).
   */
  function distance(a, b, max) {
    a = String(a); b = String(b);
    if (a === b) return 0;
    var la = a.length, lb = b.length;
    if (max === undefined) max = Math.max(la, lb);
    if (Math.abs(la - lb) > max) return max + 1;
    if (!la) return lb > max ? max + 1 : lb;
    if (!lb) return la > max ? max + 1 : la;

    var prev2 = null;
    var prev = new Array(lb + 1);
    var cur  = new Array(lb + 1);
    var i, j;
    for (j = 0; j <= lb; j++) prev[j] = j;

    for (i = 1; i <= la; i++) {
      cur[0] = i;
      var lo = Math.max(1, i - max);
      var hi = Math.min(lb, i + max);
      if (lo > 1) cur[lo - 1] = max + 1;
      var best = max + 1;

      for (j = lo; j <= hi; j++) {
        var cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
        var v = Math.min(
          cur[j - 1] + 1,        /* إدراج */
          prev[j] + 1,           /* حذف */
          prev[j - 1] + cost     /* استبدال */
        );
        /* تبديل حرفين متجاورين — «eortic» ↔ «erotic» */
        if (i > 1 && j > 1 && prev2 &&
            a.charCodeAt(i - 1) === b.charCodeAt(j - 2) &&
            a.charCodeAt(i - 2) === b.charCodeAt(j - 1)) {
          v = Math.min(v, prev2[j - 2] + 1);
        }
        cur[j] = v;
        if (v < best) best = v;
      }
      if (hi < lb) cur[hi + 1] = max + 1;
      if (best > max) return max + 1;

      prev2 = prev.slice();
      var t = prev; prev = cur; cur = t;
    }
    var d = prev[lb];
    return d > max ? max + 1 : d;
  }

  /* كم خطأ نسامح فيه حسب طول الكلمة */
  function tolerance(len) {
    if (len <= 3) return 0;
    if (len <= 5) return 1;
    if (len <= 9) return 2;
    return 3;
  }

  /* ---------- ثلاثيات الحروف ---------- */

  function trigrams(str) {
    var s = '  ' + norm(str) + ' ';
    var out = [];
    for (var i = 0; i < s.length - 2; i++) out.push(s.slice(i, i + 3));
    return out;
  }

  function dice(a, b) {
    var ta = trigrams(a), tb = trigrams(b);
    if (!ta.length || !tb.length) return 0;
    var map = {};
    ta.forEach(function (g) { map[g] = (map[g] || 0) + 1; });
    var hit = 0;
    tb.forEach(function (g) { if (map[g] > 0) { map[g]--; hit++; } });
    return (2 * hit) / (ta.length + tb.length);
  }

  /**
   * تشابه كلمتين: ٠..١ — يجمع التطابق التام والبادئة والمسافة والثلاثيات.
   */
  function similar(a, b) {
    var x = norm(a), y = norm(b);
    if (!x || !y) return 0;
    if (x === y) return 1;
    if (x.length >= 4 && y.indexOf(x) === 0) return 0.93;
    if (y.length >= 4 && x.indexOf(y) === 0) return 0.9;

    var max = tolerance(Math.max(x.length, y.length));
    if (max > 0) {
      var d = distance(x, y, max);
      if (d <= max) return Math.max(0.6, 1 - (d / Math.max(x.length, y.length)) - 0.05);
    }
    var g = dice(x, y);
    return g >= 0.55 ? g * 0.85 : 0;
  }

  /* هل الكلمتان «نفس الكلمة تقريبًا»؟ */
  function near(a, b) { return similar(a, b) >= 0.72; }

  /**
   * correct(term, vocab, opts) — أقرب كلمة معروفة لكلمة مكتوبة غلط.
   * vocab: مصفوفة كلمات (تُطبَّع داخليًا).
   * يرجّع { word, score } أو null.
   */
  function correct(term, vocab, opts) {
    opts = opts || {};
    var t = norm(term);
    if (t.length < 3 || !vocab || !vocab.length) return null;
    var minScore = opts.min || 0.74;
    var best = null;

    for (var i = 0; i < vocab.length; i++) {
      var w = norm(vocab[i]);
      if (!w || w === t) return { word: vocab[i], score: 1 };
      /* قصّ رخيص قبل الحساب الغالي */
      if (Math.abs(w.length - t.length) > tolerance(Math.max(w.length, t.length))) continue;
      if (w.charCodeAt(0) !== t.charCodeAt(0) && dice(w, t) < 0.45) continue;
      var s = similar(t, w);
      if (s >= minScore && (!best || s > best.score)) best = { word: vocab[i], score: s };
      if (best && best.score > 0.97) break;
    }
    return best;
  }

  /**
   * expand(terms, vocab) — يرجّع لكل كلمة صورها المصحّحة.
   * الأصل يبقى دائمًا أولًا: التصحيح إضافة لا استبدال.
   */
  function expand(terms, vocab) {
    var out = [];
    (terms || []).forEach(function (t) {
      if (out.indexOf(t) === -1) out.push(t);
      var fix = correct(t, vocab);
      if (fix && norm(fix.word) !== norm(t) && out.indexOf(fix.word) === -1) out.push(fix.word);
    });
    return out;
  }

  /**
   * هل النص يحوي هذي الكلمة أو قريبًا منها؟
   * hay مطبَّع ومحاط بمسافات (نفس شكل حقل المطابقة في الفهرس).
   */
  function inText(hay, term) {
    var t = norm(term);
    if (!t) return 0;
    if (hay.indexOf(' ' + t) !== -1) return 1;
    var max = tolerance(t.length);
    if (max < 1) return 0;
    var words = hay.split(' ');
    for (var i = 0; i < words.length; i++) {
      var w = words[i];
      if (!w || Math.abs(w.length - t.length) > max) continue;
      if (distance(w, t, max) <= max) return 0.78;
    }
    return 0;
  }

  CS.fuzzy = {
    norm: norm,
    distance: distance,
    tolerance: tolerance,
    trigrams: trigrams,
    dice: dice,
    similar: similar,
    near: near,
    correct: correct,
    expand: expand,
    inText: inText
  };

})(window.CS);
