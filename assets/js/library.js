/* ============================================================
   library.js — مكتبة المستخدم: المفضلة · المؤجّلة · متابعة المشاهدة
                · المتابَعة للجديد · النسخة الاحتياطية

   كلها محفوظة في متصفّح الزائر وحده، وكلها تعيش بين الجلسات.
   منفصلة عن 👍/👎 في taste.js: ذاك ملفّ ذوق يغذّي التوصيات،
   وهذي قوائم يبنيها المستخدم بنفسه ويرجع لها.
   ============================================================ */

(function (CS) {
  'use strict';

  var K = {
    fav:      'cs.lib.fav',
    later:    'cs.lib.later',
    progress: 'cs.lib.progress',
    follow:   'cs.lib.follow',
    seenEp:   'cs.lib.seen_ep',
    backupAt: 'cs.lib.backup_at'
  };

  var MAX = 600;

  function keyOf(item) { return item.type + ':' + item.id; }

  /* نحفظ ما يكفي لرسم البطاقة بلا أي طلب شبكة */
  function slim(item) {
    return {
      id: item.id,
      type: item.type,
      title: item.title || '',
      originalTitle: item.originalTitle || '',
      year: item.year || null,
      poster: item.poster || '',
      rating: item.rating || 0,
      votes: item.votes || 0,
      popularity: item.popularity || 0,
      overview: (item.overview || '').slice(0, 320),
      genreIds: (item.genreIds || []).slice(0, 6),
      keywordIds: (item.keywords || []).map(function (k) { return k.id; }).slice(0, 10),
      source: item.source || 'tmdb',
      ts: Date.now()
    };
  }

  function readList(key) {
    var l = CS.store.get(key, []);
    return Array.isArray(l) ? l : [];
  }

  function writeList(key, list) {
    CS.store.set(key, list.slice(0, MAX));
    return list;
  }

  /* ------------------------------------------------------------
     قائمة بسيطة (المفضلة · المؤجّلة · المتابَعة)
     ------------------------------------------------------------ */
  function makeList(key) {
    return {
      all: function () { return readList(key); },
      count: function () { return readList(key).length; },
      has: function (item) {
        if (!item) return false;
        var k = keyOf(item);
        return readList(key).some(function (x) { return keyOf(x) === k; });
      },
      add: function (item) {
        if (!item || !item.type || item.id == null) return false;
        var k = keyOf(item);
        var list = readList(key).filter(function (x) { return keyOf(x) !== k; });
        list.unshift(slim(item));
        writeList(key, list);
        return true;
      },
      remove: function (item) {
        if (!item) return false;
        var k = keyOf(item);
        var before = readList(key);
        var list = before.filter(function (x) { return keyOf(x) !== k; });
        writeList(key, list);
        return list.length !== before.length;
      },
      /* يرجّع الحالة بعد التبديل: true داخل القائمة · false خارجها */
      toggle: function (item) {
        if (this.has(item)) { this.remove(item); return false; }
        this.add(item);
        return true;
      },
      clear: function () { writeList(key, []); }
    };
  }

  var fav    = makeList(K.fav);
  var later  = makeList(K.later);
  var follow = makeList(K.follow);

  /* ------------------------------------------------------------
     متابعة المشاهدة — أين وقف المستخدم

     الموقع ما فيه مشغّل فيديو (يحوّل لتطبيقات خارجية)، فالتقدّم
     يُسجَّل بفعل صريح: «وصلت هنا» على الحلقة، أو «شفته» على الفيلم.
     ما نخترع نسبة مشاهدة ما نقدر نقيسها.
     ------------------------------------------------------------ */

  function readProgress() {
    var p = CS.store.get(K.progress, {});
    return (p && typeof p === 'object' && !Array.isArray(p)) ? p : {};
  }

  var progress = {
    all: function () { return readProgress(); },

    get: function (item) {
      if (!item) return null;
      return readProgress()[keyOf(item)] || null;
    },

    /**
     * set(item, mark)
     * mark للمسلسل: { season, episode, done }
     * mark للفيلم:  { done: true } أو { minute: 41 }
     */
    set: function (item, mark) {
      if (!item || !item.type || item.id == null) return null;
      var db = readProgress();
      var k = keyOf(item);
      var rec = db[k] || { meta: slim(item), at: 0 };
      rec.meta = slim(item);
      rec.at = Date.now();
      if (mark && mark.season != null) {
        rec.season = +mark.season;
        rec.episode = +mark.episode || 1;
      }
      if (mark && mark.minute != null) rec.minute = +mark.minute;
      if (mark && mark.done !== undefined) rec.done = !!mark.done;
      db[k] = rec;
      /* نبقي الأحدث فقط — القائمة تكبر بلا حد وإلا */
      var keys = Object.keys(db).sort(function (a, b) { return (db[b].at || 0) - (db[a].at || 0); });
      if (keys.length > 300) keys.slice(300).forEach(function (x) { delete db[x]; });
      CS.store.set(K.progress, db);
      return rec;
    },

    clear: function (item) {
      var db = readProgress();
      delete db[keyOf(item)];
      CS.store.set(K.progress, db);
    },

    clearAll: function () { CS.store.set(K.progress, {}); },

    /* آخر ما كان يشوفه — صف «كمّل مشاهدتك» */
    recent: function (n) {
      var db = readProgress();
      return Object.keys(db)
        .map(function (k) { return db[k]; })
        .filter(function (r) { return r && r.meta && !r.done; })
        .sort(function (a, b) { return (b.at || 0) - (a.at || 0); })
        .slice(0, n || 20);
    },

    /* هل هذي الحلقة انشافت؟ يُستعمل في قائمة الحلقات */
    episodeSeen: function (item, season, episode) {
      var r = progress.get(item);
      if (!r || r.season == null) return false;
      if (season < r.season) return true;
      if (season > r.season) return false;
      return episode <= (r.episode || 0);
    },

    /* الحلقة التالية المقترحة */
    nextEpisode: function (item) {
      var r = progress.get(item);
      if (!r || r.season == null) return { season: 1, episode: 1, fresh: true };
      return { season: r.season, episode: (r.episode || 0) + 1, fresh: false };
    }
  };

  /* ------------------------------------------------------------
     تنبيهات الجديد — حلقة أو جزء جديد لعمل متابَع
     ------------------------------------------------------------ */

  function readSeen() {
    var s = CS.store.get(K.seenEp, {});
    return (s && typeof s === 'object' && !Array.isArray(s)) ? s : {};
  }

  var alerts = {
    /* هل عندنا إذن التنبيه من المتصفّح؟ */
    permission: function () {
      try { return (window.Notification && Notification.permission) || 'unsupported'; }
      catch (e) { return 'unsupported'; }
    },

    request: function () {
      try {
        if (!window.Notification) return Promise.resolve('unsupported');
        if (Notification.permission !== 'default') return Promise.resolve(Notification.permission);
        return Notification.requestPermission();
      } catch (e) { return Promise.resolve('denied'); }
    },

    /* يسجّل ما رأيناه عشان ما نكرّر التنبيه نفسه */
    mark: function (item, stamp) {
      var s = readSeen();
      s[keyOf(item)] = stamp;
      CS.store.set(K.seenEp, s);
    },

    isNew: function (item, stamp) {
      if (!stamp) return false;
      return readSeen()[keyOf(item)] !== stamp;
    },

    /* يفحص الأعمال المتابَعة ويرجّع الجديد منها.
       fetchNext(item) → Promise<{ stamp, label } | null> */
    check: function (fetchNext) {
      var list = follow.all().filter(function (x) { return x.type === 'tv'; });
      if (!list.length) return Promise.resolve([]);
      return CS.util.pool(list.slice(0, 24), 3, function (it) {
        return Promise.resolve()
          .then(function () { return fetchNext(it); })
          .then(function (info) {
            if (!info || !info.stamp) return null;
            if (!alerts.isNew(it, info.stamp)) return null;
            alerts.mark(it, info.stamp);
            return { item: it, label: info.label, stamp: info.stamp };
          })
          .catch(function () { return null; });
      }).then(function (rows) { return rows.filter(Boolean); });
    },

    notify: function (title, body) {
      try {
        if (window.Notification && Notification.permission === 'granted') {
          new Notification(title, { body: body, tag: 'ranhub-' + title });
          return true;
        }
      } catch (e) {}
      return false;
    }
  };

  /* ------------------------------------------------------------
     النسخة الاحتياطية — كل شي يخصّ المستخدم في ملف واحد
     ------------------------------------------------------------ */

  /* المفاتيح اللي تُحفظ وتُستعاد. الفهرس المحلي وذاكرة الطلبات
     خارجها عمدًا: تُبنى من جديد تلقائيًا وحجمها كبير. */
  function userKeys() {
    return [
      CS.KEYS.taste, CS.KEYS.lang, CS.KEYS.region, CS.KEYS.autoTr,
      CS.KEYS.email, CS.KEYS.certTier, CS.KEYS.adultOn, CS.KEYS.adultOnly,
      CS.KEYS.tab, CS.KEYS.dataSources, CS.KEYS.theme, CS.KEYS.explicitOn,
      CS.KEYS.noticeOff,
      K.fav, K.later, K.progress, K.follow, K.seenEp
    ].filter(Boolean);
  }

  var backup = {
    build: function () {
      var data = { app: 'RANHUB', kind: 'backup', version: CS.config.version,
                   exportedAt: new Date().toISOString(), store: {} };
      userKeys().forEach(function (k) {
        var v = CS.store.get(k, undefined);
        if (v !== undefined) data.store[k] = v;
      });
      /* التوافق للخلف: ملفات التصدير القديمة فيها likes/dislikes مسطّحة */
      data.likes = CS.taste.likes();
      data.dislikes = CS.taste.dislikes();
      return data;
    },

    /**
     * restore(data, mode)
     * mode 'merge'  — يضيف ولا يمسح شيئًا موجودًا (الافتراضي)
     * mode 'replace'— يستبدل المفاتيح الموجودة في الملف
     * يرجّع تقريرًا بما تغيّر.
     */
    restore: function (data, mode) {
      if (!data || typeof data !== 'object') throw new Error('BAD_FILE');
      var report = { taste: 0, lists: 0, settings: 0, progress: 0 };

      /* ملفّ تصدير قديم: likes/dislikes فقط */
      if (!data.store && (Array.isArray(data.likes) || Array.isArray(data.dislikes))) {
        report.taste = CS.taste.merge(data);
        return report;
      }
      if (!data.store || typeof data.store !== 'object') throw new Error('BAD_FILE');

      var replace = mode === 'replace';

      Object.keys(data.store).forEach(function (key) {
        var incoming = data.store[key];
        if (incoming === undefined || incoming === null) return;

        if (key === CS.KEYS.taste) {
          report.taste += CS.taste.merge(incoming) || 0;
          return;
        }
        if (key === K.fav || key === K.later || key === K.follow) {
          if (!Array.isArray(incoming)) return;
          var cur = readList(key);
          var have = {};
          cur.forEach(function (x) { have[keyOf(x)] = true; });
          incoming.forEach(function (x) {
            if (!x || !x.type || x.id == null) return;
            if (have[keyOf(x)] && !replace) return;
            if (have[keyOf(x)]) return;
            cur.push(x);
            have[keyOf(x)] = true;
            report.lists++;
          });
          writeList(key, cur);
          return;
        }
        if (key === K.progress) {
          if (typeof incoming !== 'object') return;
          var db = readProgress();
          Object.keys(incoming).forEach(function (k) {
            var inc = incoming[k];
            if (!inc) return;
            if (!db[k] || replace || (inc.at || 0) > (db[k].at || 0)) { db[k] = inc; report.progress++; }
          });
          CS.store.set(K.progress, db);
          return;
        }
        /* الإعدادات: ما نكتب فوق اختيار المستخدم الحالي إلا في وضع الاستبدال */
        var existing = CS.store.get(key, undefined);
        if (existing === undefined || replace) { CS.store.set(key, incoming); report.settings++; }
      });

      CS.store.set(K.backupAt, Date.now());
      return report;
    },

    lastAt: function () { return CS.store.get(K.backupAt, 0); },
    markSaved: function () { CS.store.set(K.backupAt, Date.now()); }
  };

  /* ------------------------------------------------------------
     الترحيل — ما ينضاع شي عند التحديث
     ------------------------------------------------------------ */
  function migrate() {
    var moved = 0;
    /* المفضلة القديمة (cs.favorites) كانت تُنقل إلى 👍 وحدها.
       نحفظها كمان في المفضلة الجديدة عشان ما يفقد المستخدم قائمته. */
    var old = CS.store.get(CS.KEYS.favorites, null);
    if (Array.isArray(old) && old.length && !fav.count()) {
      old.forEach(function (f) {
        if (f && f.type && f.id != null) { fav.add(f); moved++; }
      });
    }
    return moved;
  }

  CS.library = {
    KEYS: K,
    fav: fav,
    later: later,
    follow: follow,
    progress: progress,
    alerts: alerts,
    backup: backup,
    migrate: migrate,
    slim: slim,
    keyOf: keyOf,
    counts: function () {
      return { fav: fav.count(), later: later.count(),
               follow: follow.count(), progress: progress.recent(999).length };
    }
  };

})(window.CS);
