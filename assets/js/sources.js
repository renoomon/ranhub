/* ============================================================
   sources.js — مصادر بيانات إضافية غير TMDB
   • TVmaze  : مجاني تمامًا بدون مفتاح — حلقات ومواعيد المسلسلات
   • OMDb    : تقييمات IMDb وروتن توميتوز وميتاكريتك — يحتاج مفتاحًا مجانيًا
   • Wikidata: مجاني ومفتوح — معرّفات المواقع الأخرى (روابط مباشرة)

   كلها اختيارية ومربوطة بسجلّ CS.contentSources: المطفأ ما يُنادى،
   والساقط يُكتم مؤقتًا، والصفحة تكمل بدونه بلا أي خطأ في وجه المستخدم.
   ============================================================ */

(function (CS) {
  'use strict';

  function getJSON(url, ttl) {
    return CS.net.json(url, {
      headers: { accept: 'application/json' },
      persist: true,
      ttl: ttl || 12 * 3600 * 1000,
      retries: 1
    }).catch(function () { return null; });
  }

  /* ============================================================
     TVmaze — بدون مفتاح
     ============================================================ */

  var tvmaze = {
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
              url: CS.util.safeUrl(s.url || ''),
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
      url: CS.util.safeUrl(e.url || '')
    };
  }

  /* ============================================================
     OMDb — يحتاج مفتاحًا مجانيًا (١٠٠٠ طلب باليوم)
     ============================================================ */

  var omdb = {
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

  /* P5786 هو معرّف Moviepilot.de لا Trakt — كان يولّد روابط Trakt مكسورة.
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
        'SELECT ?p ?v WHERE { ?item wdt:P345 "' + String(imdbId).replace(/["\\]/g, '') + '" . ' +
        '?item ?prop ?v . ?prop wikibase:directClaim ?p . ' +
        'VALUES ?p { ' + Object.keys(WD_PROPS).map(function (p) { return 'wdt:' + p; }).join(' ') + ' } } LIMIT 40';

      var url = 'https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(sparql);
      return getJSON(url, 30 * 24 * 3600 * 1000).then(function (j) {
        var rows = ((j || {}).results || {}).bindings || [];
        if (!rows.length) return null;
        var out = {};
        rows.forEach(function (r) {
          var pid = String(r.p.value).split('/').pop();
          var name = WD_PROPS[pid];
          if (name && !out[name]) out[name] = r.v.value;
        });
        if (!out.tmdb && out.tmdbTv) out.tmdb = out.tmdbTv;
        if (!out.trakt && out.traktNum) out.trakt = out.traktNum;
        return Object.keys(out).length ? out : null;
      }).catch(function () { return null; });
    }
  };

  /* ============================================================
     تجميع كل المصادر لعمل واحد — كل مصدر عبر سجلّه
     ============================================================ */

  function enrich(item) {
    return CS.contentSources.gather([
      { id: 'tvmaze',   run: function () { return item.type === 'tv' ? tvmaze.show(item) : null; } },
      { id: 'omdb',     run: function () { return omdb.byImdb(item.imdbId); } },
      { id: 'wikidata', run: function () { return wikidata.byImdb(item.imdbId); } }
    ]).then(function (res) {
      return {
        tvmaze: res.byId.tvmaze || null,
        omdb: res.byId.omdb || null,
        wikidata: res.byId.wikidata || null,
        failed: res.failed,
        skipped: res.skipped
      };
    }).catch(function () { return {}; });
  }

  /**
   * nextEpisodeOf(item) — أقرب حلقة قادمة، من TMDB أولًا ثم TVmaze.
   * يخدم تنبيهات «نزلت حلقة جديدة» للأعمال المتابَعة.
   */
  function nextEpisodeOf(item) {
    if (!item || item.type !== 'tv') return Promise.resolve(null);

    return CS.contentSources.race([
      {
        id: 'tmdb',
        run: function () {
          return CS.tmdb.req('/tv/' + item.id, { append_to_response: '' }, { persist: false })
            .then(function (raw) {
              var nx = raw && raw.next_episode_to_air;
              var last = raw && raw.last_episode_to_air;
              var use = nx || last;
              if (!use) return null;
              return {
                stamp: 's' + use.season_number + 'e' + use.episode_number + '@' + (use.air_date || ''),
                label: 'م' + use.season_number + ' ح' + use.episode_number +
                       (use.air_date ? ' · ' + use.air_date : ''),
                upcoming: !!nx
              };
            });
        }
      },
      {
        id: 'tvmaze',
        run: function () {
          return tvmaze.show(item).then(function (s) {
            var use = s && (s.next || s.prev);
            if (!use) return null;
            return {
              stamp: 's' + use.season + 'e' + use.number + '@' + (use.airdate || ''),
              label: 'م' + use.season + ' ح' + use.number + (use.airdate ? ' · ' + use.airdate : ''),
              upcoming: !!(s && s.next)
            };
          });
        }
      }
    ]).then(function (r) { return r.value; });
  }

  CS.sources = {
    tvmaze: tvmaze,
    omdb: omdb,
    wikidata: wikidata,
    enrich: enrich,
    nextEpisodeOf: nextEpisodeOf
  };

})(window.CS);
