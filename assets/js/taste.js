/* ============================================================
   taste.js — الإعجاب/عدم الإعجاب وبناء ملف الذوق
   كل شي محفوظ في متصفح الزائر (localStorage) — ما فيه سيرفر.
   ============================================================ */

(function (CS) {
  'use strict';

  var MAX_ITEMS = 400;

  function blank() {
    return { likes: [], dislikes: [], updatedAt: 0 };
  }

  function load() {
    var t = CS.store.get(CS.KEYS.taste, null);
    if (!t || typeof t !== 'object') return blank();
    if (!Array.isArray(t.likes)) t.likes = [];
    if (!Array.isArray(t.dislikes)) t.dislikes = [];
    return t;
  }

  function save(t) {
    t.updatedAt = Date.now();
    t.likes = t.likes.slice(0, MAX_ITEMS);
    t.dislikes = t.dislikes.slice(0, MAX_ITEMS);
    CS.store.set(CS.KEYS.taste, t);
    return t;
  }

  function key(item) { return item.type + ':' + item.id; }

  function slim(item) {
    return {
      id: item.id,
      type: item.type,
      title: item.title,
      year: item.year || null,
      poster: item.poster || '',
      rating: item.rating || 0,
      genreIds: (item.genreIds || []).slice(0, 6),
      keywordIds: (item.keywords || []).map(function (k) { return k.id; }).slice(0, 8),
      source: item.source || 'tmdb',
      ts: Date.now()
    };
  }

  /* ---------- القراءة ---------- */

  function verdict(item) {
    if (!item) return 0;
    var k = key(item), t = load();
    if (t.likes.some(function (x) { return key(x) === k; })) return 1;
    if (t.dislikes.some(function (x) { return key(x) === k; })) return -1;
    return 0;
  }

  function likes()    { return load().likes; }
  function dislikes() { return load().dislikes; }
  function counts()   { var t = load(); return { likes: t.likes.length, dislikes: t.dislikes.length }; }

  /* ---------- الكتابة ---------- */

  /* dir: 1 إعجاب، -1 عدم إعجاب. الضغط على نفس الزر مرة ثانية يلغيه. */
  function set(item, dir) {
    var t = load(), k = key(item);
    var was = verdict(item);

    t.likes    = t.likes.filter(function (x) { return key(x) !== k; });
    t.dislikes = t.dislikes.filter(function (x) { return key(x) !== k; });

    var now = was === dir ? 0 : dir;
    if (now === 1)  t.likes.unshift(slim(item));
    if (now === -1) t.dislikes.unshift(slim(item));

    save(t);
    return now;
  }

  /* ندمج الكلمات المفتاحية بعد ما تُفتح صفحة العمل (ما تجي مع القوائم) */
  function enrich(item) {
    if (!item || !item.keywords || !item.keywords.length) return;
    var t = load(), k = key(item), changed = false;

    t.likes.concat(t.dislikes).forEach(function (x) {
      if (key(x) === k && (!x.keywordIds || !x.keywordIds.length)) {
        x.keywordIds = item.keywords.map(function (kw) { return kw.id; }).slice(0, 8);
        if (!x.genreIds || !x.genreIds.length) x.genreIds = (item.genreIds || []).slice(0, 6);
        changed = true;
      }
    });
    if (changed) save(t);
  }

  /* ---------- ملف الذوق ---------- */

  function tally(list, field, weightFn) {
    var map = {};
    list.forEach(function (x, i) {
      var w = weightFn ? weightFn(x, i) : 1;
      (x[field] || []).forEach(function (id) {
        map[id] = (map[id] || 0) + w;
      });
    });
    return map;
  }

  function topOf(map, n) {
    return Object.keys(map)
      .sort(function (a, b) { return map[b] - map[a]; })
      .slice(0, n)
      .map(Number);
  }

  /**
   * ملف الذوق:
   *  - الإعجابات الأحدث لها وزن أعلى
   *  - الأنواع اللي ما عجبته تُطرح من وزنها
   */
  function profile() {
    var t = load();
    var recency = function (x, i) { return 1 + Math.max(0, 1.2 - i * 0.08); };

    var likeGenres = tally(t.likes, 'genreIds', recency);
    var dislikeGenres = tally(t.dislikes, 'genreIds');
    Object.keys(dislikeGenres).forEach(function (g) {
      likeGenres[g] = (likeGenres[g] || 0) - dislikeGenres[g] * 1.4;
    });
    Object.keys(likeGenres).forEach(function (g) {
      if (likeGenres[g] <= 0) delete likeGenres[g];
    });

    var years = t.likes.map(function (x) { return x.year; }).filter(Boolean);
    var typeCount = { movie: 0, tv: 0 };
    t.likes.forEach(function (x) { typeCount[x.type] = (typeCount[x.type] || 0) + 1; });

    return {
      total: t.likes.length,
      genres: topOf(likeGenres, 4),
      keywords: topOf(tally(t.likes, 'keywordIds', recency), 4),
      avoidGenres: topOf(dislikeGenres, 3).filter(function (g) { return !likeGenres[g]; }),
      minYear: years.length ? Math.min.apply(null, years) : null,
      maxYear: years.length ? Math.max.apply(null, years) : null,
      leansTv: typeCount.tv > typeCount.movie,
      recent: t.likes.slice(0, 3),
      seen: {}   /* يُملأ في seenSet */
    };
  }

  /* كل شي تفاعل معه — عشان ما نرشّحه له من جديد */
  function seenSet() {
    var t = load(), set = {};
    t.likes.concat(t.dislikes).forEach(function (x) { set[key(x)] = true; });
    return set;
  }

  function clearAll() {
    CS.store.set(CS.KEYS.taste, blank());
  }

  /* ترحيل المفضلة القديمة (زر القلب) إلى الإعجابات — مرة وحدة، بدون ما نفقد شي */
  function migrate() {
    var old = CS.store.get(CS.KEYS.favorites, null);
    if (!Array.isArray(old) || !old.length) return 0;

    var t = load();
    var have = {};
    t.likes.concat(t.dislikes).forEach(function (x) { have[key(x)] = true; });

    var added = 0;
    old.forEach(function (f) {
      if (!f || !f.type || f.id == null || have[key(f)]) return;
      t.likes.push(slim(f));
      have[key(f)] = true;
      added++;
    });

    if (added) save(t);
    CS.store.remove(CS.KEYS.favorites);
    return added;
  }

  /* دمج ملف تصدير — يضيف الجديد ولا يمسح شي موجود */
  function merge(data) {
    if (!data || typeof data !== 'object') throw new Error('BAD_FILE');
    var inLikes = Array.isArray(data.likes) ? data.likes : [];
    var inDis = Array.isArray(data.dislikes) ? data.dislikes : [];
    if (!inLikes.length && !inDis.length) return 0;

    var t = load();
    var have = {};
    t.likes.concat(t.dislikes).forEach(function (x) { have[key(x)] = true; });

    var added = 0;
    function take(list, target) {
      list.forEach(function (x) {
        if (!x || !x.type || x.id == null || have[key(x)]) return;
        have[key(x)] = true;
        target.push(slim(x));
        added++;
      });
    }
    take(inLikes, t.likes);
    take(inDis, t.dislikes);

    if (added) save(t);
    return added;
  }

  /**
   * نسبة تطابق العمل مع ذوقك — رقم حقيقي مبني على تصويتك، لا زينة.
   * تُعرض في الصفحات اللي ما فيها استعلام بحث (الاستكشاف · الممثل · عجبني)،
   * وترجّع صفرًا قبل ما تصوّت على شي فما نعرض شارة بلا معنى.
   */
  function matchPct(item) {
    if (!item) return 0;
    var p = profile();
    var mine = p.genres || [];
    var avoid = p.avoidGenres || [];
    var ids = item.genreIds || [];

    /* ما صوّت على شي بعد؟ الشارة تبقى موجودة لكن معناها يتغيّر بصراحة:
       قوة الترشيح من تقييمه وعدد مصوّتيه وشهرته، لا تطابق ذوق ما نعرفه. */
    if (!p.total || (!mine.length && !avoid.length)) {
      item.matchBasis = 'quality';
      var q = 42;
      if (item.rating) q += (item.rating - 5.5) * 7;
      if (item.votes) q += Math.min(14, Math.log10(item.votes + 1) * 4);
      q += Math.min(10, Math.log10((item.popularity || 0) + 1) * 4);
      return Math.max(20, Math.min(99, Math.round(q)));
    }

    item.matchBasis = 'taste';

    var hit = 0, miss = 0;
    ids.forEach(function (g) {
      var rank = mine.indexOf(g);
      if (rank !== -1) hit += 4 - Math.min(rank, 3);
      if (avoid.indexOf(g) !== -1) miss += 3;
    });

    /* الأساس ٥٠٪: بلا اشتراك أنواع ولا نفور، العمل «محايد» لا صفر */
    var score = 50 + hit * 9 - miss * 12;

    /* التقييم والشهرة يرجّحان قليلًا، والسنة داخل مدى ما أعجبك */
    if (item.rating) score += (item.rating - 6) * 2.5;
    if (item.year && p.minYear && p.maxYear &&
        item.year >= p.minYear - 5 && item.year <= p.maxYear + 5) score += 5;
    if (p.leansTv && item.type === 'tv') score += 4;
    if (!p.leansTv && item.type === 'movie') score += 4;

    return Math.max(20, Math.min(99, Math.round(score)));
  }

  /* بصمة الذوق — تتغيّر مع كل تصويت فتُعاد النسب بدل ما تتجمّد */
  function version() {
    var t = load();
    return (t.likes.length * 1000) + t.dislikes.length;
  }

  CS.taste = {
    matchPct: matchPct,
    version: version,
    verdict: verdict,
    merge: merge,
    set: set,
    enrich: enrich,
    likes: likes,
    dislikes: dislikes,
    counts: counts,
    profile: profile,
    seenSet: seenSet,
    clearAll: clearAll,
    migrate: migrate,
    key: key
  };

})(window.CS);
