/* ============================================================
   app.js — RANHUB: التوجيه، الأحداث، وربط كل شي مع بعض
   الصفحات: الاستكشاف · النتائج · العمل · الشخص · المكتبة · الإعدادات
   ============================================================ */

(function (CS) {
  'use strict';

  var $  = function (sel, ctx) { return (ctx || document).querySelector(sel); };
  var $$ = function (sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); };

  var LIM = (CS.config && CS.config.limits) ||
            { pageSize: 50, suggest: 8, history: 12, wikiSearch: 14, wikiResolve: 10, keywordSeeds: 3 };

  var PAGE = 50;                /* كم عمل نضيف مع كل «اعرض المزيد» */
  var itemCache = {};

  function remember(list) {
    (list || []).forEach(function (it) { if (it) itemCache[CS.ui.itemKey(it)] = it; });
  }

  function attrEsc(v) { return String(v).replace(/(["\\])/g, '\\$1'); }
  var esc0 = CS.util.esc;

  /* التمرير يحترم «قلّل الحركة» — كان smooth مفروضًا دائمًا */
  function scrollTop(smooth) {
    var reduce = false;
    try { reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
    catch (e) { reduce = false; }
    window.scrollTo(smooth && !reduce ? { top: 0, behavior: 'smooth' } : { top: 0 });
  }

  /* الحافظة تُرفض في سفاري والسياقات غير الآمنة — لازم بديل ما يفشل بصمت */
  function copyLink(url, label) {
    var done = label || '🔗 انتسخ الرابط';
    function fallback() {
      try {
        var ta = document.createElement('textarea');
        ta.value = url;
        ta.setAttribute('readonly', '');
        ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
        document.body.appendChild(ta);
        ta.select();
        var ok = document.execCommand('copy');
        document.body.removeChild(ta);
        CS.ui.toast(ok ? done : url);
      } catch (e) { CS.ui.toast(url); }
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(function () { CS.ui.toast(done); }).catch(fallback);
      return;
    }
    fallback();
  }

  /* المشاركة: واجهة المشاركة الأصلية على الجوال، ونسخ الرابط على الحاسب */
  function shareUrl(url, title) {
    if (navigator.share) {
      navigator.share({ title: title || 'RANHUB', url: url })
        .catch(function () { copyLink(url); });
      return;
    }
    copyLink(url);
  }

  function fullUrl(hash) {
    return location.origin + location.pathname + (hash || location.hash || '#/');
  }

  /* ============================================================
     الصفحات ومسار التنقّل
     ============================================================ */

  var VIEWS = ['home', 'results', 'library', 'detail', 'person', 'settings'];

  function showView(name) {
    CS.state.view = name;
    VIEWS.forEach(function (v) {
      var el = $('#view-' + v);
      if (el) el.hidden = v !== name;
    });
  }

  function setCrumbs(path) {
    var bar = $('#crumbs');
    if (!bar) return;
    var html = CS.ui.crumbs(path);
    bar.innerHTML = html;
    bar.hidden = !html;
  }

  function tabCrumb() {
    return { label: titleFor(currentTab()), hash: '#/' };
  }

  /* ============================================================
     التصنيف ووسوم المحتوى — تحميل كسول ومحدود

     التحميل كان بلا سقف: كل بطاقة تكلّف طلبين إضافيين (الوسوم
     والتصنيف)، فصفحة فيها أربعين بطاقة تكلّف ثمانين طلبًا قبل ما
     يشوف المستخدم شيئًا. الآن:
       · الوسوم (البوابة) تُسحب لما نحتاجه للحكم فقط
       · التصنيف العمري (الشارة وحدها) يُسحب للمعروض على الشاشة
     ============================================================ */

  function ensureCerts(list, cap) {
    var need = (list || []).slice(0, cap || 24).filter(function (it) {
      return it.source === 'tmdb' && CS.certs.cachedFor(it) === undefined;
    });
    if (!need.length) return Promise.resolve();
    return CS.util.pool(need, 5, function (it) { return CS.certs.fetchFor(it); });
  }

  function ensureHeat(list, cap) {
    var need = (list || []).slice(0, cap || 40).filter(function (it) {
      return it.source === 'tmdb' && CS.certs.cachedHeat(it) === undefined;
    });
    if (!need.length) return Promise.resolve();
    return CS.util.pool(need, 6, function (it) { return CS.certs.fetchHeat(it); });
  }

  /* ترقية السجلّ الناقص — للمعروض فقط وبحدّ صغير. كان يعيد طلب
     ثلاثين سجلًّا مع كل إعادة رسم لمجرد تحسين شارة. */
  function upgradeHeat(list, cap) {
    var need = (list || []).slice(0, cap || 12).filter(function (it) {
      var h = it && it.source === 'tmdb' && CS.certs.cachedHeat(it);
      return !!(h && h.partial);
    });
    if (!need.length) return Promise.resolve();
    return CS.util.pool(need, 4, function (it) { return CS.certs.fetchHeat(it, true); });
  }

  function paintBadges(root, list, redraw) {
    (list || []).forEach(function (it) {
      var cardEl = root.querySelector('.card[data-key="' + attrEsc(CS.ui.itemKey(it)) + '"]');
      if (!cardEl) return;
      var row = cardEl.querySelector('.card__row--bottom');
      if (!row) return;

      var info = CS.certs.cachedFor(it);
      if (info && !row.querySelector('.card__cert')) {
        row.insertAdjacentHTML('afterbegin', CS.ui.certBadge(it));
      }

      var kindEl = row.querySelector('.card__kind');
      if (kindEl && (redraw || kindEl.classList.contains('card__kind--wait'))) {
        var fresh = CS.ui.kindBadge(it);
        if (fresh.indexOf('card__kind--wait') === -1) kindEl.outerHTML = fresh;
      }

      var poster = cardEl.querySelector('.card__poster');
      var heat = CS.certs.cachedHeat(it);
      if (poster && heat && heat.score && !poster.querySelector('.card__heat')) {
        it.heat = heat;
        /* esc0 لا attrEsc: attrEsc يهرّب بأسلوب جافاسكربت (\") وموزّع
           HTML ما يفهمه، فوسم يجي من TMDB فيه علامة اقتباس كان يكسر
           السمة ويحقن سمات جديدة. */
        poster.insertAdjacentHTML('beforeend',
          '<div class="card__heat" title="' + esc0('وسوم TMDB: ' + heat.tags.join('، ')) +
          '"><i style="width:' + CS.util.clamp(+heat.score || 0, 0, 100) + '%"></i></div>');
      }
    });
  }

  /* الشارة لازم تكون في كل الصفحات — تطابق ذوقك رقم حقيقي من تصويتك */
  function stampTaste(list) {
    var v = CS.taste.version ? CS.taste.version() : 0;
    var prof = CS.reco ? CS.reco.tasteProfile() : null;
    (list || []).forEach(function (it) {
      if (!it || it.matchBasis === 'query' || it.matchBasis === 'related') return;
      if (it.matchStamp === v) return;
      if (it.matchStamp !== v) {
        it.matchPct = CS.reco ? CS.reco.matchProfile(it, prof) : CS.taste.matchPct(it);
        it.matchStamp = v;
      }
    });
    return list;
  }

  /* الترطيب: التصنيف للمعروض، والوسوم للحكم، وكلها بحدود */
  function hydrate(root, list) {
    var n = (list || []).length;
    ensureCerts(list, Math.min(n, 30)).then(function () {
      paintBadges(root, list);
      dropDisqualified(root, list);
    });
    ensureHeat(list, Math.min(n, 40)).then(function () {
      paintBadges(root, list);
      return upgradeHeat(list, 12).then(function () { paintBadges(root, list, true); });
    });
  }

  function dropDisqualified(root, list) {
    if (!root) return;
    var dropped = 0;
    (list || []).forEach(function (it) {
      if (CS.certs.isAdultWork(it) === false) {
        var el = root.querySelector('.card[data-key="' + attrEsc(CS.ui.itemKey(it)) + '"]');
        if (el && el.parentNode) { el.parentNode.removeChild(el); dropped++; }
      }
    });
    if (!dropped) return;

    var grid = root.querySelector('#feed-grid') || (root.id === 'feed-grid' ? root : null);
    if (grid || root === $('#feed-grid')) {
      var left = $$('#feed-grid .card').length;
      var c = $('#feed-count');
      if (c) c.textContent = left ? left + ' عمل' : '';
      if (!left && CS.state.view === 'home') {
        $('#feed-empty').hidden = false;
        $('#feed-empty').innerHTML = emptyFeedHtml();
      }
      return;
    }
    var rleft = $$('#results-grid .card').length;
    var rc = $('#results-count');
    if (rc && $('#results-grid')) rc.textContent = rleft + ' من ' + rleft;
    if (!rleft && CS.state.view === 'results' && $('#results-empty')) {
      $('#results-empty').hidden = false;
    }
  }

  /* ============================================================
     وضع «للبالغين فقط» — يشمل الموقع كله
     ============================================================ */

  function adultOnlyOn() { return CS.store.get(CS.KEYS.adultOnly, true) !== false; }

  function setAdultOnly(on) {
    CS.store.set(CS.KEYS.adultOnly, !!on);
    CS.store.set(CS.KEYS.adultOn, !!on);
  }

  /* إظهار قسم Explicit — مفتاح يحفظه المستخدم في إعداداته */
  function explicitOn() { return CS.store.get(CS.KEYS.explicitOn, true) !== false; }

  function setExplicitOn(on) {
    CS.store.set(CS.KEYS.explicitOn, !!on);
    applyExplicitVisibility();
  }

  function applyExplicitVisibility() {
    var btn = $('.tab[data-tab="explicit"]');
    if (btn) btn.hidden = !explicitOn();
    if (!explicitOn() && currentTab() === 'explicit') {
      setTab('general');
      startFeed('general');
    }
  }

  /* ============================================================
     أقسام الموقع الثلاثة
     ============================================================ */
  var TABS = {
    general:  { title: '🌹 General',   cert: 'general'  },
    explicit: { title: '⛔ Explicit',  cert: 'explicit' },
    foryou:   { title: '✨ For You',   cert: 'general'  }
  };

  var HOME_TAB = 'general';

  function tabConf(tab) { return TABS[tab] || TABS[HOME_TAB]; }
  function certFor(tab) { return tabConf(tab).cert; }
  function titleFor(tab) { return tabConf(tab).title; }

  var feedBusy = false;
  var feedGen = 0;

  function currentTab() {
    var el = $('.tab.is-active[data-tab]');
    return el && TABS[el.dataset.tab] ? el.dataset.tab : HOME_TAB;
  }

  /* ------------------------------------------------------------
     الفلاتر — تُقرأ من الواجهة، وتُحفظ، وتنكتب في الرابط
     ------------------------------------------------------------ */

  function readFilters() {
    return {
      sort: ($('#feed-sort') || {}).value || 'popularity.desc',
      origLang: ($('#feed-lang') || {}).value || '',
      minRating: +(($('#feed-rating') || {}).value) || 0,
      mediaType: ($('#feed-type') || {}).value || '',
      country: ($('#feed-country') || {}).value || '',
      quality: ($('#feed-quality') || {}).value || '',
      yearFrom: yearField('#feed-year-from'),
      yearTo: yearField('#feed-year-to'),
      tag: +(($('#feed-cats') && $('#feed-cats').dataset.cat) || 0)
    };
  }

  /* التحقّق من المدخلات: السنة رقم داخل مدى معقول لا أي شي */
  function yearField(sel) {
    var el = $(sel);
    if (!el) return 0;
    var raw = String(el.value || '').trim();
    if (!raw) { el.setCustomValidity(''); return 0; }
    var n = parseInt(raw, 10);
    if (isNaN(n) || n < 1874 || n > 2100) {
      el.setCustomValidity('اكتب سنة بين ١٨٧٤ و٢١٠٠');
      el.classList.add('is-bad');
      return 0;
    }
    el.setCustomValidity('');
    el.classList.remove('is-bad');
    return n;
  }

  function applyFilters(f) {
    if (!f) return;
    if ($('#feed-sort'))    $('#feed-sort').value = f.sort || 'popularity.desc';
    if ($('#feed-lang'))    $('#feed-lang').value = f.origLang || '';
    if ($('#feed-rating'))  $('#feed-rating').value = String(f.minRating || 0);
    if ($('#feed-type'))    $('#feed-type').value = f.mediaType || '';
    if ($('#feed-country')) $('#feed-country').value = f.country || '';
    if ($('#feed-quality')) $('#feed-quality').value = f.quality || '';
    if ($('#feed-year-from')) $('#feed-year-from').value = f.yearFrom || '';
    if ($('#feed-year-to'))   $('#feed-year-to').value = f.yearTo || '';
    if ($('#feed-cats')) $('#feed-cats').dataset.cat = String(f.tag || 0);
  }

  function activeFilterCount(f) {
    f = f || readFilters();
    var n = 0;
    if (f.sort && f.sort !== 'popularity.desc') n++;
    if (f.origLang) n++;
    if (f.minRating) n++;
    if (f.mediaType) n++;
    if (f.country) n++;
    if (f.quality) n++;
    if (f.yearFrom) n++;
    if (f.yearTo) n++;
    if (f.tag) n++;
    return n;
  }

  function paintFilterCount() {
    var n = activeFilterCount();
    var el = $('#filter-count');
    if (!el) return;
    el.textContent = n;
    el.hidden = !n;
  }

  /* الفلاتر في الرابط: يفتح الرابط فيرجع نفس العرض بالضبط */
  function filtersToQuery(tab, f) {
    var p = [];
    if (tab && tab !== HOME_TAB) p.push('tab=' + tab);
    if (f.sort && f.sort !== 'popularity.desc') p.push('sort=' + encodeURIComponent(f.sort));
    if (f.mediaType) p.push('type=' + f.mediaType);
    if (f.origLang) p.push('lang=' + f.origLang);
    if (f.country) p.push('country=' + f.country);
    if (f.minRating) p.push('rating=' + f.minRating);
    if (f.quality) p.push('q=' + f.quality);
    if (f.yearFrom) p.push('from=' + f.yearFrom);
    if (f.yearTo) p.push('to=' + f.yearTo);
    if (f.tag) p.push('cat=' + f.tag);
    return p.join('&');
  }

  function queryToFilters(qs) {
    var out = {}, tab = '';
    String(qs || '').split('&').forEach(function (pair) {
      if (!pair) return;
      var i = pair.indexOf('=');
      var k = i === -1 ? pair : pair.slice(0, i);
      var v = i === -1 ? '' : decodeSafe(pair.slice(i + 1));
      switch (k) {
        case 'tab': tab = v; break;
        case 'sort': out.sort = v; break;
        case 'type': out.mediaType = v; break;
        case 'lang': out.origLang = v; break;
        case 'country': out.country = v; break;
        case 'rating': out.minRating = +v || 0; break;
        case 'q': out.quality = v; break;
        case 'from': out.yearFrom = +v || 0; break;
        case 'to': out.yearTo = +v || 0; break;
        case 'cat': out.tag = +v || 0; break;
      }
    });
    return { tab: tab, filters: out };
  }

  function syncHomeHash() {
    var f = readFilters();
    var qs = filtersToQuery(currentTab(), f);
    var h = qs ? '#/?' + qs : '#/';
    CS.store.set(CS.KEYS.filters, { tab: currentTab(), f: f });
    if (location.hash !== h) { suppressRoute = true; location.hash = h; }
  }

  /* ------------------------------------------------------------
     تشغيل القسم
     ------------------------------------------------------------ */

  function startFeed(tab, opts) {
    opts = opts || {};
    tab = TABS[tab] ? tab : HOME_TAB;
    if (tab === 'explicit' && !explicitOn()) tab = HOME_TAB;
    var cert = certFor(tab);

    /* كل الأقسام للبالغين، فالموافقة تُطلب مرة وحدة وتُحفظ */
    if (!CS.certs.adultConsent()) {
      var ok = window.confirm(
        'محتوى للبالغين فقط\n\n' +
        'كل أقسام هذا الموقع مخصّصة لأعمال الكبار (sensual · erotic · softcore ·\n' +
        'sexploitation · explicit nudity). تأكد إنك بالغ وإن استخدامه مسؤوليتك.\n\n' +
        'تبي تكمّل؟'
      );
      if (!ok) {
        setAdultOnly(false);
        setTab(tab);
        $('#feed-title').textContent = titleFor(tab);
        $('#feed-grid').innerHTML = '';
        $('#feed-count').textContent = '';
        $('#feed-more').hidden = true;
        $('#feed-empty').hidden = false;
        $('#feed-empty').innerHTML =
          '<b>🔒 ما فتحت المحتوى</b>' +
          '<p>أقسام الموقع الثلاثة كلها لأعمال الكبار، فبدون الموافقة ما فيه شي يُعرض.</p>' +
          '<div class="empty__acts"><button class="btn" data-retry-home>وافقت — اعرض المحتوى</button></div>';
        return;
      }
      CS.store.set(CS.KEYS.adultOn, true);
      setAdultOnly(true);
    }

    CS.store.set(CS.KEYS.certTier, cert);
    CS.store.set(CS.KEYS.tab, tab);
    autoRounds = 0;

    feedGen++;
    feedBusy = false;

    setTab(tab);
    $('#feed-title').textContent = titleFor(tab);
    setCrumbs([{ label: '🏠 الاستكشاف', hash: '#/' }, tabCrumb()]);

    var f = readFilters();
    paintFilterCount();

    CS.feed.reset({
      tab: tab,
      sort: f.sort,
      origLang: f.origLang,
      minRating: f.minRating,
      mediaType: f.mediaType,
      country: f.country,
      quality: f.quality,
      yearFrom: f.yearFrom,
      yearTo: f.yearTo,
      tag: f.tag
    });

    $('#feed-grid').innerHTML = CS.ui.skeletons(18);
    $('#feed-grid').setAttribute('aria-busy', 'true');
    $('#feed-empty').hidden = true;
    $('#feed-more').hidden = true;
    $('#feed-count').textContent = '';
    if (!opts.skipHash) syncHomeHash();
    scheduleShelves();
    loadFeed(true);
  }

  /* ------------------------------------------------------------
     أزرار التصنيفات
     ------------------------------------------------------------ */
  function paintCats() {
    var box = $('#feed-cats');
    if (!box || !CS.feed) return;
    var list = CS.feed.allCategories();
    if (!list.length) return;

    var active = +(box.dataset.cat || 0);

    var html = '<button class="cat' + (active ? '' : ' is-on') + '" data-cat="0" type="button" ' +
      'aria-pressed="' + (active ? 'false' : 'true') + '">الكل</button>';
    list.forEach(function (c) {
      var on = active === c.id;
      html += '<button class="cat' + (on ? ' is-on' : '') + '" data-cat="' + c.id + '" ' +
        'type="button" aria-pressed="' + (on ? 'true' : 'false') + '">' + esc0(c.name) + '</button>';
    });
    box.innerHTML = html;
  }

  function setCat(tag) {
    var box = $('#feed-cats');
    if (box) box.dataset.cat = String(tag || 0);
    paintCats();
    startFeed(currentTab());
  }

  function setTab(tab) {
    $$('.tab[data-tab]').forEach(function (t) {
      var on = t.dataset.tab === tab;
      t.classList.toggle('is-active', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
    });
  }

  var autoRounds = 0;

  /* ------------------------------------------------------------
     الرسم المبكر.

     البوابة تحتاج وسوم TMDB، وانتظار وسوم أربعين عملًا قبل أول رسم
     كان يخلّي الشاشة هياكل فاضية ثوانيَ كاملة على اتصال بارد. لكن
     جزءًا من الجولة محسوم بلا أي طلب: العمل الراجع من /discover
     بكلمة قوية يحمل تلك الكلمة قطعًا، فبذرتها تفتح له البوابة
     مجانًا. نرسم المحسوم فورًا، وبقيّة الجولة تكمل في الخلفية
     ويُعاد الرسم كاملًا. ما نرسم شيئًا لم تحسمه البوابة.
     ------------------------------------------------------------ */
  var EARLY_MIN = 6;

  function paintEarly(items) {
    var grid = $('#feed-grid');
    if (!grid || grid.querySelector('.card')) return;   /* فيه معروض أصلًا */

    var st = CS.feed.current();
    /* «توصيتي» نسبته تُحسب بعد وصول الوسوم — رسم مبكر فيه يعرض أرقامًا
       تتغيّر تحت عين المستخدم، فنتركه للرسم الكامل */
    if (st.tab === 'foryou') return;

    var tagOn = !!st.tag;
    var ready = (items || []).filter(function (it) {
      return CS.certs.isAdultWork(it) === true && (tagOn || CS.certs.kindFits(it) !== false);
    });
    if (ready.length < EARLY_MIN) return;

    $('#feed-empty').hidden = true;
    /* اللي نرسمه نعرفه: النقر على بطاقة مرسومة مبكرًا لازم يفتح
       صفحتها من الذاكرة لا يعيد جلبها */
    remember(ready);
    stampTaste(ready);
    grid.innerHTML = CS.ui.cards(ready);
    grid.setAttribute('aria-busy', 'true');   /* الجولة ما خلصت بعد */
    $('#feed-count').textContent = '';
  }

  function loadFeed(first) {
    if (feedBusy) return;
    feedBusy = true;
    var gen = feedGen;
    var btn = $('#btn-feed-more');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ يحمّل…'; }

    CS.feed.loadMore(function (sofar) {
      /* بعد كل جولة: المحسوم بلا طلب يظهر الآن، لا بعد الدفعة كاملة
         ولا بعد أربعين نداء وسوم */
      if (gen !== feedGen || CS.state.view !== 'home') return;
      paintEarly(sofar);
    }).then(function (res) {
      if (gen !== feedGen) return;
      if (CS.state.view !== 'home') { feedBusy = false; return; }

      var items = res.items;
      remember(items);
      paintEarly(items);

      /* البوابة تحتاج وسوم كل عمل بنرسمه — حدّ ثابت لكل جولة */
      return ensureHeat(items, 40).then(function () {
        if (gen !== feedGen) return;
        feedBusy = false;
        if (CS.state.view !== 'home') return;
        paintFeed(items, res, first, btn);
      });
    }).catch(function (err) {
      if (gen !== feedGen) return;
      feedBusy = false;
      if (btn) { btn.disabled = false; btn.textContent = 'اعرض المزيد'; }
      if (CS.state.view !== 'home') return;
      showFeedError(err && err.message === 'NO_KEY' ? 'ما فيه مفتاح TMDB ولا وسيط' : CS.tmdb.explain(err));
    });
  }

  function showFeedError(why) {
    showTmdbProblem(why);
    $('#feed-grid').innerHTML = '';
    $('#feed-grid').setAttribute('aria-busy', 'false');
    $('#feed-count').textContent = '';
    $('#feed-empty').hidden = false;
    $('#feed-empty').innerHTML = CS.ui.errorHtml('ما قدرت أوصل لـ TMDB', why,
      '<button class="btn" data-diagnose>🔍 افحص الاتصال</button>' +
      '<button class="btn btn--ghost" data-retry-home>أعد المحاولة</button>');
  }

  function paintFeed(items, res, first, btn) {
    var strongBtn = $('#btn-index-strong');
    if (strongBtn) strongBtn.disabled = false;
    $('#feed-grid').setAttribute('aria-busy', 'false');

    var st = CS.feed.current();

    /* الشبكة رجعت فاضية لأن TMDB ما رد، لا لأن الفلاتر ضيّقة.
       كان الفرق ضائعًا: يُعرض «ما وصل شي بهذي الفلاتر» والمفتاح ميت. */
    if (!items.length && (st.lastError || st.hardFail)) {
      showFeedError(CS.tmdb.explain({ message: st.lastError, host: st.lastErrorHost }));
      if (btn) { btn.disabled = false; btn.textContent = 'اعرض المزيد'; }
      return;
    }

    var tagOn = !!st.tag;
    var shown = items.filter(function (it) {
      return CS.certs.isAdultWork(it) === true && (tagOn || CS.certs.kindFits(it) !== false);
    });

    /* «توصيتي»: العتبة تُطبَّق هنا — بعد وصول الوسوم — فالنسبة مبنيّة
       على الوسوم والمخرج والممثلين واللغة والفترة لا على النوع
       السينمائي وحده. ونفس الرقم هو المعروض على البطاقة. */
    if (st.tab === 'foryou' && CS.reco) {
      var prof = CS.reco.tasteProfile();
      var tv = CS.taste.version ? CS.taste.version() : 0;
      shown.forEach(function (it) {
        it.matchPct = CS.reco.matchProfile(it, prof);
        it.matchStamp = tv;
      });
      shown = shown.filter(function (it) { return (it.matchPct || 0) >= st.forYouMin; });
      /* الموضوع ثم الأشخاص، والحشو أخيرًا مهما كانت نسبته */
      function weight(x) {
        return (x.themeHit ? 4 : 0) + (x.personHit ? 2 : 0) - (x.fillerHit ? 3 : 0);
      }
      shown.sort(function (a, b) {
        var t = weight(b) - weight(a);
        if (t) return t;
        return (b.matchPct || 0) - (a.matchPct || 0);
      });
    }

    /* الفلترة تاكل من الحصيلة — نكمّل تحميلًا تلقائيًا بدل صفحة شبه فاضية */
    var maxRounds = tagOn ? 4 : 3;
    if (shown.length < 24 && !res.exhausted && autoRounds < maxRounds) {
      autoRounds++;
      if (shown.length) {
        $('#feed-empty').hidden = true;
        stampTaste(shown);
        $('#feed-grid').innerHTML = CS.ui.cards(shown);
        hydrate($('#feed-grid'), shown);
      }
      loadFeed(first);
      return;
    }

    if (!shown.length) {
      scheduleSweep();
      $('#feed-grid').innerHTML = '';
      $('#feed-count').textContent = '';        /* كان يبقى عدّاد التصنيف السابق */
      $('#feed-empty').hidden = false;
      $('#feed-empty').innerHTML = emptyFeedHtml();
      $('#feed-more').hidden = res.exhausted;
      if (btn) { btn.disabled = false; btn.textContent = 'اعرض المزيد'; }
      return;
    }

    $('#feed-empty').hidden = true;
    stampTaste(shown);
    if (CS.catalog) CS.catalog.add(shown);
    $('#feed-grid').innerHTML = CS.ui.cards(shown);
    $('#feed-count').textContent = shown.length + ' عمل' + (res.exhausted ? ' — خلصت المادة' : '');
    $('#feed-more').hidden = res.exhausted;
    if (btn) { btn.disabled = false; btn.textContent = 'اعرض المزيد'; }
    hydrate($('#feed-grid'), shown);
    if (first) scrollTop(true);
    paintIndexBtn();
    scheduleSweep();
  }

  /* الفهرس المحلي يكبر في الخلفية بعد ما تستقر الصفحة */
  var sweepQueued = false;
  function scheduleSweep() {
    if (sweepQueued || !CS.catalog) return;
    sweepQueued = true;
    var go = function () {
      CS.catalog.sweep()
        .then(function () { paintIndexBtn(); })
        .catch(function () {});
    };
    if (window.requestIdleCallback) window.requestIdleCallback(go, { timeout: 6000 });
    else setTimeout(go, 3500);
  }

  /* ============================================================
     الصفوف الجاهزة
     ============================================================ */

  var shelvesPainted = false;
  var shelvesQueued = false;

  /* الصفوف الجاهزة تكلّف طلبات، والشبكة الرئيسية أهمّ منها.
     صفّ «كمّل مشاهدتك» يُرسم فورًا (من المكتبة بلا شبكة)، والثلاثة
     الباقية تنتظر حتى تستقر الصفحة فما تزاحم أول بطاقة على الحصّة. */
  function scheduleShelves() {
    paintShelves(true);          /* الفوري الآن */
    if (shelvesQueued) return;
    shelvesQueued = true;
    var go = function () { shelvesQueued = false; paintShelves(false); };
    if (window.requestIdleCallback) window.requestIdleCallback(go, { timeout: 3000 });
    else setTimeout(go, 1500);
  }

  function paintShelves(localOnly) {
    var box = $('#shelves');
    if (!box) return;
    var tab = currentTab();

    /* صف «كمّل مشاهدتك» فوري — من مكتبتك بلا أي طلب */
    var cont = CS.library.progress.recent(14).map(function (r) { return r.meta; })
      .filter(function (m) { return m && m.poster; });

    var head = cont.length
      ? CS.ui.shelf({ id: 'continue', title: '▶️ كمّل مشاهدتك',
                      note: 'من آخر نقطة وقفت عندها', items: cont })
      : '';

    /* الصفوف الأخرى للقسم العام فقط — القسم الصريح وتوصيتي لهما
       منطقهما الخاص، وحشوهما بصفوف عامة يشوّش عليهما */
    if (tab !== 'general') {
      box.innerHTML = head;
      return;
    }

    if (shelvesPainted && box.querySelector('[data-shelf="top"]')) {
      /* موجودة أصلًا — نحدّث صف «كمّل» وحده */
      var old = box.querySelector('[data-shelf="continue"]');
      if (old) old.outerHTML = head;
      else box.insertAdjacentHTML('afterbegin', head);
      return;
    }

    /* الجولة الفورية ترسم «كمّل» فقط وتترك الباقي للجولة المؤجَّلة */
    if (localOnly) { box.innerHTML = head; return; }

    box.innerHTML = head +
      CS.ui.shelf({ id: 'top', title: '⭐ الأعلى تقييمًا', loading: true }) +
      CS.ui.shelf({ id: 'new', title: '🆕 الأحدث', loading: true }) +
      CS.ui.shelf({ id: 'hot', title: '🔥 الأكثر رواجًا', loading: true });
    shelvesPainted = true;

    [['top', '⭐ الأعلى تقييمًا'], ['new', '🆕 الأحدث'], ['hot', '🔥 الأكثر رواجًا']].forEach(function (row) {
      CS.feed.shelf(row[0], 16).then(function (items) {
        return ensureHeat(items, 14).then(function () {
          var ok = items.filter(function (it) {
            return CS.certs.isAdultWork(it) === true && CS.certs.kindFits(it) !== false;
          }).slice(0, 14);
          remember(ok);
          stampTaste(ok);
          if (CS.catalog) CS.catalog.add(ok);
          var slot = box.querySelector('[data-shelf="' + row[0] + '"]');
          if (!slot) return;
          var html = CS.ui.shelf({ id: row[0], title: row[1], items: ok });
          if (!html) { slot.remove(); return; }
          slot.outerHTML = html;
          var fresh = box.querySelector('[data-shelf="' + row[0] + '"]');
          if (fresh) hydrate(fresh, ok);
        });
      }).catch(function () {
        var slot = box.querySelector('[data-shelf="' + row[0] + '"]');
        if (slot) slot.remove();
      });
    });
  }

  /* ============================================================
     زرّ الفهرس
     ============================================================ */
  var INDEX_THIN = 500;

  function paintIndexBtn(state) {
    var btn = $('#btn-index');
    if (!btn) return;
    if (!CS.catalog) { btn.hidden = true; return; }

    var n = CS.catalog.size();
    var txt = btn.querySelector('.idxbtn__txt');
    var num = btn.querySelector('#index-count');

    btn.classList.toggle('is-busy', state === 'busy');
    btn.classList.toggle('is-thin', state !== 'busy' && n < INDEX_THIN);
    if (num) num.textContent = n;

    if (!txt) return;
    if (state === 'busy') { txt.textContent = 'يوسّع الفهرس…'; return; }
    txt.textContent = n < INDEX_THIN ? 'وسّع فهرس البحث' : 'حدّث الفهرس';
    btn.title = n < INDEX_THIN
      ? 'فهرس البحث لسه صغير (' + n + ' عمل) — اضغط عشان يكبر ويصير البحث بالوصف أدق'
      : 'فهرس البحث: ' + n + ' عمل محفوظ بملخّصه — اضغط عشان يلتقط الجديد';
  }

  function runSweep(fromButton) {
    if (!CS.catalog) return;
    paintIndexBtn('busy');

    var floor = new Promise(function (r) { setTimeout(r, 450); });

    CS.catalog.sweep(true).then(function (added) {
      return floor.then(function () { return added; });
    }).then(function (added) {
      paintIndexBtn();
      if ($('#view-settings') && !$('#view-settings').hidden) renderSettings();
      if (!fromButton) return;
      CS.ui.toast(added > 0
        ? '⚡ انضاف ' + added + ' عمل لفهرس البحث'
        : '🟡 الفهرس محدَّث — ما فيه جديد في هذي الجولة');
    }).catch(function () {
      paintIndexBtn();
      if (fromButton) CS.ui.toast('🔴 ما قدرت أوسّع الفهرس');
    });
  }

  function runDeepSweep() {
    var btn = $('#btn-index-strong');
    var tab = currentTab();

    CS.store.set(CS.KEYS.certTier, certFor(tab));
    autoRounds = 0;
    var f = readFilters();
    /* التصنيف المختار كان يسقط هنا بصمت: الزرّ يرجّع القسم كله
       والشريحة تضل مضيئة، فالواجهة تدّعي فلترًا غير مطبَّق */
    CS.feed.reset({
      tab: tab, sort: f.sort, origLang: f.origLang, minRating: f.minRating,
      mediaType: f.mediaType, country: f.country, quality: f.quality,
      yearFrom: f.yearFrom, yearTo: f.yearTo, tag: f.tag, strong: true
    });
    $('#feed-title').textContent = titleFor(tab);
    $('#feed-grid').innerHTML = CS.ui.skeletons(18);
    $('#feed-empty').hidden = true;
    $('#feed-more').hidden = true;
    if (btn) btn.disabled = true;
    CS.ui.toast('🔄 تحديث قوي — يجيب أعمالًا أقوى…');
    loadFeed(true);

    if (CS.catalog && CS.catalog.deepSweep) {
      CS.catalog.deepSweep().then(function () { paintIndexBtn(); }).catch(function () {});
    }
  }

  function emptyFeedHtml() {
    var tab = currentTab();
    var name = titleFor(tab);
    var st = CS.feed.current();

    if (tab === 'foryou') {
      var n = CS.taste.counts().likes;
      if (!n) {
        return '<b>✨ For You — ما فيه شي أبني عليه بعد</b>' +
          '<p>هذا القسم ما يستكشف بكلمات، يبني على أعمالك اللي عجبتك. ' +
          'اضغط 👍 على أي عمل في الأقسام الثانية وارجع هنا.</p>' +
          '<div class="empty__acts"><button class="btn" data-go-general>🌹 روح لقسم General</button></div>';
      }
      return '<b>✨ For You — ما وصل شي من كتالوج الموقع</b>' +
        '<p>عندك ' + n + ' عمل بـ👍، وبنينا الترشيح من وسومها وقصصها ومخرجيها وممثليها، لكن ما طلع ' +
        'شي يطابقها بنسبة ' + CS.feed.FORYOU_MIN + '٪ فما فوق بهذي الفلاتر.</p>' +
        '<div class="empty__acts"><button class="btn btn--ghost" id="btn-filters-reset-2">صفّر التصفية</button>' +
        '<button class="btn" data-go-general>🌹 روح لقسم General</button></div>';
    }

    if (st.tag) {
      return '<b>🟡 تصنيف «' + esc0(CS.feed.tagNameOf(st.tag)) + '» — ما طلع منه شي</b>' +
        '<p>التصنيف موجود عند TMDB، لكن أعماله في هذي الصفحات ما تحمل وسمًا جنسيًا ثانيًا، ' +
        'وبوابة الموقع ما تمرّر إلا اللي TMDB وسمه بمحتوى جنسي. جرّب تصنيفًا أقرب للموضوع ' +
        'أو وسّع الفلاتر.</p>' +
        '<div class="empty__acts"><button class="btn" data-cat-all>اعرض كل التصنيفات</button>' +
        '<button class="btn btn--ghost" id="btn-filters-reset-2">صفّر التصفية</button></div>';
    }

    return '<b>🟡 ' + esc0(name) + ' — ما وصل شي بهذي الفلاتر</b>' +
      '<p>هذا القسم يبني نفسه من كلمات TMDB المفتاحية، وكتالوجها لهذا النوع محدود أصلًا. ' +
      'رجّع «اللغة الأصلية» لـ«كل اللغات» و«أقل تقييم» لـ«أي تقييم» — الفلترين هما اللي يقصّونه غالبًا.</p>' +
      '<div class="empty__acts">' +
      '<button class="btn btn--ghost" id="btn-filters-reset-2">صفّر التصفية</button>' +
      '<button class="btn" data-retry-home>أعد المحاولة</button>' +
      '<button class="btn btn--ghost" data-diagnose>🔍 افحص الاتصال</button></div>';
  }

  /* ============================================================
     النتائج
     ============================================================ */

  var searchToken = 0;

  function sortResults(list) {
    var mode = ($('#results-sort') || {}).value || 'match';
    var l = list.slice();
    if (mode === 'match') return l;
    if (mode === 'title.asc') {
      l.sort(function (a, b) { return String(a.title || '').localeCompare(String(b.title || ''), 'ar'); });
    } else if (mode === 'primary_release_date.desc') {
      l.sort(function (a, b) { return (b.year || 0) - (a.year || 0); });
    } else if (mode === 'vote_average.desc') {
      l.sort(function (a, b) { return (b.rating || 0) - (a.rating || 0); });
    } else if (mode === 'popularity.desc') {
      l.sort(function (a, b) { return (b.popularity || 0) - (a.popularity || 0); });
    }
    return l;
  }

  function paintResults() {
    var grid = $('#results-grid');
    var empty = $('#results-empty');
    var more = $('#loadmore-wrap');
    var all = CS.state.results;

    var pre = ensureHeat(all, Math.min(all.length, 60));
    grid.setAttribute('aria-busy', 'true');

    pre.then(function () {
      var list = all.filter(function (it) {
        return CS.certs.isAdultWork(it) === true && CS.certs.kindFits(it) !== false;
      });
      grid.setAttribute('aria-busy', 'false');

      if (!list.length) {
        grid.innerHTML = '';
        paintRelatedBlock(0);
        empty.hidden = false;
        var meta = CS.state.meta || {};
        empty.innerHTML = CS.ui.emptyHtml(CS.state.query, meta);
        more.hidden = true;
        $('#results-meta').textContent = buildMetaText(0);
        return;
      }

      empty.hidden = true;
      list = sortResults(list);
      var slice = list.slice(0, CS.state.shown);
      grid.innerHTML = CS.ui.cards(slice);
      paintRelatedBlock(list.length);
      more.hidden = list.length <= CS.state.shown;
      $('#results-count').textContent = slice.length + ' من ' + list.length;
      $('#results-meta').textContent = buildMetaText(list.length);
      hydrate(grid, slice);
    });
  }

  /* الأعمال القريبة من أفضل نتيجة — كتلة مستقلة خارج شبكة النتائج.
     دمجها في نفس الشبكة كان يحوّل بحثًا إجابته عمل واحد إلى ٢٣ بطاقة
     عشرون منها ما لها علاقة ببحثك، ويكذب العدّاد. */
  function paintRelatedBlock(shownTotal) {
    var box = $('#results-related');
    if (!box) return;
    var m = CS.state.meta || {};
    if (!m.relatedItems || !m.relatedItems.length || CS.state.shown < shownTotal) {
      box.innerHTML = '';
      return;
    }
    remember(m.relatedItems);
    box.innerHTML = '<section class="results__related">' +
      '<h3 class="sec__title">وقريب من «' + esc0(m.relatedOf) + '» ' +
      '<span class="sec__note">مو نتائج بحثك — أعمال قريبة من أقوى نتيجة</span></h3>' +
      '<div class="grid">' + CS.ui.cards(m.relatedItems) + '</div></section>';
    hydrate(box, m.relatedItems);
  }

  /* ============================================================
     «أعمال مثل هذا»
     ============================================================ */
  function openSimilar(type, id) {
    var token = ++searchToken;
    var key = type + '/' + id;
    var known = itemCache[key] || null;

    showView('results');
    suggestOff = true;
    hideSuggest();
    setCrumbs([{ label: '🏠 الاستكشاف', hash: '#/' },
               { label: known ? known.title : 'العمل', hash: '#/work/' + key },
               { label: '🎯 أعمال مثله' }]);
    $('#results-title').textContent = '🎯 أعمال مثل ' + (known ? '«' + known.title + '»' : 'هذا العمل');
    $('#results-meta').textContent = 'يقيس القرب…';
    $('#results-grid').innerHTML = CS.ui.skeletons(12);
    $('#results-empty').hidden = true;
    $('#loadmore-wrap').hidden = true;
    if ($('#results-related')) $('#results-related').innerHTML = '';
    scrollTop(true);

    var heat = known && CS.certs.cachedHeat(known);
    var haveKw = known && known.keywords && known.keywords.length;
    var base = haveKw ? Promise.resolve(known)
      : (heat && heat.names && !heat.partial && known)
        ? Promise.resolve(Object.assign({}, known, {
            keywords: heat.names.map(function (n) { return { name: n }; })
          }))
        : CS.tmdb.details(type, id).catch(function () { return known; });

    base.then(function (d) {
      if (token !== searchToken) return;
      if (!d) throw new Error('NO_WORK');

      $('#results-title').textContent = '🎯 أعمال مثل «' + d.title + '»';
      remember([d]);
      if (d.keywords && d.keywords.length) {
        CS.certs.putHeat(d, d.heat || CS.certs.heatOf(d.keywords, d.adult, d.descriptors));
        if (CS.catalog) CS.catalog.put(d, { keywords: d.keywords, overviewAr: d.arOverview, titleAr: d.arTitle });
      }

      var ex = {};
      ex[(type === 'tv' ? 'v' : 'm') + id] = true;
      var local = CS.catalog ? CS.catalog.candidates(d, { exclude: ex, limit: 400 }) : [];

      return Promise.all([
        CS.tmdb.relatedPage(type, id, 'recommendations', 1).catch(function () { return { items: [] }; }),
        CS.tmdb.relatedPage(type, id, 'similar', 1).catch(function () { return { items: [] }; })
      ]).then(function (r) {
        if (token !== searchToken) return;
        var seen = {};
        seen[type + ':' + id] = true;
        local.forEach(function (it) { seen[it.type + ':' + it.id] = true; });

        var api = [];
        [r[0].items || [], r[1].items || []].forEach(function (list) {
          list.forEach(function (it) {
            var k = it.type + ':' + it.id;
            if (seen[k] || !it.poster) return;
            seen[k] = true;
            api.push(it);
          });
        });

        return ensureHeat(api, Math.min(api.length, 40)).then(function () {
          if (token !== searchToken) return;
          var apiOk = api.filter(function (it) {
            return CS.certs.isAdultWork(it) === true && CS.certs.kindFits(it) !== false;
          });
          if (CS.catalog) CS.catalog.add(apiOk);

          var all = CS.reco.rank(d, local.concat(apiOk), { exclude: ex });

          CS.state.results = all;
          CS.state.meta = { similarOf: d.title, fromIndex: local.length, fromApi: apiOk.length };
          CS.state.shown = PAGE;
          remember(all);

          if (!all.length) {
            $('#results-grid').innerHTML = '';
            $('#results-empty').hidden = false;
            $('#results-empty').innerHTML =
              '<b>🟡 ما لقيت عملًا قريبًا من «' + esc0(d.title) + '»</b>' +
              '<p>القرب يُقاس بالوسوم المشتركة وتقاطع القصة والمخرج والممثلين واللغة والفترة، ' +
              'والفهرس المحلي لسه ما فيه مادة كافية. وسّع الفهرس من الرئيسية وارجع.</p>' +
              '<div class="empty__acts"><button class="btn" data-back-home>رجوع للاستكشاف</button></div>';
            $('#results-meta').textContent = '';
            $('#loadmore-wrap').hidden = true;
            return;
          }
          paintResults();
        });
      });
    }).catch(function (err) {
      if (token !== searchToken) return;
      $('#results-grid').innerHTML = '';
      $('#results-empty').hidden = false;
      $('#results-empty').innerHTML = CS.ui.errorHtml('ما قدرت أقيس القرب',
        err && err.message === 'NO_WORK' ? 'ما لقيت هذا العمل' : CS.tmdb.explain(err),
        '<button class="btn btn--ghost" data-back-home>رجوع</button>');
    });
  }

  function buildMetaText(count) {
    var m = CS.state.meta || {};
    if (m.similarOf) {
      var b = [count + ' عمل قريب'];
      if (m.fromIndex) b.push('⚡ ' + m.fromIndex + ' من الفهرس المحلي');
      if (m.fromApi) b.push('🎬 ' + m.fromApi + ' من ترشيحات TMDB');
      b.push('القرب من الوسوم والقصة والمخرج والممثلين واللغة والفترة');
      return b.join(' · ');
    }
    var bits = [count + ' نتيجة'];
    if (m.intent === 'plot')  bits.push('🔎 بحثت بالقصة والوصف');
    if (m.corrections && m.corrections.length) {
      bits.push('✍️ صحّحت: ' + m.corrections.map(function (c) { return c.from + ' ← ' + c.to; }).join('، '));
    }
    if (m.categories && m.categories.length) bits.push('🏷️ تصنيف: ' + m.categories.join('، '));
    if (m.gateDropped)        bits.push('🚫 حجبت ' + m.gateDropped + ' خارج المحتوى');
    if (m.catalogHits)        bits.push('⚡ ' + m.catalogHits + ' من الفهرس المحلي');
    if (m.warmedIndex)        bits.push('⏳ وسّعت الفهرس قبل البحث');
    if (m.intent === 'mixed') bits.push('🔎 بحثت بالاسم والقصة معًا');
    if (m.translated) bits.push('جرّبت كمان بالإنجليزي: ' + m.translated);
    if (m.translationRejected) bits.push('🟡 الترجمة الآلية ما نفعت — اعتمدت المعجم');
    if (m.related) bits.push('+ ' + m.related + ' قريبة من «' + m.relatedOf + '»');
    if (m.tmdbError) bits.push('🔴 TMDB ما رد: ' + m.tmdbError);
    return bits.join(' · ');
  }

  function doSearch(query, skipHash, mode) {
    query = String(query || '').trim();
    if (!query) { location.hash = '#/'; return; }
    if (query.length > 160) query = query.slice(0, 160);

    CS.state.query = query;
    CS.history.push(query);

    $('#q').value = query;
    $('#btn-to-en').hidden = !CS.util.isArabic(query);
    suggestOff = true;
    hideSuggest();
    showView('results');
    setCrumbs([{ label: '🏠 الاستكشاف', hash: '#/' },
               { label: mode === 'theme' ? '#' + query : 'بحث: ' + query }]);
    $('#results-title').textContent = mode === 'theme' ? '#' + query.replace(/\s+/g, '-') : '«' + query + '»';
    $('#results-meta').textContent = 'يدور…';
    $('#results-grid').innerHTML = CS.ui.skeletons(12);
    $('#results-grid').setAttribute('aria-busy', 'true');
    $('#results-empty').hidden = true;
    $('#loadmore-wrap').hidden = true;
    if ($('#results-related')) $('#results-related').innerHTML = '';
    scrollTop(true);

    if (!skipHash) {
      var h = (mode === 'theme' ? '#/tag/' : '#/s/') + encodeURIComponent(query);
      if (location.hash !== h) { suppressRoute = true; location.hash = h; }
    }

    var token = ++searchToken;

    CS.search.run(query, mode || 'auto').then(function (res) {
      if (token !== searchToken) return;
      CS.state.results = res.items;
      CS.state.meta = res.meta;
      CS.state.shown = PAGE;
      remember(res.items);
      if (res.meta.tmdbError) showTmdbProblem(res.meta.tmdbError); else refreshKeyNotice();
      paintResults();
    }).catch(function (err) {
      if (token !== searchToken) return;
      $('#results-grid').innerHTML = '';
      $('#results-grid').setAttribute('aria-busy', 'false');
      $('#results-empty').hidden = false;
      $('#results-empty').innerHTML = CS.ui.errorHtml('صار خطأ في البحث', CS.tmdb.explain(err),
        '<button class="btn" data-retry-search>أعد المحاولة</button>');
    });
  }

  /* حوّل بحثي للإنجليزي — يظهر للنص العربي فقط، وما يترجم المترجَم */
  function searchInEnglish() {
    var q = $('#q').value.trim();
    if (!q) return;
    if (!CS.util.isArabic(q)) {
      CS.ui.toast('🟡 النص إنجليزي أصلًا');
      $('#btn-to-en').hidden = true;
      return;
    }
    var btn = $('#btn-to-en');
    btn.disabled = true;
    var was = btn.textContent;
    btn.textContent = '⏳';

    CS.wiki.toEnglish(q).then(function (en) {
      btn.disabled = false;
      btn.textContent = was;
      if (!en || en === q || CS.util.isArabic(en)) {
        CS.ui.toast('🔴 خدمة الترجمة ما ردّت — غالبًا انتهت الحصة اليومية. حط بريدك في الإعدادات.');
        return;
      }
      CS.ui.toast('🔤 ' + en);
      btn.hidden = true;
      doSearch(en);
    });
  }

  /* ============================================================
     المكتبة
     ============================================================ */

  var libTab = 'fav';

  function libLists() {
    return {
      fav:      { title: '⭐ المفضلة', items: CS.library.fav.all(),
                  empty: 'اضغط ⭐ على أي عمل وبيجي هنا، ويضل محفوظًا بين الجلسات.' },
      later:    { title: '🕗 أشوفه لاحقًا', items: CS.library.later.all(),
                  empty: 'اضغط 🕗 على أي عمل تبي ترجع له بعدين.' },
      continue: { title: '▶️ أكمل مشاهدتك', items: CS.library.progress.recent(200).map(function (r) { return r.meta; }),
                  empty: 'افتح أي مسلسل وعلّم الحلقة اللي وصلت لها، وبتلقاه هنا من آخر نقطة.' },
      follow:   { title: '🔔 أعمال متابَعة', items: CS.library.follow.all(),
                  empty: 'تابع أي مسلسل من صفحته ونخبّرك أول ما تنزل حلقة أو جزء جديد.' },
      liked:    { title: '👍 عجبني', items: CS.taste.likes(),
                  empty: 'اضغط 👍 تحت أي بوستر عشان يدخل هنا ويأثّر على التوصيات.' },
      disliked: { title: '👎 ما عجبني', items: CS.taste.dislikes(),
                  empty: 'اضغط 👎 على اللي ما عجبك وما نرشّح لك شبيهه.' }
    };
  }

  function renderLibrary() {
    showView('library');
    setCrumbs([{ label: '🏠 الاستكشاف', hash: '#/' }, { label: '🔖 مكتبتي' }]);

    var lists = libLists();
    var counts = {
      fav: lists.fav.items.length, later: lists.later.items.length,
      continue: lists.continue.items.length, follow: lists.follow.items.length,
      liked: lists.liked.items.length, disliked: lists.disliked.items.length
    };
    Object.keys(counts).forEach(function (k) {
      var el = $('#n-' + k);
      if (el) el.textContent = counts[k];
    });

    $$('#lib-tabs .tab').forEach(function (t) {
      var on = t.dataset.lib === libTab;
      t.classList.toggle('is-active', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
    });

    var conf = lists[libTab] || lists.fav;
    var items = (conf.items || []).filter(Boolean);
    remember(items);

    var total = counts.fav + counts.later + counts.continue + counts.follow + counts.liked;
    $('#lib-meta').textContent = total
      ? total + ' عمل محفوظ في متصفّحك · آخر نسخة احتياطية: ' +
        (CS.library.backup.lastAt() ? CS.util.ago(CS.library.backup.lastAt()) : 'ما سويت وحدة')
      : 'ما فيه شي محفوظ بعد';

    var acts = $('#lib-acts');
    if (acts) {
      acts.innerHTML = items.length
        ? '<button class="btn btn--ghost btn--sm" data-lib-clear="' + esc0(libTab) + '">🗑️ فضّي «' +
          esc0(conf.title.replace(/^\S+\s/, '')) + '»</button>' +
          (libTab === 'follow' ? '<button class="btn btn--ghost btn--sm" id="btn-check-new">🔔 افحص الجديد الآن</button>' : '')
        : '';
    }

    var grid = $('#lib-grid');
    var empty = $('#lib-empty');
    if (!items.length) {
      grid.innerHTML = '';
      empty.hidden = false;
      empty.innerHTML = '<b>' + esc0(conf.title) + ' — فاضية</b><p>' + esc0(conf.empty) + '</p>';
      updateLibCount();
      return;
    }

    empty.hidden = true;
    stampTaste(items);
    grid.innerHTML = CS.ui.cards(items);
    hydrate(grid, items);
    updateLibCount();
  }

  function updateLibCount() {
    var c = CS.library.counts();
    var n = c.fav + c.later + c.follow;
    var el = $('#lib-count');
    if (!el) return;
    el.textContent = n;
    el.hidden = n === 0;
  }

  function exportBackup() {
    var data = CS.library.backup.build();
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'ranhub-backup-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    CS.library.backup.markSaved();
    CS.ui.toast('💾 نزّلت نسخة كاملة من مكتبتك وإعداداتك');
    if (CS.state.view === 'library') renderLibrary();
  }

  function importBackup(file) {
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) { CS.ui.toast('🔴 الملف كبير جدًا — لازم أقل من ٨ ميغا'); return; }
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var data = JSON.parse(String(reader.result));
        var rep = CS.library.backup.restore(data, 'merge');
        var bits = [];
        if (rep.taste) bits.push(rep.taste + ' تصويت');
        if (rep.lists) bits.push(rep.lists + ' عمل في قوائمك');
        if (rep.progress) bits.push(rep.progress + ' متابعة مشاهدة');
        if (rep.settings) bits.push(rep.settings + ' إعداد');
        var msg = bits.length ? '♻️ رجّعت ' + bits.join(' · ') : '🟡 ما فيه شي جديد في الملف';
        /* الصدق في العدّ: قوائمك لها سقف، وما تجاوزه ما انحفظ */
        if (rep.dropped) msg += ' — و' + rep.dropped + ' ما دخلوا (القائمة وصلت سقفها)';
        CS.ui.toast(msg);
        updateLibCount();
        renderLibrary();
      } catch (e) {
        CS.ui.toast('🔴 الملف مو صالح — لازم يكون ملف نسخة احتياطية من RANHUB');
      }
    };
    reader.onerror = function () { CS.ui.toast('🔴 ما قدرت أقرأ الملف'); };
    reader.readAsText(file);
  }

  /* ============================================================
     صفحة العمل
     ============================================================ */

  var detailToken = 0;
  var detailCtx = null;
  var related = { items: [], pool: [], shown: 0, page: 0, exhausted: false, loading: false, autoRounds: 0 };
  var seasonView = { season: null, episodes: [], loading: false, error: '' };

  function repaintStory() {
    var sec = $('#dt-story');
    if (sec && detailCtx) sec.innerHTML = CS.ui.storySection(detailCtx.d, detailCtx.extra);
  }

  function autoTranslateOn() { return CS.store.get(CS.KEYS.autoTr, true) !== false; }

  function openDetail(type, id) {
    var token = ++detailToken;
    showView('detail');
    var panel = $('#detail-panel');
    panel.innerHTML = CS.ui.detailSkeleton();
    scrollTop(false);
    related = { items: [], pool: [], shown: 0, page: 0, exhausted: false, loading: false, autoRounds: 0 };
    seasonView = { season: null, episodes: [], loading: false, error: '' };

    CS.tmdb.details(type, id).then(function (d) {
      if (token !== detailToken) return;

      if (d.keywords && d.keywords.length) {
        CS.certs.putHeat(d, d.heat || CS.certs.heatOf(d.keywords, d.adult, d.descriptors));
      }
      /* البوابة تحكم مرة واحدة، وتقول السبب الصحيح: «ما وسمه TMDB»
         غير «خارج صنف القسم الحالي» — كانت الرسالة الأولى تُعرض
         في الحالتين فتكذب على المستخدم. */
      var verdict = CS.certs.isAdultWork(d);
      if (verdict === false) {
        panel.innerHTML = blockedPanel(d,
          '«' + esc0(d.title || '') + '» ما وسمه TMDB بمحتوى جنسي، والموقع ما يعرض غيره. ' +
          'الرابط اللي فتحته يشير لعمل خارج الكتالوج.');
        setCrumbs([{ label: '🏠 الاستكشاف', hash: '#/' }, { label: 'خارج الكتالوج' }]);
        return;
      }

      if (CS.catalog) CS.catalog.put(d, { keywords: d.keywords || [], overviewAr: d.arOverview, titleAr: d.arTitle });

      var extra = {};
      var arabic = d.overview && CS.util.isArabic(d.overview) ? d.overview : d.arOverview;

      if (arabic) {
        extra.summary = arabic;
        extra.summarySource = 'الملخص من TMDB (عربي)';
      } else {
        extra.summary = d.enOverview || d.overview || '';
        extra.summarySource = 'الملخص من TMDB (إنجليزي)';
        if (autoTranslateOn() && extra.summary && !CS.util.isArabic(extra.summary)) extra.translating = true;
      }
      extra.loadingPlot = true;

      panel.innerHTML = CS.ui.detail(d, extra);
      remember([d]);
      scrollTop(false);
      detailCtx = { d: d, extra: extra, token: token };
      setCrumbs([{ label: '🏠 الاستكشاف', hash: '#/' },
                 { label: CS.ui.TYPE_AR[d.type] || 'عمل' },
                 { label: d.title }]);
      CS.taste.enrich(d);
      renderExtraData();

      if (extra.translating) {
        CS.wiki.toArabic(extra.summary, 1200).then(function (ar) {
          if (token !== detailToken) return;
          extra.translating = false;
          if (ar) { extra.summary = ar; extra.summarySource = 'الملخص من TMDB (ترجمة آلية)'; }
          else extra.plotError = 'ما قدرت أترجم الملخص — غالبًا انتهت حصة الترجمة المجانية اليوم. حط بريدك في الإعدادات عشان ترتفع لـ٥٠ ألف حرف.';
          repaintStory();
        });
      }

      attachWikiPlot(d, extra, token);
      attachSources(d, token);
      loadRelated(d, token, true);
      if (d.type === 'tv' && d.seasonList && d.seasonList.length) {
        var start = CS.library.progress.get(d);
        loadSeason(d, (start && start.season) || d.seasonList[0].number, token);
      }
    }).catch(function (err) {
      if (token !== detailToken) return;
      panel.innerHTML = '<div class="dt__body">' +
        '<div class="empty">' + CS.ui.errorHtml('ما قدرت أفتح التفاصيل', CS.tmdb.explain(err),
          '<button class="btn btn--ghost" data-back>رجوع</button>') + '</div></div>';
    });
  }

  function blockedPanel(d, why) {
    return '<div class="dt__hero"><div class="dt__backdrop"></div>' +
      '<button class="dt__close" data-back aria-label="رجوع">&#8594;</button></div>' +
      '<div class="empty empty--panel">' +
      '<b>🚫 هذا العمل خارج محتوى الموقع</b><p>' + why + '</p>' +
      '<div class="empty__acts"><button class="btn" data-back>رجوع</button></div></div>';
  }

  /* ---------- المواسم والحلقات ---------- */

  function loadSeason(d, number, token) {
    seasonView = { season: number, episodes: [], loading: true, error: '' };
    paintSeasons(d);
    CS.tmdb.season('tv', d.id, number).then(function (s) {
      if (token !== detailToken) return;
      seasonView = { season: number, episodes: s.episodes || [], loading: false, error: '' };
      paintSeasons(d);
    }).catch(function (e) {
      if (token !== detailToken) return;
      seasonView = { season: number, episodes: [], loading: false, error: CS.tmdb.explain(e) };
      paintSeasons(d);
    });
  }

  function paintSeasons(d) {
    var sec = $('#dt-seasons');
    if (!sec) return;
    sec.innerHTML = CS.ui.seasonsSection(d, seasonView);
  }

  /* ---------- الأعمال ذات الصلة ---------- */

  var REL_PAGE = 24;

  function paintRelated(d, token) {
    var sec = $('#dt-related');
    if (!sec || token !== detailToken) return;

    var pre = ensureHeat(related.items, Math.min(related.items.length, 60));

    pre.then(function () {
      if (token !== detailToken) return;

      var fromApi = related.items.filter(function (it) {
        return CS.certs.isAdultWork(it) === true && CS.certs.kindFits(it) !== false;
      });
      if (CS.catalog) CS.catalog.add(fromApi);

      var seen = {};
      seen[d.type + ':' + d.id] = true;
      fromApi.forEach(function (it) { seen[it.type + ':' + it.id] = true; });

      var fromIndex = [];
      if (CS.catalog) {
        var ex = {};
        Object.keys(seen).forEach(function (k) {
          var p2 = k.split(':');
          ex[(p2[0] === 'tv' ? 'v' : 'm') + p2[1]] = true;
        });
        fromIndex = CS.catalog.candidates(d, { exclude: ex, limit: 400 });
      }

      var all = CS.reco.rank(d, fromApi.concat(fromIndex), {});

      related.pool = all;
      var shown = all.slice(0, related.shown || REL_PAGE);
      related.shown = shown.length;

      var sec2 = $('#dt-related');
      if (!sec2) return;
      var more = all.length > shown.length;
      sec2.innerHTML = CS.ui.relatedSection(shown, !more && related.exhausted, false, all.length);
      hydrate(sec2, shown);
      remember(shown);

      if (all.length < 12 && !related.exhausted && related.autoRounds < 4) {
        related.autoRounds++;
        loadRelated(d, token, false);
      }
    });
  }

  function moreRelated() {
    if (!detailCtx || !related.pool) return false;
    if (related.shown >= related.pool.length) return false;
    related.shown = Math.min(related.pool.length, related.shown + REL_PAGE);
    var shown = related.pool.slice(0, related.shown);
    var sec = $('#dt-related');
    if (!sec) return true;
    sec.innerHTML = CS.ui.relatedSection(shown, related.shown >= related.pool.length && related.exhausted,
      false, related.pool.length);
    hydrate(sec, shown);
    remember(shown);
    return true;
  }

  function loadRelated(d, token, first) {
    if (related.loading || related.exhausted) return;
    related.loading = true;

    if (!first) {
      var sec = $('#dt-related');
      if (sec && related.pool && related.pool.length) {
        sec.innerHTML = CS.ui.relatedSection(related.pool.slice(0, related.shown || 24),
          false, true, related.pool.length);
      }
    }

    related.page += 1;
    var p = related.page;

    Promise.all([
      CS.tmdb.relatedPage(d.type, d.id, 'recommendations', p),
      CS.tmdb.relatedPage(d.type, d.id, 'similar', p)
    ]).then(function (r) {
      if (token !== detailToken) return;
      related.loading = false;

      var seen = {};
      related.items.forEach(function (x) { seen[x.type + ':' + x.id] = true; });
      seen[d.type + ':' + d.id] = true;

      var added = 0;
      [r[0].items, r[1].items].forEach(function (list) {
        list.forEach(function (it) {
          var k = it.type + ':' + it.id;
          if (seen[k] || !it.poster) return;
          if (it.adult && !CS.certs.adultAllowed()) return;
          seen[k] = true;
          related.items.push(it);
          added++;
        });
      });

      if (p >= Math.max(r[0].pages, r[1].pages) || (!added && p > 1)) related.exhausted = true;

      remember(related.items);
      paintRelated(d, token);
      if (first && related.items.length < 20 && !related.exhausted) loadRelated(d, token, true);
    }).catch(function () { related.loading = false; paintRelated(d, token); });
  }

  function attachSources(d, token) {
    CS.sources.enrich(d).then(function (ex) {
      if (token !== detailToken) return;
      if (ex.wikidata) {
        d.wd = ex.wikidata;
        if (!d.imdbId && ex.wikidata.imdb) d.imdbId = ex.wikidata.imdb;
        var linksSec = $('#dt-links');
        if (linksSec) linksSec.innerHTML = CS.ui.linksHtml(d);
      }
      var html = CS.ui.extraSources(d, ex);
      var slot = $('#dt-extra');
      if (slot && html) slot.innerHTML = html;
    }).catch(function () { /* اختيارية */ });
  }

  function findArticle(d) {
    if (d.wikiTitle) return Promise.resolve({ wikiLang: d.wikiLang || 'ar', wikiTitle: d.wikiTitle, wikiUrl: d.wikiUrl });

    var names = [d.title, d.originalTitle, d.arTitle].filter(Boolean);
    var attempts = [
      { lang: 'ar', probe: (d.arTitle || d.title) + (d.year ? ' ' + d.year : '') },
      { lang: 'en', probe: (d.originalTitle || d.title) + (d.year ? ' ' + d.year : '') }
    ];

    return attempts.reduce(function (chain, a) {
      return chain.then(function (found) {
        if (found) return found;
        return CS.wiki.findWorks(a.lang, a.probe, 4).then(function (works) {
          var hit = works.filter(function (w) {
            var sim = Math.max.apply(null, names.map(function (n) { return CS.search.similarity(w.cleanTitle, n); }));
            return sim > .6 && (!w.year || !d.year || Math.abs(w.year - d.year) <= 1);
          })[0];
          return hit ? { wikiLang: hit.wikiLang, wikiTitle: hit.wikiTitle, wikiUrl: hit.wikiUrl } : null;
        }).catch(function () { return null; });
      });
    }, Promise.resolve(null));
  }

  function attachWikiPlot(d, extra, token) {
    findArticle(d).then(function (w) {
      if (token !== detailToken) return;
      if (!w) { extra.loadingPlot = false; repaintStory(); return; }
      return CS.wiki.fullPlot(w.wikiLang, w.wikiTitle).then(function (plot) {
        if (token !== detailToken) return;
        extra.loadingPlot = false;
        if (!plot) { repaintStory(); return; }
        d.wikiUrl = d.wikiUrl || w.wikiUrl;
        d.wikiTitle = w.wikiTitle;
        d.wikiLang = w.wikiLang;
        extra.fullPlot = plot;
        extra.plotLang = w.wikiLang;

        if (autoTranslateOn() && !CS.util.isArabic(plot)) {
          extra.translating = true;
          repaintStory();
          CS.wiki.toArabic(plot, 3000).then(function (ar) {
            if (token !== detailToken) return;
            extra.translating = false;
            if (ar) extra.plotArabic = ar;
            else extra.plotError = 'ما قدرت أترجم القصة — غالبًا انتهت الحصة اليومية المجانية. حط بريدك في الإعدادات عشان يرتفع الحد.';
            repaintStory();
          });
          return;
        }
        repaintStory();
      });
    }).catch(function () {
      if (detailCtx && detailCtx.extra) { detailCtx.extra.loadingPlot = false; repaintStory(); }
    });
  }

  function translatePlot(btn) {
    if (!detailCtx || !detailCtx.extra.fullPlot) return;
    var ctx = detailCtx;
    btn.disabled = true;
    btn.textContent = '⏳ يترجم…';

    CS.wiki.toArabic(ctx.extra.fullPlot, 3000).then(function (ar) {
      if (ctx.token !== detailToken) return;
      if (ar) { ctx.extra.plotArabic = ar; ctx.extra.plotError = ''; }
      else ctx.extra.plotError = 'ما قدرت أترجم — غالبًا انتهت الحصة اليومية المجانية للترجمة.';
      repaintStory();
    });
  }

  function openWikiDetail(lang, title) {
    var token = ++detailToken;
    showView('detail');
    var panel = $('#detail-panel');
    panel.innerHTML = CS.ui.detailSkeleton();
    scrollTop(false);

    var wcached = itemCache['w/' + lang + '/' + encodeURIComponent(title)] ||
                  itemCache['w/' + lang + '/' + title];
    if (!wcached || CS.certs.isAdultWork(wcached) !== true) {
      panel.innerHTML = blockedPanel(null,
        'هذي الصفحة ما لها مقابل في TMDB، وبدونه ما نقدر نتحقق إن محتواها ' +
        'ضمن الموقع. ابحث باسم العمل عشان نجيبه من TMDB.');
      return;
    }

    CS.wiki.fullPlot(lang, title).then(function (plot) {
      if (token !== detailToken) return;
      var d = wcached;
      var extra = { summary: d.overview || '', summarySource: 'الملخص من ويكيبيديا', fullPlot: plot, plotLang: lang };
      remember([d]);
      panel.innerHTML = CS.ui.detail(d, extra);
      scrollTop(false);
      detailCtx = { d: d, extra: extra, token: token };
    }).catch(function () {
      if (token !== detailToken) return;
      panel.innerHTML = '<div class="dt__body"><div class="empty">🔴 ما قدرت أجيب المقالة من ويكيبيديا.</div></div>';
    });
  }

  /* ============================================================
     صفحة الشخص
     ============================================================ */

  var personCtx = null;

  function openPerson(id) {
    var token = ++detailToken;
    showView('person');
    var panel = $('#person-panel');
    panel.innerHTML = CS.ui.detailSkeleton();
    scrollTop(false);

    CS.tmdb.person(id).then(function (p) {
      if (token !== detailToken) return;
      personCtx = { p: p, shown: PAGE, token: token };
      remember(p.works);
      setCrumbs([{ label: '🏠 الاستكشاف', hash: '#/' },
                 { label: p.job === 'Directing' ? 'مخرج' : 'ممثل' },
                 { label: p.name }]);
      paintPerson(token, true);
    }).catch(function (err) {
      if (token !== detailToken) return;
      panel.innerHTML = '<div class="dt__body"><div class="empty">' +
        CS.ui.errorHtml('ما قدرت أفتح صفحة الشخص', CS.tmdb.explain(err),
          '<button class="btn btn--ghost" data-back>رجوع</button>') + '</div></div>';
    });
  }

  function morePersonWorks() {
    if (!personCtx) return;
    personCtx.shown += PAGE;
    paintPerson(personCtx.token, false);
  }

  function paintPerson(token, scroll) {
    if (!personCtx || token !== detailToken) return;
    var p = personCtx.p;
    var pre = ensureHeat(p.works, Math.min(p.works.length, 90));

    pre.then(function () {
      if (token !== detailToken) return;
      var works = p.works.filter(function (it) {
        return CS.certs.isAdultWork(it) === true && CS.certs.kindFits(it) !== false;
      });
      if (CS.catalog) CS.catalog.add(works);

      stampTaste(works);
      var view = { name: p.name, photo: p.photo, job: p.job, birthday: p.birthday,
                   deathday: p.deathday, place: p.place, bio: p.bio,
                   directedCount: p.directedCount, works: works };
      var panel = $('#person-panel');
      if (!panel) return;
      panel.innerHTML = CS.ui.person(view, personCtx.shown);
      hydrate(panel, works.slice(0, personCtx.shown));
      if (scroll) scrollTop(false);
    });
  }

  /* ============================================================
     صفحة الإعدادات — كل الخيارات في مكان واحد
     ============================================================ */

  function openSettings() {
    showView('settings');
    setCrumbs([{ label: '🏠 الاستكشاف', hash: '#/' }, { label: '⚙️ الإعدادات' }]);
    renderSettings();
    scrollTop(false);
    if (location.hash !== '#/settings') { suppressRoute = true; location.hash = '#/settings'; }
  }

  function renderSettings() {
    var panel = $('#settings-panel');
    if (!panel) return;
    var st = CS.net.stats();

    panel.innerHTML =
      '<div class="set">' +
        '<header class="set__head"><h2>⚙️ الإعدادات</h2>' +
          '<button class="btn btn--ghost btn--sm" data-back-home>رجوع للاستكشاف</button></header>' +

        section('العرض واللغة',
          field('الوضع', selectHtml('set-theme', CS.theme.MODES.map(function (m) {
            return { v: m, t: CS.theme.LABEL[m] };
          }), CS.theme.get()), 'الاختيار يُحفظ ويُطبَّق قبل أول رسم فما فيه وميض عند الفتح.') +
          field('لغة المحتوى', selectHtml('set-lang', [
            { v: 'ar', t: 'العربية' }, { v: 'en', t: 'English' }
          ], CS.state.lang)) +
          field('منطقة المشاهدة', selectHtml('set-region', [
            { v: 'SA', t: 'السعودية' }, { v: 'AE', t: 'الإمارات' }, { v: 'EG', t: 'مصر' },
            { v: 'KW', t: 'الكويت' }, { v: 'QA', t: 'قطر' }, { v: 'BH', t: 'البحرين' },
            { v: 'OM', t: 'عُمان' }, { v: 'JO', t: 'الأردن' }, { v: 'MA', t: 'المغرب' },
            { v: 'US', t: 'أمريكا' }, { v: 'GB', t: 'بريطانيا' }, { v: 'FR', t: 'فرنسا' },
            { v: 'DE', t: 'ألمانيا' }
          ], CS.state.region), 'تحدّد منصّات المشاهدة المعروضة والتصنيف العمري المفضَّل.') +
          switchHtml('set-autotr', 'ترجمة تلقائية للقصة',
            'يترجم أي ملخّص أو قصة غير عربية للعربي بدون ما تضغط شي', autoTranslateOn())
        ) +

        section('المحتوى',
          switchHtml('set-adultonly', '🔞 وضع الكبار فقط',
            'الموقع كله مخصّص لهذا المحتوى — إطفاؤه يقفل الأقسام', adultOnlyOn()) +
          switchHtml('set-explicit', '⛔ إظهار قسم Explicit',
            'إطفاؤه يخفي القسم من شريط الأقسام ويرجّعك للقسم العام', explicitOn()) +
          '<p class="field__hint">🟠 <b>بصراحة:</b> الأقسام تُبنى من كلمات TMDB المفتاحية ' +
          '(erotic · softcore · sexploitation · nudity) لا من التصنيف العمري. هذا اللي يمنع ' +
          'تسرّب الأفلام العادية المصنّفة R، لكنه يعني إن الكتالوج محدود بما وسمه TMDB فعلًا.</p>'
        ) +

        section('تفضيلات المشاهدة',
          '<p class="field__hint">🟠 <b>بصراحة:</b> هذا الموقع دليل لا مشغّل — ما فيه فيديو ' +
          'يُشغَّل داخله عشان نضبط جودته أو صوته أو ملء الشاشة، والمصادر المجانية تعطي ' +
          'بيانات الأعمال لا ملفاتها. اللي نسويه فعلًا: نحمل تفضيلاتك إلى روابط البحث ' +
          'اللي نفتحها لك (Yandex · Google)، والتطبيق اللي تفتحه — Nuvio أو Stremio — ' +
          'هو اللي يشغّل ويضبط الجودة والترجمة وملء الشاشة.</p>' +
          field('الجودة المفضّلة', selectHtml('set-quality', [
            { v: '', t: 'أي جودة' }, { v: '4K', t: '4K' }, { v: '1080p', t: '1080p' },
            { v: '720p', t: '720p' }, { v: '480p', t: '480p' }
          ], CS.links.prefs().quality || '')) +
          field('الترجمة المفضّلة', selectHtml('set-subs', [
            { v: 'ar', t: 'عربية' }, { v: 'en', t: 'إنجليزية' }, { v: 'none', t: 'بدون' }
          ], CS.links.prefs().subs)) +
          field('الصوت المفضّل', selectHtml('set-audio', [
            { v: 'original', t: 'الصوت الأصلي' }, { v: 'dubbed', t: 'مدبلج' }
          ], CS.links.prefs().audio)) +
          '<p class="field__hint">' +
          esc0('اللي ينضاف لاستعلام البحث الخارجي الآن: «' + (CS.links.prefTerms() || 'لا شي') + '»') +
          '</p>'
        ) +

        section('التنبيهات',
          switchHtml('set-alerts', '🔔 نبّهني عند نزول حلقة أو جزء جديد',
            'يفحص أعمالك المتابَعة عند كل فتحة للموقع ويعطيك تنبيهًا',
            CS.store.get(CS.KEYS.alertsOn, false) === true) +
          '<p class="field__hint">' + esc0(alertsStatusLine()) + '</p>' +
          '<div class="set__acts"><button class="btn btn--ghost btn--sm" id="btn-check-new-2">افحص الجديد الآن</button></div>'
        ) +

        section('مصادر المحتوى',
          '<p class="field__hint">📊 كل مصدر تحت تحكّمك: شغّله أو وقّفه أو تحقق منه. ' +
          'الموقوف ما يُنادى أصلًا، والساقط يُكتم تلقائيًا دقيقة ونصف ثم يُعاد.</p>' +
          '<div class="srclist" id="cs-list">' + contentSourcesHtml() + '</div>'
        ) +

        section('المفاتيح والوسيط',
          field('رابط وسيط يخفي المفتاح <em>(اختياري)</em>',
            '<span class="keyrow"><input type="url" id="set-proxy" dir="ltr" maxlength="300" placeholder="https://your-worker.workers.dev" ' +
            'value="' + esc0(CS.store.get(CS.KEYS.proxy, '') || '') + '">' +
            '<button type="button" class="keyrow__test" data-test-key="set-proxy">تحقق</button></span>' +
            '<span class="keyrow__out" id="out-set-proxy"></span>',
            'هذا هو الحلّ الوحيد الحقيقي لإخفاء المفتاح: خادم صغير يحتفظ بالمفتاح عنده ' +
            'ويمرّر الطلبات. مع الوسيط ما يغادر أي مفتاح متصفّحك. بدونه — أي موقع ساكن ' +
            'مفتاحه مقروء من لوح الشبكة مهما خبّأناه في الشيفرة.') +

          field('مفتاح TMDB خاص فيك <em>(اختياري)</em>',
            '<span class="keyrow"><input type="password" id="set-api-key" maxlength="300" ' +
            'placeholder="الموقع فيه مفتاح مشترك جاهز — اتركه فاضي" ' +
            'autocomplete="off" spellcheck="false" value="' + esc0(CS.state.userKey || '') + '">' +
            '<button type="button" class="keyrow__test" data-test-key="set-api-key">تحقق</button></span>' +
            '<span class="keyrow__out" id="out-set-api-key"></span>',
            'مفتاح مجاني من themoviedb.org — يقبل v3 أو توكن v4. يُحفظ في متصفحك فقط. ' +
            'توكن v4 أفضل: يُرسل في ترويسة لا في الرابط.') +

          field('بريدك لرفع حد الترجمة <em>(اختياري)</em>',
            '<span class="keyrow"><input type="email" id="set-tr-email" maxlength="160" placeholder="name@example.com" ' +
            'autocomplete="off" spellcheck="false" value="' + esc0(CS.store.get(CS.KEYS.email, '') || '') + '">' +
            '<button type="button" class="keyrow__test" data-test-key="set-tr-email">تحقق</button></span>' +
            '<span class="keyrow__out" id="out-set-tr-email"></span>',
            'الترجمة عبر MyMemory: ٥٠٠٠ حرف يوميًا بدون بريد، و٥٠ ألف مع بريد.') +

          '<div class="keystate" id="key-state"></div>' +
          '<div class="set__acts">' +
            '<button class="btn" id="btn-save-settings">حفظ</button>' +
            '<button class="btn btn--ghost" id="btn-test-key">🔍 تحقق من الاتصال</button>' +
            '<button class="btn btn--ghost" id="btn-clear-key">حذف مفتاحي</button>' +
          '</div>'
        ) +

        section('مصادرك الإضافية',
          '<p class="field__hint">مزوّدون تضيفهم بمفتاحك لعرض بيانات إضافية في صفحة العمل. ' +
          '🟠 المفتاح يُحفظ في متصفّحك <b>بنص صريح</b> ويُرسل داخل رابط الطلب — الإخفاء في ' +
          'الشاشة (••••) للعرض فقط.</p>' +
          '<div class="srclist" id="ds-list">' + dataSourcesHtml() + '</div>' +
          field('١ · اختر المصدر', '<select id="ds-preset"></select>',
            '', 'ds-hint') +
          field('٢ · الصق المفتاح واضغط أضف',
            '<span class="keyrow"><input type="text" id="ds-key" maxlength="256" placeholder="الصق مفتاح API هنا" autocomplete="off" spellcheck="false">' +
            '<button type="button" class="keyrow__test" id="btn-ds-add">أضف</button></span>' +
            '<span class="keyrow__out" id="out-ds-add"></span>') +
          '<div class="field-row" id="ds-custom" hidden>' +
            field('رابط الـAPI <em>(للمصدر الخاص فقط)</em>',
              '<input type="text" id="ds-url" dir="ltr" maxlength="500" placeholder="https://api.example.com/movie/{imdb}?api_key={key}">',
              'البدائل: {key} {imdb} {tmdb} {type} {title} {year} — ولازم يبدأ بـ https://') +
            field('الاسم <em>(اختياري)</em>', '<input type="text" id="ds-name" maxlength="64" placeholder="يُستنتج من الرابط">') +
          '</div>'
        ) +

        section('البيانات والتخزين',
          '<div class="metatable">' +
            metaBox('فهرس البحث', CS.catalog.size() + ' عمل') +
            metaBox('طلبات هذي الجلسة', st.sent + ' مرسل · ' + st.fromMem + ' من الرام · ' + st.fromDisk + ' من القرص') +
            metaBox('أُعيدت المحاولة', String(st.retried)) +
            metaBox('مساحة الإعدادات', Math.round(CS.store.bytes() / 1024) + ' ك.ب') +
          '</div>' +
          '<p class="field__hint" id="catalog-state">' + catalogStateText() + '</p>' +
          '<div class="set__acts">' +
            '<button class="btn btn--ghost btn--sm" id="btn-catalog-sweep">⚡ وسّع الفهرس الآن</button>' +
            '<button class="btn btn--ghost btn--sm" id="btn-catalog-clear">🗑️ صفّر الفهرس</button>' +
            '<button class="btn btn--ghost btn--sm" id="btn-clear-net">🧹 فرّغ ذاكرة الطلبات</button>' +
          '</div>' +
          '<div class="set__acts">' +
            '<button class="btn btn--ghost btn--sm" id="btn-backup-2">💾 نزّل نسخة احتياطية</button>' +
            '<button class="btn btn--ghost btn--sm" id="btn-restore-2">♻️ استعد من ملف</button>' +
            '<button class="btn btn--ghost btn--sm" id="btn-reset-taste">صفّر ذوقي</button>' +
          '</div>' +
          '<p class="field__hint">النسخة الاحتياطية تشمل: تصويتك · المفضلة · لاحقًا · متابعة ' +
          'المشاهدة · المتابَعة · إعداداتك · مصادرك. الفهرس وذاكرة الطلبات خارجها لأنها ' +
          'تُبنى تلقائيًا.</p>'
        ) +

        '<p class="set__ver">RANHUB ' + esc0(CS.config.version) + '</p>' +
      '</div>';

    fillPresets();
    onPresetPick();
  }

  function alertsStatusLine() {
    var p = CS.library.alerts.permission();
    if (p === 'unsupported') return 'متصفّحك ما يدعم تنبيهات النظام — بنعرض التنبيه داخل الموقع.';
    if (p === 'granted') return 'إذن التنبيهات مفعّل.';
    if (p === 'denied') return 'رفضت إذن التنبيهات من المتصفّح — بنعرضه داخل الموقع فقط.';
    return 'بنطلب إذن المتصفّح أول ما تشغّل الخيار.';
  }

  function catalogStateText() {
    var n = CS.catalog.size();
    var quality = n >= 900 ? '🟢 واسع' : n >= 300 ? '🟡 متوسط' : '🟠 صغير';
    return quality + ' — ' + n + ' عمل محفوظ بملخّصه ووسومه في متصفّحك. البحث بوصف القصة ' +
      'يطابق على هذا الفهرس، فكل ما تصفّحت أكثر صار أدق.';
  }

  function section(title, body) {
    return '<section class="set__sec"><h3 class="sec__title">' + esc0(title) + '</h3>' + body + '</section>';
  }

  function field(label, control, hint, hintId) {
    return '<label class="field"><span class="field__label">' + label + '</span>' + control +
      (hint || hintId ? '<small class="field__hint"' + (hintId ? ' id="' + hintId + '"' : '') + '>' +
        esc0(hint || '') + '</small>' : '') + '</label>';
  }

  function selectHtml(id, opts, value) {
    return '<select id="' + id + '">' + opts.map(function (o) {
      return '<option value="' + esc0(o.v) + '"' + (String(o.v) === String(value) ? ' selected' : '') + '>' +
        esc0(o.t) + '</option>';
    }).join('') + '</select>';
  }

  function switchHtml(id, title, hint, on) {
    return '<label class="switch"><input type="checkbox" id="' + id + '"' + (on ? ' checked' : '') + '>' +
      '<span><b>' + esc0(title) + '</b><i>' + esc0(hint) + '</i></span></label>';
  }

  function metaBox(k, v) {
    return '<div><span>' + esc0(k) + '</span><b>' + esc0(v) + '</b></div>';
  }

  function contentSourcesHtml() {
    return CS.contentSources.all().map(function (s) {
      var state = s.ok === true ? '<i class="srcitem__st is-ok">🟢 شغّال</i>'
                : s.ok === false ? '<i class="srcitem__st is-bad">🔴 ' + esc0(s.detail || 'ما رد') + '</i>'
                : '<i class="srcitem__st">⚪ ما تحقّقت منه بعد</i>';
      return '<div class="srcitem' + (s.enabled ? '' : ' is-off') + '" data-cs-row="' + esc0(s.id) + '">' +
        '<div class="srcitem__top"><b class="srcitem__name">' + esc0(s.name) + '</b>' +
          '<span class="srcitem__type">' + (s.keyless ? 'بلا مفتاح' : 'بمفتاح') + '</span>' +
          (s.required ? '<span class="srcitem__type">أساسي</span>' : '') +
          (s.enabled ? '' : '<span class="srcitem__type is-off">موقوف</span>') +
          (s.muted ? '<span class="srcitem__type is-off">مكتوم مؤقتًا</span>' : '') +
        '</div>' +
        '<small class="field__hint">' + esc0(s.hint) + '</small>' +
        state +
        '<div class="srcitem__acts">' +
          '<button class="btn btn--sm" data-cs-test="' + esc0(s.id) + '">تحقق</button>' +
          (s.required ? '' :
            '<button class="btn btn--sm btn--ghost" data-cs-toggle="' + esc0(s.id) + '">' +
            (s.enabled ? 'إيقاف' : 'تشغيل') + '</button>') +
        '</div></div>';
    }).join('');
  }

  /* ============================================================
     مصادر البيانات اللي يضيفها المستخدم
     ============================================================ */

  function fillPresets() {
    var sel = $('#ds-preset');
    if (!sel || sel.options.length) return;
    CS.dataSources.PRESETS.forEach(function (p) {
      sel.add(new Option(p.name + ' — ' + p.hint, p.id));
    });
    sel.add(new Option('⚙️ مصدر خاص فيي (عندي رابط API)', 'custom'));
    sel.value = CS.dataSources.preset('omdb') ? 'omdb' : sel.options[0].value;
  }

  function onPresetPick() {
    var sel = $('#ds-preset');
    if (!sel) return;
    var v = sel.value;
    var custom = v === 'custom';
    if ($('#ds-custom')) $('#ds-custom').hidden = !custom;

    if (custom) {
      if ($('#ds-hint')) $('#ds-hint').textContent = 'الصق رابط الـAPI تحت، والمفتاح فوق لو المصدر يحتاجه.';
      if ($('#ds-key')) $('#ds-key').placeholder = 'الصق المفتاح لو المصدر يحتاجه';
      return;
    }

    var p = CS.dataSources.preset(v);
    if (!p) return;
    if ($('#ds-url')) $('#ds-url').value = p.url;
    if ($('#ds-name')) $('#ds-name').value = '';
    if ($('#ds-hint')) $('#ds-hint').textContent = p.needsKey
      ? 'خذ مفتاحك المجاني من ' + p.site + ' والصقه تحت.'
      : p.name + ' ما يحتاج مفتاح — اضغط «أضف» على طول.';
    if ($('#ds-key')) $('#ds-key').placeholder = p.needsKey ? (p.keyLabel || 'مفتاح API') : 'ما يحتاج مفتاح — اتركه فاضي';
  }

  function statusLine(d, cls) {
    cls = cls || 'srcitem__st';
    if (!d.status) return '<i class="' + cls + '">⚪ ما تحقّقت منه بعد</i>';
    var ok = d.status.ok;
    var mark = ok === true ? '🟢 ' : ok === false ? '🔴 ' : '🟡 ';
    var kind = ok === true ? ' is-ok' : ok === false ? ' is-bad' : ' is-warn';
    return '<i class="' + cls + kind + '">' + mark + esc0(d.status.detail) + '</i>';
  }

  function dataSourcesHtml() {
    var list = CS.dataSources.all();
    if (!list.length) {
      return '<div class="empty empty--inline"><b>⚪ ما فيه مصادر</b>' +
        '<p>اختر مزوّدًا من القائمة تحت واضغط «أضف».</p></div>';
    }
    return list.map(function (d) {
      return '<div class="srcitem' + (d.enabled ? '' : ' is-off') + '" data-ds-row="' + esc0(d.id) + '">' +
        '<div class="srcitem__top">' +
          '<b class="srcitem__name">' + esc0(d.name) + '</b>' +
          '<span class="srcitem__type">' + esc0(d.key ? 'بمفتاح' : 'بدون مفتاح') + '</span>' +
          (d.enabled ? '' : '<span class="srcitem__type is-off">موقوف</span>') +
        '</div>' +
        '<code class="srcitem__url" dir="ltr">' + esc0(hideKey(d)) + '</code>' +
        statusLine(d) +
        '<div class="srcitem__acts">' +
          '<button class="btn btn--sm" data-ds-test="' + esc0(d.id) + '">تحقق</button>' +
          '<button class="btn btn--sm btn--ghost" data-ds-toggle="' + esc0(d.id) + '">' +
            (d.enabled ? 'إيقاف' : 'تشغيل') + '</button>' +
          '<button class="btn btn--sm btn--ghost" data-ds-del="' + esc0(d.id) + '">حذف</button>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  function hideKey(d) {
    return String(d.url).replace(/\{key\}/g, d.key ? '••••' : '{key}');
  }

  function looksLikeKey(v) {
    return !!v && !/\s/.test(v) && !/^https?:/i.test(v) && v.indexOf('://') === -1 &&
           /^[A-Za-z0-9_.\-]{8,}$/.test(v);
  }

  function addDataSource() {
    var out = $('#out-ds-add');
    var sel = $('#ds-preset').value;
    var custom = sel === 'custom';
    var key = $('#ds-key').value.trim();
    var url = ($('#ds-url') ? $('#ds-url').value : '').trim();

    if (custom && !key && looksLikeKey(url)) { key = url; url = ''; }

    if (custom && !url) {
      out.className = 'keyrow__out is-bad';
      out.textContent = looksLikeKey(key)
        ? '🔴 هذا مفتاح مو رابط. اختر مصدرًا من القائمة فوق، أو الصق رابط الـAPI في الخانة تحت.'
        : '🔴 الصق رابط الـAPI في الخانة تحت — لازم يبدأ بـ https://';
      return;
    }

    var p = custom ? null : CS.dataSources.preset(sel);
    if (p && p.needsKey && !key) {
      out.className = 'keyrow__out is-bad';
      out.textContent = '🔴 ' + p.name + ' يحتاج ' + (p.keyLabel || 'مفتاح API') + ' — الصقه فوق.';
      return;
    }

    var btn = $('#btn-ds-add');
    var label = btn.textContent;
    btn.disabled = true;
    btn.textContent = '⏳';
    out.className = 'keyrow__out is-wait';
    out.textContent = 'أتحقق منه قبل ما أضيفه…';

    var draft = { id: '', preset: p ? p.id : '', key: key, url: custom ? url : p.url, enabled: true };

    CS.dataSources.test(draft).then(function (r) {
      btn.disabled = false;
      btn.textContent = label;

      var d = CS.dataSources.add({
        preset: custom ? '' : sel,
        name:   ($('#ds-name') ? $('#ds-name').value : '').trim(),
        url:    custom ? url : p.url,
        key:    key
      });
      CS.dataSources.update(d.id, { status: r });

      $('#ds-key').value = '';
      if ($('#ds-url')) $('#ds-url').value = '';
      if ($('#ds-name')) $('#ds-name').value = '';
      refreshDsList();
      if (detailCtx) renderExtraData();

      out.className = 'keyrow__out ' + (r.ok === true ? 'is-ok' : r.ok === false ? 'is-bad' : 'is-warn');
      out.textContent = (r.ok === true ? '🟢 انضاف «' + d.name + '» وشغّال — '
                       : r.ok === false ? '🟡 انضاف «' + d.name + '» لكن الفحص فشل — '
                       : '🟡 انضاف «' + d.name + '» وما قدرت أحكم — ') + r.detail;
    }).catch(function (e) {
      btn.disabled = false;
      btn.textContent = label;
      out.className = 'keyrow__out is-bad';
      var m = String(e && e.message);
      out.textContent = '🔴 ' + (m === 'BAD_URL' ? 'الرابط لازم يبدأ بـ https://'
                               : m === 'BAD_SCHEME' ? 'هذا الرابط غير مسموح — https فقط'
                               : m === 'LONG_URL' ? 'الرابط طويل جدًا'
                               : (e && e.message) || 'ما قدرت أضيفه');
    });
  }

  function refreshDsList() {
    var box = $('#ds-list');
    if (box) box.innerHTML = dataSourcesHtml();
  }

  function refreshCsList() {
    var box = $('#cs-list');
    if (box) box.innerHTML = contentSourcesHtml();
  }

  function testDataSource(id) {
    var d = CS.dataSources.byId(id);
    if (!d) return Promise.resolve();

    var row = $('[data-ds-row="' + id + '"]');
    var st  = row && row.querySelector('.srcitem__st');
    if (st) { st.className = 'srcitem__st is-wait'; st.textContent = '⏳ أفحص…'; }

    return CS.dataSources.test(d).then(function () {
      refreshDsList();
      if (detailCtx) renderExtraData();
    });
  }

  function renderExtraData() {
    var sec = $('#dt-datasources');
    if (!sec || !detailCtx) return;

    var list = CS.dataSources.all().filter(function (d) { return d.enabled; });
    if (!list.length) { sec.innerHTML = ''; return; }

    var item = detailCtx.d;
    var token = detailCtx.token;
    sec.innerHTML = CS.ui.dataSection(list.map(function (d) {
      return { name: d.name, loading: true };
    }));

    CS.util.pool(list, 3, function (d) {
      return CS.dataSources.fetchFor(d, item).then(function (r) {
        return { name: d.name, ok: r.ok, rows: r.rows, art: r.art, detail: r.detail };
      });
    }).then(function (blocks) {
      if (token !== detailToken) return;
      var sec2 = $('#dt-datasources');
      if (sec2) sec2.innerHTML = CS.ui.dataSection(blocks);

      var art = blocks.filter(function (b) { return b.art && b.art.logo; })[0];
      if (art) applyLogo(art.art.logo);
    });
  }

  function applyLogo(url) {
    var safe = CS.util.safeUrl(url);
    if (!safe) return;
    var t = $('#detail-panel .dt__title');
    if (!t || t.dataset.logo) return;

    var text = t.textContent;
    t.dataset.logo = '1';
    /* الرابط يجي من مزوّد خارجي (fanart.tv) — يُهرَّب كـHTML لا كجافاسكربت */
    t.innerHTML = '<img class="dt__logo" src="' + esc0(safe) + '" alt="' + esc0(text) + '">';

    var img = t.querySelector('img');
    if (img) img.onerror = function () {
      t.dataset.logo = '';
      t.textContent = text;
    };
  }

  /* ============================================================
     الإعدادات — الحفظ والفحص
     ============================================================ */

  function rerenderCurrent() {
    var r = parseHash();
    if (r.name === 'detail') { openDetail(r.type, r.id); return; }
    if (r.name === 'wiki')   { openWikiDetail(r.lang, r.title); return; }
    if (r.name === 'person') { openPerson(r.id); return; }
    if (r.name === 'settings') { renderSettings(); return; }
    if (CS.state.view === 'results' && CS.state.query) { doSearch(CS.state.query, true, parseHash().mode); return; }
    if (CS.state.view === 'library') { renderLibrary(); return; }
    showView('home');
    startFeed(currentTab());
  }

  function saveSettings() {
    var key = ($('#set-api-key') || {}).value || '';
    key = key.trim();
    var state = $('#key-state');

    /* ------------------------------------------------------------
       التحقق كله قبل أي كتابة.

       كان الترتيب: نحفظ اللغة والمنطقة والسمة… ثم نتحقق من الوسيط
       فنخرج. فرابط وسيط غلط يترك نصف الإعدادات محفوظًا ونصفها لا،
       والمستخدم يقرأ «رابط الوسيط غلط» ويظن أن شيئًا ما انحفظ.
       ------------------------------------------------------------ */
    var proxy = (($('#set-proxy') || {}).value || '').trim();
    if (proxy && !/^https:\/\/[^\s]+$/i.test(proxy)) {
      state.className = 'keystate is-bad';
      state.textContent = '🔴 رابط الوسيط لازم يبدأ بـ https:// — ما انحفظ شي';
      return;
    }

    var mail = (($('#set-tr-email') || {}).value || '').trim();
    if (mail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) {
      state.className = 'keystate is-bad';
      state.textContent = '🔴 صيغة البريد غير صحيحة — ما انحفظ شي';
      return;
    }

    CS.state.lang = CS.store.set(CS.KEYS.lang, $('#set-lang').value);
    CS.state.region = CS.store.set(CS.KEYS.region, $('#set-region').value);
    CS.store.set(CS.KEYS.autoTr, $('#set-autotr').checked);
    setAdultOnly($('#set-adultonly').checked);
    setExplicitOn($('#set-explicit').checked);
    CS.theme.set($('#set-theme').value);
    paintThemeBtn();
    CS.store.set(CS.KEYS.certTier, certFor(currentTab()));
    $('#lang-label').textContent = CS.state.lang === 'ar' ? 'ع' : 'EN';

    /* الوسيط: https فقط — تحقّق فوق قبل أي كتابة */
    if (proxy) CS.store.set(CS.KEYS.proxy, proxy.replace(/\/+$/, ''));
    else CS.store.remove(CS.KEYS.proxy);

    /* تفضيلات المشاهدة */
    if ($('#set-quality')) {
      CS.links.setPrefs({
        quality: $('#set-quality').value,
        subs: $('#set-subs').value,
        audio: $('#set-audio').value
      });
    }

    /* التنبيهات */
    var alertsWanted = $('#set-alerts').checked;
    CS.store.set(CS.KEYS.alertsOn, alertsWanted);
    if (alertsWanted) CS.library.alerts.request();

    if (mail) CS.store.set(CS.KEYS.email, mail); else CS.store.remove(CS.KEYS.email);

    if (!key) {
      CS.state.userKey = '';
      CS.state.apiKey = CS.config.sharedKey;
      CS.store.remove(CS.KEYS.apiKey);
      state.className = 'keystate is-ok';
      state.textContent = proxy
        ? '🟢 محفوظ. الطلبات تمرّ من الوسيط وما يغادر أي مفتاح متصفّحك.'
        : '🟢 محفوظ. الموقع يستخدم المفتاح المشترك المدمج.';
      refreshKeyNotice();
      /* بلا catch كان الحفظ يعلّق للأبد لو سقط نداء الأنواع */
      CS.tmdb.loadGenres().catch(function () {}).then(finishSave);
      return;
    }

    state.className = 'keystate is-wait';
    state.textContent = '⏳ أختبر المفتاح…';

    CS.tmdb.testKey(key).then(function () {
      CS.state.userKey = CS.store.set(CS.KEYS.apiKey, key);
      CS.state.apiKey = key;
      state.className = 'keystate is-ok';
      state.textContent = '🟢 مفتاحك الخاص شغّال ومفعّل.';
      refreshKeyNotice();
      return CS.tmdb.loadGenres().catch(function () {});
    }).then(finishSave).catch(function (err) {
      state.className = 'keystate is-bad';
      state.textContent = '🔴 ' + CS.tmdb.explain(err);
    });
  }

  function finishSave() {
    CS.ui.toast('🟢 تم الحفظ');
    setTimeout(function () { location.hash = '#/'; }, 650);
  }

  function refreshKeyNotice() {
    var off = CS.store.get(CS.KEYS.noticeOff, false);
    $('#key-notice').hidden = CS.hasKey() || off;
  }

  function showTmdbProblem(reason) {
    if (CS.store.get(CS.KEYS.noticeOff, false)) return;
    var bar = $('#key-notice');
    $('#key-notice-text').textContent = CS.usingProxy()
      ? '🔴 الوسيط ما يرد: ' + reason
      : CS.state.userKey
        ? '🔴 مفتاحك الخاص ما يشتغل: ' + reason
        : '🔴 المفتاح المشترك ما يشتغل: ' + reason + ' — حط مفتاحك الخاص المجاني.';
    $('#notice-open-settings').textContent = 'افحص الاتصال';
    bar.dataset.tmdbBroken = '1';
    bar.hidden = false;
  }

  function testConnection() {
    var btn = $('#btn-test-key');
    var box = $('#key-state');
    if (!btn || !box) return;
    var key = ($('#set-api-key') || {}).value || '';
    key = key.trim();

    btn.disabled = true;
    var label = btn.textContent;
    btn.textContent = '⏳ يفحص…';
    box.className = 'keystate is-wait';
    box.textContent = 'أفحص الاتصال بـ TMDB…';

    CS.tmdb.diagnose(key || null).then(function (rep) {
      btn.disabled = false;
      btn.textContent = label;
      var rows = rep.steps.map(function (s) {
        return '<div class="diag__row"><span>' + (s.ok ? '🟢' : '🔴') + '</span><b>' +
          esc0(s.name) + '</b><i>' + esc0(s.detail) + '</i></div>';
      }).join('');
      box.className = 'keystate ' + (rep.ok ? 'is-ok' : 'is-bad');
      box.innerHTML = '<div class="diag__head">' +
        (rep.ok ? '🟢 كل شي شغّال — الموقع يقدر يبحث ويجيب البيانات' : '🔴 فيه خلل — تفاصيله تحت') +
        '</div>' + rows + (rep.ok ? '' : '<div class="diag__tip">' + esc0(hintFor(rep)) + '</div>');
    }).catch(function (e) {
      btn.disabled = false;
      btn.textContent = label;
      box.className = 'keystate is-bad';
      box.textContent = '🔴 ما قدرت أكمّل الفحص: ' + (e && e.message || e);
    });
  }

  function hintFor(rep) {
    var d = (rep.steps.filter(function (s) { return !s.ok; })[0] || {}).detail || '';
    if (/401|رفض/.test(d)) return 'الحل: خذ مفتاحًا مجانيًا من themoviedb.org والصقه في الخانة فوق ثم احفظ.';
    if (/429|حد الطلبات/.test(d)) return 'الحل: انتظر دقيقة وأعد الفحص، أو استخدم مفتاحك الخاص.';
    if (/ما وصلت/.test(d)) return 'الحل: جرّب شبكة ثانية أو بيانات الجوال — بعض الشبكات تحجب api.themoviedb.org.';
    return 'جرّب مرة ثانية بعد شوي، وإذا تكرر أرسل لي نص الخطأ.';
  }

  var KEY_TESTS = {
    'set-api-key': function (v) {
      return CS.tmdb.testKey(v || CS.config.sharedKey).then(function () {
        return { ok: true, detail: v ? 'مفتاحك الخاص شغّال' : 'المفتاح المشترك المدمج شغّال' };
      }).catch(function (e) {
        return { ok: false, detail: CS.tmdb.explain(e) };
      });
    },

    'set-proxy': function (v) {
      if (!v) return Promise.resolve({ ok: null, detail: 'فاضي — الطلبات تروح لـ TMDB مباشرة بالمفتاح' });
      if (!/^https:\/\/[^\s]+$/i.test(v)) return Promise.resolve({ ok: false, detail: 'لازم يبدأ بـ https://' });
      return CS.net.json(v.replace(/\/+$/, '') + '/3/configuration', { fresh: true, retries: 0 })
        .then(function () { return { ok: true, detail: 'الوسيط يرد — المفتاح عنده ولا يغادر متصفّحك' }; })
        .catch(function (e) { return { ok: false, detail: CS.tmdb.explain(e) }; });
    },

    'set-tr-email': function (v) {
      if (!v) return Promise.resolve({ ok: null, detail: 'فاضي — الترجمة شغّالة بحد ٥ آلاف حرف يوميًا' });
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return Promise.resolve({ ok: false, detail: 'صيغة البريد غير صحيحة' });
      return CS.net.json('https://api.mymemory.translated.net/get?q=' + encodeURIComponent('a quiet night') +
                   '&langpair=en|ar&de=' + encodeURIComponent(v), { fresh: true, retries: 0 })
        .then(function (j) {
          var txt = j && j.responseData && j.responseData.translatedText;
          if (j && +j.responseStatus === 200 && txt) return { ok: true, detail: 'شغّال — ترجم تجربة إلى «' + txt + '»' };
          return { ok: false, detail: (j && j.responseDetails) || 'خدمة الترجمة رفضت الطلب' };
        })
        .catch(netFail);
    }
  };

  function netFail(err) {
    var m = String((err && err.message) || err);
    return {
      ok: false,
      detail: /Failed to fetch|NetworkError|Load failed/i.test(m)
        ? 'ما وصلت للخدمة — إما الشبكة تحجبها أو الخدمة واقفة'
        : m
    };
  }

  function verifyKeyRow(btn) {
    var id  = btn.dataset.testKey;
    var inp = document.getElementById(id);
    var out = document.getElementById('out-' + id);
    var fn  = KEY_TESTS[id];
    if (!inp || !out || !fn) return;

    var label = btn.textContent;
    btn.disabled = true;
    btn.textContent = '⏳';
    out.className = 'keyrow__out is-wait';
    out.textContent = 'أفحص…';

    fn(inp.value.trim()).then(function (r) {
      btn.disabled = false;
      btn.textContent = label;
      out.className = 'keyrow__out ' + (r.ok === true ? 'is-ok' : r.ok === false ? 'is-bad' : 'is-idle');
      out.textContent = (r.ok === true ? '🟢 ' : r.ok === false ? '🔴 ' : '⚪ ') + r.detail;
    }).catch(function (e) {
      btn.disabled = false;
      btn.textContent = label;
      out.className = 'keyrow__out is-bad';
      out.textContent = '🔴 ' + ((e && e.message) || e);
    });
  }

  /* ============================================================
     الاقتراحات الفورية
     ============================================================ */

  var suggestToken = 0;
  var suggestOff = false;

  function hideSuggest() {
    suggestToken++;
    var s = $('#suggest');
    if (!s) return;
    s.hidden = true;
    s.innerHTML = '';
    var q = $('#q');
    if (q) q.setAttribute('aria-expanded', 'false');
  }

  function paintSuggest(bag, token) {
    if (token !== suggestToken) return;
    var s = $('#suggest');
    if (!s) return;
    var html = '';

    (bag.categories || []).forEach(function (c) {
      html += '<button type="button" class="sug sug--cat" role="option" data-cat-go="' + c.id + '">' +
        '<span class="sug__ph">🏷️</span><span class="sug__t"><b>' + esc0(c.name) + '</b>' +
        '<span>تصنيف في الموقع</span></span></button>';
    });

    (bag.history || []).forEach(function (h) {
      html += '<button type="button" class="sug sug--hist" role="option" data-search-go="' + esc0(h) + '">' +
        '<span class="sug__ph">🕘</span><span class="sug__t"><b>' + esc0(h) + '</b>' +
        '<span>من بحثك السابق</span></span></button>';
    });

    (bag.items || []).forEach(function (it) {
      remember([it]);
      var img = it.poster
        ? CS.ui.imgTag(it.poster, '', '', ' width="36" height="54"')
        : '<span class="sug__ph">' + (it.type === 'tv' ? '📺' : '🎬') + '</span>';
      html += '<button type="button" class="sug" role="option" data-open="' + esc0(CS.ui.itemKey(it)) + '">' + img +
        '<span class="sug__t"><b>' + esc0(it.title) + '</b><span>' +
        esc0([it.year, CS.ui.TYPE_AR[it.type]].filter(Boolean).join(' · ')) + '</span></span></button>';
    });

    if (!html) { hideSuggest(); return; }
    s.innerHTML = html;
    s.hidden = false;
    var q = $('#q');
    if (q) q.setAttribute('aria-expanded', 'true');
  }

  var runSuggest = CS.util.debounce(function (q) {
    if (suggestOff || q.length < 2 || !CS.hasKey()) return hideSuggest();
    var token = ++suggestToken;

    CS.search.suggest(q, function (partial) { paintSuggest(partial, token); })
      .then(function (bag) { paintSuggest(bag, token); })
      .catch(hideSuggest);
  }, 220);

  /* ============================================================
     التوجيه
     ============================================================ */

  var suppressRoute = false;
  var ourSteps = 0;

  function decodeSafe(s) { try { return decodeURIComponent(s); } catch (e) { return s; } }

  function parseHash() {
    var raw = location.hash.slice(1);
    if (!raw) return { name: 'home' };
    if (raw.charAt(0) !== '/') return { name: 'ignore' };

    var qs = '';
    var qi = raw.indexOf('?');
    if (qi !== -1) { qs = raw.slice(qi + 1); raw = raw.slice(0, qi); }

    var h = raw.replace(/^\//, '');
    if (!h) return { name: 'home', qs: qs };
    var parts = h.split('/');

    if (parts[0] === 's' && parts.length >= 2) {
      return { name: 'search', query: decodeSafe(parts.slice(1).join('/')) };
    }
    if (parts[0] === 'tag' && parts.length >= 2) {
      return { name: 'search', query: decodeSafe(parts.slice(1).join('/')), mode: 'theme' };
    }
    if (parts[0] === 'person' && parts[1]) return { name: 'person', id: parts[1] };
    if (parts[0] === 'like' && (parts[1] === 'movie' || parts[1] === 'tv') && parts[2]) {
      return { name: 'similar', type: parts[1], id: parts[2] };
    }
    if (parts[0] === 'settings') return { name: 'settings' };
    if (parts[0] === 'work') parts = parts.slice(1);

    if ((parts[0] === 'movie' || parts[0] === 'tv') && parts[1]) {
      return { name: 'detail', type: parts[0], id: parts[1] };
    }
    if (parts[0] === 'w' && parts.length >= 3) {
      return { name: 'wiki', lang: parts[1], title: decodeSafe(parts.slice(2).join('/')) };
    }
    if (parts[0] === 'library' || parts[0] === 'liked' || parts[0] === 'fav') {
      return { name: 'library', tab: parts[1] || (parts[0] === 'liked' ? 'liked' : 'fav') };
    }
    return { name: 'home', qs: qs };
  }

  var routedOnce = false;

  function onRoute() {
    if (suppressRoute) { suppressRoute = false; return; }
    var r = parseHash();
    /* هاش ما يبدأ بـ«/» (مثل #main اللي يصنعه رابط «تخطَّ إلى المحتوى»)
       كان يوقف التوجيه كليًا: تفتح الصفحة فتطلع الشبكة فاضية للأبد.
       نتجاهله بعد أول توجيه فقط — قبل ذلك نعامله كالرئيسية. */
    if (r.name === 'ignore') {
      if (routedOnce) return;
      r = { name: 'home' };
    }
    routedOnce = true;

    if (r.name !== 'detail' && r.name !== 'wiki' && r.name !== 'person') detailToken++;

    if (r.name === 'detail') { CS.state.backTo = CS.state.backTo || '#/'; openDetail(r.type, r.id); return; }
    if (r.name === 'wiki')   { CS.state.backTo = CS.state.backTo || '#/'; openWikiDetail(r.lang, r.title); return; }
    if (r.name === 'person') { CS.state.backTo = CS.state.backTo || '#/'; openPerson(r.id); return; }

    CS.state.backTo = location.hash || '#/';

    if (r.name === 'search') { doSearch(r.query, true, r.mode); return; }
    if (r.name === 'similar') { openSimilar(r.type, r.id); return; }
    if (r.name === 'library') {
      if (r.tab && libLists()[r.tab]) libTab = r.tab;
      renderLibrary();
      return;
    }
    if (r.name === 'settings') { showView('settings'); setCrumbs([{ label: '🏠 الاستكشاف', hash: '#/' }, { label: '⚙️ الإعدادات' }]); renderSettings(); return; }

    /* الرئيسية — مع فلاتر الرابط لو فيه */
    showView('home');
    setCrumbs([{ label: '🏠 الاستكشاف', hash: '#/' }, tabCrumb()]);
    if (r.qs) {
      var parsed = queryToFilters(r.qs);
      applyFilters(Object.assign({ tag: 0 }, parsed.filters));
      paintCats();
      startFeed(parsed.tab || currentTab(), { skipHash: true });
      return;
    }
    if (!CS.feed.current().items.length) startFeed(currentTab());
    else scheduleShelves();   /* الرجوع للرئيسية يحدّث صف «كمّل مشاهدتك» */
  }

  function goTo(hash) {
    var here = parseHash().name;
    if (here !== 'detail' && here !== 'wiki' && here !== 'person') CS.state.backTo = location.hash || '#/';
    if (location.hash !== hash) ourSteps++;
    location.hash = hash;
  }

  function goBack() {
    if (ourSteps > 0) { ourSteps--; history.back(); return; }
    location.hash = CS.state.backTo || '#/';
  }

  /* ============================================================
     التصويت والمكتبة
     ============================================================ */

  function handleVote(btn) {
    var item = itemCache[btn.dataset.item];
    if (!item) return;
    var now = CS.taste.set(item, +btn.dataset.vote);

    CS.ui.toast(now === 1 ? '👍 انضاف لذوقك' : now === -1 ? '👎 تمام، ما بكرّر لك شبيهه' : '⚪ شلت رأيك');

    $$('[data-item="' + attrEsc(btn.dataset.item) + '"][data-vote]').forEach(function (b) {
      var on = +b.dataset.vote === now;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });

    if (CS.state.view === 'library') renderLibrary();
  }

  function handleLibToggle(btn) {
    var item = itemCache[btn.dataset.item];
    if (!item) return;
    var which = btn.dataset.libToggle;
    var list = CS.library[which];
    if (!list) return;

    var on = list.toggle(item);
    var label = which === 'fav' ? 'المفضلة' : which === 'later' ? 'قائمة لاحقًا' : 'المتابَعة';
    CS.ui.toast(on ? '✅ انضاف لـ' + label : '⚪ انشال من ' + label);

    /* لو تابع مسلسلًا نسجّل حالته الحالية عشان التنبيه ما يعيد القديم */
    if (which === 'follow' && on && item.type === 'tv') {
      CS.sources.nextEpisodeOf(item).then(function (info) {
        if (info && info.stamp) CS.library.alerts.mark(item, info.stamp);
      });
    }

    $$('[data-item="' + attrEsc(btn.dataset.item) + '"][data-lib-toggle="' + which + '"]').forEach(function (b) {
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      if (b.classList.contains('btn')) {
        b.textContent = which === 'fav' ? (on ? '⭐ في المفضلة' : '☆ أضف للمفضلة')
                      : which === 'later' ? (on ? '🕗 في قائمة لاحقًا' : '🕗 أشوفه لاحقًا')
                      : (on ? '🔔 متابَع' : '🔕 تابع الجديد');
      }
    });

    updateLibCount();
    if (CS.state.view === 'library') renderLibrary();
  }

  function markEpisode(spec) {
    if (!detailCtx) return;
    var parts = String(spec).split(':');
    var season = +parts[0], number = +parts[1];
    var d = detailCtx.d;
    var cur = CS.library.progress.get(d);
    /* الضغط على نفس الحلقة يلغي العلامة */
    if (cur && cur.season === season && cur.episode === number) {
      CS.library.progress.clear(d);
      CS.ui.toast('⚪ شلت علامة المتابعة');
    } else {
      CS.library.progress.set(d, { season: season, episode: number });
      CS.ui.toast('▶️ سجّلت إنك وصلت م' + season + ' ح' + number);
    }
    paintSeasons(d);
    updateLibCount();
  }

  function markDone(key) {
    var item = itemCache[key];
    if (!item) return;
    var cur = CS.library.progress.get(item);
    var done = !(cur && cur.done);
    CS.library.progress.set(item, { done: done });
    CS.ui.toast(done ? '✓ سجّلت إنك شفته' : '⚪ شلت العلامة');
    var btn = $('[data-mark-done="' + attrEsc(key) + '"]');
    if (btn) {
      btn.classList.toggle('is-on', done);
      btn.textContent = done ? '✓ شفته' : '○ علّم إني شفته';
    }
  }

  /* ============================================================
     تنبيهات الجديد
     ============================================================ */

  function checkNewEpisodes(manual) {
    if (!manual && CS.store.get(CS.KEYS.alertsOn, false) !== true) return Promise.resolve([]);
    return CS.library.alerts.check(function (it) {
      return CS.sources.nextEpisodeOf(it);
    }).then(function (rows) {
      if (!rows.length) {
        if (manual) CS.ui.toast('🟡 ما فيه جديد في أعمالك المتابَعة');
        return rows;
      }
      var first = rows[0];
      var msg = rows.length === 1
        ? '🔔 «' + first.item.title + '» — ' + first.label
        : '🔔 ' + rows.length + ' أعمال متابَعة نزل لها جديد';
      CS.ui.toast(msg);
      CS.library.alerts.notify('RANHUB — نزل جديد', msg.replace(/^🔔 /, ''));
      return rows;
    }).catch(function () { return []; });
  }

  /* ============================================================
     التمرير اللانهائي
     ============================================================ */

  function watchSentinels() {
    if (!('IntersectionObserver' in window)) return;

    var feedSentinel = $('#feed-sentinel');
    if (feedSentinel) {
      new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (!e.isIntersecting) return;
          if (CS.state.view === 'home' && !$('#feed-more').hidden) loadFeed(false);
        });
      }, { rootMargin: '600px' }).observe(feedSentinel);
    }

    var resSentinel = $('#results-sentinel');
    if (resSentinel) {
      new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting && CS.state.view === 'results' && !$('#loadmore-wrap').hidden) {
            CS.state.shown += PAGE;
            paintResults();
          }
        });
      }, { rootMargin: '600px' }).observe(resSentinel);
    }
  }

  /* ============================================================
     الثيم والحالة العامة
     ============================================================ */

  function paintThemeBtn() {
    var el = $('#theme-label');
    if (!el) return;
    var mode = CS.theme.get();
    el.textContent = mode === 'light' ? '☀️' : mode === 'auto' ? '🖥️' : '🌙';
    var btn = $('#btn-theme');
    if (btn) btn.title = CS.theme.LABEL[mode];
  }

  function watchNetwork() {
    var bar = $('#netbar');
    CS.net.onBusy(function (n) {
      if (!bar) return;
      bar.hidden = n === 0;
    });

    function online() {
      var off = $('#offline-notice');
      if (off) off.hidden = navigator.onLine !== false;
    }
    window.addEventListener('online', function () { online(); CS.ui.toast('🟢 رجع الاتصال'); });
    window.addEventListener('offline', function () { online(); CS.ui.toast('🟠 انقطع الاتصال — يُعرض المحفوظ فقط'); });
    online();
  }

  /* الصور: المضيف البديل ثم بديل نصّي — بلا أيقونة صورة مكسورة أبدًا */
  function watchImages() {
    document.addEventListener('error', function (e) {
      var img = e.target;
      if (!img || img.tagName !== 'IMG') return;
      var fb = img.getAttribute('data-fallback');
      if (fb && img.src !== fb) {
        img.setAttribute('data-fallback', '');
        img.src = fb;
        return;
      }
      if (img.dataset.dead) return;
      img.dataset.dead = '1';
      var card = img.closest('.card__poster, .dt__poster, .ep__still, .cast__p, .sug');
      if (!card) { img.style.display = 'none'; return; }
      var title = img.getAttribute('alt') || '';
      var kind = card.classList.contains('ep__still') ? '🎞️'
               : card.classList.contains('cast__p') ? '👤' : '🎬';
      img.outerHTML = '<div class="card__ph"><b>' + kind + '</b><span>' + esc0(title) + '</span></div>';
    }, true);
  }

  /* ============================================================
     ربط الأحداث
     ============================================================ */

  function bind() {

    $('#search-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var q = $('#q').value.trim();
      /* بحث فاضٍ كان لا يفعل شيئًا إطلاقًا — الآن يرجّعك للاستكشاف */
      if (!q) {
        hideSuggest();
        if (CS.state.view !== 'home') location.hash = '#/';
        else CS.ui.toast('🟡 اكتب اسم عمل أو وصف قصة');
        return;
      }
      goTo('#/s/' + encodeURIComponent(q));
    });

    $('#q').addEventListener('input', function () {
      var v = this.value.trim();
      $('#search-clear').hidden = !v;
      $('#btn-to-en').hidden = !CS.util.isArabic(v);
      suggestOff = false;
      runSuggest(v);
    });

    $('#q').addEventListener('focus', function () {
      suggestOff = false;
      if (this.value.trim().length >= 2) runSuggest(this.value.trim());
    });

    $('#search-clear').addEventListener('click', function () {
      $('#q').value = '';
      this.hidden = true;
      $('#btn-to-en').hidden = true;
      hideSuggest();
      /* كانت تفضّي الخانة وتترك صفحة نتائج قديمة معروضة — ورابطها
         في شريط العنوان — فيحسّ المستخدم إن الزرّ ما اشتغل */
      if (CS.state.view === 'results') { CS.state.query = ''; location.hash = '#/'; }
      $('#q').focus();
    });

    /* التنقّل داخل الاقتراحات بالأسهم */
    $('#q').addEventListener('keydown', function (e) {
      var box = $('#suggest');
      if (!box || box.hidden) return;
      var opts = $$('.sug', box);
      if (!opts.length) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        var i = opts.indexOf(document.activeElement);
        var next = e.key === 'ArrowDown' ? (i + 1) % opts.length : (i <= 0 ? opts.length - 1 : i - 1);
        opts[next].focus();
      } else if (e.key === 'Escape') {
        hideSuggest();
      }
    });

    $('#suggest').addEventListener('keydown', function (e) {
      var opts = $$('.sug', this);
      var i = opts.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); opts[(i + 1) % opts.length].focus(); }
      else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (i <= 0) $('#q').focus(); else opts[i - 1].focus();
      } else if (e.key === 'Escape') { e.preventDefault(); hideSuggest(); $('#q').focus(); }
    });

    $('#btn-to-en').addEventListener('click', searchInEnglish);

    /* --- التبويبات وأدوات الخلاصة --- */
    $('#tabs').addEventListener('click', function (e) {
      var t = e.target.closest('.tab');
      if (!t) return;
      setTab(t.dataset.tab);
      startFeed(t.dataset.tab);
    });

    ['#feed-sort', '#feed-lang', '#feed-rating', '#feed-type', '#feed-country', '#feed-quality']
      .forEach(function (sel) {
        var el = $(sel);
        if (el) el.addEventListener('change', function () { startFeed(currentTab()); });
      });

    ['#feed-year-from', '#feed-year-to'].forEach(function (sel) {
      var el = $(sel);
      if (!el) return;
      el.addEventListener('change', function () { startFeed(currentTab()); });
      el.addEventListener('input', function () { yearField(sel); paintFilterCount(); });
    });

    var resSort = $('#results-sort');
    if (resSort) resSort.addEventListener('change', paintResults);

    var filtersBtn = $('#btn-filters');
    if (filtersBtn) filtersBtn.addEventListener('click', function () {
      var tools = $('#feed-tools');
      var open = tools.hidden;
      tools.hidden = !open;
      this.setAttribute('aria-expanded', open ? 'true' : 'false');
    });

    var resetBtn = $('#btn-filters-reset');
    if (resetBtn) resetBtn.addEventListener('click', resetFilters);

    $('#btn-feed-more').addEventListener('click', function () {
      autoRounds = 0;
      loadFeed(false);
    });
    $('#btn-loadmore').addEventListener('click', function () {
      CS.state.shown += PAGE;
      paintResults();
    });

    /* --- المكتبة --- */
    $('#btn-backup').addEventListener('click', exportBackup);
    $('#btn-restore').addEventListener('click', function () { $('#import-file').click(); });
    $('#import-file').addEventListener('change', function () {
      importBackup(this.files && this.files[0]);
      this.value = '';
    });
    $('#lib-tabs').addEventListener('click', function (e) {
      var t = e.target.closest('.tab');
      if (!t) return;
      libTab = t.dataset.lib;
      suppressRoute = true;
      location.hash = '#/library/' + libTab;
      renderLibrary();
    });

    /* --- تفويض النقر العام --- */
    document.addEventListener('click', function (e) {
      var vote = e.target.closest('[data-vote]');
      if (vote) { e.preventDefault(); handleVote(vote); return; }

      var lib = e.target.closest('[data-lib-toggle]');
      if (lib) { e.preventDefault(); handleLibToggle(lib); return; }

      var ep = e.target.closest('[data-mark-ep]');
      if (ep) { e.preventDefault(); markEpisode(ep.dataset.markEp); return; }

      var done = e.target.closest('[data-mark-done]');
      if (done) { e.preventDefault(); markDone(done.dataset.markDone); return; }

      var season = e.target.closest('[data-season]');
      if (season && detailCtx) { e.preventDefault(); loadSeason(detailCtx.d, +season.dataset.season, detailCtx.token); return; }

      var person = e.target.closest('[data-person]');
      if (person) {
        if (e.metaKey || e.ctrlKey || e.shiftKey) return;
        e.preventDefault();
        goTo('#/person/' + person.dataset.person);
        return;
      }

      var tag = e.target.closest('[data-tag]');
      if (tag) {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
        e.preventDefault();
        goTo('#/tag/' + encodeURIComponent(tag.dataset.tag));
        return;
      }

      var simBtn = e.target.closest('[data-similar]');
      if (simBtn) {
        e.preventDefault();
        goTo('#/like/' + simBtn.dataset.similar);
        return;
      }

      var catGo = e.target.closest('[data-cat-go]');
      if (catGo) {
        e.preventDefault();
        hideSuggest();
        location.hash = '#/';
        setTimeout(function () { setCat(+catGo.dataset.catGo); }, 30);
        return;
      }

      var searchGo = e.target.closest('[data-search-go]');
      if (searchGo) { e.preventDefault(); goTo('#/s/' + encodeURIComponent(searchGo.dataset.searchGo)); return; }

      var open = e.target.closest('[data-open]');
      if (open) {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
        e.preventDefault();
        suggestOff = true;
        hideSuggest();
        goTo('#/work/' + open.dataset.open);
        return;
      }

      var trBtn = e.target.closest('[data-translate-plot]');
      if (trBtn) { translatePlot(trBtn); return; }

      if (e.target.closest('[data-related-more]') && detailCtx) {
        if (!moreRelated()) loadRelated(detailCtx.d, detailCtx.token, false);
        return;
      }
      if (e.target.closest('[data-person-more]')) { morePersonWorks(); return; }

      var share = e.target.closest('[data-share]');
      if (share) {
        var it = itemCache[share.dataset.share];
        shareUrl(fullUrl('#/work/' + share.dataset.share), it ? it.title : 'RANHUB');
        return;
      }

      if (e.target.closest('#btn-results-share')) { shareUrl(fullUrl(), CS.state.query || 'RANHUB'); return; }
      if (e.target.closest('#btn-share-section')) {
        syncHomeHash();
        shareUrl(fullUrl(), 'RANHUB — ' + titleFor(currentTab()));
        return;
      }

      if (e.target.closest('[data-fatal-dismiss]')) { clearFatal(); return; }
      if (e.target.closest('[data-open-settings]')) { openSettings(); return; }
      if (e.target.closest('[data-diagnose]')) { openSettings(); setTimeout(testConnection, 60); return; }
      if (e.target.closest('[data-retry-home]')) { startFeed(currentTab()); return; }
      if (e.target.closest('[data-retry-search]')) { doSearch(CS.state.query, true); return; }
      if (e.target.closest('[data-cat-all]')) { setCat(0); return; }
      if (e.target.closest('#btn-filters-reset-2')) { resetFilters(); return; }

      if (e.target.closest('[data-go-general]')) { setTab('general'); startFeed('general'); return; }
      if (e.target.closest('[data-back-home]')) { location.hash = '#/'; return; }

      var copyT = e.target.closest('[data-copy-title]');
      if (copyT) {
        e.preventDefault();
        copyLink(copyT.dataset.copyTitle, '📋 انتسخ الاسم');
        return;
      }
      if (e.target.closest('[data-back]')) { goBack(); return; }

      var keyBtn = e.target.closest('[data-test-key]');
      if (keyBtn) { verifyKeyRow(keyBtn); return; }

      var csTest = e.target.closest('[data-cs-test]');
      if (csTest) {
        var id = csTest.dataset.csTest;
        csTest.disabled = true;
        csTest.textContent = '⏳';
        CS.contentSources.test(id).then(function () { refreshCsList(); });
        return;
      }
      var csToggle = e.target.closest('[data-cs-toggle]');
      if (csToggle) {
        var cid = csToggle.dataset.csToggle;
        CS.contentSources.setEnabled(cid, !CS.contentSources.enabled(cid));
        refreshCsList();
        return;
      }

      var dt2 = e.target.closest('[data-ds-test]');
      if (dt2) { testDataSource(dt2.dataset.dsTest); return; }

      var dg = e.target.closest('[data-ds-toggle]');
      if (dg) {
        var dcur = CS.dataSources.byId(dg.dataset.dsToggle);
        if (dcur) CS.dataSources.update(dcur.id, { enabled: !dcur.enabled });
        refreshDsList();
        if (detailCtx) renderExtraData();
        return;
      }

      var dd = e.target.closest('[data-ds-del]');
      if (dd) {
        var dgone = CS.dataSources.byId(dd.dataset.dsDel);
        if (dgone && window.confirm('أحذف «' + dgone.name + '»؟')) {
          CS.dataSources.remove(dgone.id);
          refreshDsList();
          if (detailCtx) renderExtraData();
        }
        return;
      }

      var libClear = e.target.closest('[data-lib-clear]');
      if (libClear) {
        var which = libClear.dataset.libClear;
        if (!window.confirm('أفضّي هذي القائمة؟ ما ينحذف غيرها.')) return;
        if (which === 'continue') CS.library.progress.clearAll();
        else if (which === 'liked' || which === 'disliked') CS.taste.clearAll();
        else if (CS.library[which]) CS.library[which].clear();
        updateLibCount();
        renderLibrary();
        CS.ui.toast('🗑️ انفضّت القائمة');
        return;
      }

      if (e.target.closest('#btn-check-new') || e.target.closest('#btn-check-new-2')) {
        CS.ui.toast('🔎 أفحص الجديد…');
        checkNewEpisodes(true);
        return;
      }

      /* أزرار صفحة الإعدادات — تُبنى ديناميكيًا فنمسكها بالتفويض */
      if (e.target.closest('#btn-save-settings')) { saveSettings(); return; }
      if (e.target.closest('#btn-test-key')) { testConnection(); return; }
      if (e.target.closest('#btn-clear-key')) {
        if ($('#set-api-key')) $('#set-api-key').value = '';
        CS.state.userKey = '';
        CS.state.apiKey = CS.config.sharedKey;
        CS.store.remove(CS.KEYS.apiKey);
        refreshKeyNotice();
        var ks = $('#key-state');
        if (ks) { ks.className = 'keystate is-ok'; ks.textContent = '🟢 انحذف مفتاحك الخاص. رجعنا للمفتاح المشترك.'; }
        return;
      }
      if (e.target.closest('#btn-ds-add')) { addDataSource(); return; }
      if (e.target.closest('#btn-catalog-sweep')) {
        var cst = $('#catalog-state');
        if (cst) cst.textContent = '⏳ يوسّع الفهرس…';
        runSweep(true);
        return;
      }
      if (e.target.closest('#btn-catalog-clear')) {
        if (!window.confirm('أصفّر فهرس البحث؟ بيرجع يكبر تلقائيًا مع التصفّح.')) return;
        CS.catalog.clear();
        renderSettings();
        paintIndexBtn();
        CS.ui.toast('🗑️ انصفّر الفهرس');
        return;
      }
      if (e.target.closest('#btn-clear-net')) {
        CS.net.clearCache().then(function () {
          CS.ui.toast('🧹 انفرغت ذاكرة الطلبات');
          renderSettings();
        });
        return;
      }
      if (e.target.closest('#btn-backup-2')) { exportBackup(); return; }
      if (e.target.closest('#btn-restore-2')) { $('#import-file').click(); return; }
      if (e.target.closest('#btn-reset-taste')) {
        if (!window.confirm('أصفّر كل الإعجابات وأرجع من الصفر؟')) return;
        CS.taste.clearAll();
        updateLibCount();
        CS.ui.toast('⚪ انصفّر ذوقك');
        return;
      }

      if (e.target.closest('[data-route-home]')) { e.preventDefault(); location.hash = '#/'; return; }

      if (!e.target.closest('#search-form')) hideSuggest();
    });

    /* تغييرات صفحة الإعدادات (تُبنى ديناميكيًا) */
    document.addEventListener('change', function (e) {
      if (e.target.id === 'ds-preset') { onPresetPick(); return; }
      if (e.target.id === 'set-theme') { CS.theme.set(e.target.value); paintThemeBtn(); return; }
    });

    /* --- أزرار الهيدر --- */
    $('#btn-library').addEventListener('click', function () { goTo('#/library/' + libTab); });
    $('#btn-settings').addEventListener('click', openSettings);
    $('#btn-theme').addEventListener('click', function () {
      var mode = CS.theme.cycle();
      paintThemeBtn();
      CS.ui.toast(CS.theme.LABEL[mode]);
      if (CS.state.view === 'settings') renderSettings();
    });
    $('#notice-open-settings').addEventListener('click', function () {
      var broken = $('#key-notice').dataset.tmdbBroken;
      openSettings();
      if (broken) setTimeout(testConnection, 60);
    });
    $('#notice-dismiss').addEventListener('click', function () {
      CS.store.set(CS.KEYS.noticeOff, true);
      $('#key-notice').hidden = true;
    });

    $('#btn-lang').addEventListener('click', function () {
      CS.state.lang = CS.store.set(CS.KEYS.lang, CS.state.lang === 'ar' ? 'en' : 'ar');
      $('#lang-label').textContent = CS.state.lang === 'ar' ? 'ع' : 'EN';
      CS.ui.toast(CS.state.lang === 'ar' ? '🟢 لغة المحتوى: العربية' : '🟢 Content language: English');
      CS.tmdb.loadGenres().then(rerenderCurrent);
    });

    $('#btn-back-home').addEventListener('click', function () { location.hash = '#/'; });
    $('#btn-lib-back').addEventListener('click', function () { location.hash = '#/'; });

    var idxBtn = $('#btn-index');
    if (idxBtn) idxBtn.addEventListener('click', function () { runSweep(true); });

    var strongBtn = $('#btn-index-strong');
    if (strongBtn) strongBtn.addEventListener('click', runDeepSweep);

    var cats = $('#feed-cats');
    if (cats) {
      cats.addEventListener('click', function (e) {
        var b = e.target.closest('.cat');
        if (!b) return;
        setCat(+b.dataset.cat || 0);
      });
    }

    /* --- الاختصارات --- */
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        if (CS.state.view === 'detail' || CS.state.view === 'person') return goBack();
        hideSuggest();
        return;
      }
      var typing = /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName);
      if (e.key === '/' && !typing) { e.preventDefault(); $('#q').focus(); $('#q').select(); }
    });

    window.addEventListener('hashchange', onRoute);

    /* الحصّة امتلأت — نقولها بدل ما نفشل بصمت */
    window.addEventListener('cs:storage-full', function () {
      CS.ui.toast('🟠 مساحة المتصفّح امتلأت — إعداداتك تشتغل لكن ما تنحفظ. صفّر الفهرس من الإعدادات.');
    });
  }

  function resetFilters() {
    applyFilters({ sort: 'popularity.desc', origLang: '', minRating: 0, mediaType: '',
                   country: '', quality: '', yearFrom: 0, yearTo: 0, tag: 0 });
    paintCats();
    paintFilterCount();
    startFeed(currentTab());
    CS.ui.toast('⚪ انصفّرت التصفية');
  }

  /* ============================================================
     تعبئة القوائم المبنية من البيانات
     ============================================================ */

  function fillSelects() {
    var sort = $('#feed-sort');
    if (sort && !sort.options.length) {
      CS.feed.SORTS.forEach(function (s) { sort.add(new Option(s.label, s.id)); });
    }
    var rsort = $('#results-sort');
    if (rsort && !rsort.options.length) {
      [{ v: 'match', t: '🎯 الأقرب لبحثك' },
       { v: 'primary_release_date.desc', t: 'الأحدث' },
       { v: 'vote_average.desc', t: 'الأعلى تقييمًا' },
       { v: 'popularity.desc', t: 'الأكثر مشاهدة' },
       { v: 'title.asc', t: 'أبجدي' }].forEach(function (o) { rsort.add(new Option(o.t, o.v)); });
    }
    var country = $('#feed-country');
    if (country && !country.options.length) {
      CS.feed.COUNTRIES.forEach(function (c) { country.add(new Option(c.name, c.code)); });
    }
    var quality = $('#feed-quality');
    if (quality && !quality.options.length) {
      Object.keys(CS.feed.QUALITY).forEach(function (k) {
        quality.add(new Option(CS.feed.QUALITY[k].label, k));
      });
    }
  }

  /* ============================================================
     حزام الأمان
     ============================================================ */

  var REQUIRED = ['util', 'store', 'state', 'db', 'net', 'theme', 'fuzzy', 'taste', 'library',
                  'certs', 'tmdb', 'catalog', 'reco', 'wiki', 'contentSources', 'sources',
                  'dataSources', 'links', 'feed', 'search', 'ui'];

  function fatal(title, detail, showReload) {
    var bar = document.getElementById('fatal');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'fatal';
      bar.className = 'fatal';
      document.body.insertBefore(bar, document.body.firstChild);
    }
    bar.innerHTML = '<b>🔴 ' + esc0(title) + '</b><span>' + esc0(detail) + '</span>' +
      (showReload ? '<button class="notice__cta" id="fatal-reload">حدّث الصفحة الآن</button>' : '') +
      '<button class="notice__x" data-fatal-dismiss aria-label="إخفاء">&times;</button>';
    bar.hidden = false;
    var rl = document.getElementById('fatal-reload');
    if (rl) rl.addEventListener('click', hardReload);
  }

  function hardReload() {
    var url = location.href.split('#')[0].split('?')[0];
    location.replace(url + '?fresh=' + Date.now() + location.hash);
  }

  function clearFatal() {
    var bar = document.getElementById('fatal');
    if (bar) bar.hidden = true;
  }

  function step(fn) {
    try { fn(); } catch (e) { if (window.console) console.error('[ranhub] خطوة إقلاع فشلت:', e); }
  }

  function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') return;
    try {
      navigator.serviceWorker.register('sw.js').catch(function () { /* اختياري */ });
    } catch (e) { /* اختياري */ }
  }

  function boot() {
    var missing = REQUIRED.filter(function (m) { return !CS[m]; });
    if (missing.length) {
      fatal('نسخة الصفحة قديمة',
            'متصفحك مخزّن نسخة قديمة من الموقع (' + missing.join('، ') + ' ناقصة). اضغط تحديث.', true);
      return;
    }

    try { bind(); }
    catch (e) { fatal('ما قدرت أربط الأزرار', String(e && e.message || e), true); return; }

    step(fillSelects);
    step(paintThemeBtn);
    step(function () { $('#lang-label').textContent = CS.state.lang === 'ar' ? 'ع' : 'EN'; });
    /* الترتيب مقصود: taste.migrate يحذف cs.favorites بعد نقلها
       للإعجابات، فلو سبق library.migrate ما لقى شيئًا وضاعت مفضلة
       المستخدم القديمة من قائمة ⭐. المكتبة تقرأ أولًا. */
    step(function () { CS.library.migrate(); });
    step(function () {
      var moved = CS.taste.migrate();
      if (moved) setTimeout(function () { CS.ui.toast('👍 نقلت ' + moved + ' من مفضلتك القديمة'); }, 900);
    });
    step(function () {
      /* مفاتيح قديمة كانت خانات ثابتة — ننقلها لقائمة مصادره الموحّدة */
      if (CS.store.get(CS.KEYS.dsMigrated, false) === true) return;
      CS.store.set(CS.KEYS.dsMigrated, true);

      var moved = CS.dataSources.migrate({
        omdb:   CS.store.get(CS.KEYS.omdbKey, ''),
        fanart: CS.store.get(CS.KEYS.fanartKey, ''),
        trakt:  CS.store.get(CS.KEYS.traktKey, '')
      });
      if (moved) {
        [CS.KEYS.omdbKey, CS.KEYS.fanartKey, CS.KEYS.traktKey].forEach(function (k) { CS.store.remove(k); });
        setTimeout(function () {
          CS.ui.toast('🟢 نقلت ' + moved + ' من مفاتيحك لقائمة مصادرك — تقدر توقّفها أو تحذفها');
        }, 1400);
      }
    });
    step(updateLibCount);
    step(function () { paintIndexBtn(); });
    step(refreshKeyNotice);
    step(watchSentinels);
    step(watchNetwork);
    step(watchImages);
    step(applyExplicitVisibility);
    step(paintCats);
    step(function () {
      /* آخر فلاتر مستعملة + آخر قسم */
      var saved = CS.store.get(CS.KEYS.filters, null);
      if (saved && saved.f && !location.hash.slice(1).indexOf('/?')) applyFilters(saved.f);
      var tab = CS.store.get(CS.KEYS.tab, HOME_TAB);
      if (!TABS[tab]) tab = HOME_TAB;
      if (tab === 'explicit' && !explicitOn()) tab = HOME_TAB;
      setTab(tab);
      CS.store.set(CS.KEYS.certTier, certFor(tab));
      $('#feed-title').textContent = titleFor(tab);
      paintFilterCount();
    });

    /* الفهرس يُحمَّل من IndexedDB قبل أول رسم — البحث بالوصف يعتمد عليه */
    var warm = CS.catalog.ready.catch(function () { return 0; });
    var genres = CS.hasKey() ? CS.tmdb.loadGenres().catch(function () {}) : Promise.resolve();

    Promise.all([warm, genres]).then(function () {
      step(paintIndexBtn);
      try { onRoute(); }
      catch (e) { fatal('ما قدرت أفتح الصفحة', String(e && e.message || e), true); }

      /* التصنيفات الإضافية تُحلّ في الخلفية بعد ما تستقر الصفحة —
         أربعون نداء /search/keyword ما تستاهل تأخير أول بطاقة،
         والنتيجة تنحفظ أسبوعين فما تتكرّر */
      if (CS.feed.resolveExtras) {
        setTimeout(function () {
          CS.feed.resolveExtras().then(function (extra) {
            if (extra && extra.length) paintCats();
          }).catch(function () {});
        }, 6000);
      }
      setTimeout(function () { checkNewEpisodes(false); }, 4000);
      registerSW();
    });
  }

  var reported = false;
  window.addEventListener('error', function (e) {
    if (reported || !e || !e.message) return;
    /* أخطاء تحميل الصور تُعالَج في watchImages — ما تستحق شريطًا أحمر */
    if (e.target && e.target.tagName === 'IMG') return;
    reported = true;
    try { fatal('صار خطأ في الصفحة', e.message, true); } catch (ignored) { /* آخر خط دفاع */ }
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  CS.app = { fatal: fatal, clearFatal: clearFatal, hardReload: hardReload,
             startFeed: startFeed, renderSettings: renderSettings };

})(window.CS);
