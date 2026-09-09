/* ============================================================
   ui.js — بناء الواجهة: البطاقات، صفحة العمل، صفحة الشخص
   ============================================================ */

(function (CS) {
  'use strict';

  var esc = CS.util.esc;
  var TYPE_AR = { movie: 'فيلم', tv: 'مسلسل' };
  var WHY_CLASS = { plot: 'is-plot', theme: 'is-theme', related: 'is-theme', title: '' };

  /* ---------- التوست ---------- */

  var toastTimer;
  function toast(msg) {
    var el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, 2600);
  }

  function skeletons(n) {
    var out = '';
    for (var i = 0; i < n; i++) {
      out += '<div class="skel"><div class="skel__poster"></div><div class="skel__line"></div><div class="skel__line"></div></div>';
    }
    return out;
  }

  /* ---------- مفاتيح وعناصر ---------- */

  function itemKey(item) {
    if (item.source === 'wiki') {
      return 'w/' + (item.wikiLang || 'ar') + '/' + encodeURIComponent(item.wikiTitle || '');
    }
    return item.type + '/' + item.id;
  }

  function posterHtml(item) {
    if (item.poster) {
      return '<img src="' + esc(item.poster) + '" alt="بوستر ' + esc(item.title) + '" loading="lazy" decoding="async">';
    }
    return '<div class="card__ph"><b>' + (item.type === 'tv' ? '📺' : '🎬') + '</b><span>' + esc(item.title) + '</span></div>';
  }

  function scoreClass(r) { return r >= 7.5 ? 'is-high' : r > 0 && r < 5.5 ? 'is-low' : ''; }

  function certBadge(item) {
    var info = CS.certs.cachedFor(item);
    /* نتيجة من ويكيبيديا ما لها معرّف TMDB فما لها تصنيف — نقولها بصراحة
       بدل ما نعرضها كأنها مصنّفة أو نخفيها بلا سبب */
    if (!info && item.source === 'wiki') {
      return '<span class="card__cert card__cert--unknown" ' +
        'title="نتيجة من ويكيبيديا بلا مقابل في TMDB — تصنيفها العمري غير معروف">؟ غير مصنّف</span>';
    }
    if (!info) return '';
    var t = CS.certs.tierInfo(info.tier);
    var text = info.tier === 5 ? '🔥 إباحي' : (t.emoji + ' ' + t.short);
    var title = info.tier === 5 ? 'معلَّم adult عند TMDB'
              : t.label + (info.cert ? ' · ' + info.cert + (info.country ? ' (' + info.country + ')' : '') : '');
    return '<span class="card__cert" style="border-color:' + esc(t.color) + '55;color:' + esc(t.color) +
           '" title="' + esc(title) + '">' + text + '</span>';
  }

  /* شارة نوع المحتوى — إلزامية على كل بوستر في الموقع.
     قبل ما توصل بيانات العمل تعرض «⏳ …» وتُستبدل فور وصولها،
     فما فيه بوستر يطلع بلا شارة في أي صفحة. */
  function kindBadge(item) {
    var k = CS.certs.contentKind(item);
    if (!k) {
      return '<span class="card__kind card__kind--wait" ' +
        'title="نوع المحتوى يُسحب من TMDB الآن">⏳ …</span>';
    }
    var i = CS.certs.kindInfo(k);
    return '<span class="card__kind card__kind--' + k + '" style="--kc:' + esc(i.color) + '" ' +
      'title="' + esc(i.why) + '">' + i.emoji + ' ' + i.ar + '</span>';
  }

  /* شريط الحسّية — مبني على وسوم TMDB الحقيقية، لا على نسبة مخترعة */
  function heatBar(item) {
    var h = item.heat;
    if (!h || !h.score) return '';
    return '<div class="card__heat" title="' + esc('وسوم TMDB: ' + h.tags.join('، ')) +
           '"><i style="width:' + h.score + '%"></i></div>';
  }

  /* نسبة التطابق — في البحث تعني قرب النتيجة من استعلامك،
     وفي بقية الصفحات تعني قربها من ذوقك المبني على تصويتك */
  function matchBadge(item) {
    if (!item.matchPct) return '';
    /* الرقم حقيقي دائمًا، وكلمته تتبع أساسه فما نوهم المستخدم بشي */
    var quality = item.matchBasis === 'quality';
    var why = item.why === 'related' ? 'قربه من العمل اللي فتحته'
            : quality ? 'قوة الترشيح: تقييمه وعدد مصوّتيه وشهرته — صوّت على أعمال وبتتحوّل لتطابق ذوقك'
            : item.whyText ? 'قربه من بحثك'
            : 'تطابقه مع ذوقك حسب تصويتك';
    return '<span class="card__match' + (item.matchPct >= 85 ? ' is-top' : '') +
      '" title="' + esc(why) + '">' + (quality ? 'مرشّح ' : 'مطابق ') + item.matchPct + '٪</span>';
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

  /* ---------- البطاقة ---------- */

  function card(item) {
    var sub = [];
    if (item.year) sub.push(item.year);
    sub.push(TYPE_AR[item.type] || '');
    if (item.source === 'wiki') sub.push('ويكيبيديا');

    var plot = (item.overview || item.plotSnippet || '').trim();
    var why = item.whyText
      ? '<span class="card__why ' + (WHY_CLASS[item.why] || '') + '">' + esc(item.whyText) + '</span>' : '';
    var tags = (item.heat && item.heat.tags.length)
      ? '<div class="card__tags">' + item.heat.tags.slice(0, 3).map(function (t) {
          return '<span class="card__tag">' + esc(t) + '</span>';
        }).join('') + '</div>' : '';

    return '' +
      '<article class="card" data-key="' + esc(itemKey(item)) + '">' +
        '<a class="card__link" href="#/work/' + esc(itemKey(item)) + '" data-open="' + esc(itemKey(item)) + '">' +
          '<div class="card__poster">' + posterHtml(item) +
            (item.rating ? '<span class="card__score ' + scoreClass(item.rating) + '">' + item.rating.toFixed(1) + '</span>' : '') +
            '<span class="card__type">' + (TYPE_AR[item.type] || '') + '</span>' +
            matchBadge(item) + certBadge(item) + kindBadge(item) + heatBar(item) +
            /* «مثله» — يقلب الشبكة لأقرب الأعمال بلا ما تفتح صفحة العمل */
            (item.source === 'tmdb'
              ? '<button class="card__like" data-similar="' + esc(itemKey(item)) + '" ' +
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
        voteBar(item, false) +
      '</article>';
  }

  function cards(list) { return list.map(card).join(''); }

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

    /* بيانات التوفّر من TMDB مصدرها JustWatch، وشروط TMDB تُلزم بنسبها
       لـJustWatch مع كل عمل لا مرة واحدة في التذييل — وإلا يُسحب الوصول */
    var credit = '<p class="prov__credit">مصدر بيانات التوفّر: ' +
      '<a href="https://www.justwatch.com/" target="_blank" rel="noopener noreferrer">JustWatch</a>' +
      (p.link ? ' · <a href="' + esc(p.link) + '" target="_blank" rel="noopener noreferrer">كل المنصّات</a>' : '') +
      '</p>';

    return '<div class="prov">' + groups.map(function (g) {
      return '<div class="prov__g"><span class="prov__lbl">' + g[0] + '</span>' +
        g[1].map(function (x) {
          return '<img src="' + esc(x.logo) + '" alt="' + esc(x.name) + '" title="' + esc(x.name) + '" loading="lazy">';
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
    if (src.length) html += '<p class="overview__src">🔸 ' + src.join(' · ') + '</p>';

    if (extra.fullPlot && !extra.plotArabic && !plotIsArabic && CS.state.lang === 'ar' && !extra.translating) {
      html += '<div class="dt__actions"><button class="btn btn--ghost btn--sm" data-translate-plot>' +
              '🔤 ترجم القصة الكاملة للعربية</button></div>';
    }
    if (extra.plotError) html += '<p class="overview__src">🔴 ' + esc(extra.plotError) + '</p>';

    return '<h3 class="sec__title">القصة الكاملة</h3>' + html;
  }

  /* ---------- المصادر الإضافية ---------- */

  function extraSources(d, ex) {
    ex = ex || {};
    var blocks = '';

    /* تقييمات OMDb انمسحت من هنا: صارت تتكرّر حرفيًا مع بطاقة OMDb
       في «بيانات إضافية» اللي يتحكّم فيها المشغّل بنفسه */

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
    facts.push('<span class="fact">' + (TYPE_AR[d.type] || '') + '</span>');
    if (d.runtime) facts.push('<span class="fact">' + esc(CS.util.minutes(d.runtime)) + '</span>');
    if (d.seasons) facts.push('<span class="fact">' + d.seasons + ' موسم · ' + d.episodes + ' حلقة</span>');

    var certInfo = CS.certs.cachedFor(d);
    if (certInfo) {
      var ct = CS.certs.tierInfo(certInfo.tier);
      facts.push('<span class="fact" style="border-color:' + esc(ct.color) + '66;color:' + esc(ct.color) + '">' +
        ct.emoji + ' ' + esc(ct.label) + (certInfo.cert && certInfo.tier !== 5 ? ' · ' + esc(certInfo.cert) : '') + '</span>');
    }
    /* نوع المحتوى بالعربي — نفس شارة البوستر، حاضرة هنا كمان */
    var dk = CS.certs.contentKind(d);
    if (dk) {
      var dki = CS.certs.kindInfo(dk);
      facts.push('<span class="fact fact--kind" style="border-color:' + esc(dki.color) +
        '66;color:' + esc(dki.color) + '" title="' + esc(dki.why) + '">' +
        dki.emoji + ' ' + dki.ar + '</span>');
    }
    (d.genres || []).forEach(function (g) { facts.push('<span class="fact">' + esc(g) + '</span>'); });
    if (d.directors && d.directors.length) facts.push('<span class="fact">🎬 ' + esc(d.directors.join('، ')) + '</span>');
    if (d.countries && d.countries.length) facts.push('<span class="fact">' + esc(d.countries.slice(0, 2).join('، ')) + '</span>');

    /* وسوم العمل — كلمات TMDB المفتاحية كما هي بالإنجليزي.
       هذي هي تصنيف العمل الحقيقي: sea battle · time loop · heist …
       والوسوم الحسّاسة تتلوّن بلون مختلف لكنها تشتغل بنفس الطريقة. */
    var heatHtml = '';
    var hot = (d.heat && d.heat.tags) || [];
    var kws = (d.keywords || []).map(function (k) { return k.name; })
      .filter(function (n) { return n && String(n).length <= 34; });

    /* الحسّاسة أولًا ثم البقية، بلا تكرار */
    var allTags = hot.concat(kws).filter(function (t, i, a) {
      return a.map(function (x) { return String(x).toLowerCase(); })
              .indexOf(String(t).toLowerCase()) === i;
    }).slice(0, 18);

    if (allTags.length) {
      heatHtml = '<section><h3 class="sec__title">الوسوم ' +
        '<span class="sec__note">اضغط أي وسم يجيب لك كل الأعمال اللي تحمله</span></h3>' +
        '<div class="tags">' + allTags.map(function (t) {
          var isHot = hot.some(function (h) { return String(h).toLowerCase() === String(t).toLowerCase(); });
          return '<a class="tag' + (isHot ? ' tag--heat' : ' tag--kw') + '" href="#/tag/' +
            esc(encodeURIComponent(t)) + '" data-tag="' + esc(t) + '">#' +
            esc(String(t).replace(/\s+/g, '-')) + '</a>';
        }).join('') + '</div></section>';
    }

    var castHtml = (d.cast && d.cast.length)
      ? '<div class="cast">' + d.cast.map(function (c) {
          return '<a class="cast__p" href="#/person/' + esc(c.id) + '" data-person="' + esc(c.id) + '">' +
            (c.photo ? '<img src="' + esc(c.photo) + '" alt="' + esc(c.name) + '" loading="lazy">' : '<div class="cast__ph">👤</div>') +
            '<b>' + esc(c.name) + '</b>' + (c.role ? '<span>' + esc(c.role) + '</span>' : '') + '</a>';
        }).join('') + '</div>' : '';


    var provHtml = providersHtml(d.providers);

    /* أزرار المشاهدة السريعة فوق */
    var watchName = d.originalTitle || d.title;
    /* Nuvio يفتح بتطبيق سطح المكتب مباشرة عبر مخطّطه nuvio://
       (المخطّط والقواعد من DeepLinkParser في مستودع Nuvio نفسه) */
    var watchBtns =
      '<a class="linkbtn linkbtn--hero linkbtn--app" href="' + esc(CS.links.nuvio(d)) + '">' +
        '<span class="linkbtn__dot" style="background:#22d3ee"></span>Nuvio</a>' +
      '<a class="linkbtn linkbtn--hero" target="_blank" rel="noopener noreferrer" ' +
        'href="https://web.stremio.com/#/search?search=' + encodeURIComponent(watchName) + '">' +
        '<span class="linkbtn__dot" style="background:#7b5bf5"></span>Stremio</a>' +
      '<a class="linkbtn linkbtn--hero" target="_blank" rel="noopener noreferrer" ' +
        'href="https://yandex.com/search/?text=' + encodeURIComponent(watchName + ' ' + (d.year || '') + ' online') + '">' +
        '<span class="linkbtn__dot" style="background:#fc3f1d"></span>Yandex</a>';

    return '' +
      '<div class="dt__hero">' +
        '<div class="dt__backdrop">' + (d.backdrop ? '<img src="' + esc(d.backdrop) + '" alt="" loading="lazy">' : '') + '</div>' +
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
            '<button class="btn btn--ghost" data-share="' + esc(itemKey(d)) + '">🔗 انسخ الرابط</button>' +
          '</div>' +
          '<div class="dt__actions">' + watchBtns + '</div>' +
        '</div>' +
      '</div>' +

      '<div class="dt__body">' +
        '<section id="dt-story">' + storySection(d, extra) + '</section>' +
        heatHtml +
        (provHtml ? '<section><h3 class="sec__title">وين تشوفه <span class="sec__note">(' + esc(CS.state.region) + ')</span></h3>' + provHtml + '</section>' : '') +
        '<section id="dt-datasources"></section>' +
        '<section id="dt-links">' + linksHtml(d) + '</section>' +
        (castHtml ? '<section><h3 class="sec__title">طاقم العمل <span class="sec__note">اضغط أي اسم لأعماله</span></h3>' + castHtml + '</section>' : '') +
        '<section id="dt-extra"></section>' +
        '<section id="dt-related"></section>' +
      '</div>';
  }

  /* قسم الأعمال ذات الصلة مع «اعرض المزيد» */
  function relatedSection(items, exhausted, loading, total) {
    if (!items.length) return '';
    /* العدد يقول المعروض من الكل، لا المعروض وحده — «٢٤ عمل» على
       بركة فيها ١٨٠ يخفي إن فيه المزيد */
    var n = total && total > items.length
      ? items.length + ' من ' + total + ' عمل'
      : items.length + ' عمل';
    return '<h3 class="sec__title">أعمال ذات صلة <span class="sec__note">' + n + '</span></h3>' +
      '<div class="grid">' + cards(items) + '</div>' +
      (exhausted ? '' :
        '<div class="loadmore"><button class="btn btn--ghost" data-related-more ' +
        (loading ? 'disabled' : '') + '>' + (loading ? '⏳ يحمّل…' : 'اعرض المزيد') + '</button></div>');
  }

  /* ---------- صفحة الشخص ---------- */

  function person(p, shown) {
    var meta = [p.job, p.birthday ? 'مواليد ' + p.birthday : '', p.place].filter(Boolean).join(' · ');
    var list = p.works.slice(0, shown);

    return '' +
      '<div class="dt__hero"><div class="dt__backdrop"></div>' +
        '<button class="dt__close" data-back aria-label="رجوع">&#8594;</button></div>' +
      '<div class="person__head">' +
        (p.photo ? '<img class="person__photo" src="' + esc(p.photo) + '" alt="' + esc(p.name) + '">'
                 : '<div class="person__photo cast__ph">👤</div>') +
        '<div><h2 class="person__name">' + esc(p.name) + '</h2>' +
        (meta ? '<p class="person__meta">' + esc(meta) + '</p>' : '') +
        '<p class="person__meta">' + p.works.length + ' عمل</p></div>' +
      '</div>' +
      '<div class="dt__body">' +
        (p.bio ? '<section><h3 class="sec__title">نبذة</h3><p class="overview">' + esc(p.bio) + '</p></section>' : '') +
        '<section><h3 class="sec__title">أعماله</h3>' +
          '<div class="grid">' + cards(list) + '</div>' +
          (shown < p.works.length
            ? '<div class="loadmore"><button class="btn" data-person-more>اعرض المزيد</button>' +
              '<p class="loadmore__note">' + shown + ' من ' + p.works.length + '</p></div>' : '') +
        '</section>' +
      '</div>';
  }

  /* ---------- حالات فارغة ---------- */

  function emptyHtml(query, meta) {
    meta = meta || {};
    if (meta.tmdbError) {
      return '<b>🔴 TMDB ما رد</b><p>' + esc(meta.tmdbError) + '</p>' +
        '<div style="margin-top:1.2rem"><button class="btn" data-diagnose>🔍 افحص الاتصال</button></div>' +
        '<p style="margin-top:1rem;font-size:.82rem">🟢 البحث بوصف القصة عبر ويكيبيديا يضل شغّالًا.</p>';
    }
    var tips = [
      'اكتب المشهد اللي تذكره بالتفصيل: «رجل يجلس على كرسي متحرك ويراقب جيرانه».',
      'جرّب زر «ترجم EN» جنب البحث — تغطية ويكيبيديا الإنجليزية أوسع بكثير.',
      'اذكر أسماء الممثلين أو المخرج لو تذكرها.'
    ];
    var head = '<b>🔴 ما لقيت شي لـ «' + esc(query) + '»</b>';

    /* لو البوابة هي اللي فرّغت النتيجة نقولها صراحة — الفرق مهم:
       «ما فيه عمل بهذا الوصف» غير «فيه أعمال بس ما هي محتوى جنسي» */
    if (meta.gateIn && !meta.gateOut) {
      return head +
        '<p>وصلت ' + meta.gateIn + ' نتيجة، وكلها طلعت خارج المحتوى الجنسي فانحجبت. ' +
        'الموقع ما يعرض إلا الأعمال اللي TMDB وسمها بمحتوى جنسي.</p>' +
        '<p style="margin-top:.8rem">جرّب توصف المشهد نفسه بتفصيل أكثر، أو اكتبه بالإنجليزي.</p>';
    }
    if (meta.catalogSize !== undefined && meta.catalogSize < 150) {
      tips.unshift('الفهرس المحلي لسه صغير (' + meta.catalogSize + ' عمل) — تصفّح الأقسام شوي ' +
                   'وبيكبر تلقائيًا، والبحث بالوصف بيصير أدق.');
    }
    return head + '<p>جرّب كذا:</p><ul><li>' + tips.join('</li><li>') + '</li></ul>';
  }

  /* قسم المشاهدة من مصادر المشغّل */
  /* بيانات إضافية من مصادر المشغّل.
     المزوّدون يكرّرون بعض: MDBList وOMDb يعطيان تقييم IMDb نفسه.
     فندمج الكل في جدول واحد، كل قياس مرة وحدة، ومكتوب جنبه من وين جاء. */

  /* ترتيب العرض، وأي اسم يقابل أي قياس */
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

    var loading = blocks.filter(function (b) { return b.loading; });
    var skipped = blocks.filter(function (b) { return !b.loading && !b.ok && /^يحتاج /.test(b.detail || ''); });
    var failed  = blocks.filter(function (b) { return !b.loading && !b.ok && skipped.indexOf(b) === -1; });
    var okBlocks = blocks.filter(function (b) { return b.ok && b.rows && b.rows.length; });

    /* ندمج: أول مزوّد يعطي القياس هو المرجع، والباقي يُذكرون كمصادر مؤكِّدة */
    var merged = {}, order = [];
    okBlocks.forEach(function (b) {
      b.rows.forEach(function (r) {
        var label = String(r[0]), value = String(r[1]);
        if (!merged[label]) { merged[label] = { value: value, from: [b.name] }; order.push(label); }
        else if (merged[label].from.indexOf(b.name) === -1) {
          /* نفس القياس بقيمة مختلفة؟ نبيّن الاختلاف بدل ما نخفيه */
          if (merged[label].value !== value) merged[label].alt = merged[label].alt || [];
          if (merged[label].value !== value) merged[label].alt.push(b.name + ': ' + value);
          merged[label].from.push(b.name);
        }
      });
    });

    order.sort(function (a, b) { return metricRank(a) - metricRank(b); });

    var rows = order.map(function (label) {
      var m = merged[label];
      var v = /^https?:\/\//.test(m.value)
        ? '<a href="' + esc(m.value) + '" target="_blank" rel="noopener noreferrer">' + esc(m.value) + '</a>'
        : esc(m.value);
      return '<div class="mrow"><span class="mrow__k">' + esc(label) + '</span>' +
        '<b class="mrow__v">' + v + '</b>' +
        '<i class="mrow__src" title="' + esc(m.from.join(' · ')) + '">' + esc(m.from[0]) +
        (m.from.length > 1 ? ' +' + (m.from.length - 1) : '') + '</i>' +
        (m.alt ? '<i class="mrow__alt">' + esc(m.alt.join(' · ')) + '</i>' : '') +
        '</div>';
    }).join('');

    var notes = [];
    if (loading.length) notes.push('⏳ ' + loading.map(function (b) { return esc(b.name); }).join('، '));
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
    skeletons: skeletons,
    card: card,
    cards: cards,
    detail: detail,
    detailSkeleton: detailSkeleton,
    storySection: storySection,
    relatedSection: relatedSection,
    extraSources: extraSources,
    person: person,
    emptyHtml: emptyHtml,
    itemKey: itemKey,
    linksHtml: linksHtml,
    voteBar: voteBar,
    certBadge: certBadge,
    kindBadge: kindBadge,
    TYPE_AR: TYPE_AR
  };

})(window.CS);
