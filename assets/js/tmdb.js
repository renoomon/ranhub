/* ============================================================
   tmdb.js — عميل TMDB (يدعم مفتاح v3 وتوكن v4)
   ============================================================ */

(function (CS) {
  'use strict';

  var CFG = CS.config.tmdb;
  var cache = {};

  /* توكن v4 عبارة عن JWT فيه نقطتين وطويل، ومفتاح v3 هاش 32 خانة */
  function isV4(key) { return key.split('.').length === 3 && key.length > 100; }

  function langTag() { return CS.state.lang === 'ar' ? 'ar-SA' : 'en-US'; }

  function buildUrl(path, params) {
    var key = CS.state.apiKey || '';
    var qs = [];
    params = params || {};
    if (!('language' in params)) params.language = langTag();

    Object.keys(params).forEach(function (k) {
      var v = params[k];
      if (v === undefined || v === null || v === '') return;
      qs.push(encodeURIComponent(k) + '=' + encodeURIComponent(v));
    });
    if (key && !isV4(key)) qs.push('api_key=' + encodeURIComponent(key));

    return CFG.base + path + (qs.length ? '?' + qs.join('&') : '');
  }

  /* ---------- الطلب الأساسي ---------- */

  function req(path, params, opts) {
    opts = opts || {};
    if (!CS.hasKey()) return Promise.reject(new Error('NO_KEY'));

    var url = buildUrl(path, params);
    if (!opts.fresh && cache[url]) return Promise.resolve(cache[url]);

    var headers = { accept: 'application/json' };
    var key = CS.state.apiKey;
    if (isV4(key)) headers.Authorization = 'Bearer ' + key;

    return fetch(url, { headers: headers })
      .then(function (res) {
        if (res.status === 401) throw new Error('BAD_KEY');
        if (res.status === 429) throw new Error('RATE_LIMIT');
        if (!res.ok) throw new Error('HTTP_' + res.status);
        return res.json();
      })
      .then(function (json) {
        cache[url] = json;
        return json;
      });
  }

  /* ---------- الصور ---------- */

  function img(path, size) {
    if (!path) return '';
    return CFG.img + '/' + size + path;
  }

  /* ---------- توحيد شكل العنصر ---------- */

  function normalize(raw, forcedType) {
    if (!raw) return null;
    var type = forcedType || raw.media_type || (raw.first_air_date || raw.name ? 'tv' : 'movie');
    if (type !== 'movie' && type !== 'tv') return null;

    var date = raw.release_date || raw.first_air_date || '';
    var title = raw.title || raw.name || '';
    var original = raw.original_title || raw.original_name || '';

    return {
      id: raw.id,
      type: type,
      title: title || original || 'بدون عنوان',
      originalTitle: original && original !== title ? original : '',
      date: date,
      year: CS.util.year(date),
      poster: img(raw.poster_path, CFG.poster.md),
      posterLarge: img(raw.poster_path, CFG.poster.lg),
      backdrop: img(raw.backdrop_path, CFG.backdrop.lg),
      rating: raw.vote_average ? Math.round(raw.vote_average * 10) / 10 : 0,
      votes: raw.vote_count || 0,
      popularity: raw.popularity || 0,
      overview: raw.overview || '',
      genreIds: raw.genre_ids || (raw.genres || []).map(function (g) { return g.id; }),
      adult: raw.adult === true,
      source: 'tmdb'
    };
  }

  /* هل نسمح بالمحتوى الإباحي في نتائج TMDB؟ يتبع فلتر التصنيف */
  function allowAdult() {
    return !!(CS.certs && CS.certs.adultAllowed());
  }

  function normalizeList(list, forcedType) {
    return (list || [])
      .map(function (r) { return normalize(r, forcedType); })
      .filter(Boolean);
  }

  /* ---------- الأنواع (Genres) ---------- */

  function loadGenres() {
    if (!CS.hasKey()) return Promise.resolve();
    return Promise.all([
      req('/genre/movie/list').catch(function () { return { genres: [] }; }),
      req('/genre/tv/list').catch(function () { return { genres: [] }; })
    ]).then(function (res) {
      CS.state.genres.movie = {};
      CS.state.genres.tv = {};
      (res[0].genres || []).forEach(function (g) { CS.state.genres.movie[g.id] = g.name; });
      (res[1].genres || []).forEach(function (g) { CS.state.genres.tv[g.id] = g.name; });
    });
  }

  function genreNames(item) {
    var map = CS.state.genres[item.type] || {};
    return (item.genreIds || []).map(function (id) { return map[id]; }).filter(Boolean);
  }

  /* ---------- البحث ---------- */

  function searchMulti(query, page) {
    return req('/search/multi', {
      query: query, page: page || 1, include_adult: allowAdult()
    }).then(function (json) {
      /* الأعمال فقط — الأشخاص وملفاتهم ما يظهرون في النتائج */
      var items = normalizeList((json.results || []).filter(function (r) {
        return r.media_type !== 'person';
      }));
      return { items: items, total: json.total_results || 0, pages: json.total_pages || 1 };
    });
  }

  function searchByTitle(type, query, year) {
    var params = { query: query, include_adult: allowAdult(), page: 1 };
    if (year) params[type === 'movie' ? 'primary_release_year' : 'first_air_date_year'] = year;
    return req('/search/' + type, params)
      .then(function (json) { return normalizeList(json.results, type); })
      .catch(function () { return []; });
  }

  /* بحث بالاسم في اللغتين — أساسي للاستعلامات العربية */
  function searchTitleBoth(query) {
    return Promise.all([
      req('/search/movie', { query: query, include_adult: allowAdult(), page: 1 })
        .then(function (j) { return normalizeList(j.results, 'movie'); }).catch(function () { return []; }),
      req('/search/tv', { query: query, include_adult: allowAdult(), page: 1 })
        .then(function (j) { return normalizeList(j.results, 'tv'); }).catch(function () { return []; })
    ]).then(function (r) { return r[0].concat(r[1]); });
  }

  /* البحث بالكلمات المفتاحية: نحوّل الوصف لثيمات ثم نستكشف بها */
  function searchKeywords(query) {
    return req('/search/keyword', { query: query, page: 1, language: undefined })
      .then(function (json) { return json.results || []; })
      .catch(function () { return []; });
  }

  function discoverByKeywords(type, keywordIds, page) {
    return discover(type, { with_keywords: keywordIds.join('|') }, page);
  }

  /* استكشاف عام — يستخدمه صف «مختارة لك» وفلتر التصنيف */
  function discover(type, extra, page) {
    var params = {
      sort_by: 'popularity.desc',
      include_adult: allowAdult(),
      include_video: false,
      page: page || 1
    };
    /* حد الأصوات يرفع الجودة، لكن أعمال الكبار ما توصله أبدًا فنسقطه هناك */
    if (!allowAdult()) params['vote_count.gte'] = 30;
    Object.keys(extra || {}).forEach(function (k) {
      if (extra[k] !== undefined && extra[k] !== null && extra[k] !== '') params[k] = extra[k];
    });

    /* فلتر التصنيف العمري — TMDB يدعمه للأفلام فقط */
    var certParam = CS.certs && CS.certs.discoverCert && CS.certs.discoverCert(type);
    if (certParam) Object.keys(certParam).forEach(function (k) { params[k] = certParam[k]; });

    return req('/discover/' + type, params)
      .then(function (json) {
        var list = normalizeList(json.results, type);
        /* عدد الصفحات المتاح — الخلاصة تحتاجه عشان تقفز لصفحة
           عشوائية داخل المدى بدل ما تبدأ من الأولى كل مرة */
        list.totalPages = Math.min(json.total_pages || 1, 500);
        list.totalResults = json.total_results || 0;
        return list;
      })
      .catch(function () { var e = []; e.totalPages = 1; e.totalResults = 0; return e; });
  }

  /* ---------- التفاصيل ---------- */

  function details(type, id) {
    var appends = type === 'movie'
      ? 'credits,external_ids,similar,recommendations,keywords,translations,release_dates,watch/providers'
      : 'aggregate_credits,external_ids,similar,recommendations,keywords,translations,content_ratings,watch/providers';

    return req('/' + type + '/' + id, { append_to_response: appends })
      .then(function (raw) {
        var base = normalize(raw, type);
        if (!base) throw new Error('NOT_FOUND');

        base.tagline    = raw.tagline || '';
        base.runtime    = raw.runtime || (raw.episode_run_time || [])[0] || 0;
        base.status     = raw.status || '';
        base.homepage   = raw.homepage || '';
        base.budget     = raw.budget || 0;
        base.revenue    = raw.revenue || 0;
        base.genres     = (raw.genres || []).map(function (g) { return g.name; });
        base.countries  = (raw.production_countries || []).map(function (c) { return c.name; });
        base.companies  = (raw.production_companies || []).map(function (c) { return c.name; });
        base.languageOf = raw.original_language || '';
        base.imdbId     = raw.imdb_id || (raw.external_ids || {}).imdb_id || '';
        base.tvdbId     = (raw.external_ids || {}).tvdb_id || '';
        base.seasons    = raw.number_of_seasons || 0;
        base.episodes   = raw.number_of_episodes || 0;
        base.lastAir    = raw.last_air_date || '';
        base.creators   = (raw.created_by || []).map(function (c) { return c.name; });
        base.networks   = (raw.networks || []).map(function (n) { return n.name; });

        /* الطاقم */
        var credits = raw.credits || raw.aggregate_credits || {};
        base.cast = (credits.cast || []).slice(0, 16).map(function (c) {
          var role = c.character || ((c.roles || [])[0] || {}).character || '';
          return { id: c.id, name: c.name, role: role, photo: img(c.profile_path, CFG.profile) };
        });
        base.directors = (credits.crew || [])
          .filter(function (c) { return c.job === 'Director' || c.job === 'Series Director'; })
          .map(function (c) { return c.name; }).slice(0, 3);
        base.writers = (credits.crew || [])
          .filter(function (c) { return c.department === 'Writing'; })
          .map(function (c) { return c.name; }).slice(0, 3);

        /* منصات المشاهدة في المنطقة المختارة */
        var wp = (raw['watch/providers'] || {}).results || {};
        var region = wp[CS.state.region] || {};
        base.providers = {
          link: region.link || '',
          flatrate: (region.flatrate || []).map(provider),
          rent: (region.rent || []).map(provider),
          buy: (region.buy || []).map(provider)
        };

        /* الترجمات الرسمية: نفضّل ملخّص TMDB العربي على أي ترجمة آلية */
        var trs = ((raw.translations || {}).translations) || [];
        function pick(iso, preferRegions) {
          var list = trs.filter(function (t) {
            return t.iso_639_1 === iso && ((t.data || {}).overview || '').trim();
          });
          for (var i = 0; i < preferRegions.length; i++) {
            var hit = list.filter(function (t) { return t.iso_3166_1 === preferRegions[i]; })[0];
            if (hit) return hit.data;
          }
          return list.length ? list[0].data : null;
        }

        var arData = pick('ar', ['SA', 'AE', 'EG']);
        var enData = pick('en', ['US', 'GB']);

        base.arOverview = (arData || {}).overview || '';
        base.arTitle    = (arData || {}).title || (arData || {}).name || '';
        base.enOverview = (enData || {}).overview || '';

        base.keywords = ((raw.keywords || {}).keywords || (raw.keywords || {}).results || [])
          .map(function (k) { return { id: k.id, name: k.name }; });

        /* وسوم المحتوى الحسّي من الكلمات المفتاحية الحقيقية */
        if (CS.certs && CS.certs.heatOf) {
          base.descriptors = CS.certs.descriptorsOf(
            type === 'movie' ? raw.release_dates : raw.content_ratings, type);
          base.heat = CS.certs.heatOf(base.keywords, base.adult, base.descriptors);
          CS.certs.putHeat(base, base.heat);
        }

        /* التصنيف العمري — جاهز من نفس الطلب بلا نداء إضافي */
        var certInfo = CS.certs ? CS.certs.fromDetails(raw, type, base.adult) : null;
        if (certInfo) {
          base.certTier = certInfo.tier;
          base.cert = certInfo.cert;
          base.certCountry = certInfo.country;
          CS.certs.put(base, certInfo);
        }

        base.similar = normalizeList(((raw.similar || {}).results || []), type);
        base.recommendations = normalizeList(((raw.recommendations || {}).results || []), type);

        return base;
      });
  }

  function provider(p) {
    return { name: p.provider_name, logo: img(p.logo_path, CFG.logo) };
  }

  /* ---------- صفحات الاستكشاف ---------- */

  function trending(window_) {
    return req('/trending/all/' + (window_ || 'week'))
      .then(function (json) { return normalizeList(json.results); })
      .catch(function () { return []; });
  }

  function topRated(type) {
    return req('/' + type + '/top_rated', { page: 1 })
      .then(function (json) { return normalizeList(json.results, type); })
      .catch(function () { return []; });
  }

  function nowPlaying() {
    return req('/movie/now_playing', { page: 1, region: CS.state.region })
      .then(function (json) { return normalizeList(json.results, 'movie'); })
      .catch(function () { return []; });
  }

  function airingToday() {
    return req('/tv/on_the_air', { page: 1 })
      .then(function (json) { return normalizeList(json.results, 'tv'); })
      .catch(function () { return []; });
  }

  /* ---------- اختبار المفتاح ---------- */

  /* المشابهات/الترشيحات مع رقم الصفحة — عشان «اعرض المزيد» يشتغل */
  function relatedPage(type, id, kind, page) {
    return req('/' + type + '/' + id + '/' + kind, { page: page || 1 })
      .then(function (json) {
        return {
          items: normalizeList(json.results || [], type),
          page: json.page || 1,
          pages: json.total_pages || 1
        };
      })
      .catch(function () { return { items: [], page: 1, pages: 1 }; });
  }

  /* ---------- الأشخاص ---------- */

  function person(id) {
    return req('/person/' + id, { append_to_response: 'combined_credits,external_ids' })
      .then(function (raw) {
        var credits = ((raw.combined_credits || {}).cast || [])
          .map(function (c) { return normalize(c, c.media_type); })
          .filter(Boolean)
          .filter(function (c) { return c.poster; })
          .sort(function (a, b) { return (b.popularity || 0) - (a.popularity || 0); });

        var seen = {};
        credits = credits.filter(function (c) {
          var k = c.type + ':' + c.id;
          if (seen[k]) return false;
          seen[k] = true;
          return true;
        });

        return {
          id: raw.id,
          name: raw.name || '',
          photo: img(raw.profile_path, CFG.profile),
          job: raw.known_for_department || '',
          birthday: raw.birthday || '',
          place: raw.place_of_birth || '',
          bio: raw.biography || '',
          imdbId: (raw.external_ids || {}).imdb_id || '',
          works: credits
        };
      });
  }

  function testKey(key) {
    var prev = CS.state.apiKey;
    CS.state.apiKey = key;
    return req('/configuration', {}, { fresh: true })
      .then(function () { return true; })
      .catch(function (err) { CS.state.apiKey = prev; throw err; });
  }

  /**
   * فحص كامل للاتصال — يرجّع تقرير مفصّل بدل رمي خطأ.
   * { ok, key, steps:[{name, ok, detail}] }
   */
  function diagnose(key) {
    var prev = CS.state.apiKey;
    if (key) CS.state.apiKey = key;

    var steps = [];
    function run(name, path, params) {
      return req(path, params || {}, { fresh: true })
        .then(function (json) {
          steps.push({ name: name, ok: true, detail: describe(path, json) });
          return true;
        })
        .catch(function (err) {
          steps.push({ name: name, ok: false, detail: explain(err) });
          return false;
        });
    }

    return run('الاتصال والمفتاح', '/configuration')
      .then(function (ok) {
        if (!ok) return false;
        return run('البحث', '/search/movie', { query: 'inception', page: 1 });
      })
      .then(function (ok) {
        if (!ok) return false;
        return run('الرائج', '/trending/all/week');
      })
      .then(function () {
        if (key) CS.state.apiKey = prev;
        var allOk = steps.length > 0 && steps.every(function (s) { return s.ok; });
        return { ok: allOk, steps: steps };
      });
  }

  function describe(path, json) {
    if (path === '/configuration') return 'المفتاح مقبول من TMDB';
    var n = (json.results || []).length;
    return n ? 'رجعت ' + n + ' نتيجة' : 'اتصل بنجاح لكن بلا نتائج';
  }

  function explain(err) {
    var m = err && err.message || '';
    if (m === 'BAD_KEY')     return 'TMDB رفض المفتاح (401) — المفتاح غلط أو ملغى';
    if (m === 'RATE_LIMIT')  return 'تجاوزت حد الطلبات (429) — انتظر شوي';
    if (m === 'NO_KEY')      return 'ما فيه مفتاح مضبوط';
    if (/^HTTP_/.test(m))    return 'TMDB رد بخطأ ' + m.replace('HTTP_', '');
    if (/Failed to fetch|NetworkError|Load failed/i.test(m))
      return 'ما وصلت لـ TMDB إطلاقًا — إنترنت مقطوع، أو الشبكة/المزوّد حاجب api.themoviedb.org';
    return m || 'خطأ غير معروف';
  }

  CS.tmdb = {
    req: req,
    img: img,
    normalize: normalize,
    normalizeList: normalizeList,
    loadGenres: loadGenres,
    genreNames: genreNames,
    searchMulti: searchMulti,
    searchByTitle: searchByTitle,
    searchTitleBoth: searchTitleBoth,
    searchKeywords: searchKeywords,
    discoverByKeywords: discoverByKeywords,
    discover: discover,
    details: details,
    trending: trending,
    topRated: topRated,
    nowPlaying: nowPlaying,
    airingToday: airingToday,
    relatedPage: relatedPage,
    person: person,
    testKey: testKey,
    diagnose: diagnose,
    explain: explain
  };

})(window.CS);
