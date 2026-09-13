/* ============================================================
   freecatalog.js — كتالوجات مجانية بلا مفاتيح
   TVmaze (مسلسلات) · Jikan/MyAnimeList (أنمي) · Internet Archive (أفلام)

   وظيفتها: توسيع الاكتشاف في البحث. لا تعرض نتائجها مباشرة —
   بوابة المحتوى تتحقق من TMDB وحده — بل تجيب أسماء الأعمال اللي
   فاتت بحث TMDB، ثم نطابقها مع TMDB فيدخل العمل بعد فحصه كأي
   عمل آخر، ببوستره ووسومه.

   كل نداء يمرّ من CS.contentSources: لو المستخدم أطفأ المصدر ما
   يُنادى أصلًا، ولو سقط ثلاث مرات يُكتم مؤقتًا ويكمّل الباقي.
   ============================================================ */

(function (CS) {
  'use strict';

  var TVMAZE  = 'https://api.tvmaze.com/search/shows?q=';
  var JIKAN   = 'https://api.jikan.moe/v4/anime?limit=6&q=';
  var ARCHIVE = 'https://archive.org/advancedsearch.php?output=json&rows=8&page=1' +
                '&fl%5B%5D=identifier&fl%5B%5D=title&fl%5B%5D=year&fl%5B%5D=description&q=';

  function get(url) {
    return CS.net.json(url, {
      headers: { Accept: 'application/json' },
      persist: true,
      ttl: 6 * 3600 * 1000,
      retries: 1
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
          provider: 'TVmaze', sourceId: 'tvmaze', type: 'tv',
          title: s.name || '', year: yearOf(s.premiered),
          overview: clean(s.summary).slice(0, 240),
          poster: img.medium || img.original || ''
        };
      });
    });
  }

  /* ---------- Jikan: أنمي (MyAnimeList) ---------- */
  function jikan(q) {
    return get(JIKAN + encodeURIComponent(q)).then(function (j) {
      return (j && j.data ? j.data : []).slice(0, 6).map(function (a) {
        var img = a.images && a.images.jpg ? a.images.jpg : {};
        return {
          provider: 'MyAnimeList', sourceId: 'jikan', type: 'tv',
          title: a.title_english || a.title || '', year: yearOf(a.aired && a.aired.from),
          overview: clean(a.synopsis).slice(0, 240),
          poster: img.image_url || ''
        };
      });
    });
  }

  /* ---------- Internet Archive: أفلام مجانية ---------- */
  function archive(q) {
    var term = 'title:(' + String(q).replace(/[()"]/g, ' ') + ') AND mediatype:movies';
    return get(ARCHIVE + encodeURIComponent(term)).then(function (j) {
      var docs = (j && j.response ? j.response.docs : []) || [];
      return docs.slice(0, 6).map(function (d) {
        return {
          provider: 'Internet Archive', sourceId: 'archive', type: 'movie',
          title: clean(d.title), year: yearOf(d.year),
          overview: clean(Array.isArray(d.description) ? d.description[0] : d.description).slice(0, 240),
          poster: 'https://archive.org/services/img/' + encodeURIComponent(d.identifier || '')
        };
      });
    });
  }

  /* فحص سريع لزر «تحقق» في الإعدادات */
  function probe(which) {
    if (which === 'jikan') return jikan('love');
    if (which === 'archive') return archive('night');
    return tvmaze('night');
  }

  /**
   * أسماء أعمال من الكتالوجات المجانية — تُستعمل لاكتشاف ما فات TMDB.
   * المصادر المطفأة أو المكتومة تُتخطّى، والباقي يكمّل.
   */
  function findTitles(q) {
    var term = String(q || '').trim();
    if (term.length < 2) return Promise.resolve([]);

    return CS.contentSources.gather([
      { id: 'tvmaze',  run: function () { return tvmaze(term); } },
      { id: 'jikan',   run: function () { return jikan(term); } },
      { id: 'archive', run: function () { return archive(term); } }
    ]).then(function (res) {
      var out = [], seen = {};
      ['tvmaze', 'jikan', 'archive'].forEach(function (id) {
        (res.byId[id] || []).forEach(function (x) {
          if (!x || !x.title) return;
          var k = x.title.toLowerCase().replace(/[^a-z0-9؀-ۿ]+/g, '');
          if (!k || seen[k]) return;
          seen[k] = 1;
          out.push(x);
        });
      });
      return out.slice(0, 14);
    }).catch(function () { return []; });
  }

  CS.freeCatalog = {
    findTitles: findTitles,
    probe: probe,
    tvmaze: tvmaze,
    jikan: jikan,
    archive: archive,
    providers: ['TVmaze', 'MyAnimeList', 'Internet Archive']
  };

})(window.CS);
