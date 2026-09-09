/* ============================================================
   wiki.js — البحث بوصف القصة عبر ويكيبيديا + ترجمة تلقائية
   يشتغل بدون أي مفتاح API.
   ============================================================ */

(function (CS) {
  'use strict';

  var LIM = CS.config.limits;
  var cache = {};

  /* يميّز صفحات الأفلام والمسلسلات من وصف ويكي داتا */
  var RE_MOVIE  = /\b(film|movie|motion picture)\b|فيلم/i;
  var RE_TV     = /\b(television series|tv series|tv show|series|sitcom|miniseries|telenovela|drama series|anime series|web series)\b|مسلسل|سلسلة تلفزيونية|برنامج تلفزيوني/i;
  var RE_EITHER = /\b(film|movie|motion picture|television|series|sitcom|miniseries|telenovela|anime|documentary)\b|فيلم|مسلسل|سلسلة|أنمي|وثائقي/i;

  /* عناوين أقسام الحبكة في المقالات */
  var PLOT_HEADINGS = /^(القصة|الحبكة|القصّة|ملخص|ملخص القصة|ملخّص|قصة الفيلم|قصة المسلسل|الملخص|plot|synopsis|story|premise|plot summary|storyline)$/i;

  function api(lang, params) {
    params = Object.assign({ action: 'query', format: 'json', origin: '*', formatversion: 2 }, params);
    var qs = Object.keys(params)
      .filter(function (k) { return params[k] !== undefined && params[k] !== null && params[k] !== ''; })
      .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); })
      .join('&');

    var url = 'https://' + lang + '.wikipedia.org/w/api.php?' + qs;
    if (cache[url]) return Promise.resolve(cache[url]);

    return fetch(url)
      .then(function (r) {
        if (!r.ok) throw new Error('WIKI_HTTP_' + r.status);
        return r.json();
      })
      .then(function (json) { cache[url] = json; return json; });
  }

  /* ---------- 1) البحث في النص الكامل ---------- */

  function searchPages(lang, query, limit) {
    return api(lang, {
      list: 'search',
      srsearch: query,
      srlimit: limit || LIM.wikiSearch,
      srnamespace: 0,
      srprop: 'snippet',
      srqiprofile: 'popular_inclinks_pv'   /* يرجّح الصفحات المشهورة */
    }).then(function (json) {
      return ((json.query || {}).search || []).map(function (r) {
        return {
          pageid: r.pageid,
          title: r.title,
          snippet: CS.util.stripTags(r.snippet)
        };
      });
    }).catch(function () { return []; });
  }

  /* ---------- 2) تفاصيل الصفحات + الفلترة على الأفلام/المسلسلات ---------- */

  function pageDetails(lang, pageids) {
    if (!pageids.length) return Promise.resolve([]);
    return api(lang, {
      pageids: pageids.slice(0, 20).join('|'),
      prop: 'pageimages|pageterms|extracts|info',
      inprop: 'url',
      piprop: 'thumbnail',
      pithumbsize: 500,
      wbptterms: 'description',
      exintro: 1,
      explaintext: 1,
      exlimit: 20
    }).then(function (json) {
      return ((json.query || {}).pages || []).map(function (p) {
        var terms = p.terms || {};
        return {
          pageid: p.pageid,
          title: p.title,
          url: p.fullurl || ('https://' + lang + '.wikipedia.org/wiki/' + encodeURIComponent(p.title)),
          description: (terms.description || [])[0] || '',
          extract: p.extract || '',
          thumb: (p.thumbnail || {}).source || '',
          lang: lang
        };
      });
    }).catch(function () { return []; });
  }

  /* أي نوع هذي الصفحة؟ فيلم / مسلسل / لا شي */
  /* مقالات موضوعية وقوائم كانت تدخل كأنها أعمال: «Nudity in film» و«قائمة أفلام…» */
  var RE_TOPIC = /^(list of|lists of|outline of|index of|glossary of|history of|قائمة |قوائم |تاريخ )/i;
  var RE_TOPIC_IN = /\b(in film|in cinema|in television|in video games|filmography)\b|^(cinema|film|television) of /i;

  function classify(page) {
    var title = page.title || '';
    if (RE_TOPIC.test(title) || RE_TOPIC_IN.test(title)) return null;

    var probe = (page.description || '') + ' ' + title + ' ' + (page.extract || '').slice(0, 320);
    if (!RE_EITHER.test(probe)) return null;
    if (RE_TV.test(page.description) || RE_TV.test(page.title)) return 'tv';
    if (RE_MOVIE.test(page.description) || RE_MOVIE.test(page.title)) return 'movie';
    if (RE_TV.test(probe)) return 'tv';
    if (RE_MOVIE.test(probe)) return 'movie';
    return null;
  }

  /* البحث الكامل في ويكي واحدة: بحث ← تفاصيل ← فلترة */
  function findWorks(lang, query, limit) {
    return searchPages(lang, query, limit).then(function (hits) {
      if (!hits.length) return [];
      var ids = hits.map(function (h) { return h.pageid; });
      var order = {}, snip = {};
      hits.forEach(function (h, i) { order[h.pageid] = i; snip[h.pageid] = h.snippet || ''; });

      return pageDetails(lang, ids).then(function (pages) {
        return pages
          .map(function (p) {
            var type = classify(p);
            if (!type) return null;
            return {
              wikiPageId: p.pageid,
              wikiTitle: p.title,
              wikiLang: lang,
              wikiUrl: p.url,
              type: type,
              cleanTitle: CS.util.cleanTitle(p.title),
              year: CS.util.yearFrom(p.description) || CS.util.yearFrom(p.title) || CS.util.yearFrom(p.extract.slice(0, 200)),
              description: p.description,
              extract: p.extract,
              /* مقتطف البحث هو دليل المطابقة الوحيد اللي ترجّعه ويكيبيديا — نحتفظ فيه */
              snippet: snip[p.pageid] || '',
              thumb: p.thumb,
              rank: order[p.pageid] == null ? 99 : order[p.pageid]
            };
          })
          .filter(Boolean)
          .sort(function (a, b) { return a.rank - b.rank; });
      });
    });
  }

  /* ---------- 3) القصة الكاملة من نص المقالة ---------- */

  function fullPlot(lang, title) {
    return api(lang, {
      titles: title,
      prop: 'extracts',
      explaintext: 1,
      exlimit: 1
    }).then(function (json) {
      var page = ((json.query || {}).pages || [])[0];
      var text = (page || {}).extract || '';
      if (!text) return '';

      /* نقسم على العناوين ونلقط قسم القصة */
      var parts = text.split(/\n(?==+[^=\n]+=+\n?)/);
      var intro = parts[0] || '';
      var plot = '';

      parts.forEach(function (block) {
        var m = /^(=+)\s*([^=\n]+?)\s*\1/.exec(block);
        if (!m) return;
        if (plot) return;
        if (PLOT_HEADINGS.test(m[2].trim())) {
          plot = block.replace(/^=+[^=\n]+=+\n?/, '').trim();
        }
      });

      return (plot || intro).trim();
    }).catch(function () { return ''; });
  }

  /* ---------- 4) الترجمة المجانية (عربي ⇄ إنجليزي) ---------- */

  var CHUNK = 440;        // أقصى طول للمقطع الواحد عند MyMemory
  var MAX_CACHE = 240;    // كم ترجمة نخزّن قبل ما نبدأ نرمي الأقدم
  var memTr = {};

  function hash(str) {
    var h = 5381, i = str.length;
    while (i) h = (h * 33) ^ str.charCodeAt(--i);
    return (h >>> 0).toString(36);
  }

  function diskCache() {
    var c = CS.store.get(CS.KEYS.trCache, {});
    return (c && typeof c === 'object') ? c : {};
  }

  function cachePut(key, value) {
    var c = diskCache();
    var keys = Object.keys(c);
    if (keys.length >= MAX_CACHE) keys.slice(0, keys.length - MAX_CACHE + 1).forEach(function (k) { delete c[k]; });
    c[key] = value;
    CS.store.set(CS.KEYS.trCache, c);
  }

  /* ترجمة مقطع واحد قصير */
  function translate(text, from, to) {
    text = String(text || '').trim();
    if (!text || text.length > 500) return Promise.resolve('');

    var key = from + '>' + to + ':' + hash(text);
    if (memTr[key]) return Promise.resolve(memTr[key]);

    var url = 'https://api.mymemory.translated.net/get?q=' +
      encodeURIComponent(text) + '&langpair=' + from + '|' + to;

    /* البريد اختياري — يرفع الحد اليومي من ٥ آلاف إلى ٥٠ ألف حرف */
    var email = CS.store.get(CS.KEYS.email, '');
    if (email) url += '&de=' + encodeURIComponent(email);

    return fetch(url)
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (json) {
        var out = ((json || {}).responseData || {}).translatedText || '';
        /* الخدمة ترجّع رسائل الحصة كنص عادي — نتجاهلها */
        if (!out || /MYMEMORY WARNING|QUERY LENGTH LIMIT|INVALID|DAILY LIMIT/i.test(out)) return '';
        memTr[key] = out;
        return out;
      })
      .catch(function () { return ''; });
  }

  /* تقسيم النص لجُمل بدون lookbehind (توافق أوسع للمتصفحات) */
  function sentences(text) {
    var raw = String(text).split(/([.!?؟…]+["'”»)\]]*\s+)/);
    var out = [], cur = '';
    for (var i = 0; i < raw.length; i++) {
      cur += raw[i];
      if (i % 2 === 1) { out.push(cur); cur = ''; }
    }
    if (cur.trim()) out.push(cur);
    return out.filter(function (s) { return s.trim(); });
  }

  function pack(parts, max) {
    var out = [], buf = '';
    parts.forEach(function (s) {
      while (s.length > max) {           // جملة وحدة أطول من الحد
        if (buf) { out.push(buf); buf = ''; }
        out.push(s.slice(0, max));
        s = s.slice(max);
      }
      if ((buf + s).length > max) { if (buf) out.push(buf); buf = s; }
      else buf += s;
    });
    if (buf.trim()) out.push(buf);
    return out;
  }

  /**
   * ترجمة نص طويل: تقسيم لمقاطع + تنفيذ بالتسلسل + تخزين في المتصفح.
   * ترجع '' لو فشلت كليًا (حصة يومية، انقطاع، ...).
   */
  function translateLong(text, from, to, cap) {
    text = String(text || '').trim();
    if (!text) return Promise.resolve('');
    if (cap && text.length > cap) text = text.slice(0, cap);

    var key = from + '>' + to + ':L' + hash(text);
    var disk = diskCache();
    if (disk[key]) return Promise.resolve(disk[key]);

    var parts = pack(sentences(text), CHUNK);
    var done = [];

    return parts.reduce(function (chain, part) {
      return chain.then(function () {
        return translate(part, from, to).then(function (t) { done.push(t || ''); });
      });
    }, Promise.resolve()).then(function () {
      if (!done.filter(Boolean).length) return '';
      var joined = done.join(' ').replace(/[ \t]+/g, ' ').trim();
      cachePut(key, joined);
      return joined;
    });
  }

  /* يرجّع النسخة الإنجليزية من الاستعلام (أو نفسه لو كان إنجليزي) */
  function toEnglish(query) {
    if (!CS.util.isArabic(query)) return Promise.resolve(query);
    return translate(query, 'ar', 'en').then(function (en) { return en || ''; });
  }

  /* يرجّع النسخة العربية من نص إنجليزي */
  function toArabic(text, cap) {
    if (!text || CS.util.isArabic(text)) return Promise.resolve('');
    return translateLong(text, 'en', 'ar', cap || 3000);
  }

  CS.wiki = {
    findWorks: findWorks,
    fullPlot: fullPlot,
    translate: translate,
    translateLong: translateLong,
    toEnglish: toEnglish,
    toArabic: toArabic
  };

})(window.CS);
