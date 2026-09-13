/* ============================================================
   app.js — RANHUB: التوجيه، الأحداث، وربط كل شي مع بعض
   الصفحات: الاستكشاف · النتائج · العمل · الشخص · عجبني
   ============================================================ */

(function (CS) {
  'use strict';

  var $  = function (sel, ctx) { return (ctx || document).querySelector(sel); };
  var $$ = function (sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); };

  /* لو config.js نفسه هو الملف القديم/الفاشل، لازم app.js يكمل تحميله
     عشان يقدر يعرض شريط «نسختك قديمة» بدل ما يموت بصمت */
  var LIM = (CS.config && CS.config.limits) ||
            { pageSize: 50, suggest: 7, history: 12, wikiSearch: 14, wikiResolve: 10, keywordSeeds: 3 };

  var PAGE = 50;                /* كم عمل نضيف مع كل «اعرض المزيد» */
  var itemCache = {};

  function remember(list) {
    (list || []).forEach(function (it) { if (it) itemCache[CS.ui.itemKey(it)] = it; });
  }

  function attrEsc(v) { return String(v).replace(/(["\\])/g, '\\$1'); }

  function esc0(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
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

  /* ============================================================
     الصفحات
     ============================================================ */

  var VIEWS = ['home', 'results', 'liked', 'detail', 'person'];

  function showView(name) {
    CS.state.view = name;
    VIEWS.forEach(function (v) {
      var el = $('#view-' + v);
      if (el) el.hidden = v !== name;
    });
  }

  /* ============================================================
     التصنيف ووسوم المحتوى — تحميل كسول
     ============================================================ */

  function ensureCerts(list, cap) {
    var need = (list || []).slice(0, cap || 60).filter(function (it) {
      return it.source === 'tmdb' && CS.certs.cachedFor(it) === undefined;
    });
    if (!need.length) return Promise.resolve();
    return CS.util.pool(need, 6, function (it) { return CS.certs.fetchFor(it); });
  }

  /* وسوم المحتوى تُسحب فقط في أقسام الكبار — فيها الفائدة، وتوفّر طلبات */
  /* الوسوم كانت مقفولة على وضع «adults» — وهو الوضع الافتراضي — فما ظهرت أبدًا.
     نفتحها لكل أوضاع الكبار ونكتفي بحدّ أعلى للطلبات. */
  /* ما تحتاجه البوابة: وسوم العمل اللي ما نعرف عنه شيئًا */
  function ensureHeat(list, cap) {
    var need = (list || []).slice(0, cap || 40).filter(function (it) {
      return it.source === 'tmdb' && CS.certs.cachedHeat(it) === undefined;
    });
    if (!need.length) return Promise.resolve();
    return CS.util.pool(need, 6, function (it) { return CS.certs.fetchHeat(it); });
  }

  /* ما تحتاجه الشارة: القائمة الكاملة بدل بذرة الكلمة الواحدة.
     يُنادى للمعروض فقط — البوابة ما تنتظره، فما يكلّف تأخيرًا. */
  function upgradeHeat(list, cap) {
    var need = (list || []).slice(0, cap || 30).filter(function (it) {
      var h = it && it.source === 'tmdb' && CS.certs.cachedHeat(it);
      return !!(h && h.partial);
    });
    if (!need.length) return Promise.resolve();
    return CS.util.pool(need, 6, function (it) { return CS.certs.fetchHeat(it, true); });
  }

  function paintBadges(root, list, redraw) {
    (list || []).forEach(function (it) {
      var cardEl = root.querySelector('.card[data-key="' + attrEsc(CS.ui.itemKey(it)) + '"]');
      if (!cardEl) return;
      var poster = cardEl.querySelector('.card__poster');
      if (!poster) return;

      var info = CS.certs.cachedFor(it);
      if (info && !poster.querySelector('.card__cert')) {
        poster.insertAdjacentHTML('beforeend', CS.ui.certBadge(it));
      }

      /* شارة نوع المحتوى إلزامية على كل بوستر — نستبدل شارة الانتظار
         أول ما تصل البيانات، وما نتركها «⏳» أبدًا بعد وصولها */
      var kindEl = poster.querySelector('.card__kind');
      if (kindEl && (redraw || kindEl.classList.contains('card__kind--wait'))) {
        var fresh = CS.ui.kindBadge(it);
        if (fresh.indexOf('card__kind--wait') === -1) kindEl.outerHTML = fresh;
      }
      var heat = CS.certs.cachedHeat(it);
      if (heat && heat.score && !poster.querySelector('.card__heat')) {
        it.heat = heat;
        poster.insertAdjacentHTML('beforeend',
          '<div class="card__heat" title="' + attrEsc('وسوم TMDB: ' + heat.tags.join('، ')) +
          '"><i style="width:' + heat.score + '%"></i></div>');
      }
    });
  }

  /* الشارة لازم تكون في كل الصفحات لا في نتائج البحث وحدها.
     الصفحات اللي ما فيها استعلام تعرض تطابق ذوقك — رقم حقيقي من تصويتك. */
  function stampTaste(list) {
    var v = CS.taste.version ? CS.taste.version() : 0;
    (list || []).forEach(function (it) {
      if (!it || it.matchBasis === 'query' || it.matchBasis === 'related') return;
      /* التصويت يغيّر ذوقك، فالنسبة لازم تُحسب من جديد لا تتجمّد على أول قيمة */
      if (it.matchStamp !== v) { it.matchPct = CS.taste.matchPct(it); it.matchStamp = v; }
    });
    return list;
  }

  /* الشارتان تُرسمان كل وحدة أول ما تجهز — التصنيف يوصل قبل الوسوم
     عادةً، فانتظار الاثنين معًا كان يأخّر ظهور الشارة بلا داعٍ.
     والحدّ صار طول القائمة المعروضة: شارة نوع المحتوى إلزامية على
     كل بوستر، وحدّ ٤٠ كان يترك آخر البطاقات على «⏳» للأبد. */
  function hydrate(root, list) {
    var n = (list || []).length;
    ensureCerts(list, n).then(function () {
      paintBadges(root, list);
      /* التصنيف يصل بعد الرسم، وقد ينقض البوابة: عمل موسوم إيروتيك
         لكن تصنيفه الرسمي PG وسمه غلط. نشيل بطاقته بدل ما تقعد. */
      dropDisqualified(root, list);
    });
    ensureHeat(list, n).then(function () {
      paintBadges(root, list);
      /* الشارة تُحدَّث بعدها بالقائمة الكاملة — البوابة ما تنتظرها */
      return upgradeHeat(list, 30).then(function () { paintBadges(root, list, true); });
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

    /* الحذف بعد الرسم كان يترك العدّاد يكذب وحالة «ما فيه شي» مخفيّة */
    var grid = root.querySelector('#feed-grid') || (root.id === 'feed-grid' ? root : null);
    if (grid || root === $('#feed-grid')) {
      var left = $$('#feed-grid .card').length;
      var c = $('#feed-count');
      if (c) c.textContent = left + ' عمل';
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
     الاستكشاف — شبكة واحدة بترقيم لا نهائي
     ============================================================ */

  /* ------------------------------------------------------------
     وضع «للبالغين فقط» — يشمل الموقع كله لا الأقسام المخصّصة وحدها
     ------------------------------------------------------------ */

  function adultOnlyOn() { return CS.store.get(CS.KEYS.adultOnly, true) !== false; }

  /* المفتاح صار واحدًا: تشغيله موافقة صريحة، وإطفاؤه سحب لها
     يقفل الأقسام الثلاثة كلها — ما عاد فيه قسم عام يرجع له */
  function setAdultOnly(on) {
    CS.store.set(CS.KEYS.adultOnly, !!on);
    CS.store.set(CS.KEYS.adultOn, !!on);
  }

  /* ------------------------------------------------------------
     أقسام الموقع الثلاثة — كلها مخصّصة لنفس نوع المحتوى، والفرق
     بينها الدرجة لا الموضوع. الأسماء إنجليزية لأن مصطلحات التصنيف
     نفسها إنجليزية على TMDB والوسوم قابلة للضغط بها.
     ------------------------------------------------------------ */
  var TABS = {
    general:  { title: '🌹 General',   cert: 'general'  },
    explicit: { title: '⛔ Explicit',  cert: 'explicit' },
    foryou:   { title: '✨ For You',   cert: 'general'  }
  };

  var HOME_TAB = 'general';

  function tabConf(tab) { return TABS[tab] || TABS[HOME_TAB]; }

  /* أي فلتر تصنيف يستحقه هذا القسم الآن — كل قسم له فلتره الخاص،
     وما عاد فيه قسم يرث عتبة الموقع: الأقسام كلها للكبار. */
  function certFor(tab) { return tabConf(tab).cert; }

  function titleFor(tab) { return tabConf(tab).title; }

  var feedBusy = false;
  /* كل تبديل قسم يُبطل التحميل الطائر بدل ما يُسقط الجديد: بدون هذا
     كان loadFeed يرد فورًا لأن القسم السابق ما خلّص، فيبقى القسم
     الجديد على هياكله بلا أي إعادة محاولة. */
  var feedGen = 0;

  function currentTab() {
    var el = $('.tab.is-active');
    return el && TABS[el.dataset.tab] ? el.dataset.tab : HOME_TAB;
  }

  function startFeed(tab) {
    tab = TABS[tab] ? tab : HOME_TAB;
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
        $('#feed-more').hidden = true;
        $('#feed-empty').hidden = false;
        $('#feed-empty').innerHTML =
          '<b>🔒 ما فتحت المحتوى</b>' +
          '<p>أقسام الموقع الثلاثة كلها لأعمال الكبار، فبدون الموافقة ما فيه شي يُعرض.</p>' +
          '<div style="margin-top:1.2rem"><button class="btn" data-retry-home>وافقت — اعرض المحتوى</button></div>';
        return;
      }
      CS.store.set(CS.KEYS.adultOn, true);
      setAdultOnly(true);
    }

    CS.store.set(CS.KEYS.certTier, cert);
    CS.store.set(CS.KEYS.tab, tab);
    autoRounds = 0;

    /* القسم الجديد يسبق أي طلب قديم: نُبطل الجيل السابق ونحرّر القفل
       كي لا يسقط تحميل هذا القسم، والرد القديم يُتجاهل عند وصوله. */
    feedGen++;
    feedBusy = false;

    $('#feed-title').textContent = titleFor(tab);

    CS.feed.reset({
      tab: tab,
      sort: $('#feed-sort').value,
      origLang: $('#feed-lang').value,
      minRating: +$('#feed-rating').value || 0,
      mediaType: ($('#feed-type') || {}).value || ''
    });

    $('#feed-grid').innerHTML = CS.ui.skeletons(18);
    $('#feed-empty').hidden = true;
    $('#feed-more').hidden = true;
    loadFeed(true);
  }

  function setTab(tab) {
    $$('.tab').forEach(function (t) {
      var on = t.dataset.tab === tab;
      t.classList.toggle('is-active', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
    });
  }

  var autoRounds = 0;

  function loadFeed(first) {
    if (feedBusy) return;
    feedBusy = true;
    var gen = feedGen;
    var btn = $('#btn-feed-more');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ يحمّل…'; }

    CS.feed.loadMore().then(function (res) {
      if (gen !== feedGen) return;
      if (CS.state.view !== 'home') { feedBusy = false; return; }

      var items = res.items;
      remember(items);

      /* في وضع البالغين نجيب التصنيفات قبل الرسم، لأن TMDB ما يفلتر
         المسلسلات بالتصنيف أصلًا — الفلترة لازم تصير عندنا */
      /* البوابة تحتاج وسوم كل عمل بنرسمه — لا تصنيفه. الوسوم هي
         الدليل الوحيد على إن العمل محتوى جنسي فعلًا، والتصنيف يجي
         كسولًا بعدها للشارة وحدها. */
      /* حدّ ثابت لكل جولة: items تكبر مع كل جولة، فسحب وسوم القائمة
         كلها في كل مرة كان يعيد حساب ما عرفناه ويضاعف الطلبات */
      return ensureHeat(items, 70).then(function () {
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
      var why = err && err.message === 'NO_KEY' ? 'ما فيه مفتاح TMDB' : CS.tmdb.explain(err);
      showTmdbProblem(why);
      $('#feed-grid').innerHTML = '';
      $('#feed-empty').hidden = false;
      $('#feed-empty').innerHTML =
        '<b>🔴 ما قدرت أوصل لـ TMDB</b><p>' + esc0(why) + '</p>' +
        '<div style="margin-top:1.2rem;display:flex;gap:.6rem;justify-content:center;flex-wrap:wrap">' +
        '<button class="btn" data-diagnose>🔍 افحص الاتصال</button>' +
        '<button class="btn btn--ghost" data-retry-home>أعد المحاولة</button></div>';
    });
  }

  function paintFeed(items, res, first, btn) {
    /* بوابة واحدة للموقع كله: العمل ما يُعرض إلا إذا TMDB وسمه
       بمحتوى جنسي. اللي ما وصلت وسومه يُمنع لا يُعرض على الشك. */
    var shown = items.filter(function (it) {
      return CS.certs.isAdultWork(it) === true && CS.certs.kindFits(it) !== false;
    });

    /* الفلترة تاكل من الحصيلة — نكمّل تحميلًا تلقائيًا بدل ما نطلع صفحة شبه فاضية */
    if (shown.length < 24 && !res.exhausted && autoRounds < 3) {
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
      /* الكنس لازم يشتغل حتى لو الشبكة طلعت فاضية — هو الطريق الوحيد
         لإصلاح فهرس فاضي أو سجلّات قديمة */
      scheduleSweep();
      $('#feed-grid').innerHTML = '';
      $('#feed-empty').hidden = false;
      $('#feed-empty').innerHTML = emptyFeedHtml();
      $('#feed-more').hidden = res.exhausted;
      if (btn) { btn.disabled = false; btn.textContent = 'اعرض المزيد'; }
      return;
    }

    $('#feed-empty').hidden = true;
    stampTaste(shown);
    /* الفهرس يتغذّى من المعروض فقط — العمل عدّى البوابة فعلًا هنا.
       تغذيته من القائمة الخام كانت تملأه بأعمال ما تخرج منه أبدًا. */
    if (CS.catalog) CS.catalog.add(shown);
    $('#feed-grid').innerHTML = CS.ui.cards(shown);
    $('#feed-count').textContent = shown.length + ' عمل' + (res.exhausted ? ' — خلصت المادة' : '');
    $('#feed-more').hidden = res.exhausted;
    if (btn) { btn.disabled = false; btn.textContent = 'اعرض المزيد'; }
    hydrate($('#feed-grid'), shown);
    if (first) window.scrollTo({ top: 0, behavior: 'smooth' });
    paintIndexBtn();
    scheduleSweep();
  }

  /* الفهرس المحلي يكبر في الخلفية بعد ما تستقر الصفحة — هو مادة
     البحث بالوصف، وكل ما كبر صار البحث أدق. مرة كل ست ساعات. */
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

  /* ------------------------------------------------------------
     زرّ الفهرس في الرئيسية.
     الفهرس هو مادة البحث بوصف القصة، وأول زيارة يكون صغيرًا فالبحث
     يطلع ضعيفًا بلا ما يفهم المستخدم ليه. الزرّ يعرض حجمه، ويتلوّن
     تحذيريًا وهو صغير، ويوسّعه بضغطة بدل ما ينتظر الكنس التلقائي.
     ------------------------------------------------------------ */
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

    /* أرضية زمنية للحالة المشغولة: الكنسة قد تنتهي في أجزاء من الثانية
       (ذاكرة الطلبات)، فتومض الحالة ويحسّ المستخدم إن الزرّ ما اشتغل. */
    var floor = new Promise(function (r) { setTimeout(r, 450); });

    CS.catalog.sweep(true).then(function (added) {
      return floor.then(function () { return added; });
    }).then(function (added) {
      paintIndexBtn();
      renderCatalogState();
      if (!fromButton) return;
      CS.ui.toast(added > 0
        ? '⚡ انضاف ' + added + ' عمل لفهرس البحث'
        : '🟡 الفهرس محدَّث — ما فيه جديد');
    }).catch(function () {
      paintIndexBtn();
      if (fromButton) CS.ui.toast('🔴 ما قدرت أوسّع الفهرس');
    });
  }

  /* ------------------------------------------------------------
     «تحديث قوي» — الزرّ اللي جنب زرّ الفهرس.
     الكنسة العادية خفيفة ومقيّدة بمهلة زمنية وكنسة واحدة لكل فتحة.
     هذا الزرّ يتجاوزها بكنسة أوسع (كلمات القسمين · خمس ترتيبات ·
     صفحات مختلفة) فيجيب مادة أحدث وأكثر للفهرس وبوسترات أكثر.
     ------------------------------------------------------------ */
  function runDeepSweep() {
    if (!CS.catalog || !CS.catalog.deepSweep) return;
    var btn = $('#btn-index-strong');
    if (btn) btn.disabled = true;
    paintIndexBtn('busy');
    CS.ui.toast('🚀 تحديث قوي — يمسح الفهرس بعمق…');

    var floor = new Promise(function (r) { setTimeout(r, 450); });
    CS.catalog.deepSweep().then(function (added) {
      return floor.then(function () { return added; });
    }).then(function (added) {
      paintIndexBtn();
      renderCatalogState();
      if (btn) btn.disabled = false;
      CS.ui.toast(added > 0
        ? '🚀 تحديث قوي: انضاف ' + added + ' عمل للفهرس'
        : '🟡 الفهرس محدَّث — ما فيه جديد');
    }).catch(function () {
      paintIndexBtn();
      if (btn) btn.disabled = false;
      CS.ui.toast('🔴 ما قدرت أكمل التحديث القوي');
    });
  }

  function emptyFeedHtml() {
    var tab = currentTab();
    var name = titleFor(tab);

    if (tab === 'foryou') {
      var n = CS.taste.counts().likes;
      if (!n) {
        return '<b>✨ For You — ما فيه شي أبني عليه بعد</b>' +
          '<p>هذا القسم ما يستكشف بكلمات، يبني على أعمالك اللي عجبتك. ' +
          'اضغط 👍 على أي عمل في الأقسام الثانية وارجع هنا.</p>' +
          '<div style="margin-top:1.2rem"><button class="btn" data-go-general>🌹 روح لقسم General</button></div>';
      }
      return '<b>✨ For You — ما وصل شي من كتالوج الموقع</b>' +
        '<p>عندك ' + n + ' عمل بـ👍، وبنينا الترشيح من كلماتها وأنواعها، لكن ما طلع ' +
        'شي يطابقها بنسبة ' + CS.feed.FORYOU_MIN + '٪ فما فوق بهذي الفلاتر — ' +
        'إما أعمالها المشابهة ما تدخل كتالوج الموقع، وإما الفلاتر ضيّقة. ' +
        'وسّع «اللغة الأصلية» و«أقل تقييم»، أو افتح صفحة العمل ونزّل مفرداته بأزرار 🎯.</p>' +
        '<div style="margin-top:1.2rem"><button class="btn" data-go-general>🌹 روح لقسم General</button></div>';
    }

    return '<b>🟡 ' + esc0(name) + ' — ما وصل شي بهذي الفلاتر</b>' +
      '<p>هذا القسم يبني نفسه من كلمات TMDB المفتاحية، وكتالوجها لهذا النوع محدود أصلًا. ' +
      'رجّع «اللغة الأصلية» لـ«كل اللغات» و«أقل تقييم» لـ«أي تقييم» — الفلترين هما اللي يقصّونه غالبًا.</p>' +
      '<div style="margin-top:1.2rem;display:flex;gap:.6rem;justify-content:center;flex-wrap:wrap">' +
      '<button class="btn" data-retry-home>أعد المحاولة</button>' +
      '<button class="btn btn--ghost" data-diagnose>🔍 افحص الاتصال</button></div>';
  }

  /* ============================================================
     النتائج
     ============================================================ */

  var searchToken = 0;

  function paintResults() {
    var grid = $('#results-grid');
    var empty = $('#results-empty');
    var more = $('#loadmore-wrap');
    var all = CS.state.results;

    /* نتائج البحث عدّت بوابة المحتوى في search.js قبل ما تصل هنا،
       فما نعيد فلترتها بالتصنيف العمري — إعادة الفلترة كانت تسقط
       أعمالًا صحيحة بلا تصنيف أمريكي. نتحقق من البوابة فقط، دفاعًا
       في العمق: أي عنصر ما عدّاها ما يُرسم مهما كان مصدره. */
    var pre = ensureHeat(all, Math.min(all.length, 90));

    pre.then(function () {
      var list = all.filter(function (it) {
        return CS.certs.isAdultWork(it) === true && CS.certs.kindFits(it) !== false;
      });

      if (!list.length) {
        grid.innerHTML = '';
        empty.hidden = false;
        var meta = CS.state.meta || {};
        if (CS.certs.currentFilter() !== 'all') meta.certFiltered = CS.certs.current().label;
        else delete meta.certFiltered;
        empty.innerHTML = CS.ui.emptyHtml(CS.state.query, meta);
        more.hidden = true;
        $('#results-meta').textContent = buildMetaText(0);
        return;
      }

      empty.hidden = true;
      var slice = list.slice(0, CS.state.shown);
      grid.innerHTML = CS.ui.cards(slice);
      more.hidden = list.length <= CS.state.shown;
      $('#results-count').textContent = slice.length + ' من ' + list.length;
      $('#results-meta').textContent = buildMetaText(list.length);
      hydrate(grid, slice);
    });
  }

  /* ============================================================
     «أعمال مثل هذا» — من البوستر مباشرة، بلا فتح صفحة العمل.
     نفس مقياس القرب المستعمل في «ذات صلة»: وسوم مشتركة موزونة
     بندرتها، وتقاطع كلمات القصة. المصدر الأول الفهرس المحلي
     (فوري وبلا طلبات)، وترشيحات TMDB تكمّله وتُقاس بنفس المقياس.
     ============================================================ */
  function openSimilar(type, id) {
    var token = ++searchToken;
    var key = type + '/' + id;
    var known = itemCache[key] || null;

    showView('results');
    suggestOff = true;
    hideSuggest();
    $('#results-title').textContent = '🎯 أعمال مثل ' + (known ? '«' + known.title + '»' : 'هذا العمل');
    $('#results-meta').textContent = 'يقيس القرب…';
    $('#results-grid').innerHTML = CS.ui.skeletons(12);
    $('#results-empty').hidden = true;
    $('#loadmore-wrap').hidden = true;
    window.scrollTo({ top: 0, behavior: 'smooth' });

    /* نحتاج وسوم العمل وقصته. التفاصيل تعطيهما في طلب واحد، ولو
       العمل عندنا بوسومه كاملة نستغني عن الطلب أصلًا. */
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
        if (CS.catalog) CS.catalog.put(d, { keywords: d.keywords });
      }

      var ex = {};
      ex[(type === 'tv' ? 'v' : 'm') + id] = true;
      var local = CS.catalog ? CS.catalog.similarTo(d, { exclude: ex, limit: 300 }) : [];

      /* ترشيحات TMDB تكمّل الفهرس ولا تحلّ محلّه */
      return Promise.all([
        CS.tmdb.relatedPage(type, id, 'recommendations', 1).catch(function () { return { items: [] }; }),
        CS.tmdb.relatedPage(type, id, 'similar', 1).catch(function () { return { items: [] }; })
      ]).then(function (r) {
        if (token !== searchToken) return;
        var seen = {};
        seen[type + ':' + id] = true;
        local.forEach(function (it) { seen[it.type + ':' + it.id] = true; });

        var api = [];
        [r[0].items || [], r[1].items || []].forEach(function (list, src) {
          list.forEach(function (it, i) {
            var k = it.type + ':' + it.id;
            if (seen[k] || !it.poster) return;
            seen[k] = true;
            it.apiSrc = src; it.apiIdx = i;
            api.push(it);
          });
        });

        return ensureHeat(api, Math.min(api.length, 60)).then(function () {
          if (token !== searchToken) return;
          var apiOk = api.filter(function (it) {
            return CS.certs.isAdultWork(it) === true && CS.certs.kindFits(it) !== false;
          });
          apiOk.forEach(function (it) { it.relScore = relatedScore(it, it.apiSrc, it.apiIdx, d); });
          if (CS.catalog) CS.catalog.add(apiOk);

          var all = local.concat(apiOk);
          var strong = all.filter(function (it) { return !it.relWeak; });
          if (strong.length >= 8) all = strong;
          all.sort(function (a, b) { return (b.relScore || 0) - (a.relScore || 0); });

          var top = all.length ? Math.max(1, all[0].relScore || 1) : 1;
          all.forEach(function (it) {
            it.matchBasis = 'related';
            it.why = 'related';
            it.whyText = relatedWhy(it);
            it.matchPct = Math.max(30, Math.min(96, Math.round((it.relScore / top) * 96)));
          });

          CS.state.results = all;
          CS.state.meta = { similarOf: d.title, fromIndex: local.length, fromApi: apiOk.length };
          CS.state.shown = PAGE;
          remember(all);

          if (!all.length) {
            $('#results-grid').innerHTML = '';
            $('#results-empty').hidden = false;
            $('#results-empty').innerHTML =
              '<b>🟡 ما لقيت عملًا قريبًا من «' + esc0(d.title) + '»</b>' +
              '<p>القرب يُقاس بالوسوم المشتركة وتقاطع القصة، والفهرس المحلي لسه ' +
              'ما فيه مادة كافية. وسّع الفهرس من الرئيسية وارجع.</p>' +
              '<div style="margin-top:1.2rem"><button class="btn" data-back-home>رجوع للاستكشاف</button></div>';
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
      $('#results-empty').innerHTML = '<b>🔴 ما قدرت أقيس القرب</b><p>' +
        esc0(err && err.message === 'NO_WORK' ? 'ما لقيت هذا العمل' : CS.tmdb.explain(err)) + '</p>';
    });
  }

  function buildMetaText(count) {
    var m = CS.state.meta || {};
    if (m.similarOf) {
      var b = [count + ' عمل قريب'];
      if (m.fromIndex) b.push('⚡ ' + m.fromIndex + ' من الفهرس المحلي');
      if (m.fromApi) b.push('🎬 ' + m.fromApi + ' من ترشيحات TMDB');
      b.push('القرب من الوسوم المشتركة وتقاطع القصة');
      return b.join(' · ');
    }
    var bits = [count + ' نتيجة'];
    /* نوضّح للمستخدم بأي طريقة بحثنا — بالوصف ولا بالاسم */
    if (m.intent === 'plot')  bits.push('🔎 بحثت بالقصة والوصف');
    if (m.gateDropped)        bits.push('🚫 حجبت ' + m.gateDropped + ' خارج المحتوى');
    if (m.catalogHits)        bits.push('⚡ ' + m.catalogHits + ' من الفهرس المحلي');
    if (m.intent === 'mixed') bits.push('🔎 بحثت بالاسم والقصة معًا');
    if (m.translated) bits.push('جرّبت كمان بالإنجليزي: ' + m.translated);
    if (m.relatedOf) bits.push('+ أعمال قريبة من «' + m.relatedOf + '»');
    if (m.tmdbError) bits.push('🔴 TMDB ما رد: ' + m.tmdbError);
    return bits.join(' · ');
  }

  function doSearch(query, skipHash, mode) {
    query = String(query || '').trim();
    if (!query) { location.hash = '#/'; return; }

    CS.state.query = query;
    CS.history.push(query);

    $('#q').value = query;
    $('#btn-to-en').hidden = !CS.util.isArabic(query);
    suggestOff = true;
    hideSuggest();
    showView('results');
    $('#results-title').textContent = mode === 'theme' ? '#' + query.replace(/\s+/g, '-') : '«' + query + '»';
    $('#results-meta').textContent = 'يدور…';
    $('#results-grid').innerHTML = CS.ui.skeletons(12);
    $('#results-empty').hidden = true;
    $('#loadmore-wrap').hidden = true;
    window.scrollTo({ top: 0, behavior: 'smooth' });

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
      $('#results-empty').hidden = false;
      $('#results-empty').innerHTML = '<b>🔴 صار خطأ في البحث</b><p>' + esc0(CS.tmdb.explain(err)) + '</p>';
    });
  }

  /* حوّل بحثي للإنجليزي */
  function searchInEnglish() {
    var q = $('#q').value.trim();
    if (!q) return;
    var btn = $('#btn-to-en');
    btn.disabled = true;
    var was = btn.textContent;
    btn.textContent = '⏳';

    CS.wiki.toEnglish(q).then(function (en) {
      btn.disabled = false;
      btn.textContent = was;
      if (!en || en === q) {
        CS.ui.toast('🔴 خدمة الترجمة ما ردّت — غالبًا انتهت الحصة اليومية. حط بريدك في الإعدادات.');
        return;
      }
      CS.ui.toast('🔤 ' + en);
      doSearch(en);
    });
  }

  /* ============================================================
     اللي عجبني + التصدير والاستيراد
     ============================================================ */

  function renderLiked() {
    showView('liked');
    var likes = CS.taste.likes();
    var dis = CS.taste.dislikes();
    remember(likes); remember(dis);

    /* البوابة تشمل هذي الصفحة كمان: تصويت محفوظ من قبل البوابة قد
       يكون على عمل عام، وكان يُرسم كاملًا هنا للأبد. */
    ensureHeat(likes.concat(dis), Math.min(likes.length + dis.length, 120)).then(function () {
      var okL = likes.filter(function (it) { return CS.certs.isAdultWork(it) === true; });
      var okD = dis.filter(function (it) { return CS.certs.isAdultWork(it) === true; });
      var hidden = (likes.length - okL.length) + (dis.length - okD.length);

      stampTaste(okL); stampTaste(okD);
      $('#liked-grid').innerHTML = CS.ui.cards(okL);
      $('#liked-empty').hidden = okL.length > 0 || okD.length > 0;
      $('#liked-meta').textContent = (okL.length || okD.length)
        ? okL.length + ' عمل عجبك' + (okD.length ? ' · ' + okD.length + ' ما عجبك' : '') +
          (hidden ? ' · ' + hidden + ' محجوب خارج المحتوى' : '')
        : hidden ? hidden + ' عمل محفوظ محجوب — كلها خارج محتوى الموقع' : '';

      $('#disliked-wrap').hidden = okD.length === 0;
      $('#disliked-grid').innerHTML = CS.ui.cards(okD);

      hydrate($('#view-liked'), okL.concat(okD));
    });
    updateLikeCount();
  }

  function updateLikeCount() {
    var n = CS.taste.counts().likes;
    var el = $('#fav-count');
    el.textContent = n;
    el.hidden = n === 0;
  }

  function exportTaste() {
    var data = {
      app: 'RANHUB', version: CS.config.version, exportedAt: new Date().toISOString(),
      likes: CS.taste.likes(), dislikes: CS.taste.dislikes()
    };
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'ranhub-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    CS.ui.toast('⬇️ نزّلت ' + data.likes.length + ' إعجاب');
  }

  function importTaste(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var data = JSON.parse(String(reader.result));
        var added = CS.taste.merge(data);
        CS.ui.toast(added ? '⬆️ ضفت ' + added + ' عمل' : '🟡 ما فيه شي جديد في الملف');
        renderLiked();
      } catch (e) {
        CS.ui.toast('🔴 الملف مو صالح — لازم يكون ملف تصدير من RANHUB');
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
    window.scrollTo(0, 0);
    related = { items: [], pool: [], shown: 0, page: 0, exhausted: false, loading: false, autoRounds: 0 };

    CS.tmdb.details(type, id).then(function (d) {
      if (token !== detailToken) return;

      /* صفحة العمل كانت الباب المفتوح: رابط مكتوب باليد مثل
         #/work/movie/862 يفتح أي عمل بالكامل بلا أي فحص. التفاصيل
         ترجع الوسوم أصلًا في نفس الطلب، فالفحص هنا مجاني. */
      if (d.keywords && d.keywords.length) {
        /* الواصفات الرسمية تجي مع نفس الطلب — تمريرها يمنع استبدال
           سجلّ أغنى بسجلّ أفقر منه */
        CS.certs.putHeat(d, d.heat || CS.certs.heatOf(d.keywords, d.adult, d.descriptors));
      }
      if (CS.certs.isAdultWork(d) === false) {
        panel.innerHTML =
          '<div class="dt__hero"><div class="dt__backdrop"></div>' +
          '<button class="dt__close" data-back aria-label="رجوع">&#8594;</button></div>' +
          '<div class="empty" style="margin:2rem auto;max-width:34rem">' +
          '<b>🚫 هذا العمل خارج محتوى الموقع</b>' +
          '<p>«' + esc0(d.title || '') + '» ما وسمه TMDB بمحتوى جنسي، والموقع ما يعرض غيره. ' +
          'الرابط اللي فتحته يشير لعمل خارج الكتالوج.</p>' +
          '<div style="margin-top:1.2rem"><button class="btn" data-back>رجوع</button></div></div>';
        return;
      }
      if (CS.catalog) CS.catalog.put(d, { keywords: d.keywords || [] });

      /* الترجمة التلقائية مستقلة عن «لغة المحتوى»:
         أي نص مو عربي يُترجم ما دام الخيار مفعّلًا */
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

      panel.innerHTML = CS.ui.detail(d, extra);
      remember([d]);
      window.scrollTo(0, 0);
      detailCtx = { d: d, extra: extra, token: token };
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
    }).catch(function (err) {
      if (token !== detailToken) return;
      panel.innerHTML = '<div class="dt__body"><div class="empty"><b>🔴 ما قدرت أفتح التفاصيل</b><p>' +
        esc0(CS.tmdb.explain(err)) + '</p></div></div>';
    });
  }

  /* الأعمال ذات الصلة: مشابهات + ترشيحات، صفحة صفحة وبلا تكرار */
  /**
   * درجة القرب من العمل المفتوح.
   * TMDB يرجّع قائمتين بترتيبها هي، وكنا نلصقهما كما جاءتا — فتطلع عشوائية.
   * الترتيب هنا يبني على: ترشيحات TMDB أفضل تحريريًا من «مشابه»، ثم اشتراك
   * الأنواع، ثم التقييم وعدد المصوّتين والشهرة.
   */
  /* درجة القرب لعمل جاء من ترشيحات TMDB.
     النسخة الأولى كانت تبني على ترتيب TMDB نفسه (٦٠ للترشيحات و٤٢
     للمشابهات ناقص الموضع) زائد شهرة وتقييم — ولا حرف واحد عن
     محتوى العمل. ترشيحات TMDB لعمل إيروتيكي نادر مبنيّة على مشاهدات
     المستخدمين لا على القصة، فالنتيجة كانت أعمالًا بلا أي علاقة.
     الآن الوسوم المشتركة والقصة هي الأساس، وترتيب TMDB مجرّد مرجّح. */
  function relatedScore(it, srcRank, idx, base) {
    var s = 0, why = [];

    /* ١) الوسوم المشتركة — أقوى دليل على «نفس النوع من العمل» */
    var baseKw = {};
    (base.keywords || []).forEach(function (k) {
      var t = String((k && k.name) || '').toLowerCase();
      if (t) baseKw[t] = true;
    });
    var itHeat = CS.certs.cachedHeat(it);
    var itNames = (itHeat && itHeat.names) || [];
    var kwHits = 0, bestIdf = 0;
    itNames.forEach(function (n) {
      var t = String(n || '').toLowerCase();
      if (!baseKw[t]) return;
      kwHits++;
      /* الندرة توزن هنا كما توزن في الفهرس: «nunsploitation» مشتركة
         تدل أضعاف «erotica» المشتركة — وإلا تقدّم عمل بعيد يشاركك
         وسمًا عامًا على عمل قريب يشاركك وسمًا خاصًا. */
      var idf = (CS.catalog && CS.catalog.keywordIdf) ? CS.catalog.keywordIdf(t) : 1.6;
      if (idf > bestIdf) bestIdf = idf;
      s += 14 * idf;
      if (why.length < 4) why.push(t);
    });
    if (kwHits > 1) s += (kwHits - 1) * 18;

    /* ٢) تقاطع كلمات القصة */
    var termHits = 0;
    if (CS.catalog && it.overview && base.overview) {
      var baseTerms = CS.catalog.plotTerms(base.overview, 24);
      var hay = ' ' + CS.catalog.norm(it.overview + ' ' + (it.title || '')) + ' ';
      baseTerms.forEach(function (t) {
        if (hay.indexOf(' ' + t) !== -1) { termHits++; s += 7; }
      });
      if (termHits > 2) s += (termHits - 2) * 6;
    }

    /* ٣) مرجّحات: النوع، ثم موضع TMDB، ثم الجودة والسنة */
    var mine = base.genreIds || [];
    s += (it.genreIds || []).filter(function (g) { return mine.indexOf(g) !== -1; }).length * 4;
    s += (srcRank === 0 ? 10 : 6) - Math.min(idx, 20) * 0.4;
    if (it.rating) s += (it.rating - 5) * 1.6;
    s += Math.min(5, Math.log10((it.popularity || 0) + 1) * 2);
    if (it.year && base.year) s -= Math.min(7, Math.abs(it.year - base.year) / 7);

    it.relKw = why;
    it.relKwHits = kwHits;
    it.relTermHits = termHits;
    /* نفس أرضية الفهرس: وسم عام واحد مشترك لا يصنع «صلة» */
    it.relWeak = kwHits < 2 && termHits < 2 && bestIdf < 2.2;
    return s;
  }

  /* سطر يشرح ليه هذا العمل ظهر هنا — بلا سطر، «ذات صلة» ادّعاء */
  function relatedWhy(it) {
    if (it.relKw && it.relKw.length) {
      return 'يشارك: ' + it.relKw.slice(0, 3).join(' + ');
    }
    if (it.relTermHits > 1) return 'قصته تلتقي بـ' + it.relTermHits + ' من عناصر هذا العمل';
    return 'من نفس النوع';
  }

  /* الرسم — بلا حدّ مصطنع. القائمة تُبنى من الفهرس المحلي (مادة
     غزيرة ومقبولة سلفًا) زائد ترشيحات TMDB، والكل يُرتَّب بنفس
     مقياس القرب ويُعرض على دفعات. */
  var REL_PAGE = 24;

  function paintRelated(d, token) {
    var sec = $('#dt-related');
    if (!sec || token !== detailToken) return;

    var pre = ensureHeat(related.items, Math.min(related.items.length, 120));

    pre.then(function () {
      if (token !== detailToken) return;

      /* ترشيحات TMDB بعد البوابة — تُقاس الآن، بعد وصول وسومها */
      var fromApi = related.items.filter(function (it) {
        return CS.certs.isAdultWork(it) === true && CS.certs.kindFits(it) !== false;
      });
      fromApi.forEach(function (it) {
        it.relScore = relatedScore(it, it.apiSrc || 0, it.apiIdx || 0, d);
      });
      if (CS.catalog) CS.catalog.add(fromApi);

      /* الفهرس المحلي — المصدر الأغزر والأقرب، بلا أي طلب */
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
        fromIndex = CS.catalog.similarTo(d, { exclude: ex, limit: 240 });
        fromIndex.forEach(function (it) { it.why = 'related'; });
      }

      var all = fromApi.concat(fromIndex);

      /* الترشيحات الواهية تُستبعد ما دام فيه مادة كافية بدونها.
         لو ما فيه، نعرضها بدل قسم فاضٍ — لكن ما نقدّمها أبدًا. */
      var strong = all.filter(function (it) { return !it.relWeak; });
      if (strong.length >= 8) all = strong;

      all.sort(function (a, b) { return (b.relScore || 0) - (a.relScore || 0); });

      var top = all.length ? Math.max(1, all[0].relScore || 1) : 1;
      all.forEach(function (it) {
        it.matchBasis = 'related';
        it.why = 'related';
        it.whyText = relatedWhy(it);
        it.matchPct = Math.max(30, Math.min(96, Math.round((it.relScore / top) * 96)));
      });

      related.pool = all;
      var shown = all.slice(0, related.shown || REL_PAGE);
      related.shown = shown.length;

      var sec2 = $('#dt-related');
      if (!sec2) return;
      var more = all.length > shown.length;
      sec2.innerHTML = CS.ui.relatedSection(shown, !more && related.exhausted, false, all.length);
      hydrate(sec2, shown);
      remember(shown);

      /* ما زلنا نكمّل من TMDB لو الحصيلة قليلة والفهرس ما كفى */
      if (all.length < 12 && !related.exhausted && related.autoRounds < 6) {
        related.autoRounds++;
        loadRelated(d, token, false);
      }
    });
  }

  /* «اعرض المزيد» يوسّع من نفس البركة المحلية أولًا — بلا انتظار شبكة */
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

  /* الجلب فقط — الترتيب والدرجات كلها في paintRelated بعد ما تصل
     الوسوم. حسابها هنا كان يعطي صفرًا للتشابه لأن وسوم العمل ما
     وصلت بعد، فيتحوّل الترتيب لشهرة صرفة. */
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
      [r[0].items, r[1].items].forEach(function (list, src) {
        list.forEach(function (it, i) {
          var k = it.type + ':' + it.id;
          if (seen[k] || !it.poster) return;
          if (it.adult && !CS.certs.adultAllowed()) return;
          seen[k] = true;
          it.apiSrc = src;
          it.apiIdx = (p - 1) * 20 + i;
          related.items.push(it);
          added++;
        });
      });

      if (p >= Math.max(r[0].pages, r[1].pages) || (!added && p > 1)) related.exhausted = true;

      remember(related.items);
      paintRelated(d, token);
      if (first && related.items.length < 20 && !related.exhausted) loadRelated(d, token, true);
    }).catch(function () { related.loading = false; });
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
      if (!w || token !== detailToken) return;
      return CS.wiki.fullPlot(w.wikiLang, w.wikiTitle).then(function (plot) {
        if (!plot || token !== detailToken) return;
        d.wikiUrl = d.wikiUrl || w.wikiUrl;
        d.wikiTitle = w.wikiTitle;
        d.wikiLang = w.wikiLang;
        extra.fullPlot = plot;
        extra.plotLang = w.wikiLang;

        /* ترجمة تلقائية للقصة الطويلة لو الإعداد مفعّل */
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
    }).catch(function () { /* اختيارية */ });
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
    window.scrollTo(0, 0);

    /* صفحة عمل مصدرها ويكيبيديا ما لها وسوم TMDB نتحقق منها، فالبوابة
       ما تقدر تحكم عليها أبدًا. الرابط باقٍ للتوافق لكنه ما يعرض عملًا. */
    var wcached = itemCache['w/' + lang + '/' + encodeURIComponent(title)] ||
                  itemCache['w/' + lang + '/' + title];
    if (!wcached || CS.certs.isAdultWork(wcached) !== true) {
      panel.innerHTML =
        '<div class="dt__hero"><div class="dt__backdrop"></div>' +
        '<button class="dt__close" data-back aria-label="رجوع">&#8594;</button></div>' +
        '<div class="empty" style="margin:2rem auto;max-width:34rem">' +
        '<b>🚫 صفحة ويكيبيديا ما تُعرض كعمل</b>' +
        '<p>هذي الصفحة ما لها مقابل في TMDB، وبدونه ما نقدر نتحقق إن محتواها ' +
        'ضمن الموقع. ابحث باسم العمل عشان نجيبه من TMDB.</p>' +
        '<div style="margin-top:1.2rem"><button class="btn" data-back>رجوع</button></div></div>';
      return;
    }

    var cached = itemCache['w/' + lang + '/' + encodeURIComponent(title)] ||
                 itemCache['w/' + lang + '/' + title];

    CS.wiki.fullPlot(lang, title).then(function (plot) {
      if (token !== detailToken) return;
      var d = cached || {
        id: 'w', type: 'movie', title: CS.util.cleanTitle(title), year: null,
        poster: '', source: 'wiki', overview: '',
        wikiLang: lang, wikiTitle: title,
        wikiUrl: 'https://' + lang + '.wikipedia.org/wiki/' + encodeURIComponent(title)
      };
      var extra = { summary: d.overview || '', summarySource: 'الملخص من ويكيبيديا', fullPlot: plot, plotLang: lang };
      remember([d]);
      panel.innerHTML = CS.ui.detail(d, extra);
      window.scrollTo(0, 0);
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
    window.scrollTo(0, 0);

    CS.tmdb.person(id).then(function (p) {
      if (token !== detailToken) return;
      personCtx = { p: p, shown: PAGE, token: token };
      remember(p.works);
      paintPerson(token, true);
    }).catch(function (err) {
      if (token !== detailToken) return;
      panel.innerHTML = '<div class="dt__body"><div class="empty"><b>🔴 ما قدرت أفتح صفحة الشخص</b><p>' +
        esc0(CS.tmdb.explain(err)) + '</p></div></div>';
    });
  }

  function morePersonWorks() {
    if (!personCtx) return;
    personCtx.shown += PAGE;
    paintPerson(personCtx.token, false);
  }

  /**
   * صفحة الممثل كانت السطح الوحيد اللي ما يمر عليه فلتر التصنيف إطلاقًا،
   * فتعرض أعمالًا غير بالغين ووضع الكبار شغّال. الحين تُفلتر مثل غيرها،
   * وعدد الأعمال المكتوب يعدّ المعروض لا الكل عشان ما يكذب.
   */
  function paintPerson(token, scroll) {
    if (!personCtx || token !== detailToken) return;
    var p = personCtx.p;
    /* أعمال الممثل: فيها العام والجنسي معًا — البوابة تفرزها */
    var pre = ensureHeat(p.works, Math.min(p.works.length, 200));

    pre.then(function () {
      if (token !== detailToken) return;
      var works = p.works.filter(function (it) {
        return CS.certs.isAdultWork(it) === true && CS.certs.kindFits(it) !== false;
      });
      if (CS.catalog) CS.catalog.add(works);

      stampTaste(works);
      var view = { name: p.name, photo: p.photo, job: p.job, birthday: p.birthday,
                   place: p.place, bio: p.bio, works: works };
      var panel = $('#person-panel');
      if (!panel) return;
      panel.innerHTML = CS.ui.person(view, personCtx.shown);
      hydrate(panel, works.slice(0, personCtx.shown));
      if (scroll) window.scrollTo(0, 0);
    });
  }

  /* ============================================================
     الإعدادات
     ============================================================ */

  function openSettings() {
    $('#api-key').value    = CS.state.userKey || '';
    $('#tr-email').value   = CS.store.get(CS.KEYS.email, '') || '';
    $('#set-lang').value   = CS.state.lang;
    $('#set-region').value = CS.state.region;
    $('#set-autotr').checked = autoTranslateOn();
    $('#set-adultonly').checked = adultOnlyOn();
    renderCatalogState();
    fillPresets();
    onPresetPick();
    renderDataSources();
    var dsOut = $('#out-ds-add');
    if (dsOut) { dsOut.className = 'keyrow__out'; dsOut.textContent = ''; }

    var st = $('#key-state');
    st.className = 'keystate';
    st.textContent = '';
    $('#settings').hidden = false;
    document.body.classList.add('is-locked');
    setTimeout(function () { $('#set-lang').focus(); }, 60);
  }

  function closeSettings() {
    $('#settings').hidden = true;
    document.body.classList.remove('is-locked');
  }

  /* هل الفلتر المخزّن يطابق اللي تفرضه إعداداتك الحالية؟ */
  function filterStale() {
    return CS.certs.currentFilter() !== certFor(currentTab());
  }

  function rerenderCurrent() {
    var r = parseHash();
    if (r.name === 'detail') { openDetail(r.type, r.id); return; }
    if (r.name === 'wiki')   { openWikiDetail(r.lang, r.title); return; }
    if (r.name === 'person') { openPerson(r.id); return; }
    if (CS.state.view === 'results' && CS.state.query) { doSearch(CS.state.query, true, parseHash().mode); return; }
    if (CS.state.view === 'liked') { renderLiked(); return; }
    startFeed(currentTab());
  }

  function finishSave() {
    setTimeout(function () { closeSettings(); CS.ui.toast('🟢 تم الحفظ'); rerenderCurrent(); }, 650);
  }

  function saveSettings() {
    var key = $('#api-key').value.trim();
    var state = $('#key-state');

    CS.state.lang = CS.store.set(CS.KEYS.lang, $('#set-lang').value);
    CS.state.region = CS.store.set(CS.KEYS.region, $('#set-region').value);
    CS.store.set(CS.KEYS.autoTr, $('#set-autotr').checked);
    setAdultOnly($('#set-adultonly').checked);
    /* الفلتر كان مخزّنًا ويُكتب في startFeed وحدها، فتغييره من الإعدادات
       ما يوصل صفحة العمل ولا الممثل ولا النتائج إلا بعد ما ترجع للرئيسية */
    CS.store.set(CS.KEYS.certTier, certFor(currentTab()));
    $('#lang-label').textContent = CS.state.lang === 'ar' ? 'ع' : 'EN';

    var mail = $('#tr-email').value.trim();
    if (mail) CS.store.set(CS.KEYS.email, mail); else CS.store.remove(CS.KEYS.email);

    if (!key) {
      CS.state.userKey = '';
      CS.state.apiKey = CS.config.sharedKey;
      CS.store.remove(CS.KEYS.apiKey);
      state.className = 'keystate is-ok';
      state.textContent = '🟢 محفوظ. الموقع يستخدم المفتاح المشترك المدمج.';
      refreshKeyNotice();
      CS.tmdb.loadGenres().then(finishSave);
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
      return CS.tmdb.loadGenres();
    }).then(finishSave).catch(function (err) {
      state.className = 'keystate is-bad';
      state.textContent = '🔴 ' + CS.tmdb.explain(err);
    });
  }

  function refreshKeyNotice() {
    var off = CS.store.get(CS.KEYS.noticeOff, false);
    $('#key-notice').hidden = CS.hasKey() || off;
  }

  function showTmdbProblem(reason) {
    if (CS.store.get(CS.KEYS.noticeOff, false)) return;
    var bar = $('#key-notice');
    $('#key-notice-text').textContent = CS.state.userKey
      ? '🔴 مفتاحك الخاص ما يشتغل: ' + reason
      : '🔴 المفتاح المشترك ما يشتغل: ' + reason + ' — حط مفتاحك الخاص المجاني.';
    $('#notice-open-settings').textContent = 'افحص الاتصال';
    bar.dataset.tmdbBroken = '1';
    bar.hidden = false;
  }

  function testConnection() {
    var btn = $('#btn-test-key');
    var box = $('#key-state');
    var key = $('#api-key').value.trim();

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


  /* ============================================================
     زر التحقق لكل صف مفتاح — كل مفتاح يُفحص بطلبه الحقيقي
     ============================================================ */

  var KEY_TESTS = {

    'api-key': function (v) {
      return CS.tmdb.testKey(v || CS.config.sharedKey).then(function () {
        return { ok: true, detail: v ? 'مفتاحك الخاص شغّال' : 'المفتاح المشترك المدمج شغّال' };
      }).catch(function (e) {
        return { ok: false, detail: CS.tmdb.explain(e) };
      });
    },

    'tr-email': function (v) {
      if (!v) return Promise.resolve({ ok: null, detail: 'فاضي — الترجمة شغّالة بحد ٥ آلاف حرف يوميًا' });
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return Promise.resolve({ ok: false, detail: 'صيغة البريد غير صحيحة' });
      return fetch('https://api.mymemory.translated.net/get?q=' + encodeURIComponent('a quiet night') +
                   '&langpair=en|ar&de=' + encodeURIComponent(v))
        .then(function (r) { return r.json(); })
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
     مصادر البيانات — يضيفها المشغّل من الإعدادات
     ============================================================ */

  function fillPresets() {
    var sel = $('#ds-preset');
    if (sel.options.length) return;
    CS.dataSources.PRESETS.forEach(function (p) {
      sel.add(new Option(p.name + ' — ' + p.hint, p.id));
    });
    sel.add(new Option('⚙️ مصدر خاص فيي (عندي رابط API)', 'custom'));
    /* TMDB محرّك الموقع أصلًا، فالافتراضي أنفع مصدر إضافي */
    sel.value = CS.dataSources.preset('omdb') ? 'omdb' : sel.options[0].value;
    onPresetPick();
  }

  function onPresetPick() {
    var v = $('#ds-preset').value;
    var custom = v === 'custom';
    $('#ds-custom').hidden = !custom;

    if (custom) {
      $('#ds-hint').textContent = 'الصق رابط الـAPI تحت، والمفتاح فوق لو المصدر يحتاجه.';
      $('#ds-key').placeholder = 'الصق المفتاح لو المصدر يحتاجه';
      return;
    }

    var p = CS.dataSources.preset(v);
    if (!p) return;
    $('#ds-url').value = p.url;
    $('#ds-name').value = '';
    $('#ds-hint').textContent = p.needsKey
      ? 'خذ مفتاحك المجاني من ' + p.site + ' والصقه تحت.'
      : p.name + ' ما يحتاج مفتاح — اضغط «أضف» على طول.';
    $('#ds-key').placeholder = p.needsKey ? (p.keyLabel || 'مفتاح API') : 'ما يحتاج مفتاح — اتركه فاضي';
  }

  /* ثلاث حالات لا اثنتين: نجح · فشل · ما قدرت أحكم */
  function statusLine(d, cls) {
    cls = cls || 'srcitem__st';
    if (!d.status) return '<i class="' + cls + '">⚪ ما تحقّقت منه بعد</i>';
    var ok = d.status.ok;
    var mark = ok === true ? '🟢 ' : ok === false ? '🔴 ' : '🟡 ';
    var kind = ok === true ? ' is-ok' : ok === false ? ' is-bad' : ' is-warn';
    return '<i class="' + cls + kind + '">' + mark + esc0(d.status.detail) + '</i>';
  }

  /* الفهرس المحلي هو مادة البحث بالوصف — نعرض حجمه عشان يكون
     واضحًا ليه البحث يتحسّن مع الاستخدام، وما نخفي حدوده */
  function renderCatalogState(msg) {
    var el = $('#catalog-state');
    if (!el) return;
    var box = $('#catalog-box');
    if (!CS.catalog) { if (box) box.hidden = true; return; }
    var n = CS.catalog.size();
    var quality = n >= 900 ? '🟢 واسع' : n >= 300 ? '🟡 متوسط' : '🟠 صغير';
    el.innerHTML = msg ? esc0(msg) :
      quality + ' — <b>' + n + '</b> عمل محفوظ بملخّصه ووسومه في متصفّحك.<br>' +
      'البحث بوصف القصة يطابق على هذا الفهرس، فكل ما تصفّحت أكثر صار أدق. ' +
      'ما ينحفظ فيه إلا الأعمال اللي عدّت بوابة المحتوى.';
  }

  function renderDataSources() {
    var list = CS.dataSources.all();
    var box = $('#ds-list');
    if (!box) return;

    if (!list.length) {
      box.innerHTML = '<div class="empty" style="padding:1.2rem">' +
        '<b>⚪ ما فيه مصادر</b><p>الصق رابط API تحت واضغط «أضف» — أو استعمل «تعبئة سريعة» ' +
        'لو تبي مزوّدًا جاهزًا.</p></div>';
      return;
    }

    box.innerHTML = list.map(function (d) {
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

  /* ما نطبع المفتاح في الشاشة */
  function hideKey(d) {
    return String(d.url).replace(/\{key\}/g, d.key ? '••••' : '{key}');
  }

  /* شكل المفتاح: نص متصل بلا مسافات ولا نقطتين — يعني مو رابطًا */
  function looksLikeKey(v) {
    return !!v && !/\s/.test(v) && !/^https?:/i.test(v) && v.indexOf('://') === -1 &&
           /^[A-Za-z0-9_.\-]{8,}$/.test(v);
  }

  function addDataSource() {
    var out = $('#out-ds-add');
    var sel = $('#ds-preset').value;
    var custom = sel === 'custom';
    var key = $('#ds-key').value.trim();
    var url = $('#ds-url').value.trim();

    /* لو لصق المفتاح في خانة الرابط بالغلط ننقله بدل ما نرمي خطأ في وجهه */
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

    /* نفحصه أولًا ثم نضيفه — عشان يعرف النتيجة قبل ما يدخل القائمة */
    var draft = {
      id: '', preset: p ? p.id : '', key: key,
      url: custom ? url : p.url, enabled: true
    };

    CS.dataSources.test(draft).then(function (r) {
      btn.disabled = false;
      btn.textContent = label;

      var d = CS.dataSources.add({
        preset: custom ? '' : sel,
        name:   $('#ds-name').value.trim(),
        url:    custom ? url : p.url,
        key:    key
      });
      CS.dataSources.update(d.id, { status: r });

      $('#ds-key').value = '';
      $('#ds-url').value = '';
      $('#ds-name').value = '';
      renderDataSources();
      if (detailCtx) renderExtraData();

      out.className = 'keyrow__out ' + (r.ok === true ? 'is-ok' : r.ok === false ? 'is-bad' : 'is-warn');
      out.textContent = (r.ok === true ? '🟢 انضاف «' + d.name + '» وشغّال — '
                       : r.ok === false ? '🟡 انضاف «' + d.name + '» لكن الفحص فشل — '
                       : '🟡 انضاف «' + d.name + '» وما قدرت أحكم — ') + r.detail;
    }).catch(function (e) {
      btn.disabled = false;
      btn.textContent = label;
      out.className = 'keyrow__out is-bad';
      out.textContent = '🔴 ' + (String(e && e.message) === 'BAD_URL'
        ? 'الرابط لازم يبدأ بـ https://' : (e && e.message) || 'ما قدرت أضيفه');
    });
  }

  function testDataSource(id) {
    var d = CS.dataSources.byId(id);
    if (!d) return Promise.resolve();

    var row = $('[data-ds-row="' + id + '"]');
    var st  = row && row.querySelector('.srcitem__st');
    if (st) { st.className = 'srcitem__st is-wait'; st.textContent = '⏳ أفحص…'; }

    return CS.dataSources.test(d).then(function () {
      renderDataSources();
      if (detailCtx) renderExtraData();
    });
  }

  /* ------------------------------------------------------------
     بيانات إضافية من مصادر البيانات في صفحة العمل
     ------------------------------------------------------------ */

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

      /* شعار عالي الدقة من مصادرك يحلّ محل العنوان النصي */
      var art = blocks.filter(function (b) { return b.art && b.art.logo; })[0];
      if (art) applyLogo(art.art.logo);
    });
  }

  /* الشعار يُركّب فوق الخلفية بدل عنوان نصي — يستفيد من مصدر الصور فعليًا */
  function applyLogo(url) {
    var t = $('#detail-panel .dt__title');
    if (!t || t.dataset.logo) return;

    /* نركّبه على طول ونرجّع النص لو الصورة ما جت — أبسط من انتظار حدث تحميل
       قد لا ينطلق أصلًا، والنتيجة نفسها بلا سباق */
    var text = t.textContent;
    t.dataset.logo = '1';
    t.innerHTML = '<img class="dt__logo" src="' + attrEsc(url) + '" alt="' + attrEsc(text) + '">';

    var img = t.querySelector('img');
    if (img) img.onerror = function () {
      t.dataset.logo = '';
      t.textContent = text;
    };
  }

  /* ============================================================
     الاقتراحات الفورية
     ============================================================ */

  var suggestToken = 0;
  var suggestOff = false;

  function hideSuggest() {
    suggestToken++;
    var s = $('#suggest');
    s.hidden = true;
    s.innerHTML = '';
  }

  var runSuggest = CS.util.debounce(function (q) {
    if (suggestOff || q.length < 2 || !CS.hasKey()) return hideSuggest();
    var token = ++suggestToken;

    CS.search.suggest(q).then(function (list) {
      if (token !== suggestToken || !list.length) return hideSuggest();
      remember(list);
      $('#suggest').innerHTML = list.map(function (it) {
        var img = it.poster
          ? '<img src="' + esc0(it.poster) + '" alt="" loading="lazy">'
          : '<span class="sug__ph">' + (it.type === 'tv' ? '📺' : '🎬') + '</span>';
        return '<button type="button" class="sug" data-open="' + esc0(CS.ui.itemKey(it)) + '">' + img +
          '<span class="sug__t"><b>' + esc0(it.title) + '</b><span>' +
          [it.year, CS.ui.TYPE_AR[it.type]].filter(Boolean).join(' · ') + '</span></span></button>';
      }).join('');
      $('#suggest').hidden = false;
    }).catch(hideSuggest);
  }, 320);

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

    var h = raw.replace(/^\//, '');
    if (!h) return { name: 'home' };
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
    if (parts[0] === 'work') parts = parts.slice(1);

    if ((parts[0] === 'movie' || parts[0] === 'tv') && parts[1]) {
      return { name: 'detail', type: parts[0], id: parts[1] };
    }
    if (parts[0] === 'w' && parts.length >= 3) {
      return { name: 'wiki', lang: parts[1], title: decodeSafe(parts.slice(2).join('/')) };
    }
    if (parts[0] === 'liked' || parts[0] === 'fav') return { name: 'liked' };
    return { name: 'home' };
  }

  function onRoute() {
    if (suppressRoute) { suppressRoute = false; return; }
    var r = parseHash();
    if (r.name === 'ignore') return;

    if (r.name !== 'detail' && r.name !== 'wiki' && r.name !== 'person') detailToken++;

    if (r.name === 'detail') { CS.state.backTo = CS.state.backTo || '#/'; openDetail(r.type, r.id); return; }
    if (r.name === 'wiki')   { CS.state.backTo = CS.state.backTo || '#/'; openWikiDetail(r.lang, r.title); return; }
    if (r.name === 'person') { CS.state.backTo = CS.state.backTo || '#/'; openPerson(r.id); return; }

    CS.state.backTo = location.hash || '#/';

    if (r.name === 'search') { doSearch(r.query, true, r.mode); return; }
    if (r.name === 'similar') { openSimilar(r.type, r.id); return; }
    if (r.name === 'liked')  { renderLiked(); return; }

    showView('home');
    if (!CS.feed.current().items.length) startFeed(currentTab());
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
     التصويت
     ============================================================ */

  function handleVote(btn) {
    var item = itemCache[btn.dataset.item];
    if (!item) return;
    var now = CS.taste.set(item, +btn.dataset.vote);

    CS.ui.toast(now === 1 ? '👍 انضاف لذوقك' : now === -1 ? '👎 تمام، ما بكرّر لك شبيهه' : '⚪ شلت رأيك');

    $$('[data-item="' + attrEsc(btn.dataset.item) + '"]').forEach(function (b) {
      var on = +b.dataset.vote === now;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });

    updateLikeCount();
    if (CS.state.view === 'liked') renderLiked();
  }

  /* ============================================================
     التمرير اللانهائي
     ============================================================ */

  function watchSentinels() {
    if (!('IntersectionObserver' in window)) return;

    new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        if (e.target.id === 'feed-sentinel' && CS.state.view === 'home' && !$('#feed-more').hidden) loadFeed(false);
        if (e.target.id === 'results-sentinel' && CS.state.view === 'results' && !$('#loadmore-wrap').hidden) {
          CS.state.shown += PAGE;
          paintResults();
        }
      });
    }, { rootMargin: '600px' }).observe($('#feed-sentinel')),

    new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting && CS.state.view === 'results' && !$('#loadmore-wrap').hidden) {
          CS.state.shown += PAGE;
          paintResults();
        }
      });
    }, { rootMargin: '600px' }).observe($('#results-sentinel'));
  }

  /* ============================================================
     ربط الأحداث
     ============================================================ */

  function bind() {

    $('#search-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var q = $('#q').value.trim();
      if (q) goTo('#/s/' + encodeURIComponent(q));
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
      $('#q').focus();
    });

    $('#btn-to-en').addEventListener('click', searchInEnglish);

    /* --- التبويبات وأدوات الخلاصة --- */
    $('#tabs').addEventListener('click', function (e) {
      var t = e.target.closest('.tab');
      if (!t) return;
      setTab(t.dataset.tab);
      startFeed(t.dataset.tab);
    });

    ['#feed-sort', '#feed-lang', '#feed-rating', '#feed-type'].forEach(function (sel) {
      var el = $(sel);
      if (el) el.addEventListener('change', function () { startFeed(currentTab()); });
    });

    $('#btn-feed-more').addEventListener('click', function () {
      /* الجولات التلقائية كانت تُحرق في التحميل الأول وما تُصفَّر أبدًا،
         فالزر يضيف صفحة وحدة ويقف حتى لو البوابة أكلت أغلبها */
      autoRounds = 0;
      loadFeed(false);
    });
    $('#btn-loadmore').addEventListener('click', function () {
      CS.state.shown += PAGE;
      paintResults();
    });

    /* --- المفضلة --- */
    $('#btn-export').addEventListener('click', exportTaste);
    $('#btn-import').addEventListener('click', function () { $('#import-file').click(); });
    $('#import-file').addEventListener('change', function () {
      importTaste(this.files && this.files[0]);
      this.value = '';
    });
    $('#btn-reset-taste').addEventListener('click', function () {
      if (!window.confirm('أصفّر كل الإعجابات وأرجع من الصفر؟')) return;
      CS.taste.clearAll();
      updateLikeCount();
      renderLiked();
      CS.ui.toast('⚪ انصفّر ذوقك');
    });

    /* --- تفويض النقر العام --- */
    document.addEventListener('click', function (e) {
      var vote = e.target.closest('[data-vote]');
      if (vote) { e.preventDefault(); handleVote(vote); return; }

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

      /* الزرّ داخل رابط البطاقة، فلازم يُفحص قبل data-open وإلا
         انفتحت صفحة العمل بدل ما تنقلب الشبكة */
      var simBtn = e.target.closest('[data-similar]');
      if (simBtn) {
        e.preventDefault();
        goTo('#/like/' + simBtn.dataset.similar);
        return;
      }

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
        /* البركة المحلية أولًا — عرض فوري بلا شبكة. وإن خلصت
           نطلب صفحة أخرى من TMDB. */
        if (!moreRelated()) loadRelated(detailCtx.d, detailCtx.token, false);
        return;
      }
      if (e.target.closest('[data-person-more]')) { morePersonWorks(); return; }

      var share = e.target.closest('[data-share]');
      if (share) { copyLink(location.origin + location.pathname + '#/work/' + share.dataset.share); return; }

      if (e.target.closest('[data-fatal-dismiss]')) { clearFatal(); return; }
      if (e.target.closest('[data-open-settings]')) { openSettings(); return; }
      if (e.target.closest('[data-diagnose]')) { openSettings(); testConnection(); return; }
      if (e.target.closest('[data-retry-home]')) { startFeed(currentTab()); return; }

      if (e.target.closest('[data-go-general]')) { setTab('general'); startFeed('general'); return; }

      if (e.target.closest('[data-back-home]')) { location.hash = '#/'; return; }

      var copyT = e.target.closest('[data-copy-title]');
      if (copyT) {
        e.preventDefault();
        copyLink(copyT.dataset.copyTitle, '📋 انتسخ الاسم');
        return;
      }
      if (e.target.closest('[data-back]')) { goBack(); return; }
      if (e.target.closest('[data-close-settings]')) { closeSettings(); return; }
      var keyBtn = e.target.closest('[data-test-key]');
      if (keyBtn) { verifyKeyRow(keyBtn); return; }

      var dt2 = e.target.closest('[data-ds-test]');
      if (dt2) { testDataSource(dt2.dataset.dsTest); return; }

      var dg = e.target.closest('[data-ds-toggle]');
      if (dg) {
        var dcur = CS.dataSources.byId(dg.dataset.dsToggle);
        if (dcur) CS.dataSources.update(dcur.id, { enabled: !dcur.enabled });
        renderDataSources();
        if (detailCtx) renderExtraData();
        return;
      }

      var dd = e.target.closest('[data-ds-del]');
      if (dd) {
        var dgone = CS.dataSources.byId(dd.dataset.dsDel);
        if (dgone && window.confirm('أحذف «' + dgone.name + '»؟')) {
          CS.dataSources.remove(dgone.id);
          renderDataSources();
          if (detailCtx) renderExtraData();
        }
        return;
      }

      if (e.target.closest('[data-route-home]')) { e.preventDefault(); location.hash = '#/'; return; }

      if (!e.target.closest('#search-form')) hideSuggest();
    });

    /* --- أزرار الهيدر --- */
    $('#btn-fav').addEventListener('click', function () { goTo('#/liked'); });
    $('#btn-settings').addEventListener('click', openSettings);
    /* مصادر البيانات */
    $('#ds-preset').addEventListener('change', onPresetPick);
    $('#btn-ds-add').addEventListener('click', addDataSource);
    $('#notice-open-settings').addEventListener('click', function () {
      openSettings();
      if ($('#key-notice').dataset.tmdbBroken) testConnection();
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
    $('#btn-liked-back').addEventListener('click', function () { location.hash = '#/'; });

    /* --- الإعدادات --- */
    $('#btn-save-settings').addEventListener('click', saveSettings);
    var idxBtn = $('#btn-index');
    if (idxBtn) idxBtn.addEventListener('click', function () { runSweep(true); });

    var strongBtn = $('#btn-index-strong');
    if (strongBtn) strongBtn.addEventListener('click', runDeepSweep);

    var sweepBtn = $('#btn-catalog-sweep');
    if (sweepBtn && CS.catalog) sweepBtn.addEventListener('click', function () {
      renderCatalogState('⏳ يوسّع الفهرس…');
      runSweep(true);
    });
    var clearBtn = $('#btn-catalog-clear');
    if (clearBtn && CS.catalog) clearBtn.addEventListener('click', function () {
      CS.catalog.clear();
      renderCatalogState();
      paintIndexBtn();
      CS.ui.toast('🗑️ انصفّر الفهرس');
    });

    $('#btn-test-key').addEventListener('click', testConnection);
    $('#btn-clear-key').addEventListener('click', function () {
      $('#api-key').value = '';
      CS.state.userKey = '';
      CS.state.apiKey = CS.config.sharedKey;
      CS.store.remove(CS.KEYS.apiKey);
      refreshKeyNotice();
      $('#key-state').className = 'keystate is-ok';
      $('#key-state').textContent = '🟢 انحذف مفتاحك الخاص. رجعنا للمفتاح المشترك.';
    });

    /* --- الاختصارات --- */
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Tab' && !$('#settings').hidden) {
        var panel = $('.modal__panel', $('#settings'));
        var f = $$('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled])', panel)
          .filter(function (el) { return el.offsetParent !== null; });
        if (!f.length) return;
        var first = f[0], last = f[f.length - 1], here = document.activeElement;
        if (e.shiftKey && (here === first || !panel.contains(here))) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && (here === last || !panel.contains(here))) { e.preventDefault(); first.focus(); }
        return;
      }

      if (e.key === 'Escape') {
        if (!$('#settings').hidden) return closeSettings();
        if (CS.state.view === 'detail' || CS.state.view === 'person') return goBack();
        hideSuggest();
        return;
      }
      var typing = /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName);
      if (e.key === '/' && !typing) { e.preventDefault(); $('#q').focus(); $('#q').select(); }
    });

    window.addEventListener('hashchange', onRoute);
  }

  /* ============================================================
     حزام الأمان
     ============================================================ */

  var REQUIRED = ['util', 'store', 'state', 'taste', 'certs', 'tmdb', 'catalog', 'wiki', 'sources', 'dataSources', 'links', 'feed', 'search', 'ui'];

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

  function boot() {
    var missing = REQUIRED.filter(function (m) { return !CS[m]; });
    if (missing.length) {
      fatal('نسخة الصفحة قديمة',
            'متصفحك مخزّن نسخة قديمة من الموقع (' + missing.join('، ') + ' ناقصة). اضغط تحديث.', true);
      return;
    }

    try { bind(); }
    catch (e) { fatal('ما قدرت أربط الأزرار', String(e && e.message || e), true); return; }

    step(function () { $('#lang-label').textContent = CS.state.lang === 'ar' ? 'ع' : 'EN'; });
    step(function () {
      var moved = CS.taste.migrate();
      if (moved) setTimeout(function () { CS.ui.toast('👍 نقلت ' + moved + ' من مفضلتك القديمة'); }, 900);
    });
    step(fillPresets);
    step(function () {
      /* المفاتيح القديمة كانت خانات ثابتة ما يقدر يوقّفها ولا يحذفها.
         ننقلها لقائمة مصادره الموحّدة مرة وحدة فتصير تحت تحكّمه.
         العلَم يضمن إنها ما ترجع لو حذفها بعد النقل. */
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
    step(updateLikeCount);
    step(function () { paintIndexBtn(); });
    step(refreshKeyNotice);
    step(watchSentinels);
    step(function () {
      /* نرجع لآخر قسم كان فيه، والفلتر يتبع القسم لا العكس */
      var tab = CS.store.get(CS.KEYS.tab, HOME_TAB);
      if (!TABS[tab]) tab = HOME_TAB;
      setTab(tab);
      CS.store.set(CS.KEYS.certTier, certFor(tab));
      $('#feed-title').textContent = titleFor(tab);
    });

    var start = CS.hasKey() ? CS.tmdb.loadGenres().catch(function () {}) : Promise.resolve();
    /* onRoute تكفي: مسار الرئيسية يشغّل الخلاصة بنفسه.
       نداء ثانٍ هنا كان يصفّر الخلاصة وسط تحميلها فتطلع الشاشة فاضية. */
    start.then(function () {
      try { onRoute(); }
      catch (e) { fatal('ما قدرت أفتح الصفحة', String(e && e.message || e), true); }
    });
  }

  var reported = false;
  window.addEventListener('error', function (e) {
    if (reported || !e || !e.message) return;
    reported = true;
    try { fatal('صار خطأ في الصفحة', e.message, true); } catch (ignored) { /* آخر خط دفاع */ }
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  CS.app = { fatal: fatal, clearFatal: clearFatal, hardReload: hardReload };

})(window.CS);
