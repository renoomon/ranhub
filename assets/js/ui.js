/* ============================================================
   ui.js — بناء الواجهة: البطاقات، صفحة العمل، الحلقات، المكتبة،
           صفحة الشخص، وصفحة الإعدادات.

   كل نص يمرّ من esc()، وكل صورة لها مسار بديل ثم بديل نصّي —
   فما فيه صورة مكسورة ولا حقن HTML من بيانات المصادر.
   ============================================================ */

(function (CS) {
  'use strict';

  var esc = CS.util.esc;
  var TYPE_AR = { movie: 'فيلم', tv: 'مسلسل' };

  /* البرامج الواقعية والحوارية مسلسلات عند TMDB، لكن تسميتها
     «مسلسل» على البطاقة كذب صغير — نفرّقها بنوعها السينمائي */
  var REALITY_GENRES = [10764, 10767];

  function typeLabel(item) {
    if (!item) return '';
    if (item.type === 'tv' && (item.genreIds || []).some(function (g) {
      return REALITY_GENRES.indexOf(g) !== -1;
    })) return 'برنامج';
    return TYPE_AR[item.type] || '';
  }
  var WHY_CLASS = { plot: 'is-plot', theme: 'is-theme', related: 'is-theme',
                    catalog: 'is-plot', person: 'is-person', title: '' };

  /* ---------- التوست ---------- */

  var toastTimer;
  function toast(msg) {
    var el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, 2800);
  }

  function skeletons(n) {
    var out = '';
    for (var i = 0; i < n; i++) {
      out += '<div class="skel" aria-hidden="true"><div class="skel__poster"></div>' +
             '<div class="skel__line"></div><div class="skel__line"></div></div>';
    }
    return out;
  }

  function skelRow(n) {
    var out = '';
    for (var i = 0; i < (n || 8); i++) {
      out += '<div class="skel skel--row" aria-hidden="true"><div class="skel__poster"></div>' +
             '<div class="skel__line"></div></div>';
    }
    return out;
  }

  /* شريط تحميل نصّي — يستعمله كل قسم غير متزامن */
  function loading(label) {
    return '<div class="loading" role="status"><span class="loading__dot"></span>' +
           '<span>' + esc(label || 'يحمّل…') + '</span></div>';
  }

  /* ---------- مفاتيح وعناصر ---------- */

  function itemKey(item) {
    if (item.source === 'wiki') {
      return 'w/' + (item.wikiLang || 'ar') + '/' + encodeURIComponent(item.wikiTitle || '');
    }
    return item.type + '/' + item.id;
  }

  /* ------------------------------------------------------------
     الصورة: المضيف الأصلي ← المضيف البديل ← بديل نصّي.
     المعالجة في app.js بمستمع واحد على مستوى الصفحة (بلا onerror
     داخل السمة)، فالبطاقة ما تطلع أبدًا بأيقونة صورة مكسورة.
     ------------------------------------------------------------ */
  function imgTag(url, alt, cls, extra) {
    if (!url) return '';
    var fb = CS.tmdb.imgAlt(url);
    return '<img' + (cls ? ' class="' + esc(cls) + '"' : '') +
      ' src="' + esc(url) + '"' +
      (fb && fb !== url ? ' data-fallback="' + esc(fb) + '"' : '') +
      ' alt="' + esc(alt || '') + '" loading="lazy" decoding="async"' +
      (extra || '') + '>';
  }

  function posterHtml(item) {
    if (item.poster) {
      return imgTag(item.poster, 'بوستر ' + (item.title || ''), '',
        ' width="342" height="513"');
    }
    return placeholder(item);
  }

  function placeholder(item) {
    return '<div class="card__ph"><b>' + (item.type === 'tv' ? '📺' : '🎬') + '</b>' +
           '<span>' + esc(item.title || 'بلا صورة') + '</span></div>';
  }

  function scoreClass(r) { return r >= 7.5 ? 'is-high' : r > 0 && r < 5.5 ? 'is-low' : ''; }

  function certBadge(item) {
    var info = CS.certs.cachedFor(item);
    if (!info && item.source === 'wiki') {
      return '<span class="card__cert card__cert--unknown" ' +
        'title="نتيجة من ويكيبيديا بلا مقابل في TMDB — تصنيفها العمري غير معروف">؟</span>';
    }
    if (!info) return '';
    var t = CS.certs.tierInfo(info.tier);
    var text = info.tier === 5 ? '🔥' : (t.emoji + ' ' + t.short);
    var title = info.tier === 5 ? 'معلَّم adult عند TMDB'
              : t.label + (info.cert ? ' · ' + info.cert + (info.country ? ' (' + info.country + ')' : '') : '');
    return '<span class="card__cert" style="--cc:' + esc(t.color) +
           '" title="' + esc(title) + '">' + text + '</span>';
  }

  /* شارة نوع المحتوى — إلزامية على كل بوستر في الموقع */
  function kindBadge(item) {
    var k = CS.certs.contentKind(item);
    if (!k) {
      return '<span class="card__kind card__kind--wait" ' +
        'title="نوع المحتوى يُسحب من TMDB الآن">⏳</span>';
    }
    var i = CS.certs.kindInfo(k);
    return '<span class="card__kind card__kind--' + k + '" style="--kc:' + esc(i.color) + '" ' +
      'title="' + esc(i.why) + '">' + i.emoji + ' ' + i.ar + '</span>';
  }

  function heatBar(item) {
    var h = item.heat;
    if (!h || !h.score) return '';
    return '<div class="card__heat" title="' + esc('وسوم TMDB: ' + h.tags.join('، ')) +
           '"><i style="width:' + h.score + '%"></i></div>';
  }

  function matchBadge(item) {
    if (!item.matchPct) return '';
    var quality = item.matchBasis === 'quality';
    var why = item.why === 'related' ? 'قربه من العمل اللي فتحته'
            : quality ? 'قوة الترشيح: تقييمه وعدد مصوّتيه وشهرته — صوّت على أعمال وبتتحوّل لتطابق ذوقك'
            : item.matchWhy && item.matchWhy.length ? 'يطابق ذوقك في: ' + item.matchWhy.join('، ')
            : item.whyText ? 'قربه من بحثك'
            : 'تطابقه مع ذوقك حسب تصويتك';
    return '<span class="card__match' + (item.matchPct >= 85 ? ' is-top' : '') +
      '" title="' + esc(why) + '">' + (quality ? 'مرشّح ' : '') + item.matchPct + '٪</span>';
  }

  /* علامة التقدّم — «وصلت م٢ ح٥» على بوستر عمل بدأته */
  function progressBadge(item) {
    if (!CS.library) return '';
    var p = CS.library.progress.get(item);
    if (!p) return '';
    if (p.done) return '<span class="card__prog is-done" title="خلّصته">✓</span>';
    if (p.season != null) {
      return '<span class="card__prog" title="آخر ما وصلت له">م' + p.season + ' ح' + (p.episode || 1) + '</span>';
    }
    return '<span class="card__prog" title="بدأته">▶</span>';
  }

  function voteBar(item, big) {
    var v = CS.taste.verdict(item);
    var k = esc(itemKey(item));
    return '' +
      '<div class="vote' + (big ? ' vote--big' : '') + '">' +
        '<button class="vote__b vote__up' + (v === 1 ? ' is-on' : '') + '" data-vote="1" data-item="' + k + '" ' +
          'aria-pressed="' + (v === 1 ? 'true' : 'false') + '" aria-label="عجبني" title="عجبني">' +
          '<span aria-hidden="true">👍</span>' + (big ? '<b>عجبني</b>' : '') + '</button>' +
        '<button class="vote__b vote__down' + (v === -1 ? ' is-on' : '') + '" data-vote="-1" data-item="' + k + '" ' +
          'aria-pressed="' + (v === -1 ? 'true' : 'false') + '" aria-label="ما عجبني" title="ما عجبني">' +
          '<span aria-hidden="true">👎</span>' + (big ? '<b>ما عجبني</b>' : '') + '</button>' +
      '</div>';
  }

  /* أزرار المكتبة: مفضلة · لاحقًا — على كل بطاقة */
  function libBar(item) {
    if (!CS.library || item.source !== 'tmdb') return '';
    var k = esc(itemKey(item));
    var isFav = CS.library.fav.has(item);
    var isLater = CS.library.later.has(item);
    return '<div class="libbar">' +
      '<button class="libbar__b' + (isFav ? ' is-on' : '') + '" data-lib-toggle="fav" data-item="' + k + '" ' +
        'aria-pressed="' + (isFav ? 'true' : 'false') + '" title="المفضلة" aria-label="أضف للمفضلة">⭐</button>' +
      '<button class="libbar__b' + (isLater ? ' is-on' : '') + '" data-lib-toggle="later" data-item="' + k + '" ' +
        'aria-pressed="' + (isLater ? 'true' : 'false') + '" title="أشوفه لاحقًا" aria-label="أشوفه لاحقًا">🕗</button>' +
    '</div>';
  }

  /* ---------- البطاقة ---------- */

  function card(item) {
    var sub = [];
    if (item.year) sub.push(item.year);
    sub.push(typeLabel(item));
    if (item.source === 'wiki') sub.push('ويكيبيديا');
    if (item.personRole) sub.push(item.personRole);

    var plot = (item.overview || item.plotSnippet || '').trim();
    var why = item.whyText
      ? '<span class="card__why ' + (WHY_CLASS[item.why] || '') + '">' + esc(item.whyText) + '</span>' : '';
    var tags = (item.heat && item.heat.tags && item.heat.tags.length)
      ? '<div class="card__tags">' + item.heat.tags.slice(0, 3).map(function (t) {
          return '<span class="card__tag">' + esc(t) + '</span>';
        }).join('') + '</div>' : '';

    var k = esc(itemKey(item));

    return '' +
      '<article class="card" data-key="' + k + '">' +
        '<a class="card__link" href="#/work/' + k + '" data-open="' + k + '">' +
          '<div class="card__poster">' + posterHtml(item) +
            '<div class="card__row card__row--top">' +
              (item.rating ? '<span class="card__score ' + scoreClass(item.rating) + '">' + item.rating.toFixed(1) + '</span>' : '<span></span>') +
              '<span class="card__type">' + esc(typeLabel(item)) + '</span>' +
            '</div>' +
            '<div class="card__row card__row--bottom">' +
              certBadge(item) + kindBadge(item) + progressBadge(item) + matchBadge(item) +
            '</div>' +
            heatBar(item) +
            (item.source === 'tmdb'
              ? '<button class="card__like" data-similar="' + k + '" ' +
                'title="أعمال مثل هذا" aria-label="أعمال مثل هذا">🎯</button>'
              : '') +
          '</div>' +
          '<div class="card__body">' +
            '<h3 class="card__title">' + esc(item.title) + '</h3>' +
            '<p class="card__sub">' + esc(sub.filter(Boolean).join(' · ')) + '</p>' +
            (plot ? '<p class="card__plot">' + esc(plot) + '</p>' : '') +
            tags + why +
          '</div>' +
        '</a>' +
        libBar(item) +
        voteBar(item, false) +
      '</article>';
  }

  function cards(list) { return (list || []).map(card).join(''); }

  /* ---------- الصفوف الجاهزة ---------- */

  function shelf(conf) {
    /* conf: { id, title, note, items, loading, empty } */
    if (conf.loading) {
      return '<section class="shelf" data-shelf="' + esc(conf.id) + '">' +
        '<h3 class="sec__title">' + esc(conf.title) + '</h3>' +
        '<div class="shelf__rail">' + skelRow(8) + '</div></section>';
    }
    if (!conf.items || !conf.items.length) return '';
    return '<section class="shelf" data-shelf="' + esc(conf.id) + '">' +
      '<h3 class="sec__title">' + esc(conf.title) +
        (conf.note ? '<span class="sec__note">' + esc(conf.note) + '</span>' : '') + '</h3>' +
      '<div class="shelf__rail">' + cards(conf.items) + '</div>' +
    '</section>';
  }

  /* ---------- مسار التنقّل ---------- */

  function crumbs(path) {
    if (!path || path.length < 2) return '';
    return '<ol class="crumbs__list">' + path.map(function (p, i) {
      var last = i === path.length - 1;
      var label = esc(p.label);
      return '<li class="crumbs__i">' +
        (last || !p.hash ? '<span aria-current="page">' + label + '</span>'
                         : '<a href="' + esc(p.hash) + '">' + label + '</a>') +
        '</li>';
    }).join('') + '</ol>';
  }

  /* ---------- الروابط الخارجية ---------- */

  function linksHtml(item) {
    return '<h3 class="sec__title">ابحث عنه في كل المواقع</h3>' +
      '<div class="links">' + CS.links.build(item).map(function (l) {
        return '<a class="linkbtn" href="' + esc(l.url) + '" target="_blank" rel="noopener noreferrer">' +
          '<span class="linkbtn__dot" style="background:' + esc(l.color) + '"></span>' +
          esc(l.label) + (l.exact ? '' : '<span class="linkbtn__x">بحث</span>') + '</a>';
      }).join('') + '</div>';
  }

  function providersHtml(p) {
    if (!p) return '';
    var groups = [['اشتراك', p.flatrate], ['إيجار', p.rent], ['شراء', p.buy]]
      .filter(function (g) { return g[1] && g[1].length; });
    if (!groups.length) return '';

    /* شروط TMDB تُلزم بنسب بيانات التوفّر لـJustWatch مع كل عمل */
    var credit = '<p class="prov__credit">مصدر بيانات التوفّر: ' +
      '<a href="https://www.justwatch.com/" target="_blank" rel="noopener noreferrer">JustWatch</a>' +
      (p.link ? ' · <a href="' + esc(p.link) + '" target="_blank" rel="noopener noreferrer">كل المنصّات</a>' : '') +
      '</p>';

    return '<div class="prov">' + groups.map(function (g) {
      return '<div class="prov__g"><span class="prov__lbl">' + g[0] + '</span>' +
        g[1].map(function (x) {
          return imgTag(x.logo, x.name, '', ' title="' + esc(x.name) + '" width="42" height="42"');
        }).join('') + '</div>';
    }).join('') + credit + '</div>';
  }

  function metaRow(label, value) {
    if (!value) return '';
    return '<div><span>' + esc(label) + '</span><b>' + esc(value) + '</b></div>';
  }

  /* ---------- قسم القصة ---------- */

  function storySection(d, extra) {
    extra = extra || {};
    var short = extra.summary || '';
    var plot = extra.plotArabic || extra.fullPlot || '';

    if (extra.loadingPlot && !short && !plot) {
      return '<h3 class="sec__title">القصة الكاملة</h3>' + loading('يجيب القصة من ويكيبيديا…');
    }

    var story = short;
    if (plot) {
      var head = CS.search.norm(short).slice(0, 60);
      if (!story) story = plot;
      else if (!head || CS.search.norm(plot).indexOf(head) === -1) story += '\n\n' + plot;
    }

    var html = story
      ? '<p class="overview">' + esc(story) + '</p>'
      : '<p class="overview overview--empty">ما لقيت ملخصًا لهالعمل — لا في TMDB ولا في ويكيبيديا. افتح روابط المواقع تحت.</p>';

    var plotIsArabic = extra.fullPlot ? CS.util.isArabic(extra.fullPlot) : false;
    var src = [];
    if (short) src.push(extra.summarySource || 'الملخص من TMDB');
    if (extra.plotArabic) src.push('القصة من ويكيبيديا (ترجمة آلية)');
    else if (extra.fullPlot) src.push('القصة من ويكيبيديا (' + (plotIsArabic ? 'عربي' : 'إنجليزي') + ')');
    if (extra.translating) src.push('⏳ يترجم…');
    if (src.length) html += '<p class="overview__src">🔸 ' + esc(src.join(' · ')) + '</p>';

    if (extra.fullPlot && !extra.plotArabic && !plotIsArabic && CS.state.lang === 'ar' && !extra.translating) {
      html += '<div class="dt__actions"><button class="btn btn--ghost btn--sm" data-translate-plot>' +
              '🔤 ترجم القصة الكاملة للعربية</button></div>';
    }
    if (extra.plotError) html += '<p class="msg msg--warn">🟡 ' + esc(extra.plotError) + '</p>';

    return '<h3 class="sec__title">القصة الكاملة</h3>' + html;
  }

  /* ---------- المصادر الإضافية ---------- */

  function extraSources(d, ex) {
    ex = ex || {};
    var blocks = '';

    if (ex.tvmaze) {
      var t = ex.tvmaze, r2 = '';
      r2 += metaRow('الحالة', t.status);
      r2 += metaRow('موعد العرض', t.schedule);
      if (t.next) r2 += metaRow('الحلقة القادمة', 'م' + t.next.season + ' ح' + t.next.number + (t.next.airdate ? ' · ' + t.next.airdate : ''));
      if (t.prev) r2 += metaRow('آخر حلقة', 'م' + t.prev.season + ' ح' + t.prev.number + (t.prev.airdate ? ' · ' + t.prev.airdate : ''));
      if (r2) blocks += '<h3 class="sec__title">مواعيد الحلقات <span class="sec__note">TVmaze</span></h3>' +
                        '<div class="metatable">' + r2 + '</div>';
    }

    return blocks;
  }

  /* ---------- المواسم والحلقات ---------- */

  function seasonsSection(d, view) {
    if (d.type !== 'tv' || !d.seasonList || !d.seasonList.length) return '';
    view = view || {};
    var active = view.season != null ? view.season : (d.seasonList[0] || {}).number;

    var picker = '<div class="seasons">' + d.seasonList.map(function (s) {
      return '<button class="season' + (s.number === active ? ' is-on' : '') + '" ' +
        'data-season="' + s.number + '" type="button">' +
        esc(s.name) + '<i>' + s.count + ' حلقة</i></button>';
    }).join('') + '</div>';

    var body;
    if (view.loading) body = loading('يجيب حلقات الموسم…');
    else if (view.error) body = '<p class="msg msg--bad">🔴 ' + esc(view.error) + '</p>';
    else if (!view.episodes || !view.episodes.length) body = '<p class="msg">⚪ ما فيه حلقات مسجّلة لهذا الموسم.</p>';
    else body = episodeList(d, view.episodes);

    var prog = CS.library ? CS.library.progress.get(d) : null;
    var resume = prog && prog.season != null
      ? '<p class="sec__note">آخر ما وصلت له: م' + prog.season + ' ح' + (prog.episode || 1) +
        ' · ' + esc(CS.util.ago(prog.at)) + '</p>' : '';

    return '<h3 class="sec__title">المواسم والحلقات ' +
      '<span class="sec__note">' + d.seasons + ' موسم · ' + d.episodes + ' حلقة</span></h3>' +
      resume + picker + '<div class="eps" id="dt-eps">' + body + '</div>';
  }

  function episodeList(d, eps) {
    return eps.map(function (e) {
      var seen = CS.library ? CS.library.progress.episodeSeen(d, e.season, e.number) : false;
      return '<article class="ep' + (seen ? ' is-seen' : '') + '">' +
        '<div class="ep__still">' +
          (e.still ? imgTag(e.still, e.name, '', ' width="300" height="169"')
                   : '<div class="ep__ph">' + e.number + '</div>') +
        '</div>' +
        '<div class="ep__body">' +
          '<h4 class="ep__t"><b>' + e.number + '.</b> ' + esc(e.name) + '</h4>' +
          '<p class="ep__meta">' +
            [e.airdate ? CS.util.date(e.airdate) : '', e.runtime ? e.runtime + ' د' : '',
             e.rating ? '★ ' + e.rating : ''].filter(Boolean).map(esc).join(' · ') +
          '</p>' +
          (e.overview ? '<p class="ep__plot">' + esc(e.overview) + '</p>' : '') +
        '</div>' +
        '<button class="ep__mark" data-mark-ep="' + e.season + ':' + e.number + '" ' +
          'aria-pressed="' + (seen ? 'true' : 'false') + '" ' +
          'title="' + (seen ? 'وصلت هنا' : 'علّم إنك وصلت لهذي الحلقة') + '">' +
          (seen ? '✓' : '○') + '</button>' +
      '</article>';
    }).join('');
  }

  /* ---------- صفحة العمل ---------- */

  function detailSkeleton() {
    return '<div class="dt__hero"><div class="dt__backdrop"></div>' +
      '<button class="dt__close" data-back aria-label="رجوع">&#8594;</button></div>' +
      '<div class="dt__top"><div class="dt__poster skel__poster"></div>' +
      '<div class="dt__headings"><div class="skel__line" style="height:26px;width:60%"></div>' +
      '<div class="skel__line" style="width:35%"></div></div></div>' +
      '<div class="dt__body"><div class="skel__line"></div><div class="skel__line"></div></div>';
  }

  function detail(d, extra) {
    extra = extra || {};
    var facts = [];

    if (d.rating) facts.push('<span class="fact fact--score">★ ' + d.rating.toFixed(1) + (d.votes ? ' · ' + d.votes.toLocaleString('en-US') : '') + '</span>');
    if (d.year)   facts.push('<span class="fact">' + d.year + '</span>');
    facts.push('<span class="fact">' + esc(typeLabel(d)) + '</span>');
    if (d.runtime) facts.push('<span class="fact">' + esc(CS.util.minutes(d.runtime)) + '</span>');
    if (d.seasons) facts.push('<span class="fact">' + d.seasons + ' موسم · ' + d.episodes + ' حلقة</span>');

    var certInfo = CS.certs.cachedFor(d);
    if (certInfo) {
      var ct = CS.certs.tierInfo(certInfo.tier);
      facts.push('<span class="fact" style="--fc:' + esc(ct.color) + '">' +
        ct.emoji + ' ' + esc(ct.label) + (certInfo.cert && certInfo.tier !== 5 ? ' · ' + esc(certInfo.cert) : '') + '</span>');
    }
    var dk = CS.certs.contentKind(d);
    if (dk) {
      var dki = CS.certs.kindInfo(dk);
      facts.push('<span class="fact fact--kind" style="--fc:' + esc(dki.color) +
        '" title="' + esc(dki.why) + '">' + dki.emoji + ' ' + dki.ar + '</span>');
    }
    (d.genres || []).forEach(function (g) { facts.push('<span class="fact">' + esc(g) + '</span>'); });
    if (d.directors && d.directors.length) facts.push('<span class="fact">🎬 ' + esc(d.directors.join('، ')) + '</span>');
    if (d.countries && d.countries.length) facts.push('<span class="fact">' + esc(d.countries.slice(0, 2).join('، ')) + '</span>');

    /* وسوم العمل — كلمات TMDB المفتاحية كما هي */
    var heatHtml = '';
    var hot = (d.heat && d.heat.tags) || [];
    var kws = (d.keywords || []).map(function (k) { return k.name; })
      .filter(function (n) { return n && String(n).length <= 34; });

    var allTags = hot.concat(kws).filter(function (t, i, a) {
      return a.map(function (x) { return String(x).toLowerCase(); })
              .indexOf(String(t).toLowerCase()) === i;
    }).slice(0, 18);

    if (allTags.length) {
      /* الوسوم الحسّية (heat.tags) أسماء موحَّدة نصنعها نحن في
         certs.heatOf — «softcore» و«erotica» تصيران وسمًا واحدًا
         «erotic». الضغط عليها كان يبحث عن كلمة مفتاحية بهذا الاسم
         عند TMDB فترجع صفحة فاضية. فصارت شارات لا روابط، والقابل
         للضغط هو الكلمة المفتاحية الحقيقية وحدها. */
      heatHtml = '<section><h3 class="sec__title">الوسوم ' +
        '<span class="sec__note">الوسوم البرتقالية كلمات TMDB الحقيقية — اضغطها تجيب كل أعمالها</span></h3>' +
        '<div class="tags">' + allTags.map(function (t) {
          var isHot = hot.some(function (h) { return String(h).toLowerCase() === String(t).toLowerCase(); });
          var real = kws.some(function (k) { return String(k).toLowerCase() === String(t).toLowerCase(); });
          var label = '#' + esc(String(t).replace(/\s+/g, '-'));
          if (!real) {
            return '<span class="tag tag--heat" title="وسم محتوى من تصنيفنا، مو كلمة مفتاحية عند TMDB">' +
              label + '</span>';
          }
          return '<a class="tag' + (isHot ? ' tag--heat' : ' tag--kw') + '" href="#/tag/' +
            esc(encodeURIComponent(t)) + '" data-tag="' + esc(t) + '">' + label + '</a>';
        }).join('') + '</div></section>';
    }

    var castHtml = (d.cast && d.cast.length)
      ? '<div class="cast">' + d.cast.map(function (c) {
          return '<a class="cast__p" href="#/person/' + esc(c.id) + '" data-person="' + esc(c.id) + '">' +
            (c.photo ? imgTag(c.photo, c.name, '', ' width="185" height="185"') : '<div class="cast__ph">👤</div>') +
            '<b>' + esc(c.name) + '</b>' + (c.role ? '<span>' + esc(c.role) + '</span>' : '') + '</a>';
        }).join('') + '</div>' : '';

    var provHtml = providersHtml(d.providers);
    var k = esc(itemKey(d));

    /* أزرار المشاهدة السريعة */
    var watchName = d.originalTitle || d.title;
    var watchBtns =
      '<a class="linkbtn linkbtn--hero linkbtn--app" href="' + esc(CS.links.nuvio(d)) + '">' +
        '<span class="linkbtn__dot" style="background:#22d3ee"></span>Nuvio</a>' +
      '<a class="linkbtn linkbtn--hero" target="_blank" rel="noopener noreferrer" ' +
        'href="https://web.stremio.com/#/search?search=' + encodeURIComponent(watchName) + '">' +
        '<span class="linkbtn__dot" style="background:#7b5bf5"></span>Stremio</a>' +
      '<a class="linkbtn linkbtn--hero" target="_blank" rel="noopener noreferrer" ' +
        'href="https://yandex.com/search/?text=' + encodeURIComponent(watchName + ' ' + (d.year || '') + ' online') + '">' +
        '<span class="linkbtn__dot" style="background:#fc3f1d"></span>Yandex</a>';

    /* أزرار المكتبة الكبيرة */
    var inFav = CS.library.fav.has(d), inLater = CS.library.later.has(d), inFollow = CS.library.follow.has(d);
    var prog = CS.library.progress.get(d);
    var libBtns =
      '<button class="btn btn--ghost' + (inFav ? ' is-on' : '') + '" data-lib-toggle="fav" data-item="' + k + '">' +
        (inFav ? '⭐ في المفضلة' : '☆ أضف للمفضلة') + '</button>' +
      '<button class="btn btn--ghost' + (inLater ? ' is-on' : '') + '" data-lib-toggle="later" data-item="' + k + '">' +
        (inLater ? '🕗 في قائمة لاحقًا' : '🕗 أشوفه لاحقًا') + '</button>' +
      (d.type === 'tv'
        ? '<button class="btn btn--ghost' + (inFollow ? ' is-on' : '') + '" data-lib-toggle="follow" data-item="' + k + '">' +
          (inFollow ? '🔔 متابَع' : '🔕 تابع الجديد') + '</button>'
        : '') +
      (d.type === 'movie'
        ? '<button class="btn btn--ghost' + (prog && prog.done ? ' is-on' : '') + '" data-mark-done="' + k + '">' +
          (prog && prog.done ? '✓ شفته' : '○ علّم إني شفته') + '</button>'
        : '');

    return '' +
      '<div class="dt__hero">' +
        '<div class="dt__backdrop">' + (d.backdrop ? imgTag(d.backdrop, '', '', ' width="1280" height="720"') : '') + '</div>' +
        '<button class="dt__close" data-back aria-label="رجوع">&#8594;</button>' +
      '</div>' +

      '<div class="dt__top">' +
        '<div class="dt__poster">' + posterHtml(d) + '</div>' +
        '<div class="dt__headings">' +
          '<h2 class="dt__title">' + esc(d.title) +
            '<button class="dt__copy" data-copy-title="' + esc(d.originalTitle || d.title) + '" ' +
              'title="انسخ اسم العمل" aria-label="انسخ اسم العمل">📋</button>' +
          '</h2>' +
          (d.originalTitle ? '<p class="dt__original">' + esc(d.originalTitle) + '</p>' : '') +
          (d.tagline ? '<p class="dt__tagline">«' + esc(d.tagline) + '»</p>' : '') +
          '<div class="dt__facts">' + facts.join('') + '</div>' +
          '<div class="dt__actions">' + voteBar(d, true) +
            '<button class="btn btn--ghost" data-share="' + k + '">🔗 شارك</button>' +
          '</div>' +
          '<div class="dt__actions">' + libBtns + '</div>' +
          '<div class="dt__actions">' + watchBtns + '</div>' +
        '</div>' +
      '</div>' +

      '<div class="dt__body">' +
        '<section id="dt-story">' + storySection(d, extra) + '</section>' +
        (d.type === 'tv' ? '<section id="dt-seasons">' + seasonsSection(d, { loading: true }) + '</section>' : '') +
        heatHtml +
        (provHtml ? '<section><h3 class="sec__title">وين تشوفه <span class="sec__note">(' + esc(CS.state.region) + ')</span></h3>' + provHtml + '</section>' : '') +
        '<section id="dt-datasources"></section>' +
        '<section id="dt-links">' + linksHtml(d) + '</section>' +
        (castHtml ? '<section><h3 class="sec__title">طاقم العمل <span class="sec__note">اضغط أي اسم لأعماله</span></h3>' + castHtml + '</section>' : '') +
        '<section id="dt-extra"></section>' +
        '<section id="dt-related">' + relatedSection([], false, true, 0) + '</section>' +
      '</div>';
  }

  /* قسم الأعمال ذات الصلة مع «اعرض المزيد» */
  function relatedSection(items, exhausted, loadingNow, total) {
    if (loadingNow && (!items || !items.length)) {
      return '<h3 class="sec__title">أعمال ذات صلة</h3><div class="grid">' + skeletons(6) + '</div>';
    }
    if (!items.length) return '';
    var n = total && total > items.length
      ? items.length + ' من ' + total + ' عمل'
      : items.length + ' عمل';
    return '<h3 class="sec__title">أعمال ذات صلة <span class="sec__note">' + esc(n) +
      ' · القرب من الوسوم والقصة والمخرج والممثلين واللغة والفترة</span></h3>' +
      '<div class="grid">' + cards(items) + '</div>' +
      (exhausted ? '' :
        '<div class="loadmore"><button class="btn btn--ghost" data-related-more ' +
        (loadingNow ? 'disabled' : '') + '>' + (loadingNow ? '⏳ يحمّل…' : 'اعرض المزيد') + '</button></div>');
  }

  /* ---------- صفحة الشخص ---------- */

  function person(p, shown) {
    var meta = [p.job === 'Directing' ? 'مخرج' : p.job === 'Acting' ? 'ممثل' : p.job,
                p.birthday ? 'مواليد ' + p.birthday : '',
                p.deathday ? 'توفّي ' + p.deathday : '',
                p.place].filter(Boolean).join(' · ');
    var list = p.works.slice(0, shown);

    return '' +
      '<div class="dt__hero"><div class="dt__backdrop"></div>' +
        '<button class="dt__close" data-back aria-label="رجوع">&#8594;</button></div>' +
      '<div class="person__head">' +
        (p.photo ? imgTag(p.photo, p.name, 'person__photo', ' width="185" height="185"')
                 : '<div class="person__photo cast__ph">👤</div>') +
        '<div><h2 class="person__name">' + esc(p.name) + '</h2>' +
        (meta ? '<p class="person__meta">' + esc(meta) + '</p>' : '') +
        '<p class="person__meta">' + p.works.length + ' عمل' +
          (p.directedCount ? ' · ' + p.directedCount + ' إخراجًا' : '') + '</p></div>' +
      '</div>' +
      '<div class="dt__body">' +
        (p.bio ? '<section><h3 class="sec__title">نبذة</h3><p class="overview">' + esc(p.bio) + '</p></section>' : '') +
        '<section><h3 class="sec__title">أعماله</h3>' +
          (list.length ? '<div class="grid">' + cards(list) + '</div>'
                       : '<p class="msg">⚪ ما فيه أعمال لهذا الشخص داخل محتوى الموقع.</p>') +
          (shown < p.works.length
            ? '<div class="loadmore"><button class="btn" data-person-more>اعرض المزيد</button>' +
              '<p class="loadmore__note">' + shown + ' من ' + p.works.length + '</p></div>' : '') +
        '</section>' +
      '</div>';
  }

  /* ---------- حالات فارغة وأخطاء ---------- */

  function errorHtml(title, detail, actions) {
    return '<b>🔴 ' + esc(title) + '</b><p>' + esc(detail || '') + '</p>' +
      (actions ? '<div class="empty__acts">' + actions + '</div>' : '');
  }

  function emptyHtml(query, meta) {
    meta = meta || {};
    if (meta.tmdbError) {
      return errorHtml('TMDB ما رد', meta.tmdbError,
        '<button class="btn" data-diagnose>🔍 افحص الاتصال</button>' +
        '<button class="btn btn--ghost" data-retry-search>أعد المحاولة</button>') +
        '<p class="empty__note">🟢 البحث بوصف القصة عبر ويكيبيديا يضل شغّالًا.</p>';
    }
    var tips = [
      'اكتب المشهد اللي تذكره بالتفصيل: «رجل يجلس على كرسي متحرك ويراقب جيرانه».',
      'جرّب زر «ترجم EN» جنب البحث — تغطية ويكيبيديا الإنجليزية أوسع بكثير.',
      'اذكر أسماء الممثلين أو المخرج لو تذكرها.'
    ];
    var head = '<b>🔎 ما لقيت شي لـ «' + esc(query) + '»</b>';

    if (meta.corrections && meta.corrections.length) {
      tips.unshift('جرّبت كمان: ' + meta.corrections.map(function (c) { return c.to; }).join('، ') +
                   ' — ولا واحدة طلعت بنتيجة.');
    }
    if (meta.gateIn && !meta.gateOut) {
      return head +
        '<p>وصلت ' + meta.gateIn + ' نتيجة، وكلها طلعت خارج المحتوى الجنسي فانحجبت. ' +
        'الموقع ما يعرض إلا الأعمال اللي TMDB وسمها بمحتوى جنسي.</p>' +
        '<p class="empty__note">جرّب توصف المشهد نفسه بتفصيل أكثر، أو اكتبه بالإنجليزي.</p>';
    }
    if (meta.catalogSize !== undefined && meta.catalogSize < 150) {
      tips.unshift('الفهرس المحلي لسه صغير (' + meta.catalogSize + ' عمل) — تصفّح الأقسام شوي ' +
                   'وبيكبر تلقائيًا، والبحث بالوصف بيصير أدق.');
    }
    return head + '<p>جرّب كذا:</p><ul><li>' + tips.map(esc).join('</li><li>') + '</li></ul>';
  }

  /* ---------- بيانات إضافية من مصادر المشغّل ---------- */

  var METRICS = [
    'تقييم IMDb', 'أصوات IMDb', 'روتن توميتوز', 'ميتاكريتيك', 'تريكت', 'تقييم Trakt',
    'ليتربوكسد', 'نقاد روجر إيبرت', 'تقييم Simkl', 'التقييم', 'عدد الأصوات', 'عدد المقيّمين',
    'الجوائز', 'شبّاك التذاكر', 'الميزانية', 'الإيرادات', 'التصنيف العمري', 'المدة',
    'الشبكة', 'الحالة', 'اللغة', 'البلد', 'مدة الحلقة', 'العرض الأول', 'الاسم', 'سنة البداية',
    'منصّات متاحة', 'بوسترات', 'خلفيات', 'شعارات', 'الموقع الرسمي'
  ];

  function metricRank(label) {
    var i = METRICS.indexOf(label);
    return i === -1 ? METRICS.length : i;
  }

  function dataSection(blocks) {
    if (!blocks || !blocks.length) return '';

    var loadingBlocks = blocks.filter(function (b) { return b.loading; });
    var skipped = blocks.filter(function (b) { return !b.loading && !b.ok && /^يحتاج /.test(b.detail || ''); });
    var failed  = blocks.filter(function (b) { return !b.loading && !b.ok && skipped.indexOf(b) === -1; });
    var okBlocks = blocks.filter(function (b) { return b.ok && b.rows && b.rows.length; });

    var merged = {}, order = [];
    okBlocks.forEach(function (b) {
      b.rows.forEach(function (r) {
        var label = String(r[0]), value = String(r[1]);
        if (!merged[label]) { merged[label] = { value: value, from: [b.name] }; order.push(label); }
        else if (merged[label].from.indexOf(b.name) === -1) {
          if (merged[label].value !== value) merged[label].alt = merged[label].alt || [];
          if (merged[label].value !== value) merged[label].alt.push(b.name + ': ' + value);
          merged[label].from.push(b.name);
        }
      });
    });

    order.sort(function (a, b) { return metricRank(a) - metricRank(b); });

    var rows = order.map(function (label) {
      var m = merged[label];
      var safe = CS.util.safeUrl(m.value);
      var v = safe
        ? '<a href="' + esc(safe) + '" target="_blank" rel="noopener noreferrer">' + esc(safe) + '</a>'
        : esc(m.value);
      return '<div class="mrow"><span class="mrow__k">' + esc(label) + '</span>' +
        '<b class="mrow__v">' + v + '</b>' +
        '<i class="mrow__src" title="' + esc(m.from.join(' · ')) + '">' + esc(m.from[0]) +
        (m.from.length > 1 ? ' +' + (m.from.length - 1) : '') + '</i>' +
        (m.alt ? '<i class="mrow__alt">' + esc(m.alt.join(' · ')) + '</i>' : '') +
        '</div>';
    }).join('');

    var notes = [];
    if (loadingBlocks.length) notes.push('⏳ ' + loadingBlocks.map(function (b) { return esc(b.name); }).join('، '));
    if (failed.length) notes.push('🔴 ' + failed.map(function (b) {
      return esc(b.name) + ' (' + esc(b.detail || 'ما رد') + ')';
    }).join('، '));
    if (skipped.length) notes.push('⚪ ' + skipped.map(function (b) {
      return esc(b.name) + ' (' + esc(b.detail) + ')';
    }).join('، '));

    if (!rows && !notes.length) return '';

    var used = okBlocks.map(function (b) { return esc(b.name); }).join(' · ');
    return '<h3 class="sec__title">بيانات إضافية ' +
      (used ? '<span class="sec__note">' + used + '</span>' : '') + '</h3>' +
      (rows ? '<div class="mtable">' + rows + '</div>' : '') +
      (notes.length ? '<p class="ds__skip">' + notes.join(' · ') + '</p>' : '');
  }

  CS.ui = {
    dataSection: dataSection,
    toast: toast,
    loading: loading,
    skeletons: skeletons,
    skelRow: skelRow,
    card: card,
    cards: cards,
    shelf: shelf,
    crumbs: crumbs,
    detail: detail,
    detailSkeleton: detailSkeleton,
    storySection: storySection,
    seasonsSection: seasonsSection,
    episodeList: episodeList,
    relatedSection: relatedSection,
    extraSources: extraSources,
    person: person,
    emptyHtml: emptyHtml,
    errorHtml: errorHtml,
    itemKey: itemKey,
    imgTag: imgTag,
    linksHtml: linksHtml,
    voteBar: voteBar,
    libBar: libBar,
    certBadge: certBadge,
    kindBadge: kindBadge,
    progressBadge: progressBadge,
    TYPE_AR: TYPE_AR,
    typeLabel: typeLabel
  };

})(window.CS);
