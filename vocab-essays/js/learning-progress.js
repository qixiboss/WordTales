/* ============================================================
 * Module: LearningProgress
 * 本地学习档案、间隔复习调度、每日建议与记忆热力图。
 * 优先使用 IndexedDB 异步保存；localStorage 仅用于兼容与降级。
 * ============================================================ */
WordTales.LearningProgress = (function() {
  /*
   * 持久化分成两类：
   * - profiles：当前聚合状态，启动时一次读取，交互中以 180ms 防抖覆盖；
   * - events：追加式行为日志，便于将来分析，但最多保留最近 3000 条。
   * IndexedDB 不可用时，两者合并回 localStorage，保证离线和隐私模式仍可学习。
   */
  var STORAGE_KEY = 'wordtales.learning.v1';
  var MIGRATION_KEY = 'wordtales.learning.indexeddb-migrated';
  var DB_NAME = 'wordtales-learning';
  var DB_VERSION = 1;
  var MAX_EVENTS = 3000;
  var data = null;
  var database = null;
  var persistenceMode = 'localStorage';
  var profileSaveTimer = null;
  var eventWritesSincePrune = 0;
  var isReady = false;
  var pendingOperations = [];
  var wordIndex = Object.create(null);
  var wordByText = Object.create(null);
  var columnIndex = Object.create(null);
  var paragraphIndex = Object.create(null);
  var allWordItems = [];
  var overlay = null;
  var panel = null;
  var heatmapSetId = '';
  var articleObserver = null;
  var currentDay = '';

  /* ---------- 时间与档案结构：所有持久化时间统一为 ISO，展示分组使用本地日历日。 ---------- */
  function nowIso() { return new Date().toISOString(); }
  function dayKey(date) {
    var d = date || new Date();
    var y = d.getFullYear();
    var m = ('0' + (d.getMonth() + 1)).slice(-2);
    var day = ('0' + d.getDate()).slice(-2);
    return y + '-' + m + '-' + day;
  }
  function addDays(date, days) {
    return new Date(date.getTime() + days * 86400000);
  }
  function endOfToday() {
    var d = new Date();
    d.setHours(23, 59, 59, 999);
    return d;
  }
  function freshData() {
    return {
      version: 1,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      words: {},
      articles: {},
      analyses: {},
      days: {},
      reminders: { lastShown: '', notifications: false },
      events: []
    };
  }
  function normalizeData(candidate) {
    // 逐字段补默认值，使旧版本或部分写入的档案可以向前兼容，而不是整份丢弃。
    var store = candidate && candidate.version === 1 ? candidate : freshData();
    store.words = store.words || {};
    store.articles = store.articles || {};
    store.analyses = store.analyses || {};
    store.days = store.days || {};
    store.reminders = store.reminders || { lastShown: '', notifications: false };
    store.events = Array.isArray(store.events) ? store.events : [];
    store.updatedAt = store.updatedAt || store.createdAt || nowIso();
    return store;
  }
  function load() {
    // data 是本页会话内的单一事实来源，避免每次统计都同步解析 localStorage。
    if (data) return data;
    try {
      data = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    } catch (e) {
      data = null;
    }
    data = normalizeData(data);
    return data;
  }
  function requestToPromise(request) {
    return new Promise(function(resolve, reject) {
      request.onsuccess = function() { resolve(request.result); };
      request.onerror = function() { reject(request.error || new Error('IndexedDB request failed')); };
    });
  }
  function openDatabase() {
    if (!('indexedDB' in window)) return Promise.reject(new Error('IndexedDB unavailable'));
    if (database) return Promise.resolve(database);
    return new Promise(function(resolve, reject) {
      var request = window.indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = function() {
        // profiles 与 events 分库是为了更新学习状态时不反复重写整段历史。
        var db = request.result;
        if (!db.objectStoreNames.contains('profiles')) {
          db.createObjectStore('profiles', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('events')) {
          var events = db.createObjectStore('events', { keyPath: 'id', autoIncrement: true });
          events.createIndex('day', 'day', { unique: false });
          events.createIndex('type', 'type', { unique: false });
          events.createIndex('at', 'at', { unique: false });
        }
      };
      request.onsuccess = function() {
        database = request.result;
        database.onversionchange = function() {
          database.close();
          database = null;
        };
        resolve(database);
      };
      request.onerror = function() {
        reject(request.error || new Error('Unable to open IndexedDB'));
      };
      request.onblocked = function() {
        reject(new Error('IndexedDB upgrade blocked'));
      };
    });
  }
  function profileSnapshot() {
    // events 已单独存储；从快照删除它可显著缩小高频 profile 写入量。
    var snapshot = JSON.parse(JSON.stringify(load()));
    delete snapshot.events;
    return snapshot;
  }
  function writeProfileNow() {
    if (persistenceMode !== 'indexedDB' || !database) return Promise.resolve();
    var transaction = database.transaction('profiles', 'readwrite');
    var request = transaction.objectStore('profiles').put({
      id: 'current',
      updatedAt: load().updatedAt,
      data: profileSnapshot()
    });
    return requestToPromise(request);
  }
  function save() {
    var store = load();
    store.updatedAt = nowIso();
    if (persistenceMode === 'indexedDB' && database) {
      if (profileSaveTimer) clearTimeout(profileSaveTimer);
      // 连续翻卡或点词会形成突发写入，短防抖既保护存储也不明显增加丢失窗口。
      profileSaveTimer = setTimeout(function() {
        profileSaveTimer = null;
        writeProfileNow().catch(function() {
          persistenceMode = 'localStorage';
          try { localStorage.setItem(STORAGE_KEY, JSON.stringify(load())); } catch (e) {}
        });
      }, 180);
      return;
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    } catch (e) {}
  }
  function addEventToDatabase(event) {
    if (!database || persistenceMode !== 'indexedDB') return;
    try {
      var transaction = database.transaction('events', 'readwrite');
      var request = transaction.objectStore('events').add(event);
      request.onsuccess = function() {
        eventWritesSincePrune++;
        if (eventWritesSincePrune >= 100) {
          eventWritesSincePrune = 0;
          pruneEventDatabase();
        }
      };
    } catch (e) {}
  }
  function pruneEventDatabase() {
    if (!database || persistenceMode !== 'indexedDB') return Promise.resolve();
    return new Promise(function(resolve) {
      var transaction;
      try {
        transaction = database.transaction('events', 'readwrite');
      } catch (e) {
        resolve();
        return;
      }
      transaction.oncomplete = resolve;
      transaction.onerror = resolve;
      transaction.onabort = resolve;
      var store = transaction.objectStore('events');
      var countRequest = store.count();
      countRequest.onerror = function() {};
      countRequest.onsuccess = function() {
        // 自增主键的游标天然从旧到新，删除最早记录即可保留最近行为。
        var remaining = Math.max(0, countRequest.result - MAX_EVENTS);
        if (!remaining) return;
        var cursorRequest = store.openCursor();
        cursorRequest.onerror = function() {};
        cursorRequest.onsuccess = function() {
          var cursor = cursorRequest.result;
          if (!cursor || remaining <= 0) return;
          cursor.delete();
          remaining--;
          cursor.continue();
        };
      };
    });
  }
  function migrateFallbackToDatabase(db, fallback) {
    // profile 与旧事件在同一事务迁移，防止中途失败后只迁了一半。
    return new Promise(function(resolve, reject) {
      var transaction = db.transaction(['profiles', 'events'], 'readwrite');
      transaction.oncomplete = function() { resolve(); };
      transaction.onerror = function() { reject(transaction.error || new Error('IndexedDB migration failed')); };
      transaction.onabort = function() { reject(transaction.error || new Error('IndexedDB migration aborted')); };
      var snapshot = JSON.parse(JSON.stringify(fallback));
      var legacyEvents = Array.isArray(snapshot.events) ? snapshot.events : [];
      delete snapshot.events;
      transaction.objectStore('profiles').put({
        id: 'current',
        updatedAt: snapshot.updatedAt || nowIso(),
        data: snapshot
      });
      legacyEvents.forEach(function(event) {
        transaction.objectStore('events').add(event);
      });
    });
  }
  function hydrate() {
    var rawLocal = null;
    try { rawLocal = localStorage.getItem(STORAGE_KEY); } catch (e) {}
    var validLocalProfile = null;
    try {
      validLocalProfile = rawLocal ? JSON.parse(rawLocal) : null;
    } catch (e) {}
    var fallback = load();
    return openDatabase().then(function(db) {
      return requestToPromise(db.transaction('profiles', 'readonly').objectStore('profiles').get('current'))
        .then(function(savedProfile) {
          /*
           * 迁移期可能同时存在两份档案。updatedAt 决定胜者，避免用旧 IndexedDB
           * 覆盖用户刚在降级模式下产生的新进度。
           */
          var localIsNewer = validLocalProfile && validLocalProfile.version === 1 && (!savedProfile ||
            new Date(fallback.updatedAt).getTime() > new Date(savedProfile.updatedAt || 0).getTime());
          if (savedProfile && !localIsNewer) {
            data = normalizeData(savedProfile.data);
            data.events = [];
            return null;
          }
          return migrateFallbackToDatabase(db, fallback).then(function() {
            data = normalizeData(fallback);
            data.events = [];
          });
        }).then(function() {
          persistenceMode = 'indexedDB';
          try {
            localStorage.setItem(MIGRATION_KEY, '1');
            if (typeof localStorage.removeItem === 'function') localStorage.removeItem(STORAGE_KEY);
          } catch (e) {}
          return pruneEventDatabase();
        });
    }).catch(function() {
      // 存储权限、隐私模式或升级阻塞都不应阻断主应用，统一降级为 localStorage。
      persistenceMode = 'localStorage';
      data = normalizeData(fallback);
    });
  }
  function ensureDay() {
    // days 是仪表盘的日聚合缓存，避免每次打开面板重扫完整事件历史。
    var key = dayKey();
    var store = load();
    if (!store.days[key]) {
      store.days[key] = {
        wordClicks: 0,
        cardFlips: 0,
        known: 0,
        unfamiliar: 0,
        articles: 0,
        analyses: 0
      };
    }
    return store.days[key];
  }
  function logEvent(type, targetId, meta) {
    var store = load();
    var event = {
      at: nowIso(),
      day: dayKey(),
      type: type,
      targetId: targetId,
      meta: meta || {}
    };
    store.events.push(event);
    if (store.events.length > MAX_EVENTS) {
      store.events.splice(0, store.events.length - MAX_EVENTS);
    }
    addEventToDatabase(event);
  }
  function buildIndexes() {
    /*
     * 在 Data 索引之外再保留“词 → 所属专栏/词集”的上下文索引，
     * 供复习计划分组、热力图导航和旧星标迁移共同使用。
     */
    wordIndex = Object.create(null);
    wordByText = Object.create(null);
    columnIndex = Object.create(null);
    paragraphIndex = Object.create(null);
    allWordItems = [];
    WordTales.Data.sets.forEach(function(set) {
      set.columns.forEach(function(column) {
        columnIndex[column.id] = {
          column: column,
          set: set
        };
        column.words.forEach(function(word) {
          wordIndex[word.id] = {
            word: word,
            column: column,
            set: set
          };
          allWordItems.push(wordIndex[word.id]);
          var key = word.word.toLowerCase();
          if (!wordByText[key]) wordByText[key] = word.id;
        });
        column.paragraphs.forEach(function(paragraph) {
          paragraphIndex[paragraph.id] = {
            paragraph: paragraph,
            column: column,
            set: set
          };
        });
      });
    });
  }
  function migrateStarredWords() {
    /*
     * 旧版星标只有英文文本，没有 vocabId。用小写文本映射到第一个匹配词，
     * 并把星标视为一次“不熟悉”记录，使旧用户立即进入新的复习计划。
     */
    var store = load();
    if (store.migratedStarredWords) return;
    var starred = [];
    try {
      starred = JSON.parse(localStorage.getItem('starredWords') || '[]');
    } catch (e) {}
    var timestamp = nowIso();
    starred.forEach(function(text) {
      var id = wordByText[String(text).toLowerCase()];
      if (!id || store.words[id]) return;
      store.words[id] = {
        firstSeen: timestamp,
        lastSeen: timestamp,
        lastReview: timestamp,
        nextReview: timestamp,
        intervalDays: 1,
        stabilityDays: .75,
        clickCount: 0,
        cardFlipCount: 0,
        reviewCount: 1,
        correctCount: 0,
        unfamiliarCount: 1,
        lapses: 1,
        failureStreak: 1,
        lastAction: 'unknown'
      };
    });
    store.migratedStarredWords = true;
    save();
  }
  function ensureWordRecord(id) {
    // 首次接触只创建记录；具体操作分支决定是否以及何时安排复习。
    var store = load();
    var record = store.words[id];
    if (!record) {
      record = store.words[id] = {
        firstSeen: nowIso(),
        lastSeen: nowIso(),
        lastReview: '',
        nextReview: '',
        intervalDays: 0,
        stabilityDays: 1,
        clickCount: 0,
        cardFlipCount: 0,
        reviewCount: 0,
        correctCount: 0,
        unfamiliarCount: 0,
        lapses: 0,
        failureStreak: 0,
        lastAction: ''
      };
    }
    return record;
  }
  function scheduleFirstReview(record, baseDate) {
    // 点词和翻卡是“接触”而非测验，只在没有计划时安排温和的一日后复习。
    if (!record.nextReview) {
      record.intervalDays = 1;
      record.stabilityDays = Math.max(record.stabilityDays || 1, 1);
      record.nextReview = addDays(baseDate, 1).toISOString();
    }
  }
  function queueUntilReady(operation) {
    // IndexedDB 恢复是异步的；排队可避免首屏立即点击被后到的档案覆盖。
    if (isReady) return false;
    pendingOperations.push(operation);
    return true;
  }
  function trackWord(id, action, meta) {
    if (queueUntilReady(function() { trackWord(id, action, meta); })) return;
    if (!wordIndex[id]) return;
    var record = ensureWordRecord(id);
    var timestamp = new Date();
    var timestampIso = timestamp.toISOString();
    var today = ensureDay();
    record.lastSeen = timestampIso;
    record.lastAction = action;
    if (action === 'click') {
      record.clickCount++;
      today.wordClicks++;
      scheduleFirstReview(record, timestamp);
    } else if (action === 'card') {
      record.cardFlipCount++;
      today.cardFlips++;
      scheduleFirstReview(record, timestamp);
    } else if (action === 'unknown') {
      // 忘记：缩短到半天，并乘法削弱稳定度；下限防止调度趋近于零。
      record.reviewCount++;
      record.unfamiliarCount++;
      record.lapses++;
      record.failureStreak = (record.failureStreak || 0) + 1;
      record.lastReview = timestampIso;
      record.intervalDays = .5;
      record.stabilityDays = Math.max(.45, (record.stabilityDays || 1) * .62);
      record.nextReview = addDays(timestamp, .5).toISOString();
      today.unfamiliar++;
    } else if (action === 'known' || action === 'review') {
      // 记得：连续正确逐步放大间隔，上限 90 天，避免纯前端启发式无限外推。
      record.reviewCount++;
      record.correctCount++;
      record.failureStreak = 0;
      record.lastReview = timestampIso;
      var previousInterval = Math.max(1, record.intervalDays || 1);
      var growth = record.correctCount === 1 ? 2 : Math.min(2.5, 1.75 + record.correctCount * .06);
      record.intervalDays = Math.min(90, previousInterval * growth);
      record.stabilityDays = Math.max(record.intervalDays, (record.stabilityDays || 1) * 1.55);
      record.nextReview = addDays(timestamp, record.intervalDays).toISOString();
      today.known++;
    }
    logEvent('word_' + action, id, meta);
    save();
    refreshOpenDashboard();
  }
  function trackArticle(columnId) {
    if (queueUntilReady(function() { trackArticle(columnId); })) return;
    if (!columnIndex[columnId]) return;
    var store = load();
    var timestamp = nowIso();
    var record = store.articles[columnId];
    if (!record) {
      record = store.articles[columnId] = {
        firstViewed: timestamp,
        lastViewed: timestamp,
        viewCount: 0,
        lastViewedDay: ''
      };
    }
    record.lastViewed = timestamp;
    // 同一文章一天只计一次，滚动抖动或往返查看不会虚增阅读量。
    if (record.lastViewedDay !== dayKey()) {
      record.viewCount++;
      record.lastViewedDay = dayKey();
      ensureDay().articles++;
      logEvent('article_view', columnId);
    }
    save();
    refreshOpenDashboard();
  }
  function trackAnalysis(paragraphId) {
    if (queueUntilReady(function() { trackAnalysis(paragraphId); })) return;
    if (!paragraphIndex[paragraphId]) return;
    var store = load();
    var timestamp = nowIso();
    var record = store.analyses[paragraphId];
    if (!record) {
      record = store.analyses[paragraphId] = {
        firstOpened: timestamp,
        lastOpened: timestamp,
        openCount: 0
      };
    }
    record.lastOpened = timestamp;
    record.openCount++;
    ensureDay().analyses++;
    logEvent('analysis_open', paragraphId);
    save();
    refreshOpenDashboard();
  }
  function recallProbability(id, at) {
    /*
     * 简化遗忘曲线 P=e^(-t/S)：S 越大衰减越慢；历史遗忘额外施加折扣。
     * 这是可解释的本地启发式估计，不冒充经过用户数据拟合的 FSRS/SM-2。
     */
    var record = load().words[id];
    if (!record) return null;
    var anchor = record.lastReview || record.lastSeen || record.firstSeen;
    if (!anchor) return null;
    var elapsed = Math.max(0, ((at || new Date()).getTime() - new Date(anchor).getTime()) / 86400000);
    var stability = Math.max(.4, record.stabilityDays || record.intervalDays || 1);
    var probability = Math.exp(-elapsed / stability);
    if (record.lapses) probability *= Math.pow(.94, Math.min(record.lapses, 6));
    return Math.max(0, Math.min(1, probability));
  }
  function memoryState(id, at) {
    // 颜色优先级是“强制到期 > 即将到期/低概率 > 已学习”，灰色仅代表无记录。
    var record = load().words[id];
    if (!record) return 'gray';
    var now = at || new Date();
    var probability = recallProbability(id, now);
    var next = record.nextReview ? new Date(record.nextReview) : null;
    if ((next && next <= now) || (record.failureStreak || 0) >= 2) return 'red';
    if ((next && next.getTime() - now.getTime() <= 1.5 * 86400000) || probability < .72) return 'yellow';
    return 'green';
  }
  function allWords() {
    return allWordItems;
  }
  function dueWords() {
    // “今日”包含截至本地 23:59:59 到期的词，便于用户提前完成当天计划。
    var deadline = endOfToday();
    return allWords().filter(function(item) {
      var record = load().words[item.word.id];
      if (!record || !record.nextReview) return false;
      return new Date(record.nextReview) <= deadline || (record.failureStreak || 0) >= 2;
    }).sort(function(a, b) {
      var ar = load().words[a.word.id];
      var br = load().words[b.word.id];
      return new Date(ar.nextReview).getTime() - new Date(br.nextReview).getTime();
    });
  }
  function groupDueColumns(due) {
    // 推荐入口落在专栏而非孤立词，延续“在语境中复习”的产品本意。
    var counts = {};
    due.forEach(function(item) {
      counts[item.column.id] = (counts[item.column.id] || 0) + 1;
    });
    return Object.keys(counts).map(function(id) {
      return {
        info: columnIndex[id],
        count: counts[id]
      };
    }).sort(function(a, b) {
      return b.count - a.count;
    });
  }
  function formatPercent(value) {
    return value == null ? '—' : Math.round(value * 100) + '%';
  }
  function activeSetId() {
    var active = document.querySelector('.set-content.active');
    return active ? active.id : (WordTales.Data.sets[0] ? WordTales.Data.sets[0].id : '');
  }
  function floatJumpTarget(target) {
    // 重启动画前强制一次 reflow，确保重复点击热力图时仍能看到定位反馈。
    if (!target) return;
    if (target._progressJumpTimer) clearTimeout(target._progressJumpTimer);
    target.classList.remove('progress-jump-float');
    void target.offsetWidth;
    target.classList.add('progress-jump-float');
    try { target.focus({ preventScroll: true }); } catch (e) { target.focus(); }
    target._progressJumpTimer = setTimeout(function() {
      target.classList.remove('progress-jump-float');
      target._progressJumpTimer = null;
    }, 1650);
  }
  function navigateTo(item) {
    // 先切词集再关闭面板，等 DOM 恢复可交互后才滚动和聚焦目标。
    var setId = item.set.id;
    var button = document.querySelector('.set-btn[data-set="' + setId + '"]');
    if (WordTales.Navigation) WordTales.Navigation.switchSet(setId, button);
    closeDashboard();
    setTimeout(function() {
      var section = document.getElementById(item.column.id);
      if (!section) return;
      var target = item.word
        ? section.querySelector('.vocab-card[data-vocab-id="' + item.word.id + '"]')
        : section;
      if (!target) target = section;
      var reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      target.scrollIntoView({
        behavior: reducedMotion ? 'auto' : 'smooth',
        block: item.word ? 'center' : 'start'
      });
      if (item.word) {
        setTimeout(function() { floatJumpTarget(target); }, reducedMotion ? 30 : 420);
      }
    }, 80);
  }
  function makePlanItem(label, detail, item) {
    var li = document.createElement('li');
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'progress-plan-item';
    button.textContent = label;
    if (detail) {
      var small = document.createElement('small');
      small.textContent = detail;
      button.appendChild(small);
    }
    button.addEventListener('click', function() { navigateTo(item); });
    li.appendChild(button);
    return li;
  }
  function fillPlanList(list, items, mapper, emptyText) {
    // 空状态也是计划的一部分，避免空容器被误解为加载失败。
    list.innerHTML = '';
    if (!items.length) {
      var empty = document.createElement('li');
      empty.className = 'progress-empty';
      empty.textContent = emptyText;
      list.appendChild(empty);
      return;
    }
    items.forEach(function(item) {
      var mapped = mapper(item);
      list.appendChild(makePlanItem(mapped.label, mapped.detail, mapped.target));
    });
  }
  function renderHeatmap() {
    var grid = panel.querySelector('#memoryHeatmap');
    if (!grid) return;
    grid.innerHTML = '';
    var selectedSet = WordTales.Data.getSet(heatmapSetId) || WordTales.Data.sets[0];
    if (!selectedSet) return;
    // 视觉顺序严格跟随教材中的“列 → 词”，而不是按记忆状态重新排序。
    selectedSet.columns.forEach(function(column) {
      column.words.forEach(function(word) {
        var state = memoryState(word.id);
        var probability = recallProbability(word.id);
        var cell = document.createElement('button');
        cell.type = 'button';
        cell.className = 'memory-cell ' + state;
        cell.textContent = word.word;
        var sub = document.createElement('span');
        sub.textContent = state === 'gray' ? column.title + ' · 未学习' : column.title + ' · ' + formatPercent(probability);
        cell.appendChild(sub);
        cell.title = word.word + ' · ' + word.meaning + ' · ' + (state === 'gray' ? '尚未学习' : '预计回忆率 ' + formatPercent(probability));
        cell.setAttribute('aria-label', cell.title);
        cell.addEventListener('click', function() {
          navigateTo({ set: selectedSet, column: column, word: word });
        });
        grid.appendChild(cell);
      });
    });
  }
  function renderDashboard() {
    /*
     * 面板每次打开都从当前内存档案重绘，不维护第二份 UI 状态。
     * 这让游戏分类、文章曝光和解析点击能立即反映到统计与热力图。
     */
    if (!panel) return;
    var store = load();
    var due = dueWords();
    var dueColumns = groupDueColumns(due);
    var learnedIds = Object.keys(store.words).filter(function(id) { return !!wordIndex[id]; });
    var articleCount = Object.keys(store.articles).filter(function(id) { return !!columnIndex[id]; }).length;
    var analysisCount = Object.keys(store.analyses).filter(function(id) { return !!paragraphIndex[id]; }).length;
    var probabilities = learnedIds.map(function(id) { return recallProbability(id); }).filter(function(p) { return p != null; });
    var avg = probabilities.length ? probabilities.reduce(function(sum, p) { return sum + p; }, 0) / probabilities.length : null;
    var dateFormat;
    try {
      dateFormat = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }).format(new Date());
    } catch (e) {
      dateFormat = dayKey();
    }
    panel.innerHTML =
      '<div class="progress-panel-head">' +
        '<div><p class="progress-eyebrow">Learning pulse</p><h2>你的学习进度</h2><p class="progress-date">' + dateFormat + ' · 今日计划已根据记忆状态更新</p></div>' +
        '<button type="button" class="progress-close" aria-label="关闭进度面板">×</button>' +
      '</div>' +
      '<div class="progress-kpis">' +
        '<div class="progress-kpi"><div class="progress-kpi-value">' + learnedIds.length + '</div><div class="progress-kpi-label">已接触单词</div></div>' +
        '<div class="progress-kpi"><div class="progress-kpi-value">' + due.length + '</div><div class="progress-kpi-label">今天需复习</div></div>' +
        '<div class="progress-kpi"><div class="progress-kpi-value">' + (avg == null ? '—' : Math.round(avg * 100) + '%') + '</div><div class="progress-kpi-label">预计平均回忆率</div></div>' +
        '<div class="progress-kpi"><div class="progress-kpi-value">' + articleCount + '<small> / ' + analysisCount + '</small></div><div class="progress-kpi-label">浏览文章 / 段落解析</div></div>' +
      '</div>' +
      '<section class="progress-section">' +
        '<div class="progress-section-head"><div><h3>今天学什么</h3><p class="progress-section-note">按词集和栏目汇总今天到期的复习内容</p></div></div>' +
        '<div class="progress-plan-grid">' +
          '<article class="progress-plan-card"><h4>今日复习栏目 · ' + dueColumns.length + '</h4><ul class="progress-plan-list column-plan-list" id="duePlan"></ul></article>' +
        '</div>' +
      '</section>' +
      '<section class="progress-section">' +
        '<div class="progress-section-head"><div><h3>记忆热力图</h3><p class="progress-section-note">颜色由复习时间、遗忘次数和时间衰减共同决定</p></div><div class="heatmap-controls"><label for="heatmapSet">词集</label><select id="heatmapSet"></select></div></div>' +
        '<div class="memory-legend"><span><i class="memory-dot green"></i>绿色：当前回忆概率较高</span><span><i class="memory-dot yellow"></i>黄色：即将需要复习</span><span><i class="memory-dot red"></i>红色：已到期或多次遗忘</span><span><i class="memory-dot gray"></i>灰色：尚未学习</span></div>' +
        '<div class="memory-heatmap" id="memoryHeatmap"></div>' +
        '<p class="progress-footnote">进度仅保存在当前浏览器。' + (persistenceMode === 'indexedDB' ? '学习档案与逐次记录通过 IndexedDB 异步保存。' : '当前浏览器不支持 IndexedDB，已降级使用 localStorage。') + '每日提醒会在当天首次打开 WordTales 时出现；浏览器保持打开时，跨天也会自动刷新。分类为“比较认识”会延长复习间隔，分类为“不太认识”会缩短间隔。</p>' +
      '</section>';
    panel.querySelector('.progress-close').addEventListener('click', closeDashboard);
    fillPlanList(panel.querySelector('#duePlan'), dueColumns, function(item) {
      return {
        label: item.info.set.label + ' · ' + item.info.column.title,
        detail: item.count + ' 个到期词',
        target: { set: item.info.set, column: item.info.column }
      };
    }, '今天没有到期栏目，可以自由复习任意一列。');
    var select = panel.querySelector('#heatmapSet');
    WordTales.Data.sets.forEach(function(set) {
      var option = document.createElement('option');
      option.value = set.id;
      option.textContent = set.label + ' · ' + WordTales.Data.countWords(set) + '词';
      select.appendChild(option);
    });
    if (!heatmapSetId) heatmapSetId = activeSetId();
    select.value = heatmapSetId;
    select.addEventListener('change', function() {
      heatmapSetId = select.value;
      renderHeatmap();
    });
    renderHeatmap();
  }
  function openDashboard() {
    if (queueUntilReady(openDashboard)) return;
    if (!overlay) buildDashboard();
    heatmapSetId = activeSetId();
    renderDashboard();
    overlay.classList.add('active');
    setBackgroundInert(true);
    document.body.style.overflow = 'hidden';
    setTimeout(function() {
      var close = panel.querySelector('.progress-close');
      if (close) close.focus();
    }, 0);
  }
  function closeDashboard() {
    if (!overlay) return;
    overlay.classList.remove('active');
    setBackgroundInert(false);
    document.body.style.overflow = '';
    var entry = document.getElementById('progressEntry');
    if (entry) entry.focus();
  }
  function buildDashboard() {
    // 面板首次打开时才创建，减轻首屏 DOM；后续只重绘 panel 内部。
    overlay = document.createElement('div');
    overlay.className = 'progress-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', '学习进度');
    panel = document.createElement('div');
    panel.className = 'progress-panel';
    overlay.appendChild(panel);
    overlay.addEventListener('mousedown', function(event) {
      if (event.target === overlay) closeDashboard();
    });
    overlay.addEventListener('keydown', function(event) {
      if (event.key === 'Escape') closeDashboard();
    });
    document.body.appendChild(overlay);
  }
  function setBackgroundInert(inert) {
    // 隔离背景，避免读屏或键盘焦点穿透到面板背后的学习内容。
    ['progressEntry', 'dailyReminder', 'appContent', 'toc', 'setSwitcher'].forEach(function(id) {
      var element = document.getElementById(id);
      if (element) element.inert = inert;
    });
  }
  function refreshOpenDashboard() {
    if (overlay && overlay.classList.contains('active')) renderDashboard();
  }
  function reminderText() {
    var due = dueWords().length;
    if (due > 0) return '今天有 ' + due + ' 个单词需要复习，打开计划查看对应的词集和栏目。';
    return '今天没有到期内容，可以自由复习任意一列。';
  }
  function showDailyReminder(force) {
    /*
     * 默认每天只展示一次；force 用于跨日后刷新。通知属于可选增强，
     * 页面内 banner 始终是主路径，因此这里不会主动索取浏览器通知权限。
     */
    var store = load();
    var today = dayKey();
    if (!force && store.reminders.lastShown === today) return;
    var banner = document.getElementById('dailyReminder');
    if (!banner) return;
    banner.innerHTML = '';
    var copy = document.createElement('div');
    copy.className = 'daily-reminder-copy';
    var title = document.createElement('strong');
    title.textContent = '今日复习提醒';
    copy.appendChild(title);
    copy.appendChild(document.createTextNode(reminderText()));
    var open = document.createElement('button');
    open.type = 'button';
    open.textContent = '查看计划';
    open.addEventListener('click', openDashboard);
    var dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.className = 'reminder-dismiss';
    dismiss.textContent = '稍后';
    dismiss.setAttribute('aria-label', '关闭今日提醒');
    dismiss.addEventListener('click', function() { banner.hidden = true; });
    banner.appendChild(copy);
    banner.appendChild(open);
    banner.appendChild(dismiss);
    banner.hidden = false;
    store.reminders.lastShown = today;
    save();
    if (store.reminders.notifications && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      try { new Notification('WordTales 今日复习', { body: reminderText() }); } catch (e) {}
    }
  }
  function observeArticles() {
    // 文章至少进入视口 25% 才算浏览，再由 trackArticle 做“每日一次”去重。
    if (!('IntersectionObserver' in window)) return;
    articleObserver = new IntersectionObserver(function(entries) {
      entries.forEach(function(entry) {
        if (!entry.isIntersecting || entry.intersectionRatio < .25) return;
        var section = entry.target.closest('.column-section');
        if (!section) return;
        trackArticle(section.id);
      });
    }, { threshold: [.25] });
    document.querySelectorAll('.essay-block').forEach(function(block) {
      articleObserver.observe(block);
    });
  }
  function init() {
    /*
     * 初始化顺序不能颠倒：先建静态索引和同步 fallback，再异步选择最新档案；
     * 完成后才回放排队操作、启用入口和注册观察器。
     */
    buildIndexes();
    load();
    currentDay = dayKey();
    var entry = document.getElementById('progressEntry');
    if (entry) {
      entry.disabled = true;
      entry.setAttribute('aria-busy', 'true');
    }
    if (entry) entry.addEventListener('click', openDashboard);
    return hydrate().then(function() {
      migrateStarredWords();
      isReady = true;
      if (entry) {
        entry.disabled = false;
        entry.removeAttribute('aria-busy');
      }
      var queued = pendingOperations.slice();
      pendingOperations = [];
      queued.forEach(function(operation) { operation(); });
      observeArticles();
      showDailyReminder(false);
      // pagehide 兼容移动端与往返缓存，用它冲刷尚未触发的防抖保存。
      window.addEventListener('pagehide', function() {
        if (profileSaveTimer) {
          clearTimeout(profileSaveTimer);
          profileSaveTimer = null;
        }
        writeProfileNow().catch(function() {});
      });
      // 页面长时间保持打开时，每分钟检测跨日并重建今日计划。
      window.setInterval(function() {
        var nextDay = dayKey();
        if (nextDay !== currentDay) {
          currentDay = nextDay;
          showDailyReminder(true);
          refreshOpenDashboard();
        }
      }, 60000);
    });
  }
  return {
    init: init,
    open: openDashboard,
    close: closeDashboard,
    trackWord: trackWord,
    trackArticle: trackArticle,
    trackAnalysis: trackAnalysis,
    recallProbability: recallProbability,
    memoryState: memoryState,
    getData: function() { return load(); }
  };
})();
