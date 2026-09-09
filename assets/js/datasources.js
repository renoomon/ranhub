/* ============================================================
   datasources.js — مصادر البيانات اللي يضيفها المشغّل يدويًا

   تضيف المصدر باسمه ومفتاحه من الإعدادات، والموقع يناديه لكل
   عمل ويعرض اللي رجّعه تحت «بيانات إضافية» في صفحة العمل.
   ============================================================ */

(function (CS) {
  'use strict';

  /* ------------------------------------------------------------
     مزوّدون جاهزون — نعرف شكل ردّهم فنعرض حقولهم مترجمة
     كل واحد: رابط الفحص + رابط العمل + استخراج الحقول
     ------------------------------------------------------------ */

  var PRESETS = [
    {
      id: 'tmdb',
      name: 'TMDB',
      site: 'themoviedb.org',
      hint: 'قاعدة البيانات الأساسية — الأفلام والمسلسلات والبوسترات',
      keyLabel: 'مفتاح TMDB (v3)',
      needsKey: true,
      url:  'https://api.themoviedb.org/3/{type}/{tmdb}?api_key={key}&language=ar',
      test: 'https://api.themoviedb.org/3/movie/27205?api_key={key}',
      needs: ['tmdb'],
      pick: function (j) {
        return [
          ['التقييم', j.vote_average ? j.vote_average + ' / 10' : ''],
          ['عدد الأصوات', j.vote_count],
          ['الميزانية', j.budget ? '$' + Number(j.budget).toLocaleString('en-US') : ''],
          ['الإيرادات', j.revenue ? '$' + Number(j.revenue).toLocaleString('en-US') : ''],
          ['الحالة', j.status]
        ];
      }
    },
    {
      id: 'omdb',
      name: 'OMDb',
      site: 'omdbapi.com',
      hint: 'تقييم IMDb وروتن توميتوز وميتاكريتيك والجوائز',
      keyLabel: 'مفتاح OMDb',
      needsKey: true,
      url:  'https://www.omdbapi.com/?apikey={key}&i={imdb}',
      test: 'https://www.omdbapi.com/?apikey={key}&i=tt1375666',
      needs: ['imdb'],
      pick: function (j) {
        var rt = (j.Ratings || []).filter(function (r) { return /Rotten/i.test(r.Source); })[0];
        var mc = (j.Ratings || []).filter(function (r) { return /Metacritic/i.test(r.Source); })[0];
        return [
          ['تقييم IMDb', j.imdbRating && j.imdbRating !== 'N/A' ? j.imdbRating + ' / 10' : ''],
          ['أصوات IMDb', j.imdbVotes],
          ['روتن توميتوز', rt && rt.Value],
          ['ميتاكريتيك', mc && mc.Value],
          ['الجوائز', j.Awards && j.Awards !== 'N/A' ? j.Awards : ''],
          ['شبّاك التذاكر', j.BoxOffice && j.BoxOffice !== 'N/A' ? j.BoxOffice : '']
        ];
      },
      ok: function (j) { return j && j.Response === 'True'; },
      err: function (j) { return (j && j.Error) || 'المفتاح مرفوض'; }
    },
    {
      id: 'tvmaze',
      name: 'TVmaze',
      site: 'tvmaze.com',
      hint: 'مواعيد الحلقات والشبكة الناقلة — مسلسلات فقط، بلا مفتاح',
      needsKey: false,
      url:  'https://api.tvmaze.com/lookup/shows?imdb={imdb}',
      test: 'https://api.tvmaze.com/lookup/shows?imdb=tt0944947',
      needs: ['imdb'],
      only: 'tv',
      pick: function (j) {
        return [
          ['الشبكة', (j.network && j.network.name) || (j.webChannel && j.webChannel.name)],
          ['الحالة', j.status],
          ['التقييم', j.rating && j.rating.average ? j.rating.average + ' / 10' : ''],
          ['مدة الحلقة', j.averageRuntime ? j.averageRuntime + ' دقيقة' : ''],
          ['العرض الأول', j.premiered]
        ];
      }
    },
    {
      id: 'fanart',
      name: 'Fanart.tv',
      site: 'fanart.tv',
      hint: 'شعارات وخلفيات بدقة أعلى من TMDB — دعمه لـCORS غير موثّق، جرّب زر التحقق',
      keyLabel: 'مفتاح Fanart.tv',
      needsKey: true,
      url:  'https://webservice.fanart.tv/v3/movies/{tmdb}?api_key={key}',
      test: 'https://webservice.fanart.tv/v3/movies/27205?api_key={key}',
      needs: ['tmdb'],
      only: 'movie',
      pick: function (j) {
        /* الصور نفسها هي الفائدة، لا عددها — نمرّرها للواجهة */
        var logo = (j.hdmovielogo || j.movielogo || [])[0];
        var back = (j.moviebackground || [])[0];
        return [
          ['شعار العمل', logo && logo.url ? logo.url : ''],
          ['خلفية عالية الدقة', back && back.url ? back.url : '']
        ];
      },
      /* الواجهة تستفيد من الشعار مباشرة فوق البوستر */
      art: function (j) {
        var logo = (j.hdmovielogo || j.movielogo || [])[0];
        return { logo: logo && logo.url ? logo.url : '' };
      }
    },
    {
      id: 'trakt',
      name: 'Trakt',
      site: 'trakt.tv',
      hint: 'إحصاءات وتقييمات — لازم تسجّل نطاق موقعك في خانة JavaScript (CORS) origins بتطبيقك على Trakt',
      keyLabel: 'Trakt Client ID',
      needsKey: true,
      url:  'https://api.trakt.tv/movies/{imdb}?extended=full',
      test: 'https://api.trakt.tv/movies/tt1375666?extended=full',
      needs: ['imdb'],
      headers: function (key) {
        return { 'trakt-api-version': '2', 'trakt-api-key': key, 'content-type': 'application/json' };
      },
      pick: function (j) {
        return [
          ['تقييم Trakt', j.rating ? (Math.round(j.rating * 10) / 10) + ' / 10' : ''],
          ['عدد المقيّمين', j.votes],
          ['التصنيف العمري', j.certification],
          ['اللغة', j.language],
          ['الموقع الرسمي', j.homepage]
        ];
      }
    },
    {
      id: 'watchmode',
      name: 'Watchmode',
      site: 'watchmode.com',
      hint: 'وين يتوفّر العمل للمشاهدة — دعمه لـCORS غير مؤكّد، جرّب زر التحقق',
      keyLabel: 'مفتاح Watchmode',
      needsKey: true,
      url:  'https://api.watchmode.com/v1/title/{imdb}/sources/?apiKey={key}',
      test: 'https://api.watchmode.com/v1/title/tt1375666/sources/?apiKey={key}',
      needs: ['imdb'],
      pick: function (j) {
        var list = Array.isArray(j) ? j : [];
        var names = [];
        list.forEach(function (s) {
          if (s && s.name && names.indexOf(s.name) === -1) names.push(s.name);
        });
        return [['منصّات متاحة', names.slice(0, 12).join('، ')]];
      }
    },
    {
      id: 'mdblist',
      name: 'MDBList',
      site: 'mdblist.com',
      hint: 'تقييمات مجمّعة من ٧ مصادر بنداء واحد — IMDb وتريكت وليتربوكسد وتوميتوز وميتاكريتيك',
      keyLabel: 'مفتاح MDBList',
      needsKey: true,
      /* التوثيق يقول المفتاح معامل apikey. المسار الحديث أولًا،
         والقديم بديلًا لأن الخدمة تقبل الاثنين والفحص يحسم أيهما يرد. */
      url:  'https://api.mdblist.com/imdb/{mtype}/{imdb}?apikey={key}',
      alt:  'https://api.mdblist.com/?apikey={key}&i={imdb}',
      test: 'https://api.mdblist.com/imdb/movie/tt1375666?apikey={key}',
      needs: ['imdb'],
      pick: function (j) {
        var d = (j && j.response === false) ? {} : (j || {});
        /* الردّ يجي إما مصفوفة ratings فيها {source,value,score} أو حقولًا مسطّحة */
        var by = {};
        (d.ratings || []).forEach(function (r) {
          if (r && r.source) by[String(r.source).toLowerCase()] = r.value != null ? r.value : r.score;
        });
        function rate(k, suffix) {
          var v = by[k];
          return v == null || v === '' ? '' : v + (suffix || '');
        }
        return [
          ['تقييم IMDb', rate('imdb', ' / 10')],
          ['تريكت', rate('trakt', '٪')],
          ['ليتربوكسد', rate('letterboxd', ' / 5')],
          ['روتن توميتوز', rate('tomatoes', '٪')],
          ['ميتاكريتيك', rate('metacritic', '٪')],
          ['نقاد روجر إيبرت', rate('rogerebert', ' / 4')],
          ['التصنيف العمري', d.certification],
          ['المدة', d.runtime ? d.runtime + ' دقيقة' : '']
        ];
      },
      ok:  function (j) { return !!j && j.response !== false; },
      err: function (j) { return (j && (j.error || j.Error)) || 'المفتاح مرفوض'; }
    },
    {
      id: 'simkl',
      name: 'Simkl',
      site: 'simkl.com',
      hint: 'ملخّص كامل بنداء واحد — تقييمات وتصنيف ومخرج',
      keyLabel: 'Simkl Client ID',
      needsKey: true,
      /* المعرّف يقبل رقم IMDb مباشرة، فما نحتاج نداء بحث قبله */
      url:  'https://api.simkl.com/{types}/{imdb}?extended=full&client_id={key}',
      test: 'https://api.simkl.com/movies/tt1375666?extended=full&client_id={key}',
      needs: ['imdb'],
      pick: function (j) {
        var r = j.ratings || {};
        return [
          ['تقييم Simkl', r.simkl && r.simkl.rating ? r.simkl.rating + ' / 10' : ''],
          ['تقييم IMDb',  r.imdb && r.imdb.rating ? r.imdb.rating + ' / 10' : ''],
          ['التصنيف العمري', j.certification],
          ['المدة', j.runtime ? j.runtime + ' دقيقة' : ''],
          ['البلد', j.country]
        ];
      }
    },
    {
      id: 'tvdb',
      name: 'TheTVDB',
      site: 'thetvdb.com',
      hint: 'قاعدة مسلسلات مفصّلة — تحذير: ما يرسل ترويسات CORS فغالبًا يفشل من المتصفح',
      keyLabel: 'توكن TheTVDB v4',
      needsKey: true,
      url:  'https://api4.thetvdb.com/v4/search/remoteid/{imdb}',
      test: 'https://api4.thetvdb.com/v4/search/remoteid/tt0944947',
      needs: ['imdb'],
      headers: function (key) { return { Authorization: 'Bearer ' + key, accept: 'application/json' }; },
      pick: function (j) {
        var d = (j.data && j.data[0]) || {};
        var s = d.series || d.movie || {};
        return [
          ['الاسم', s.name],
          ['الحالة', s.status && s.status.name],
          ['سنة البداية', s.firstAired],
          ['البلد', s.originalCountry]
        ];
      }
    }
  ];

  function preset(id) {
    for (var i = 0; i < PRESETS.length; i++) if (PRESETS[i].id === id) return PRESETS[i];
    return null;
  }

  /* ------------------------------------------------------------
     التخزين
     ------------------------------------------------------------ */

  function all() {
    var list = CS.store.get(CS.KEYS.dataSources, []);
    return Array.isArray(list) ? list : [];
  }

  function save(list) {
    CS.store.set(CS.KEYS.dataSources, list.slice(0, 30));
    return list;
  }

  function byId(id) {
    return all().filter(function (d) { return d.id === id; })[0] || null;
  }

  /* يستنتج اسم المزوّد من رابط الـAPI */
  function nameFromUrl(url) {
    try {
      var h = new URL(String(url).replace(/\{[^}]*\}/g, 'x')).hostname.replace(/^www\./, '');
      /* api.trakt.tv ← trakt.tv · webservice.fanart.tv ← fanart.tv */
      var parts = h.split('.');
      if (parts.length > 2 && /^(api\d*|webservice|service|data|rest)$/i.test(parts[0])) parts.shift();
      return parts.join('.');
    } catch (e) { return ''; }
  }

  /* يستنتج المزوّد الجاهز من الرابط، فيصير الشرح والحقول مضبوطة تلقائيًا */
  function presetFromUrl(url) {
    var h = String(nameFromUrl(url)).toLowerCase();
    for (var i = 0; i < PRESETS.length; i++) {
      if (h && (h === PRESETS[i].site || h.indexOf(PRESETS[i].site) !== -1)) return PRESETS[i];
    }
    return null;
  }

  function add(src) {
    var p = src.preset ? preset(src.preset) : null;
    var url = String(src.url || (p && p.url) || '').trim();
    if (!url) throw new Error('NO_URL');
    if (!/^https?:\/\//i.test(url)) throw new Error('BAD_URL');

    var guess = p || presetFromUrl(url);

    var item = {
      id: 'd' + Date.now() + Math.floor(Math.random() * 1000),
      preset: p ? p.id : (guess ? guess.id : ''),
      name: String(src.name || '').trim() || (guess && guess.name) || nameFromUrl(url) || 'مصدر بيانات',
      url: url,
      key: String(src.key || '').trim(),
      enabled: true,
      status: null,
      addedAt: Date.now()
    };
    var list = all();
    list.push(item);
    save(list);
    return item;
  }

  function update(id, patch) {
    var list = all();
    list.forEach(function (d) { if (d.id === id) Object.keys(patch).forEach(function (k) { d[k] = patch[k]; }); });
    save(list);
  }

  function remove(id) {
    save(all().filter(function (d) { return d.id !== id; }));
  }

  /* ------------------------------------------------------------
     النداء
     ------------------------------------------------------------ */

  function fill(tpl, item, key) {
    var map = {
      '{key}':       encodeURIComponent(key || ''),
      '{imdb}':      item.imdbId || '',
      '{tmdb}':      item.source === 'tmdb' ? item.id : '',
      '{type}':      item.type === 'tv' ? 'tv' : 'movie',
      /* Simkl يستخدم movies/tv لا movie/tv */
      '{types}':     item.type === 'tv' ? 'tv' : 'movies',
      /* MDBList يستخدم show لا tv */
      '{mtype}':     item.type === 'tv' ? 'show' : 'movie',
      '{title}':     encodeURIComponent(item.originalTitle || item.title || ''),
      '{title_raw}': item.originalTitle || item.title || '',
      '{year}':      item.year || ''
    };
    return String(tpl).replace(/\{[a-z_]+\}/g, function (t) {
      return map[t] !== undefined ? String(map[t]) : t;
    });
  }

  /* هل ينفع نناديه لهذا العمل؟ */
  function missingFor(src, item) {
    var p = preset(src.preset);
    var need = [];
    if (/\{imdb\}/.test(src.url) && !item.imdbId) need.push('معرّف IMDb');
    if (/\{tmdb\}/.test(src.url) && item.source !== 'tmdb') need.push('معرّف TMDB');
    if (/\{key\}/.test(src.url) && !src.key) need.push('مفتاح API');
    if (p && p.only && p.only !== item.type) need.push(p.only === 'tv' ? 'عمل مسلسل' : 'عمل فيلم');
    return need;
  }

  function headersFor(src) {
    var p = preset(src.preset);
    if (p && p.headers) return p.headers(src.key);
    var h = { accept: 'application/json' };
    /* مفتاح مو موضوع في الرابط؟ نرسله كـBearer */
    if (src.key && !/\{key\}/.test(src.url)) h.Authorization = 'Bearer ' + src.key;
    return h;
  }

  /* ينادي المصدر لعمل معيّن ويرجّع صفوفًا جاهزة للعرض */
  function fetchFor(src, item) {
    var missing = missingFor(src, item);
    if (missing.length) return Promise.resolve({ ok: false, rows: [], detail: 'يحتاج ' + missing.join(' و') });

    var p0 = preset(src.preset);
    var url = fill(src.url, item, src.key);
    var alt = p0 && p0.alt ? fill(p0.alt, item, src.key) : '';

    return attempt(url, src, alt);
  }

  /* بعض الخدمات لها مساران للشي نفسه — نجرّب الثاني قبل ما نعلن الفشل */
  function attempt(url, src, alt) {
    return fetch(url, { headers: headersFor(src) })
      .then(function (r) {
        if (!r.ok) {
          if (alt) return attempt(alt, src, '');
          return { ok: false, rows: [], detail: 'رد بخطأ ' + r.status };
        }
        return r.json().then(function (j) {
          var p = preset(src.preset);
          if (p && p.ok && !p.ok(j)) {
            if (alt) return attempt(alt, src, '');
            return { ok: false, rows: [], detail: p.err ? p.err(j) : 'رد بلا بيانات' };
          }
          var rows = p && p.pick ? p.pick(j) : flatten(j);
          rows = (rows || []).filter(function (r2) {
            return r2 && r2[1] !== undefined && r2[1] !== null && String(r2[1]).trim() !== '' && String(r2[1]) !== '0';
          });
          /* بعض المزوّدين يعطون صورًا تستفيد منها الواجهة لا مجرد أرقام تُعرض */
          var art = p && p.art ? p.art(j) : null;
          return { ok: true, rows: rows, art: art,
                   detail: rows.length ? '' : 'رد بنجاح بلا حقول معروضة' };
        });
      })
      .catch(function (e) {
        if (alt) return attempt(alt, src, '');
        return { ok: false, rows: [], detail: netMsg(e) };
      });
  }

  /* مصدر مخصّص ما نعرف شكله: نسطّح أول حقول بسيطة ونعرضها كما هي */
  function flatten(j, prefix, out, depth) {
    out = out || []; depth = depth || 0;
    if (!j || typeof j !== 'object' || depth > 2 || out.length >= 12) return out;
    var src = Array.isArray(j) ? (j[0] || {}) : j;
    Object.keys(src).forEach(function (k) {
      if (out.length >= 12) return;
      var v = src[k];
      var label = (prefix ? prefix + '.' : '') + k;
      if (v === null || v === undefined || v === '') return;
      if (typeof v === 'object') { flatten(v, label, out, depth + 1); return; }
      if (typeof v === 'boolean') v = v ? 'نعم' : 'لا';
      out.push([label, String(v).slice(0, 160)]);
    });
    return out;
  }

  function netMsg(err) {
    var m = String((err && err.message) || err);
    return /Failed to fetch|NetworkError|Load failed/i.test(m)
      ? 'ما وصلت للخدمة — إما الشبكة تحجبها أو ما ترسل ترويسات CORS للمتصفح'
      : m;
  }

  /* ------------------------------------------------------------
     التحقق — كل مصدر يُفحص بطلبه الحقيقي
     ------------------------------------------------------------ */

  /* عمل تجريبي: فيلم للأغلب، ومسلسل للمصادر اللي مسلسلات فقط */
  var PROBE_MOVIE = { id: 27205, type: 'movie', title: 'Inception', originalTitle: 'Inception',
                      year: 2010, imdbId: 'tt1375666', source: 'tmdb' };
  var PROBE_TV    = { id: 1396, type: 'tv', title: 'Breaking Bad', originalTitle: 'Breaking Bad',
                      year: 2008, imdbId: 'tt0944947', source: 'tmdb' };

  function test(src) {
    var p = preset(src.preset);
    var probe = p && p.only === 'tv' ? PROBE_TV : PROBE_MOVIE;

    if (p && p.needsKey && !src.key) {
      return Promise.resolve(mark(src, false, 'ناقص المفتاح — ' + (p.keyLabel || 'مفتاح API')));
    }

    return fetchFor(src, probe).then(function (r) {
      if (!r.ok) return mark(src, false, r.detail || 'ما رجّع بيانات');
      if (!r.rows.length) return mark(src, false, r.detail || 'رد بنجاح لكن بلا حقول');
      var sample = r.rows.slice(0, 2).map(function (row) { return row[0] + ': ' + row[1]; }).join(' · ');
      return mark(src, true, 'شغّال — ' + sample);
    });
  }

  function mark(src, ok, detail) {
    var res = { ok: ok, detail: detail, at: Date.now() };
    if (src.id) update(src.id, { status: res });
    return res;
  }

  /* مفتاح مزوّد معيّن من القائمة — يستخدمه sources.js بدل الخانات الثابتة القديمة */
  function keyFor(presetId) {
    var hit = all().filter(function (d) { return d.enabled && d.preset === presetId && d.key; })[0];
    return hit ? hit.key : '';
  }

  /* هل المزوّد مضاف ومفعّل؟ */
  function isOn(presetId) {
    return all().some(function (d) { return d.enabled && d.preset === presetId; });
  }

  /* ينقل المفاتيح القديمة الثابتة إلى القائمة الموحّدة — مرة وحدة */
  function migrate(legacy) {
    var list = all();
    var added = 0;
    Object.keys(legacy).forEach(function (pid) {
      var key = legacy[pid];
      if (!key) return;
      if (list.some(function (d) { return d.preset === pid; })) return;
      var p = preset(pid);
      if (!p) return;
      list.push({
        id: 'd' + (Date.now() + added) + Math.floor(Math.random() * 1000),
        preset: pid, name: p.name, url: p.url, key: key,
        enabled: true, status: null, addedAt: Date.now()
      });
      added++;
    });
    if (added) save(list);
    return added;
  }

  CS.dataSources = {
    keyFor: keyFor,
    isOn: isOn,
    migrate: migrate,
    PRESETS: PRESETS,
    preset: preset,
    all: all,
    byId: byId,
    add: add,
    update: update,
    remove: remove,
    test: test,
    fetchFor: fetchFor,
    missingFor: missingFor,
    nameFromUrl: nameFromUrl,
    presetFromUrl: presetFromUrl
  };

})(window.CS);
