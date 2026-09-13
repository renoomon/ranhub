/* ============================================================
   links.js — بناء روابط مواقع الأفلام والمسلسلات الخارجية
   يستخدم المعرّف المباشر لو توفّر، وإلا رابط بحث جاهز.
   ============================================================ */

(function (CS) {
  'use strict';

  function enc(s) { return encodeURIComponent(String(s || '').trim()); }

  /* ------------------------------------------------------------
     تفضيلات المشاهدة.

     كن صريحًا: هذا الموقع دليل لا مشغّل — ما فيه فيديو يُشغَّل هنا
     عشان نضبط جودته أو صوته. المصادر المجانية تعطي بيانات الأعمال
     لا ملفاتها. فاللي نقدر نسويه فعلًا: نحمل تفضيلاتك إلى الروابط
     اللي نفتحها لك (بحث بالجودة واللغة)، والتطبيقات اللي تفتحها
     تتكفّل بالباقي.
     ------------------------------------------------------------ */
  var PREF_DEFAULT = { quality: '', subs: 'ar', audio: 'original' };

  function prefs() {
    var p = CS.store.get(CS.KEYS.viewPrefs, null);
    if (!p || typeof p !== 'object') return Object.assign({}, PREF_DEFAULT);
    return Object.assign({}, PREF_DEFAULT, p);
  }

  function setPrefs(patch) {
    var p = Object.assign(prefs(), patch || {});
    CS.store.set(CS.KEYS.viewPrefs, p);
    return p;
  }

  /* كلمات التفضيل اللي تُضاف لاستعلامات البحث الخارجية */
  function prefTerms() {
    var p = prefs();
    var bits = [];
    if (p.quality) bits.push(p.quality);
    if (p.subs === 'ar') bits.push('مترجم');
    else if (p.subs === 'en') bits.push('english subtitles');
    if (p.audio === 'dubbed') bits.push('مدبلج');
    return bits.join(' ');
  }

  /* ------------------------------------------------------------
     Nuvio — رابط يفتح التطبيق المثبَّت مباشرة لا صفحة ويب.
     الصيغة من DeepLinkParser في مستودع Nuvio نفسه:
       nuvio://meta?type=movie|series&id=tt…      ← معرّف IMDb
       nuvio://meta?type=movie|series&tmdb=123    ← معرّف TMDB
     النوع عنده كلمتان فقط: movie و series.
     ------------------------------------------------------------ */
  function nuvio(item) {
    var it = item || {};
    var type = it.type === 'tv' ? 'series' : 'movie';
    if (it.imdbId) return 'nuvio://meta?type=' + type + '&id=' + enc(it.imdbId);
    if (it.source === 'tmdb' && it.id) return 'nuvio://meta?type=' + type + '&tmdb=' + enc(it.id);
    /* بلا معرّف ما فيه رابط عميق صحيح — نفتح التطبيق على البحث */
    return 'nuvio://search?query=' + enc(it.originalTitle || it.title || '');
  }

  /**
   * item المتوقع:
   * { type, id, title, originalTitle, year, imdbId, tvdbId, wikiUrl, homepage, providersLink }
   */
  function build(item) {
    var it = item || {};
    var name = it.originalTitle || it.title || '';
    var q = name + (it.year ? ' ' + it.year : '');
    var isMovie = it.type !== 'tv';
    var links = [];
    var wd = it.wd || {};   /* معرّفات جاءت من ويكي داتا ← روابط مباشرة بدل بحث */

    function add(label, url, color, exact) {
      if (url) links.push({ label: label, url: url, color: color, exact: !!exact });
    }

    /* ---------- تطبيق المشاهدة المثبَّت ---------- */

    add('Nuvio', nuvio(it), '#22d3ee', !!(it.imdbId || (it.source === 'tmdb' && it.id)));

    /* ---------- قواعد البيانات الأساسية ---------- */

    add('IMDb',
      it.imdbId
        ? 'https://www.imdb.com/title/' + enc(it.imdbId) + '/'
        : 'https://www.imdb.com/find/?q=' + enc(q) + '&s=tt',
      '#f5c518', !!it.imdbId);

    add('TMDB',
      it.source === 'tmdb' && it.id
        ? 'https://www.themoviedb.org/' + (isMovie ? 'movie' : 'tv') + '/' + it.id
        : 'https://www.themoviedb.org/search?query=' + enc(q),
      '#01b4e4', it.source === 'tmdb');

    if (isMovie) {
      add('Letterboxd',
        wd.letterboxd
          ? 'https://letterboxd.com/film/' + enc(wd.letterboxd) + '/'
          : it.imdbId
            ? 'https://letterboxd.com/imdb/' + enc(it.imdbId) + '/'
            : 'https://letterboxd.com/search/films/' + enc(q) + '/',
        '#00e054', !!(wd.letterboxd || it.imdbId));

      add('Box Office Mojo',
        it.imdbId
          ? 'https://www.boxofficemojo.com/title/' + enc(it.imdbId) + '/'
          : 'https://www.boxofficemojo.com/search/?q=' + enc(name),
        '#c9a227', !!it.imdbId);
    } else {
      add('TheTVDB',
        it.tvdbId
          ? 'https://thetvdb.com/dereferrer/series/' + enc(it.tvdbId)
          : 'https://thetvdb.com/search?query=' + enc(q),
        '#6cd591', !!it.tvdbId);

      add('TVmaze',
        'https://www.tvmaze.com/search?q=' + enc(name), '#3c948b');
    }

    add('Rotten Tomatoes',
      wd.rotten
        ? 'https://www.rottentomatoes.com/' + String(wd.rotten).replace(/^\/+/, '')
        : 'https://www.rottentomatoes.com/search?search=' + enc(name),
      '#fa320a', !!wd.rotten);

    add('Metacritic',
      wd.metacritic
        ? 'https://www.metacritic.com/' + String(wd.metacritic).replace(/^\/+/, '')
        : 'https://www.metacritic.com/search/' + enc(name) + '/',
      '#ffcc33', !!wd.metacritic);

    add('Trakt',
      /* P8013 يجي ومعه البادئة (movies/… أو shows/…) وP12492 رقم مجرّد — نتعامل مع الشكلين */
      wd.trakt
        ? 'https://trakt.tv/' + (String(wd.trakt).indexOf('/') !== -1
            ? String(wd.trakt).split('/').map(enc).join('/')
            : (isMovie ? 'movies/' : 'shows/') + enc(wd.trakt))
        : 'https://trakt.tv/search?query=' + enc(name),
      '#ed1c24', !!wd.trakt);

    add('Simkl',
      'https://simkl.com/search/?q=' + enc(name), '#6f42c1');

    add('MyAnimeList',
      wd.mal
        ? 'https://myanimelist.net/anime/' + enc(wd.mal)
        : 'https://myanimelist.net/search/all?q=' + enc(name),
      '#2e51a2', !!wd.mal);

    /* ---------- وين تشوفه ---------- */

    add('JustWatch',
      it.providersLink || ('https://www.justwatch.com/' + (CS.state.region || 'sa').toLowerCase() + '/search?q=' + enc(name)),
      '#ffdc00', !!it.providersLink);

    add('Netflix',     'https://www.netflix.com/search?q=' + enc(name), '#e50914');
    add('Prime Video', 'https://www.primevideo.com/search/ref=atv_nb_sug?phrase=' + enc(name), '#00a8e1');
    add('Disney+',     'https://www.disneyplus.com/search?q=' + enc(name), '#1f6fd0');
    add('Apple TV',    'https://tv.apple.com/search?term=' + enc(name), '#b8b8bd');
    add('شاهد',        'https://shahid.mbc.net/ar/search?q=' + enc(name), '#00a3a1');
    add('OSN+',        'https://stream.osn.com/en/search?q=' + enc(name), '#8a1f2c');

    /* ---------- عربي وموسوعات ---------- */

    add('elCinema',
      'https://elcinema.com/search/?q=' + enc(name), '#e8b100');

    add('ويكيبيديا',
      it.wikiUrl || ('https://ar.wikipedia.org/w/index.php?search=' + enc(q) + '&ns0=1'),
      '#cccccc', !!it.wikiUrl);

    add('Wikidata',
      'https://www.wikidata.org/w/index.php?search=' + enc(name), '#339966');

    /* كتالوج مجاني: أفلام محفوظة للعامة على Internet Archive */
    add('Internet Archive',
      'https://archive.org/search?query=' + enc(name + (it.year ? ' ' + it.year : '')) + '&and[]=mediatype%3A%22movies%22',
      '#6b7280');

    /* ---------- مشاهدة وبحث ---------- */

    /* ستريميو: التطبيق يلتقط stremio:// والويب بديل مضمون */
    add('Stremio',
      'https://web.stremio.com/#/search?search=' + enc(name), '#7b5bf5');

    /* Yandex: الاسم + السنة + online، ومعها تفضيلات مشاهدتك */
    var pt = prefTerms();
    add('Yandex',
      'https://yandex.com/search/?text=' + enc(name + ' ' + (it.year || '') + ' online' + (pt ? ' ' + pt : '')),
      '#fc3f1d');

    /* ---------- بحث عام ---------- */

    if (it.homepage) add('الموقع الرسمي', it.homepage, '#e6b455', true);

    add('بحث Google',
      'https://www.google.com/search?q=' + enc(q + (isMovie ? ' فيلم' : ' مسلسل') + (pt ? ' ' + pt : '')),
      '#4285f4');

    return links;
  }

  /* روابط مختصرة للبطاقات في الشبكة */
  function quick(item) {
    return build(item).filter(function (l) {
      return ['IMDb', 'TMDB', 'JustWatch'].indexOf(l.label) !== -1;
    });
  }

  CS.links = { build: build, quick: quick, nuvio: nuvio,
               prefs: prefs, setPrefs: setPrefs, prefTerms: prefTerms };

})(window.CS);
