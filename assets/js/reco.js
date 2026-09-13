/* ============================================================
   reco.js — محرّك القرب: «أعمال مثل هذا» و«For You»

   المشكلة القديمة:
   القرب كان يُحسب من الوسوم وتقاطع القصة فقط، وترشيحات TMDB
   نفسها مبنية على مشاهدات المستخدمين لا على محتوى العمل — فتطلع
   نتائج بلا علاقة. وFor You كان يرتّب بنسبة مبنيّة على الأنواع
   وحدها، فيرجّع أعمالًا تشترك في «دراما» لا في شيء آخر.

   الآن القرب يُقاس على ستة محاور صريحة، كل محور بوزنه، ومعه سطر
   يشرح ليه ظهر هذا العمل:
     ١) الوسوم المشتركة، موزونة بندرتها (IDF)
     ٢) تقاطع كلمات القصة
     ٣) المخرج
     ٤) الممثلون المشتركون
     ٥) اللغة الأصلية
     ٦) فترة الإنتاج
     (+ النوع السينمائي كمرجّح)

   ما فيه رقم للعرض ورقم للترتيب: النسبة المعروضة هي نفسها الدرجة
   اللي رتّبنا بها، منسوبة لأقوى نتيجة في القائمة.
   ============================================================ */

(function (CS) {
  'use strict';

  /* أوزان المحاور — مجموعها لا يهم، النسبة تُحسب بعد الترتيب */
  var W = {
    keyword:     14,    /* لكل وسم مشترك، مضروبًا في ندرته */
    keywordPair: 16,    /* مكافأة التقاطع: وسمان أقوى من ضعف وسم */
    plotTerm:     6,
    plotStack:    5,
    director:    30,    /* أقوى إشارة مفردة بعد الوسم النادر */
    castEach:    12,
    castStack:    8,
    genre:        4,
    language:     7,
    period:      10,    /* داخل نفس العقد */
    ratingTilt:   1.4,
    popTilt:      2
  };

  /* ------------------------------------------------------------
     استخراج خصائص العمل — من الكائن الحيّ أو من سجلّه في الفهرس
     ------------------------------------------------------------ */

  function featuresOf(item) {
    if (!item) return null;
    var rec = (CS.catalog && CS.catalog.record) ? CS.catalog.record(item) : null;

    var kw = {};
    var names = [];
    if (item.keywords && item.keywords.length) {
      names = item.keywords.map(function (k) { return (k && k.name) || k; });
    } else {
      var heat = CS.certs && CS.certs.cachedHeat(item);
      if (heat && heat.names && heat.names.length) names = heat.names;
      else if (rec && rec.w) names = rec.w;
    }
    names.forEach(function (n) {
      var t = String(n || '').trim().toLowerCase();
      if (t) kw[t] = true;
    });

    var cast = {};
    ((item.cast && item.cast.length ? item.cast.map(function (c) { return c.id; })
       : (rec && rec.cr) || [])).forEach(function (id) { if (id != null) cast[id] = true; });

    var directors = (item.directors && item.directors.length ? item.directors
                     : (rec && rec.dr) || []).map(function (d) { return String(d || '').trim().toLowerCase(); })
                     .filter(Boolean);

    /* الوسوم لها وجهان: الاسم والرقم. ملفّ الذوق يخزّن الأرقام
       (من صفحة العمل) والمرشّحون يجيبون الأسماء (من ذاكرة البوابة)،
       فبلا توحيدهما ما يتقاطع الطرفان أبدًا — وهذا اللي كان يخلّي
       «For You» يرسّب كل شي مهما كان قريبًا. */
    var ids = {};
    (item.keywords || []).forEach(function (k) { if (k && k.id != null) ids[k.id] = true; });
    (item.keywordIds || []).forEach(function (id) { if (id != null) ids[id] = true; });
    if (CS.feed && CS.feed.keywordIdOf) {
      Object.keys(kw).forEach(function (n) {
        var id = CS.feed.keywordIdOf(n);
        if (id) ids[id] = true;
      });
    }
    if (CS.feed && CS.feed.keywordNameOf) {
      Object.keys(ids).forEach(function (id) {
        var n = CS.feed.keywordNameOf(id);
        if (n) kw[n] = true;
      });
    }

    var overview = item.overview || (rec && (rec.d || rec.e)) || '';

    return {
      keywordIds: Object.keys(ids),
      key: item.type + ':' + item.id,
      type: item.type,
      id: item.id,
      keywords: kw,
      keywordList: Object.keys(kw),
      genres: item.genreIds || (rec && rec.g) || [],
      cast: cast,
      castList: Object.keys(cast),
      directors: directors,
      lang: item.languageOf || item.originalLanguage || (rec && rec.l) || '',
      year: item.year || (rec && rec.y) || null,
      terms: (CS.catalog && overview) ? CS.catalog.plotTerms(overview, 26) : [],
      haystack: (rec && rec.q) || (' ' + (CS.catalog ? CS.catalog.norm(overview + ' ' + (item.title || '')) : '') + ' ')
    };
  }

  function idf(name) {
    if (CS.catalog && CS.catalog.keywordIdf) return CS.catalog.keywordIdf(name);
    return 1.6;
  }

  /* ------------------------------------------------------------
     الدرجة بين عملين
     ------------------------------------------------------------ */

  /**
   * score(baseF, cand) — baseF من featuresOf، cand عمل كامل أو سجل.
   * يرجّع { score, parts, reasons, weak }
   */
  function score(baseF, cand) {
    var f = featuresOf(cand);
    if (!baseF || !f) return { score: 0, parts: {}, reasons: [], weak: true };

    var s = 0;
    var parts = { keyword: 0, plot: 0, director: 0, cast: 0, genre: 0, language: 0, period: 0 };
    var reasons = [];

    /* ١) الوسوم المشتركة موزونة بندرتها */
    var kwHits = 0, bestIdf = 0, shared = [];
    f.keywordList.forEach(function (t) {
      if (!baseF.keywords[t]) return;
      kwHits++;
      var w = idf(t);
      if (w > bestIdf) bestIdf = w;
      parts.keyword += W.keyword * w;
      if (shared.length < 4) shared.push(t);
    });
    if (kwHits > 1) parts.keyword += (kwHits - 1) * W.keywordPair;
    if (shared.length) reasons.push({ kind: 'keyword', items: shared, n: kwHits });

    /* ٢) تقاطع كلمات القصة */
    var termHits = 0;
    baseF.terms.forEach(function (t) {
      if (f.haystack.indexOf(' ' + t) === -1) return;
      termHits++;
      parts.plot += W.plotTerm;
    });
    if (termHits > 2) parts.plot += (termHits - 2) * W.plotStack;
    if (termHits) reasons.push({ kind: 'plot', n: termHits });

    /* ٣) المخرج */
    var dirHit = f.directors.filter(function (d) { return baseF.directors.indexOf(d) !== -1; });
    if (dirHit.length) {
      parts.director += W.director;
      reasons.push({ kind: 'director', items: dirHit });
    }

    /* ٤) الممثلون */
    var castHit = f.castList.filter(function (id) { return baseF.cast[id]; });
    if (castHit.length) {
      parts.cast += W.castEach * Math.min(castHit.length, 3) + (castHit.length > 1 ? W.castStack : 0);
      reasons.push({ kind: 'cast', n: castHit.length, ids: castHit.slice(0, 3) });
    }

    /* ٥) النوع السينمائي */
    var gShared = (f.genres || []).filter(function (g) { return (baseF.genres || []).indexOf(g) !== -1; });
    if (gShared.length) {
      parts.genre += gShared.length * W.genre;
      reasons.push({ kind: 'genre', ids: gShared });
    }

    /* ٦) اللغة الأصلية */
    if (baseF.lang && f.lang && baseF.lang === f.lang) {
      parts.language += W.language;
      reasons.push({ kind: 'language', code: f.lang });
    }

    /* ٧) فترة الإنتاج — نفس العقد يرفع، والبعد يخصم بهدوء */
    if (baseF.year && f.year) {
      var gap = Math.abs(baseF.year - f.year);
      if (gap <= 10) { parts.period += W.period * (1 - gap / 10); reasons.push({ kind: 'period', gap: gap }); }
      else parts.period -= Math.min(8, (gap - 10) / 6);
    }

    s = parts.keyword + parts.plot + parts.director + parts.cast +
        parts.genre + parts.language + parts.period;

    /* مرجّحات الجودة — تفصل عند التساوي ولا تقلب الترتيب */
    if (cand.rating) s += (cand.rating - 5.5) * W.ratingTilt;
    s += Math.min(5, Math.log10((cand.popularity || 0) + 1) * W.popTilt);

    /* أرضية الصلة: وسم عام واحد مشترك لا يصنع «عملًا مشابهًا».
       لازم إشارة حقيقية: وسمان، أو وسم نادر، أو مخرج/ممثل مشترك،
       أو تقاطع قصة فعلي. */
    var weak = kwHits < 2 && termHits < 2 && bestIdf < 2.2 &&
               !dirHit.length && castHit.length < 1;

    return { score: s, parts: parts, reasons: reasons, weak: weak,
             kwHits: kwHits, termHits: termHits, bestIdf: bestIdf,
             dirHits: dirHit.length, castHits: castHit.length };
  }

  /* سطر عربي يشرح سبب الظهور — بلا سطر، «ذات صلة» ادّعاء */
  function explain(res) {
    if (!res || !res.reasons.length) return 'من نفس النوع';
    var bits = [];
    res.reasons.forEach(function (r) {
      if (r.kind === 'keyword' && r.items && r.items.length) bits.push('يشارك: ' + r.items.slice(0, 3).join(' + '));
      else if (r.kind === 'director') bits.push('نفس المخرج: ' + r.items[0]);
      else if (r.kind === 'cast') bits.push(r.n > 1 ? r.n + ' ممثلين مشتركين' : 'ممثل مشترك');
      else if (r.kind === 'plot' && r.n > 1) bits.push('قصته تلتقي بـ' + r.n + ' عناصر');
      else if (r.kind === 'language') bits.push('نفس اللغة');
      else if (r.kind === 'period' && r.gap <= 5) bits.push('نفس الفترة');
    });
    if (!bits.length) return 'من نفس النوع';
    return bits.slice(0, 2).join(' · ');
  }

  /**
   * rank(base, candidates, opts) — يرتّب ويضع النسبة والسبب.
   * opts.exclude: كائن مفاتيح نستبعدها
   * opts.keepWeak: نُبقي الواهية لو ما فيه بديل
   */
  function rank(base, candidates, opts) {
    opts = opts || {};
    var baseF = featuresOf(base);
    if (!baseF) return [];
    var exclude = opts.exclude || {};
    var out = [];

    (candidates || []).forEach(function (c) {
      if (!c || c.id == null) return;
      var k = c.type + ':' + c.id;
      if (k === baseF.key || exclude[k]) return;
      var res = score(baseF, c);
      c.relScore = res.score;
      c.relParts = res.parts;
      c.relWeak  = res.weak;
      c.relKwHits = res.kwHits;
      c.relTermHits = res.termHits;
      c.whyText = explain(res);
      c.why = 'related';
      c.matchBasis = 'related';
      out.push(c);
    });

    var strong = out.filter(function (x) { return !x.relWeak; });
    if (strong.length >= (opts.strongFloor || 8)) out = strong;
    else if (!opts.keepWeak && strong.length) out = strong.concat(out.filter(function (x) { return x.relWeak; }));

    out.sort(function (a, b) { return (b.relScore || 0) - (a.relScore || 0); });

    var top = out.length ? Math.max(1, out[0].relScore || 1) : 1;
    out.forEach(function (it) {
      it.matchPct = Math.max(25, Math.min(97, Math.round((it.relScore / top) * 97)));
    });
    return out;
  }

  /* ------------------------------------------------------------
     ملفّ الذوق — مركز ثقل الأعمال اللي عجبت المستخدم
     ------------------------------------------------------------ */

  function tasteProfile() {
    var likes = (CS.taste.likes() || []).slice(0, 40);
    var dislikes = (CS.taste.dislikes() || []).slice(0, 40);
    /* المفضلة والمتابَعة إشارات إيجابية كمان — المستخدم اختارها بيده */
    var extra = []
      .concat(CS.library ? CS.library.fav.all().slice(0, 20) : [])
      .concat(CS.library ? CS.library.follow.all().slice(0, 10) : []);

    var kw = {}, genres = {}, people = {}, langs = {}, years = [], dirs = {};
    var avoidGenres = {}, avoidKw = {};

    function absorb(list, weight, kwBag, gBag) {
      list.forEach(function (x, i) {
        if (!x) return;
        var recency = 1 + Math.max(0, 1.1 - i * 0.06);
        var w = weight * recency;
        var f = featuresOf(x);
        if (!f) return;
        f.keywordList.forEach(function (t) { kwBag[t] = (kwBag[t] || 0) + w * idf(t); });
        (f.genres || []).forEach(function (g) { gBag[g] = (gBag[g] || 0) + w; });
        f.castList.forEach(function (p) { people[p] = (people[p] || 0) + w; });
        f.directors.forEach(function (d) { dirs[d] = (dirs[d] || 0) + w * 1.5; });
        if (f.lang) langs[f.lang] = (langs[f.lang] || 0) + w;
        if (f.year) years.push(f.year);
        /* الأرقام تُخزَّن بنفس الحقيبة وبالبادئة #، وfeaturesOf يحوّل
           ما يعرف اسمه فيتقاطع الطرفان مهما اختلف مصدر البيانات */
        (f.keywordIds || []).forEach(function (id) { kwBag['#' + id] = (kwBag['#' + id] || 0) + w; });
      });
    }

    absorb(likes, 1, kw, genres);
    absorb(extra, 0.7, kw, genres);
    absorb(dislikes, 1, avoidKw, avoidGenres);

    function top(map, n) {
      return Object.keys(map).sort(function (a, b) { return map[b] - map[a]; }).slice(0, n);
    }

    return {
      total: likes.length + extra.length,
      keywords: top(kw, 18),
      keywordWeight: kw,
      genres: top(genres, 5).map(Number),
      genreWeight: genres,
      people: top(people, 10).map(Number),
      directors: top(dirs, 5),
      langs: top(langs, 3),
      minYear: years.length ? Math.min.apply(null, years) : null,
      maxYear: years.length ? Math.max.apply(null, years) : null,
      avoidGenres: top(avoidGenres, 4).map(Number)
        .filter(function (g) { return !genres[g]; }),
      avoidKeywords: top(avoidKw, 8).filter(function (t) { return !kw[t]; }),
      seeds: likes.concat(extra)
    };
  }

  /* أوزان محاور التطابق مع الذوق — مجموعها ١ لما تكون كلها متاحة */
  var AXES = { keyword: 0.38, genre: 0.18, people: 0.14, director: 0.10, language: 0.08, period: 0.12 };

  /**
   * matchProfile(item, p) — نسبة تطابق العمل مع ملفّ ذوقك.
   *
   * النسبة نسبة حقيقية لا رقم مصفوف: كم محورًا مما *نقدر نقارنه*
   * تطابق فعلًا. المحور اللي ما عندنا عنه بيانات (ما نعرف مخرج
   * أعمالك مثلًا) يسقط من البسط والمقام معًا، فما يعاقِب العمل على
   * نقص عندنا. ٨٠٪ تعني: طابق ثمانين بالمئة من الدليل المتاح.
   */
  function matchProfile(item, p) {
    p = p || tasteProfile();
    var f = featuresOf(item);
    if (!f) return 0;

    if (!p.total) {
      /* ما صوّت على شي: الشارة تبقى صادقة — قوة الترشيح لا تطابق ذوق */
      item.matchBasis = 'quality';
      var q = 42;
      if (item.rating) q += (item.rating - 5.5) * 7;
      if (item.votes) q += Math.min(14, Math.log10(item.votes + 1) * 4);
      q += Math.min(10, Math.log10((item.popularity || 0) + 1) * 4);
      return Math.max(20, Math.min(99, Math.round(q)));
    }

    item.matchBasis = 'taste';
    var got = 0, avail = 0, hits = [], penalty = 0;

    function axis(name, canCompare, ratio, label) {
      if (!canCompare) return;
      avail += AXES[name];
      var r = Math.max(0, Math.min(1, ratio));
      got += AXES[name] * r;
      if (r >= 0.5 && label) hits.push(label);
    }

    /* ١) الوسوم — بالاسم أو بالرقم، فالمصدران يتقاطعان */
    var profHasKw = p.keywords.length > 0;
    var kwHits = 0;
    f.keywordList.forEach(function (t) {
      if (p.keywordWeight[t]) kwHits++;
      if (p.avoidKeywords.indexOf(t) !== -1) penalty += 0.10;
    });
    (f.keywordIds || []).forEach(function (id) {
      if (p.keywordWeight['#' + id]) kwHits++;
    });
    /* وسمان مشتركان = تطابق تام على هذا المحور */
    axis('keyword', profHasKw, kwHits / 2, 'وسوم');

    /* ٢) النوع السينمائي */
    var gShared = (f.genres || []).filter(function (g) { return p.genres.indexOf(g) !== -1; }).length;
    (f.genres || []).forEach(function (g) { if (p.avoidGenres.indexOf(g) !== -1) penalty += 0.16; });
    axis('genre', p.genres.length > 0 && (f.genres || []).length > 0, gShared / 2, 'النوع');

    /* ٣) الممثلون */
    var castHit = f.castList.filter(function (id) { return p.people.indexOf(+id) !== -1; }).length;
    axis('people', p.people.length > 0 && f.castList.length > 0, castHit / 2, 'ممثلون');

    /* ٤) المخرج */
    var dirHit = f.directors.some(function (d) { return p.directors.indexOf(d) !== -1; }) ? 1 : 0;
    axis('director', p.directors.length > 0 && f.directors.length > 0, dirHit, 'المخرج');

    /* ٥) اللغة الأصلية */
    axis('language', p.langs.length > 0 && !!f.lang,
         p.langs.indexOf(f.lang) !== -1 ? 1 : 0, 'اللغة');

    /* ٦) فترة الإنتاج — قرب متدرّج لا عتبة قاطعة */
    if (p.minYear && p.maxYear && f.year) {
      var mid = (p.minYear + p.maxYear) / 2;
      var span = Math.max(8, (p.maxYear - p.minYear) / 2 + 8);
      axis('period', true, 1 - Math.min(1, Math.abs(f.year - mid) / (span * 2)), 'الفترة');
    }

    if (!avail) return 50;

    var ratio = Math.max(0, (got / avail) - penalty);
    /* أرضية ٢٠ وسقف ٩٩ — ما نعرض ٠٪ ولا ١٠٠٪، فكلاهما ادّعاء */
    var pct = Math.round(20 + ratio * 79);
    if (item.rating) pct += Math.round((item.rating - 6) * 0.8);

    item.matchWhy = hits.slice(0, 3);
    return Math.max(15, Math.min(99, pct));
  }

  CS.reco = {
    W: W,
    featuresOf: featuresOf,
    score: score,
    rank: rank,
    explain: explain,
    tasteProfile: tasteProfile,
    matchProfile: matchProfile
  };

})(window.CS);
