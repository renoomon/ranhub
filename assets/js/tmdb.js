/* ============================================================
   tmdb.js — عميل TMDB (يدعم مفتاح v3 وتوكن v4، ووسيطًا يخفيهما)

   كل الطلبات تمرّ من CS.net، فتأخذ منه: ذاكرة على القرص، منع
   التكرار الطائر، سقف معدّل، وتراجعًا أسّيًا عند 429.
   ============================================================ */

(function (CS) {
  'use strict';

  var CFG = CS.config.tmdb;

  /* توكن v4 عبارة عن JWT فيه نقطتين وطويل، ومفتاح v3 هاش 32 خانة */
  function isV4(key) { return String(key).split('.').length === 3 && String(key).length > 100; }

  function langTag() { return CS.state.lang === 'ar' ? 'ar-SA' : 'en-US'; }

  function buildUrl(path, params) {
    var proxy = CS.proxyBase();
    var base = proxy ? proxy + '/3' : CFG.base;
    var key = CS.state.apiKey || '';
    var qs = [];
    params = params || {};
    if (!('language' in params)) params.language = langTag();

    Object.keys(params).forEach(function (k) {
      var v = params[k];
      if (v === undefined || v === null || v === '') return;
      qs.push(encodeURIComponent(k) + '=' + encodeURIComponent(v));
    });
    /* مع الوسيط ما نرسل المفتاح إطلاقًا — هو عند الخادم */
    if (!proxy && key && !isV4(key)) qs.push('api_key=' + encodeURIComponent(key));

    return base + path + (qs.length ? '?' + qs.join('&') : '');
  }

  /* ---------- الطلب الأساسي ---------- */

  function req(path, params, opts) {
    opts = opts || {};
    if (!CS.hasKey()) return Promise.reject(new Error('NO_KEY'));

    var url = buildUrl(path, params);
    var headers = { accept: 'application/json' };
    var key = CS.state.apiKey;
    if (!CS.usingProxy() && isV4(key)) headers.Authorization = 'Bearer ' + key;

    return CS.net.json(url, {
      headers: headers,
      fresh: !!opts.fresh,
      persist: opts.persist !== undefined ? opts.persist : CS.net.shouldPersist(path),
      ttl: opts.ttl,
      retries: opts.retries
    }).catch(function (err) {
      /* نوحّد الرسائل عشان explain() يعرفها */
      var m = (err && err.message) || '';
      if (m === 'BAD_KEY' || m === 'RATE_LIMIT' || m === 'TIMEOUT' || /^HTTP_/.test(m)) throw err;
      throw err;
    });
  }

  /* ---------- الصور ---------- */

  function img(path, size) {
    if (!path) return '';
    return CFG.img + '/' + size + path;
  }

  /* نفس الصورة من المضيف البديل — الواجهة تجرّبه لو الأول سقط */
  function imgAlt(url) {
    if (!url) return '';
    return String(url).replace(CFG.img, CFG.imgAlt);
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
      posterPath: raw.poster_path || '',
      backdrop: img(raw.backdrop_path, CFG.backdrop.lg),
      rating: raw.vote_average ? Math.round(raw.vote_average * 10) / 10 : 0,
      votes: raw.vote_count || 0,
      popularity: raw.popularity || 0,
      overview: raw.overview || '',
      genreIds: raw.genre_ids || (raw.genres || []).map(function (g) { return g.id; }),
      originalLanguage: raw.original_language || '',
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
  function searchTitleBoth(query, page) {
    return Promise.all([
      req('/search/movie', { query: query, include_adult: allowAdult(), page: page || 1 })
        .then(function (j) { return normalizeList(j.results, 'movie'); }).catch(function () { return []; }),
      req('/search/tv', { query: query, include_adult: allowAdult(), page: page || 1 })
        .then(function (j) { return normalizeList(j.results, 'tv'); }).catch(function () { return []; })
    ]).then(function (r) { return r[0].concat(r[1]); });
  }

  /* البحث بالكلمات المفتاحية: نحوّل الوصف لثيمات ثم نستكشف بها */
  function searchKeywords(query) {
    return req('/search/keyword', { query: query, page: 1, language: undefined },
               { persist: true })
      .then(function (json) { return json.results || []; })
      .catch(function () { return []; });
  }

  function searchPeople(query) {
    return req('/search/person', { query: query, page: 1, include_adult: allowAdult() })
      .then(function (json) {
        return (json.results || []).map(function (p) {
          return { id: p.id, name: p.name, photo: img(p.profile_path, CFG.profile),
                   job: p.known_for_department || '' };
        });
      })
      .catch(function () { return []; });
  }

  function discoverByKeywords(type, keywordIds, page) {
    return discover(type, { with_keywords: keywordIds.join('|') }, page);
  }

  /* استكشاف عام — يستخدمه الاستكشاف والتصنيفات والتوصيات */
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
        list.totalPages = Math.min(json.total_pages || 1, 500);
        list.totalResults = json.total_results || 0;
        return list;
      })
      .catch(function (err) {
        var e = [];
        e.totalPages = 1; e.totalResults = 0; e.failed = (err && err.message) || 'ERR';
        e.failedHost = (err && err.host) || '';   /* عشان الرسالة تسمّي النطاق الصحيح */
        return e;
      });
  }

  /* ---------- التفاصيل ---------- */

  function details(type, id) {
    var appends = type === 'movie'
      ? 'credits,external_ids,similar,recommendations,keywords,translations,release_dates,watch/providers'
      : 'aggregate_credits,external_ids,similar,recommendations,keywords,translations,content_ratings,watch/providers';

    return req('/' + type + '/' + id, { append_to_response: appends }, { persist: true })
      .then(function (raw) {
        var base = normalize(raw, type);
        if (!base) throw new Error('NOT_FOUND');

        base.tagline    = raw.tagline || '';
        base.runtime    = raw.runtime || (raw.episode_run_time || [])[0] || 0;
        base.status     = raw.status || '';
        base.homepage   = CS.util.safeUrl(raw.homepage || '');
        base.budget     = raw.budget || 0;
        base.revenue    = raw.revenue || 0;
        base.genres     = (raw.genres || []).map(function (g) { return g.name; });
        base.countries  = (raw.production_countries || []).map(function (c) { return c.name; });
        base.countryCodes = (raw.production_countries || []).map(function (c) { return c.iso_3166_1; });
        base.companies  = (raw.production_companies || []).map(function (c) { return c.name; });
        base.languageOf = raw.original_language || '';
        base.imdbId     = raw.imdb_id || (raw.external_ids || {}).imdb_id || '';
        base.tvdbId     = (raw.external_ids || {}).tvdb_id || '';
        base.seasons    = raw.number_of_seasons || 0;
        base.episodes   = raw.number_of_episodes || 0;
        base.lastAir    = raw.last_air_date || '';
        base.creators   = (raw.created_by || []).map(function (c) { return c.name; });
        base.networks   = (raw.networks || []).map(function (n) { return n.name; });

        /* الحلقة القادمة — أساس تنبيه «نزل جديد» */
        var nx = raw.next_episode_to_air;
        base.nextEpisode = nx ? {
          season: nx.season_number, number: nx.episode_number,
          name: nx.name || '', airdate: nx.air_date || ''
        } : null;

        /* قائمة المواسم — للتنقّل بين المواسم والحلقات */
        base.seasonList = (raw.seasons || [])
          .filter(function (s) { return s && s.season_number != null; })
          .map(function (s) {
            return {
              number: s.season_number, name: s.name || ('الموسم ' + s.season_number),
              count: s.episode_count || 0, airdate: s.air_date || '',
              poster: img(s.poster_path, CFG.poster.sm), overview: s.overview || ''
            };
          });

        /* الطاقم */
        var credits = raw.credits || raw.aggregate_credits || {};
        base.cast = (credits.cast || []).slice(0, 18).map(function (c) {
          var role = c.character || ((c.roles || [])[0] || {}).character || '';
          return { id: c.id, name: c.name, role: role, photo: img(c.profile_path, CFG.profile) };
        });
        base.castIds = base.cast.map(function (c) { return c.id; });

        var crew = credits.crew || [];
        var dirRows = crew.filter(function (c) {
          return c.job === 'Director' || c.job === 'Series Director' ||
                 (c.jobs || []).some(function (j) { return j.job === 'Director'; });
        });
        base.directors = dirRows.map(function (c) { return c.name; }).slice(0, 3);
        base.directorIds = dirRows.map(function (c) { return c.id; }).slice(0, 3);
        base.writers = crew
          .filter(function (c) { return c.department === 'Writing'; })
          .map(function (c) { return c.name; }).slice(0, 3);

        /* منصات المشاهدة في المنطقة المختارة */
        var wp = (raw['watch/providers'] || {}).results || {};
        var region = wp[CS.state.region] || {};
        base.providers = {
          link: CS.util.safeUrl(region.link || ''),
          flatrate: (region.flatrate || []).map(provider),
          rent: (region.rent || []).map(provider),
          buy: (region.buy || []).map(provider)
        };
        base.providersLink = base.providers.link;

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

  /* حلقات موسم واحد */
  function season(type, id, number) {
    if (type !== 'tv') return Promise.resolve({ episodes: [] });
    return req('/tv/' + id + '/season/' + number, {}, { persist: true })
      .then(function (raw) {
        return {
          number: raw.season_number,
          name: raw.name || ('الموسم ' + raw.season_number),
          overview: raw.overview || '',
          episodes: (raw.episodes || []).map(function (e) {
            return {
              id: e.id, number: e.episode_number, season: e.season_number,
              name: e.name || ('الحلقة ' + e.episode_number),
              overview: e.overview || '',
              airdate: e.air_date || '',
              runtime: e.runtime || 0,
              rating: e.vote_average ? Math.round(e.vote_average * 10) / 10 : 0,
              still: img(e.still_path, CFG.still)
            };
          })
        };
      })
      .catch(function () { return { number: number, name: 'الموسم ' + number, episodes: [] }; });
  }

  function provider(p) {
    return { name: p.provider_name, logo: img(p.logo_path, CFG.logo) };
  }

  /* ---------- صفحات جاهزة ---------- */

  function trending(window_, page) {
    return req('/trending/all/' + (window_ || 'week'), { page: page || 1 })
      .then(function (json) { return normalizeList(json.results); })
      .catch(function () { return []; });
  }

  function topRated(type, page) {
    return req('/' + type + '/top_rated', { page: page || 1 })
      .then(function (json) { return normalizeList(json.results, type); })
      .catch(function () { return []; });
  }

  function nowPlaying(page) {
    return req('/movie/now_playing', { page: page || 1, region: CS.state.region })
      .then(function (json) { return normalizeList(json.results, 'movie'); })
      .catch(function () { return []; });
  }

  function airingToday(page) {
    return req('/tv/on_the_air', { page: page || 1 })
      .then(function (json) { return normalizeList(json.results, 'tv'); })
      .catch(function () { return []; });
  }

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
    return req('/person/' + id, { append_to_response: 'combined_credits,external_ids' },
               { persist: true })
      .then(function (raw) {
        var cc = raw.combined_credits || {};

        function take(list, asCrew) {
          return (list || [])
            .map(function (c) {
              var it = normalize(c, c.media_type);
              if (!it) return null;
              it.personRole = asCrew ? (c.job || '') : (c.character || '');
              it.asCrew = !!asCrew;
              return it;
            })
            .filter(Boolean)
            .filter(function (c) { return c.poster; });
        }

        /* المخرج يُعرف بأعماله كطاقم لا كممثل — الصفحة كانت تعرض
           التمثيل وحده فتطلع صفحة المخرج فاضية */
        var acting = take(cc.cast, false);
        var directing = take((cc.crew || []).filter(function (c) {
          return c.job === 'Director' || c.job === 'Series Director';
        }), true);

        var seen = {}, works = [];
        directing.concat(acting).forEach(function (c) {
          var k = c.type + ':' + c.id;
          if (seen[k]) return;
          seen[k] = true;
          works.push(c);
        });
        works.sort(function (a, b) { return (b.popularity || 0) - (a.popularity || 0); });

        return {
          id: raw.id,
          name: raw.name || '',
          photo: img(raw.profile_path, CFG.profile),
          job: raw.known_for_department || '',
          birthday: raw.birthday || '',
          deathday: raw.deathday || '',
          place: raw.place_of_birth || '',
          bio: raw.biography || '',
          imdbId: (raw.external_ids || {}).imdb_id || '',
          directedCount: directing.length,
          works: works
        };
      });
  }

  function testKey(key) {
    var prev = CS.state.apiKey;
    CS.state.apiKey = key;
    return req('/configuration', {}, { fresh: true, persist: false })
      .then(function () { return true; })
      .catch(function (err) { CS.state.apiKey = prev; throw err; });
  }

  /**
   * فحص كامل للاتصال — يرجّع تقريرًا مفصّلًا بدل رمي خطأ.
   */
  function diagnose(key) {
    var prev = CS.state.apiKey;
    if (key) CS.state.apiKey = key;

    var steps = [];
    function run(name, path, params) {
      return req(path, params || {}, { fresh: true, persist: false })
        .then(function (json) {
          steps.push({ name: name, ok: true, detail: describe(path, json) });
          return true;
        })
        .catch(function (err) {
          steps.push({ name: name, ok: false, detail: explain(err) });
          return false;
        });
    }

    return run(CS.usingProxy() ? 'الوسيط والاتصال' : 'الاتصال والمفتاح', '/configuration')
      .then(function (ok) {
        if (!ok) return false;
        return run('البحث', '/search/movie', { query: 'inception', page: 1 });
      })
      .then(function (ok) {
        if (!ok) return false;
        return run('الاستكشاف', '/discover/movie', { page: 1 });
      })
      .then(function () {
        if (key) CS.state.apiKey = prev;
        var allOk = steps.length > 0 && steps.every(function (s) { return s.ok; });
        return { ok: allOk, steps: steps };
      });
  }

  function describe(path, json) {
    if (path === '/configuration') return CS.usingProxy() ? 'الوسيط يرد والمفتاح عنده' : 'المفتاح مقبول من TMDB';
    var n = (json.results || []).length;
    return n ? 'رجعت ' + n + ' نتيجة' : 'اتصل بنجاح لكن بلا نتائج';
  }

  /* ------------------------------------------------------------
     شرح الخطأ.

     كل خطأ يحمل نطاقه من net.js، والرسالة تسمّي النطاق الحقيقي.
     نسبة خطأ مزوّد ثانوي (ترجمة · ويكيبيديا · أرشيف) إلى TMDB
     كانت ترسل المستخدم يفحص مفتاحه وهو سليم تمامًا.
     ------------------------------------------------------------ */
  function hostOfErr(err) {
    var h = err && err.host;
    if (!h) return '';
    try { return h === new URL(CS.config.tmdb.base).host ? 'TMDB' : h; }
    catch (e) { return h; }
  }

  function explain(err) {
    var m = err && err.message || '';
    var who = hostOfErr(err) || 'TMDB';   /* بلا نطاق: المسار الافتراضي هو TMDB */
    var isTmdb = who === 'TMDB';

    if (m === 'BAD_KEY')     return who + ' رفض المفتاح (401) — المفتاح غلط أو ملغى';
    if (m === 'RATE_LIMIT')  return 'تجاوزت حد طلبات ' + who + ' (429) — الموقع يتراجع تلقائيًا ويعيد المحاولة';
    if (m === 'NO_KEY')      return 'ما فيه مفتاح مضبوط ولا وسيط';
    if (m === 'TIMEOUT')     return 'الطلب إلى ' + who + ' تجاوز المهلة — الشبكة بطيئة أو محجوبة';
    if (m === 'SERVICE_DOWN') return who + ' ساقط الآن — الموقع أوقف الطلبات إليه مؤقتًا';
    if (m === 'ALL_SOURCES_FAILED') return 'كل المصادر البديلة سقطت';
    if (/^HTTP_/.test(m))    return who + ' رد بخطأ ' + m.replace('HTTP_', '');
    if (/Failed to fetch|NetworkError|Load failed/i.test(m))
      return isTmdb
        ? 'ما وصلت لـ TMDB إطلاقًا — إنترنت مقطوع، أو الشبكة/المزوّد حاجب api.themoviedb.org'
        : 'ما وصلت لـ ' + who + ' إطلاقًا — إنترنت مقطوع أو النطاق محجوب';
    return m || 'خطأ غير معروف';
  }

  CS.tmdb = {
    req: req,
    img: img,
    imgAlt: imgAlt,
    normalize: normalize,
    normalizeList: normalizeList,
    loadGenres: loadGenres,
    genreNames: genreNames,
    searchMulti: searchMulti,
    searchByTitle: searchByTitle,
    searchTitleBoth: searchTitleBoth,
    searchKeywords: searchKeywords,
    searchPeople: searchPeople,
    discoverByKeywords: discoverByKeywords,
    discover: discover,
    details: details,
    season: season,
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
