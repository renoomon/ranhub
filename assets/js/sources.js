/* ============================================================
   sources.js — مصادر بيانات إضافية غير TMDB وويكيبيديا
   • TVmaze  : مجاني تمامًا بدون مفتاح — حلقات ومواعيد المسلسلات
   • OMDb    : تقييمات IMDb وروتن توميتوز وميتاكريتك — يحتاج مفتاح مجاني
   • Wikidata: مجاني ومفتوح — معرّفات المواقع الأخرى (روابط مباشرة)
   كلها اختيارية: لو فشل أي مصدر، الصفحة تكمل عادي بدونه.
   ============================================================ */

(function (CS) {
  'use strict';

  var cache = {};

  function getJSON(url) {
    if (cache[url] !== undefined) return Promise.resolve(cache[url]);
    return fetch(url)
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { cache[url] = j; return j; })
      .catch(function () { cache[url] = null; return null; });
  }

  /* ============================================================
     TVmaze — بدون مفتاح
     ============================================================ */

  var tvmaze = {
    /* البحث بمعرّف IMDb أدق بكثير من البحث بالاسم */
    byImdb: function (imdbId) {
      if (!imdbId) return Promise.resolve(null);
      return getJSON('https://api.tvmaze.com/lookup/shows?imdb=' + encodeURIComponent(imdbId));
    },

    byName: function (name) {
      if (!name) return Promise.resolve(null);
      return getJSON('https://api.tvmaze.com/singlesearch/shows?q=' + encodeURIComponent(name));
    },

    /* الحلقة القادمة والسابقة + الجدول */
    show: function (item) {
      var job = item.imdbId
        ? tvmaze.byImdb(item.imdbId).then(function (s) { return s || tvmaze.byName(item.originalTitle || item.title); })
        : tvmaze.byName(item.originalTitle || item.title);

      return job.then(function (show) {
        if (!show || !show.id) return null;
        return getJSON('https://api.tvmaze.com/shows/' + show.id + '?embed[]=nextepisode&embed[]=previousepisode')
          .then(function (full) {
            var s = full || show;
            var emb = (s._embedded || {});
            return {
              id: s.id,
              url: s.url || '',
              status: s.status || '',
              schedule: s.schedule && s.schedule.days && s.schedule.days.length
                ? s.schedule.days.join('، ') + (s.schedule.time ? ' · ' + s.schedule.time : '')
                : '',
              network: (s.network || s.webChannel || {}).name || '',
              runtime: s.averageRuntime || s.runtime || 0,
              rating: (s.rating || {}).average || 0,
              next: ep(emb.nextepisode),
              prev: ep(emb.previousepisode)
            };
          });
      }).catch(function () { return null; });
    }
  };

  function ep(e) {
    if (!e) return null;
    return {
      name: e.name || '',
      season: e.season, number: e.number,
      airdate: e.airdate || '',
      url: e.url || ''
    };
  }

  /* ============================================================
     OMDb — يحتاج مفتاح مجاني (١٠٠٠ طلب باليوم)
     ============================================================ */

  var omdb = {
    /* المفتاح صار يجي من قائمة مصادر البيانات الموحّدة — والخانة القديمة احتياط */
    key: function () {
      var fromList = CS.dataSources && CS.dataSources.keyFor ? CS.dataSources.keyFor('omdb') : '';
      return fromList || CS.store.get(CS.KEYS.omdbKey, '') || '';
    },

    byImdb: function (imdbId) {
      var k = omdb.key();
      if (!k || !imdbId) return Promise.resolve(null);
      return getJSON('https://www.omdbapi.com/?apikey=' + encodeURIComponent(k) +
                     '&i=' + encodeURIComponent(imdbId) + '&plot=short')
        .then(function (j) {
          if (!j || j.Response === 'False') return null;
          var scores = {};
          (j.Ratings || []).forEach(function (r) { scores[r.Source] = r.Value; });
          return {
            imdb: j.imdbRating && j.imdbRating !== 'N/A' ? j.imdbRating : '',
            imdbVotes: j.imdbVotes && j.imdbVotes !== 'N/A' ? j.imdbVotes : '',
            rotten: scores['Rotten Tomatoes'] || '',
            metacritic: j.Metascore && j.Metascore !== 'N/A' ? j.Metascore : '',
            rated: j.Rated && j.Rated !== 'N/A' ? j.Rated : '',
            awards: j.Awards && j.Awards !== 'N/A' ? j.Awards : '',
            boxOffice: j.BoxOffice && j.BoxOffice !== 'N/A' ? j.BoxOffice : '',
            runtime: j.Runtime && j.Runtime !== 'N/A' ? j.Runtime : ''
          };
        });
    }
  };

  /* ============================================================
     Wikidata — مجاني ومفتوح، يعطينا معرّفات المواقع الأخرى
     ============================================================ */

  /* تصحيح: P5786 هو معرّف Moviepilot.de لا Trakt — كان يولّد روابط Trakt مكسورة.
     Trakt الصحيح: P8013 (فيه بادئة movies/ أو shows/) وP12492 (رقم مجرّد).
     وP4947 للأفلام فقط، فالمسلسلات تحتاج P4983. */
  var WD_PROPS = {
    P345:  'imdb',        P1258: 'rotten',    P1712: 'metacritic',
    P6127: 'letterboxd',  P4947: 'tmdb',      P4983: 'tmdbTv',
    P4835: 'tvdb',        P8013: 'trakt',     P12492: 'traktNum',
    P1874: 'netflix',     P11460: 'simkl',    P4086: 'mal'
  };

  var wikidata = {
    byImdb: function (imdbId) {
      if (!imdbId) return Promise.resolve(null);
      var sparql =
        'SELECT ?p ?v WHERE { ?item wdt:P345 "' + imdbId.replace(/["\\]/g, '') + '" . ' +
        '?item ?prop ?v . ?prop wikibase:directClaim ?p . ' +
        'VALUES ?p { ' + Object.keys(WD_PROPS).map(function (p) { return 'wdt:' + p; }).join(' ') + ' } } LIMIT 40';

      var url = 'https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(sparql);
      return getJSON(url).then(function (j) {
        var rows = ((j || {}).results || {}).bindings || [];
        if (!rows.length) return null;
        var out = {};
        rows.forEach(function (r) {
          var pid = String(r.p.value).split('/').pop();
          var name = WD_PROPS[pid];
          if (name && !out[name]) out[name] = r.v.value;
        });
        /* P4947 أفلام فقط — المسلسل ياخذ معرّفه من P4983 */
        if (!out.tmdb && out.tmdbTv) out.tmdb = out.tmdbTv;
        if (!out.trakt && out.traktNum) out.trakt = out.traktNum;
        return Object.keys(out).length ? out : null;
      }).catch(function () { return null; });
    }
  };

  /* ============================================================
     تجميع كل المصادر لعمل واحد
     ============================================================ */

  function enrich(item) {
    var jobs = [
      item.type === 'tv' ? tvmaze.show(item) : Promise.resolve(null),
      omdb.byImdb(item.imdbId),
      wikidata.byImdb(item.imdbId)
    ];
    return Promise.all(jobs).then(function (r) {
      return { tvmaze: r[0], omdb: r[1], wikidata: r[2] };
    }).catch(function () { return {}; });
  }

  CS.sources = {
    tvmaze: tvmaze,
    omdb: omdb,
    wikidata: wikidata,
    enrich: enrich
  };

})(window.CS);
