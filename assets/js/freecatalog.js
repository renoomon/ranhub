/* ============================================================
   freecatalog.js — كتالوجات مجانية بلا مفاتيح
   TVmaze (مسلسلات) · Jikan/MyAnimeList (أنمي) · Internet Archive (أفلام)

   وظيفتها: توسيع الاكتشاف في البحث. لا تعرض نتائجها مباشرة —
   بوابة المحتوى تتحقق من TMDB وحده — بل تجيب أسماء الأعمال اللي
   فاتت بحث TMDB، ثم نطابقها مع TMDB فيدخل العمل بعد فحصه كأي
   عمل آخر، ببوستره ووسومه. كل نداء فاشل يُتجاهل بهدوء.
   ============================================================ */

(function (CS) {
  'use strict';

  var TVMAZE = 'https://api.tvmaze.com/search/shows?q=';
  var JIKAN  = 'https://api.jikan.moe/v4/anime?limit=6&q=';
  var ARCHIVE = 'https://archive.org/advancedsearch.php?output=json&rows=8&page=1' +
                '&fl%5B%5D=identifier&fl%5B%5D=title&fl%5B%5D=year&fl%5B%5D=description&q=';

  function get(url) {
    return fetch(url, { headers: { Accept: 'application/json' } }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  function clean(s) {
    return String(s == null ? '' : s)
      .replace(/<[^>]*>/g, ' ')
      .replace(/&[a-z]+;/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function yearOf(v) {
    var m = String(v || '').match(/(18|19|20)\d{2}/);
    return m ? +m[0] : null;
  }

  /* ---------- TVmaze: مسلسلات ---------- */
  function tvmaze(q) {
    return get(TVMAZE + encodeURIComponent(q)).then(function (list) {
      return (list || []).slice(0, 6).map(function (row) {
        var s = row.show || {};
        var img = s.image || {};
        return {
          provider: 'TVmaze', type: 'tv',
          title: s.name || '', year: yearOf(s.premiered),
          overview: clean(s.summary).slice(0, 240),
          poster: img.medium || img.original || ''
        };
      });
    }).catch(function () { return []; });
  }

  /* ---------- Jikan: أنمي (MyAnimeList) ---------- */
  function jikan(q) {
    return get(JIKAN + encodeURIComponent(q)).then(function (j) {
      return (j && j.data ? j.data : []).slice(0, 6).map(function (a) {
        var img = a.images && a.images.jpg ? a.images.jpg : {};
        return {
          provider: 'MyAnimeList', type: 'tv',
          title: a.title_english || a.title || '', year: yearOf(a.aired && a.aired.from),
          overview: clean(a.synopsis).slice(0, 240),
          poster: img.image_url || ''
        };
      });
    }).catch(function () { return []; });
  }

  /* ---------- Internet Archive: أفلام مجانية ---------- */
  function archive(q) {
    var term = 'title:(' + String(q).replace(/[()"]/g, ' ') + ') AND mediatype:movies';
    return get(ARCHIVE + encodeURIComponent(term)).then(function (j) {
      var docs = (j && j.response ? j.response.docs : []) || [];
      return docs.slice(0, 6).map(function (d) {
        return {
          provider: 'Internet Archive', type: 'movie',
          title: clean(d.title), year: yearOf(d.year),
          overview: clean(Array.isArray(d.description) ? d.description[0] : d.description).slice(0, 240),
          poster: 'https://archive.org/services/img/' + encodeURIComponent(d.identifier || '')
        };
      });
    }).catch(function () { return []; });
  }

  /**
   * أسماء أعمال من الكتالوجات المجانية — تُستعمل لاكتشاف ما فات TMDB.
   * @param {string} q استعلام (الإنجليزي أفضل)
   * @returns {Promise<Array<{provider,type,title,year,overview,poster}>>}
   */
  function findTitles(q) {
    var term = String(q || '').trim();
    if (term.length < 2) return Promise.resolve([]);

    return Promise.all([tvmaze(term), jikan(term), archive(term)]).then(function (sets) {
      var out = [], seen = {};
      sets.forEach(function (list) {
        (list || []).forEach(function (x) {
          if (!x.title) return;
          var k = x.title.toLowerCase().replace(/[^a-z0-9\u0600-\u06ff]+/g, '');
          if (!k || seen[k]) return;
          seen[k] = 1;
          out.push(x);
        });
      });
      return out.slice(0, 12);
    });
  }

  CS.freeCatalog = {
    findTitles: findTitles,
    providers: ['TVmaze', 'MyAnimeList', 'Internet Archive']
  };

})(window.CS);
