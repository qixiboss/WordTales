/* ============================================================
 * Module: LearningProgress v2
 * 规范词条、FSRS-6 三档评分、统一星标、进度面板与旧档案迁移。
 * ============================================================ */
WordTales.LearningProgress = (function() {
  var STORAGE_KEY = 'wordtales.learning.v1';
  var MIGRATION_KEY = 'wordtales.learning.v2-migrated';
  var DB_NAME = 'wordtales-learning';
  var DB_VERSION = 1;
  var MAX_SUBMISSIONS = 400;
  var data = null;
  var database = null;
  var persistenceMode = 'localStorage';
  var ready = false;
  var pending = [];
  var saveTimer = null;
  var overlay = null;
  var panel = null;
  var dashboardPreviousFocus = null;
  var articleObserver = null;
  var columnIndex = Object.create(null);
  var paragraphIndex = Object.create(null);

  var scheduler = window.FSRS && window.FSRS.fsrs ? window.FSRS.fsrs({
    request_retention: 0.9,
    maximum_interval: 36500,
    enable_fuzz: false,
    enable_short_term: false,
    learning_steps: [],
    relearning_steps: []
  }) : null;

  function nowIso() { return new Date().toISOString(); }
  function dayKey(date) {
    var d = date || new Date();
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }
  function addDays(date, days) { return new Date(date.getTime() + days * 86400000); }
  function validDate(value) {
    var date = value ? new Date(value) : null;
    return date && !isNaN(date.getTime()) ? date : null;
  }
  function freshData() {
    return {
      version: 2,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      words: {},
      articles: {},
      analyses: {},
      days: {},
      reminders: { lastShown: '', notifications: false },
      processedSubmissions: [],
      events: []
    };
  }
  function emptyFsrsCard(at) {
    var now = at || new Date();
    if (window.FSRS && window.FSRS.createEmptyCard) return serializeCard(window.FSRS.createEmptyCard(now));
    return {
      due: now.toISOString(), stability: 0, difficulty: 0, elapsed_days: 0,
      scheduled_days: 0, reps: 0, lapses: 0, learning_steps: 0, state: 0, last_review: null
    };
  }
  function serializeCard(card) {
    return {
      due: validDate(card.due) ? new Date(card.due).toISOString() : nowIso(),
      stability: Number(card.stability) || 0,
      difficulty: Number(card.difficulty) || 0,
      elapsed_days: Number(card.elapsed_days) || 0,
      scheduled_days: Number(card.scheduled_days) || 0,
      reps: Number(card.reps) || 0,
      lapses: Number(card.lapses) || 0,
      learning_steps: Number(card.learning_steps) || 0,
      state: Number(card.state) || 0,
      last_review: validDate(card.last_review) ? new Date(card.last_review).toISOString() : null
    };
  }
  function reviveCard(card) {
    var value = card || emptyFsrsCard(new Date());
    return {
      due: validDate(value.due) || new Date(),
      stability: Number(value.stability) || 0,
      difficulty: Number(value.difficulty) || 0,
      elapsed_days: Number(value.elapsed_days) || 0,
      scheduled_days: Number(value.scheduled_days) || 0,
      reps: Number(value.reps) || 0,
      lapses: Number(value.lapses) || 0,
      learning_steps: Number(value.learning_steps) || 0,
      state: Number(value.state) || 0,
      last_review: validDate(value.last_review)
    };
  }
  function createRecord(entryId, at) {
    var entry = WordTales.Data.getEntry(entryId);
    var timestamp = (at || new Date()).toISOString();
    return {
      entryId: entryId,
      firstSeenAt: timestamp,
      lastSeenAt: timestamp,
      lastReviewedAt: '',
      nextReviewAt: '',
      lastResult: '',
      reviewCount: 0,
      lapseCount: 0,
      successStreak: 0,
      clickCount: 0,
      cardFlipCount: 0,
      isStarred: false,
      starredAt: '',
      starReason: '',
      sourceOccurrenceId: entry ? entry.primaryOccurrenceId : entryId,
      fsrsCard: emptyFsrsCard(at || new Date())
    };
  }
  function normalizeRecord(entryId, record) {
    var result = Object.assign(createRecord(entryId, validDate(record.firstSeenAt || record.firstSeen) || new Date()), record || {});
    result.entryId = entryId;
    result.firstSeenAt = result.firstSeenAt || result.firstSeen || nowIso();
    result.lastSeenAt = result.lastSeenAt || result.lastSeen || result.firstSeenAt;
    result.lastReviewedAt = result.lastReviewedAt || result.lastReview || '';
    result.nextReviewAt = result.nextReviewAt || result.nextReview || '';
    result.reviewCount = Number(result.reviewCount) || 0;
    result.lapseCount = Number(result.lapseCount != null ? result.lapseCount : result.lapses) || 0;
    result.successStreak = Number(result.successStreak) || 0;
    result.clickCount = Number(result.clickCount) || 0;
    result.cardFlipCount = Number(result.cardFlipCount) || 0;
    result.isStarred = !!result.isStarred;
    result.fsrsCard = serializeCard(result.fsrsCard || {
      due: result.nextReviewAt || nowIso(),
      stability: result.stabilityDays || result.intervalDays || 1,
      difficulty: result.difficulty || 5,
      elapsed_days: result.intervalDays || 0,
      scheduled_days: result.intervalDays || 1,
      reps: result.reviewCount || 0,
      lapses: result.lapseCount || 0,
      learning_steps: 0,
      state: result.reviewCount || result.nextReviewAt ? (window.FSRS ? window.FSRS.State.Review : 2) : (window.FSRS ? window.FSRS.State.Learning : 1),
      last_review: result.lastReviewedAt || null
    });
    if (!result.nextReviewAt && result.fsrsCard.reps > 0) result.nextReviewAt = result.fsrsCard.due;
    return result;
  }
  function chooseEarlier(a, b) {
    var ad = validDate(a); var bd = validDate(b);
    if (!ad) return b || '';
    if (!bd) return a || '';
    return ad <= bd ? a : b;
  }
  function chooseLater(a, b) {
    var ad = validDate(a); var bd = validDate(b);
    if (!ad) return b || '';
    if (!bd) return a || '';
    return ad >= bd ? a : b;
  }
  function mergeLegacyRecord(target, incoming) {
    target.firstSeenAt = chooseEarlier(target.firstSeenAt, incoming.firstSeenAt);
    target.lastSeenAt = chooseLater(target.lastSeenAt, incoming.lastSeenAt);
    target.lastReviewedAt = chooseLater(target.lastReviewedAt, incoming.lastReviewedAt);
    target.nextReviewAt = chooseEarlier(target.nextReviewAt, incoming.nextReviewAt);
    target.reviewCount += incoming.reviewCount;
    target.lapseCount += incoming.lapseCount;
    target.clickCount += incoming.clickCount;
    target.cardFlipCount += incoming.cardFlipCount;
    target.successStreak = Math.min(target.successStreak || Infinity, incoming.successStreak || 0);
    if (!isFinite(target.successStreak)) target.successStreak = 0;
    target.isStarred = target.isStarred || incoming.isStarred;
    if (incoming.isStarred) {
      target.starredAt = chooseLater(target.starredAt, incoming.starredAt || incoming.lastSeenAt);
      target.starReason = incoming.starReason || 'legacy';
    }
    var targetLatest = validDate(target.lastReviewedAt || target.lastSeenAt);
    var incomingLatest = validDate(incoming.lastReviewedAt || incoming.lastSeenAt);
    if (incomingLatest && (!targetLatest || incomingLatest >= targetLatest)) target.lastResult = incoming.lastResult || incoming.lastAction || target.lastResult;
    target.fsrsCard.stability = Math.min(target.fsrsCard.stability || Infinity, incoming.fsrsCard.stability || Infinity);
    if (!isFinite(target.fsrsCard.stability)) target.fsrsCard.stability = 1;
    target.fsrsCard.difficulty = Math.max(target.fsrsCard.difficulty || 0, incoming.fsrsCard.difficulty || 0);
    target.fsrsCard.reps = target.reviewCount;
    target.fsrsCard.lapses = target.lapseCount;
    target.fsrsCard.due = target.nextReviewAt || target.fsrsCard.due;
    target.fsrsCard.last_review = target.lastReviewedAt || target.fsrsCard.last_review;
    target.fsrsCard.state = target.reviewCount ? (window.FSRS ? window.FSRS.State.Review : 2) : (window.FSRS ? window.FSRS.State.Learning : 1);
  }
  function migrateCandidate(candidate) {
    if (!candidate || (candidate.version !== 1 && candidate.version !== 2)) return freshData();
    var store = freshData();
    store.createdAt = candidate.createdAt || store.createdAt;
    /* 旧档案没有更新时间时保持“未知”，避免每次迁移都伪造一个最新时间并覆盖 IndexedDB。 */
    store.updatedAt = candidate.updatedAt || candidate.createdAt || '';
    store.articles = candidate.articles || {};
    store.analyses = candidate.analyses || {};
    store.days = candidate.days || {};
    store.reminders = candidate.reminders || store.reminders;
    store.starMigrationV2 = !!candidate.starMigrationV2;
    store.processedSubmissions = Array.isArray(candidate.processedSubmissions) ? candidate.processedSubmissions.slice(-MAX_SUBMISSIONS) : [];
    store.events = Array.isArray(candidate.events) ? candidate.events.slice() : [];
    Object.keys(candidate.words || {}).forEach(function(oldId) {
      var entryId = WordTales.Data.resolveEntryId(oldId);
      if (!WordTales.Data.getEntry(entryId)) return;
      var incoming = normalizeRecord(entryId, candidate.words[oldId]);
      if (!store.words[entryId]) store.words[entryId] = incoming;
      else mergeLegacyRecord(store.words[entryId], incoming);
    });
    return store;
  }
  function loadFallback() {
    var parsed = null;
    try { parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch (e) {}
    if (!parsed) {
      var empty = freshData();
      /* 缺少 localStorage 档案不等于“刚刚产生了一份更新档案”。 */
      empty.updatedAt = '';
      return empty;
    }
    return migrateCandidate(parsed);
  }
  function snapshot() {
    return JSON.parse(JSON.stringify(load()));
  }
  function load() {
    if (!data) data = loadFallback();
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
    return new Promise(function(resolve, reject) {
      var request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = function() {
        var db = request.result;
        if (!db.objectStoreNames.contains('profiles')) db.createObjectStore('profiles', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('events')) {
          var events = db.createObjectStore('events', { keyPath: 'id', autoIncrement: true });
          events.createIndex('day', 'day', { unique: false });
          events.createIndex('type', 'type', { unique: false });
          events.createIndex('at', 'at', { unique: false });
        }
      };
      request.onsuccess = function() { database = request.result; resolve(database); };
      request.onerror = function() { reject(request.error || new Error('Unable to open IndexedDB')); };
      request.onblocked = function() { reject(new Error('IndexedDB upgrade blocked')); };
    });
  }
  function writeProfileNow() {
    if (!database || persistenceMode !== 'indexedDB') return Promise.resolve();
    return requestToPromise(database.transaction('profiles', 'readwrite').objectStore('profiles').put({
      id: 'current', updatedAt: load().updatedAt, data: snapshot()
    }));
  }
  function saveFallback() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(load())); return true; } catch (e) { return false; }
  }
  function saveSoon() {
    load().updatedAt = nowIso();
    mirrorLegacyStars();
    if (persistenceMode !== 'indexedDB' || !database) { saveFallback(); return; }
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(function() {
      saveTimer = null;
      writeProfileNow().catch(function() { persistenceMode = 'localStorage'; saveFallback(); });
    }, 180);
  }
  function commitReview(event) {
    load().updatedAt = nowIso();
    mirrorLegacyStars();
    if (!database || persistenceMode !== 'indexedDB') return Promise.resolve(saveFallback());
    return new Promise(function(resolve, reject) {
      var tx;
      try { tx = database.transaction(['profiles', 'events'], 'readwrite'); } catch (e) { reject(e); return; }
      tx.objectStore('profiles').put({ id: 'current', updatedAt: load().updatedAt, data: snapshot() });
      tx.objectStore('events').add(event);
      tx.oncomplete = function() { resolve(true); };
      tx.onerror = function() { reject(tx.error || new Error('Review commit failed')); };
      tx.onabort = function() { reject(tx.error || new Error('Review commit aborted')); };
    }).catch(function() {
      persistenceMode = 'localStorage';
      return saveFallback();
    });
  }
  function hydrate() {
    var fallback = loadFallback();
    return openDatabase().then(function(db) {
      return requestToPromise(db.transaction('profiles', 'readonly').objectStore('profiles').get('current')).then(function(saved) {
        var savedAt = saved ? new Date(saved.updatedAt || 0).getTime() : 0;
        var fallbackAt = fallback.updatedAt ? new Date(fallback.updatedAt).getTime() : 0;
        if (!isFinite(savedAt)) savedAt = 0;
        if (!isFinite(fallbackAt)) fallbackAt = 0;
        data = saved && savedAt >= fallbackAt ? migrateCandidate(saved.data) : fallback;
        persistenceMode = 'indexedDB';
        return writeProfileNow();
      });
    }).catch(function() { data = fallback; persistenceMode = 'localStorage'; });
  }
  function ensureDay() {
    var key = dayKey();
    var days = load().days;
    if (!days[key]) days[key] = { wordClicks: 0, cardFlips: 0, good: 0, hard: 0, again: 0, known: 0, unfamiliar: 0, articles: 0, analyses: 0 };
    days[key].good = Number(days[key].good) || 0;
    days[key].hard = Number(days[key].hard) || 0;
    days[key].again = Number(days[key].again) || 0;
    return days[key];
  }
  function buildIndexes() {
    columnIndex = Object.create(null);
    paragraphIndex = Object.create(null);
    WordTales.Data.sets.forEach(function(set) {
      set.columns.forEach(function(column) {
        columnIndex[column.id] = { set: set, column: column };
        column.paragraphs.forEach(function(paragraph) { paragraphIndex[paragraph.id] = { set: set, column: column, paragraph: paragraph }; });
      });
    });
  }
  function ensureRecord(id, at) {
    var entryId = WordTales.Data.resolveEntryId(id);
    if (!WordTales.Data.getEntry(entryId)) return null;
    if (!load().words[entryId]) load().words[entryId] = createRecord(entryId, at || new Date());
    return load().words[entryId];
  }
  function migrateLegacyStars() {
    var store = load();
    var migrationMarked = false;
    try { migrationMarked = localStorage.getItem(MIGRATION_KEY) === '1'; } catch (e) {}
    if (store.starMigrationV2 || migrationMarked) { store.starMigrationV2 = true; return; }
    var values = [];
    try { values = JSON.parse(localStorage.getItem('starredWords') || '[]'); } catch (e) {}
    var lookup = Object.create(null);
    values.forEach(function(value) { lookup[String(value).toLowerCase()] = true; });
    WordTales.Data.getAllEntries().forEach(function(entry) {
      if (!lookup[entry.word.toLowerCase()]) return;
      var record = ensureRecord(entry.id, new Date());
      record.isStarred = true;
      record.starredAt = record.starredAt || nowIso();
      record.starReason = record.starReason || 'legacy';
      if (!record.nextReviewAt) {
        record.nextReviewAt = nowIso();
        record.fsrsCard.due = record.nextReviewAt;
        record.fsrsCard.state = window.FSRS ? window.FSRS.State.Relearning : 3;
      }
    });
    store.starMigrationV2 = true;
    try { localStorage.setItem(MIGRATION_KEY, '1'); } catch (e) {}
    saveSoon();
  }
  function mirrorLegacyStars() {
    var seen = Object.create(null); var words = [];
    Object.keys(load().words).forEach(function(id) {
      var record = load().words[id]; var entry = WordTales.Data.getEntry(id);
      if (!record.isStarred || !entry || seen[entry.word.toLowerCase()]) return;
      seen[entry.word.toLowerCase()] = true; words.push(entry.word);
    });
    try { localStorage.setItem('starredWords', JSON.stringify(words)); } catch (e) {}
  }
  function ratingValue(rating) {
    if (!window.FSRS) return 0;
    if (rating === 'Good') return window.FSRS.Rating.Good;
    if (rating === 'Hard') return window.FSRS.Rating.Hard;
    return window.FSRS.Rating.Again;
  }
  function rateWord(id, rating, meta, submissionId) {
    if (['Good', 'Hard', 'Again'].indexOf(rating) < 0) return Promise.reject(new TypeError('Unsupported learning rating: ' + rating));
    if (!ready) return new Promise(function(resolve, reject) { pending.push(function() { rateWord(id, rating, meta, submissionId).then(resolve, reject); }); });
    var entryId = WordTales.Data.resolveEntryId(id);
    var entry = WordTales.Data.getEntry(entryId);
    if (!entry) return Promise.resolve(null);
    var store = load();
    if (submissionId && store.processedSubmissions.indexOf(submissionId) >= 0) return Promise.resolve(store.words[entryId] || null);
    var now = new Date();
    var record = ensureRecord(entryId, now);
    var currentCard = reviveCard(record.fsrsCard);
    var output;
    if (scheduler) output = scheduler.next(currentCard, now, ratingValue(rating));
    else {
      var interval = rating === 'Good' ? Math.max(3, (currentCard.scheduled_days || 1) * 2.2) : rating === 'Hard' ? Math.max(1, (currentCard.scheduled_days || 1) * 1.3) : 1;
      output = { card: Object.assign(currentCard, { due: addDays(now, interval), scheduled_days: interval, stability: interval, difficulty: rating === 'Again' ? 8 : rating === 'Hard' ? 6 : 4, reps: currentCard.reps + 1, lapses: currentCard.lapses + (rating === 'Again' ? 1 : 0), state: rating === 'Again' ? 3 : 2, last_review: now }) };
    }
    record.fsrsCard = serializeCard(output.card);
    record.lastSeenAt = now.toISOString();
    record.lastReviewedAt = now.toISOString();
    record.nextReviewAt = record.fsrsCard.due;
    record.lastResult = rating;
    record.reviewCount++;
    record.sourceOccurrenceId = meta && meta.occurrenceId ? meta.occurrenceId : record.sourceOccurrenceId;
    if (rating === 'Again') {
      record.lapseCount++;
      record.successStreak = 0;
      record.isStarred = true;
      record.starredAt = now.toISOString();
      record.starReason = 'again';
    } else {
      record.successStreak++;
      record.isStarred = false;
      record.starredAt = '';
      record.starReason = '';
    }
    var today = ensureDay();
    today[rating.toLowerCase()]++;
    if (rating === 'Again') today.unfamiliar = (today.unfamiliar || 0) + 1;
    else today.known = (today.known || 0) + 1;
    if (submissionId) {
      store.processedSubmissions.push(submissionId);
      if (store.processedSubmissions.length > MAX_SUBMISSIONS) store.processedSubmissions.splice(0, store.processedSubmissions.length - MAX_SUBMISSIONS);
    }
    var event = { at: now.toISOString(), day: dayKey(now), type: 'word_rating', targetId: entryId, meta: Object.assign({}, meta || {}, { rating: rating, submissionId: submissionId || '' }) };
    store.events.push(event);
    return commitReview(event).then(function(saved) {
      refreshOpenDashboard();
      if (WordTales.Progress && WordTales.Progress.refresh) WordTales.Progress.refresh();
      var value = getEntryState(entryId);
      value.saved = saved !== false;
      return value;
    });
  }
  function exposeWord(id, action, meta) {
    var entryId = WordTales.Data.resolveEntryId(id);
    var record = ensureRecord(entryId, new Date());
    if (!record) return null;
    var now = new Date();
    record.lastSeenAt = now.toISOString();
    if (action === 'click') { record.clickCount++; ensureDay().wordClicks++; }
    if (action === 'card') { record.cardFlipCount++; ensureDay().cardFlips++; }
    if (!record.nextReviewAt) {
      record.nextReviewAt = addDays(now, 1).toISOString();
      record.fsrsCard.due = record.nextReviewAt;
      record.fsrsCard.stability = Math.max(1, record.fsrsCard.stability || 0);
      record.fsrsCard.difficulty = Math.max(5, record.fsrsCard.difficulty || 0);
      record.fsrsCard.state = window.FSRS ? window.FSRS.State.Learning : 1;
    }
    if (meta && meta.occurrenceId) record.sourceOccurrenceId = meta.occurrenceId;
    saveSoon();
    return record;
  }
  function trackWord(id, action, meta) {
    if (!ready) { pending.push(function() { trackWord(id, action, meta); }); return; }
    if (action === 'known' || action === 'review') return rateWord(id, 'Good', meta, 'legacy-' + Date.now() + '-' + Math.random());
    if (action === 'unknown') return rateWord(id, 'Again', meta, 'legacy-' + Date.now() + '-' + Math.random());
    return exposeWord(id, action, meta);
  }
  function setStarred(id, starred, reason) {
    var record = ensureRecord(id, new Date());
    if (!record) return;
    record.isStarred = !!starred;
    record.starredAt = starred ? nowIso() : '';
    record.starReason = starred ? (reason || 'manual') : '';
    saveSoon();
    if (WordTales.Progress && WordTales.Progress.refresh) WordTales.Progress.refresh();
  }
  function getEntryState(id) {
    var entryId = WordTales.Data.resolveEntryId(id);
    var record = load().words[entryId];
    if (!record) return null;
    var value = Object.assign({}, record);
    value.fsrsCard = Object.assign({}, record.fsrsCard);
    value.learningState = getLearningState(record);
    value.retrievability = recallProbability(entryId);
    return value;
  }
  function getLearningState(record) {
    if (!record || !record.reviewCount) return record ? 'learning' : 'new';
    if (record.lastResult === 'Again' || record.fsrsCard.state === (window.FSRS ? window.FSRS.State.Relearning : 3)) return 'relearning';
    if (record.fsrsCard.state === (window.FSRS ? window.FSRS.State.Review : 2) && record.fsrsCard.stability >= 90) return 'mastered';
    return 'review';
  }
  function recallProbability(id, at) {
    var record = load().words[WordTales.Data.resolveEntryId(id)];
    if (!record || !record.lastSeenAt) return null;
    if (scheduler && record.fsrsCard && record.fsrsCard.stability > 0) {
      try { return Number(scheduler.get_retrievability(reviveCard(record.fsrsCard), at || new Date(), false)); } catch (e) {}
    }
    var anchor = validDate(record.lastReviewedAt || record.lastSeenAt);
    var elapsed = anchor ? Math.max(0, ((at || new Date()).getTime() - anchor.getTime()) / 86400000) : 0;
    return Math.max(0, Math.min(1, Math.exp(-elapsed / Math.max(.4, record.fsrsCard.stability || 1))));
  }
  function memoryState(id, at) {
    var record = load().words[WordTales.Data.resolveEntryId(id)];
    if (!record) return 'gray';
    var now = at || new Date();
    var due = validDate(record.nextReviewAt);
    var probability = recallProbability(id, now);
    if ((due && due <= now) || record.lastResult === 'Again') return 'red';
    if ((due && due.getTime() - now.getTime() <= 1.5 * 86400000) || probability < .72) return 'yellow';
    return 'green';
  }
  function occurrenceForRecord(entry, record) {
    return WordTales.Data.getOccurrence(record && record.sourceOccurrenceId) || WordTales.Data.getOccurrence(entry.primaryOccurrenceId) || entry.occurrences[0];
  }
  function getDueEntries(at) {
    var now = at || new Date();
    return WordTales.Data.getAllEntries().map(function(entry) {
      var record = load().words[entry.id];
      if (!record || !record.nextReviewAt || new Date(record.nextReviewAt) > now) return null;
      var occurrence = occurrenceForRecord(entry, record);
      return { entry: entry, record: record, occurrence: occurrence, word: occurrence.word, set: occurrence.set, column: occurrence.column };
    }).filter(Boolean).sort(function(a, b) {
      var overdueA = now.getTime() - new Date(a.record.nextReviewAt).getTime();
      var overdueB = now.getTime() - new Date(b.record.nextReviewAt).getTime();
      if (overdueA !== overdueB) return overdueB - overdueA;
      if (a.record.lapseCount !== b.record.lapseCount) return b.record.lapseCount - a.record.lapseCount;
      var recallA = recallProbability(a.entry.id, now); var recallB = recallProbability(b.entry.id, now);
      if (recallA !== recallB) return recallA - recallB;
      if (a.record.fsrsCard.difficulty !== b.record.fsrsCard.difficulty) return b.record.fsrsCard.difficulty - a.record.fsrsCard.difficulty;
      var lastA = validDate(a.record.lastReviewedAt || a.record.lastSeenAt); var lastB = validDate(b.record.lastReviewedAt || b.record.lastSeenAt);
      if (lastA && lastB && lastA.getTime() !== lastB.getTime()) return lastA - lastB;
      return a.entry.sourceOrder - b.entry.sourceOrder;
    });
  }
  function getStarredEntryIds() {
    return Object.keys(load().words).filter(function(id) { return !!load().words[id].isStarred && !!WordTales.Data.getEntry(id); });
  }
  function trackArticle(columnId) {
    if (!ready) { pending.push(function() { trackArticle(columnId); }); return; }
    if (!columnIndex[columnId]) return;
    var record = load().articles[columnId] || { firstViewed: nowIso(), lastViewed: '', viewCount: 0, lastViewedDay: '' };
    record.lastViewed = nowIso();
    if (record.lastViewedDay !== dayKey()) { record.viewCount++; record.lastViewedDay = dayKey(); ensureDay().articles++; }
    load().articles[columnId] = record; saveSoon();
  }
  function trackAnalysis(paragraphId) {
    if (!ready) { pending.push(function() { trackAnalysis(paragraphId); }); return; }
    if (!paragraphIndex[paragraphId]) return;
    var record = load().analyses[paragraphId] || { firstOpened: nowIso(), lastOpened: '', openCount: 0 };
    record.lastOpened = nowIso(); record.openCount++; load().analyses[paragraphId] = record; ensureDay().analyses++; saveSoon();
  }
  function navigateTo(item) {
    closeDashboard();
    window.location.hash = item.column.id;
  }
  function groupDueColumns(due) {
    var grouped = Object.create(null);
    due.forEach(function(item) {
      var id = item.column.id;
      if (!grouped[id]) grouped[id] = { set: item.set, column: item.column, count: 0 };
      grouped[id].count++;
    });
    return Object.keys(grouped).map(function(id) { return grouped[id]; }).sort(function(a, b) { return b.count - a.count; });
  }
  function formatPercent(value) { return value == null || isNaN(value) ? '—' : Math.round(value * 100) + '%'; }
  function renderHeatmap() {
    var grid = panel && panel.querySelector('#memoryHeatmap'); if (!grid) return;
    grid.innerHTML = '';
    var setId = panel.querySelector('#heatmapSet').value;
    var set = WordTales.Data.getSet(setId) || WordTales.Data.sets[0];
    set.columns.forEach(function(column) {
      column.words.forEach(function(word) {
        var state = memoryState(word.id); var probability = recallProbability(word.id);
        var cell = document.createElement('button'); cell.type = 'button'; cell.className = 'memory-cell ' + state; cell.textContent = word.word;
        var sub = document.createElement('span'); sub.textContent = state === 'gray' ? column.title + ' · 未学习' : column.title + ' · ' + formatPercent(probability); cell.appendChild(sub);
        cell.addEventListener('click', function() { navigateTo({ column: column }); }); grid.appendChild(cell);
      });
    });
  }
  function renderDashboard() {
    if (!panel) return;
    var due = getDueEntries(new Date()); var grouped = groupDueColumns(due);
    var learned = Object.keys(load().words).filter(function(id) { return !!WordTales.Data.getEntry(id); });
    var probabilities = learned.map(function(id) { return recallProbability(id); }).filter(function(value) { return value != null; });
    var average = probabilities.length ? probabilities.reduce(function(sum, value) { return sum + value; }, 0) / probabilities.length : null;
    panel.innerHTML = '<div class="progress-panel-head"><div><p class="progress-eyebrow">Article learning pulse</p><h2>你的学习进度</h2><p class="progress-date">到期时间按当前时刻计算 · ' + (persistenceMode === 'indexedDB' ? 'IndexedDB 已保存' : '本地存储降级模式') + '</p></div><button type="button" class="progress-close" aria-label="关闭进度面板">×</button></div>' +
      '<div class="progress-kpis"><div class="progress-kpi"><div class="progress-kpi-value">' + learned.length + '</div><div class="progress-kpi-label">已进入学习计划</div></div><div class="progress-kpi"><div class="progress-kpi-value">' + due.length + '</div><div class="progress-kpi-label">当前已到期</div></div><div class="progress-kpi"><div class="progress-kpi-value">' + formatPercent(average) + '</div><div class="progress-kpi-label">FSRS 平均回忆率</div></div><div class="progress-kpi"><div class="progress-kpi-value">' + getStarredEntryIds().length + '</div><div class="progress-kpi-label">当前生词</div></div></div>' +
      '<section class="progress-section"><div class="progress-section-head"><div><h3>到期栏目</h3><p class="progress-section-note">逾期越久、遗忘越多的词优先</p></div></div><div class="progress-plan-card"><ul class="progress-plan-list column-plan-list" id="duePlan"></ul></div></section>' +
      '<section class="progress-section"><div class="progress-section-head"><div><h3>记忆热力图</h3><p class="progress-section-note">基于 FSRS 当前回忆概率</p></div><div class="heatmap-controls"><label for="heatmapSet">词集</label><select id="heatmapSet"></select></div></div><div class="memory-legend"><span><i class="memory-dot green"></i>稳定</span><span><i class="memory-dot yellow"></i>即将到期</span><span><i class="memory-dot red"></i>已到期或遗忘</span><span><i class="memory-dot gray"></i>未学习</span></div><div class="memory-heatmap" id="memoryHeatmap"></div><p class="progress-footnote">文章点读和词卡翻面记录学习接触；游戏中的熟悉与不熟悉会更新 FSRS 复习状态。数据仅保存在当前浏览器。</p></section>';
    panel.querySelector('.progress-close').addEventListener('click', closeDashboard);
    var list = panel.querySelector('#duePlan');
    if (!grouped.length) { var empty = document.createElement('li'); empty.className = 'progress-empty'; empty.textContent = '当前没有已到期单词。'; list.appendChild(empty); }
    grouped.forEach(function(item) {
      var li = document.createElement('li'); var button = document.createElement('button'); button.type = 'button'; button.className = 'progress-plan-item'; button.textContent = item.set.label + ' · ' + item.column.title;
      var small = document.createElement('small'); small.textContent = item.count + ' 个到期词'; button.appendChild(small); button.addEventListener('click', function() { navigateTo(item); }); li.appendChild(button); list.appendChild(li);
    });
    var select = panel.querySelector('#heatmapSet');
    WordTales.Data.sets.forEach(function(set) { var option = document.createElement('option'); option.value = set.id; option.textContent = set.label + ' · ' + WordTales.Data.countWords(set) + '词'; select.appendChild(option); });
    var active = document.querySelector('.set-content.active'); select.value = active && WordTales.Data.getSet(active.id) ? active.id : WordTales.Data.sets[0].id;
    select.addEventListener('change', renderHeatmap); renderHeatmap();
  }
  function buildDashboard() {
    overlay = document.createElement('div'); overlay.className = 'progress-overlay'; overlay.setAttribute('role', 'dialog'); overlay.setAttribute('aria-modal', 'true'); overlay.setAttribute('aria-label', '学习进度');
    overlay.setAttribute('tabindex', '-1');
    panel = document.createElement('div'); panel.className = 'progress-panel'; overlay.appendChild(panel); overlay.addEventListener('mousedown', function(event) { if (event.target === overlay) closeDashboard(); }); overlay.addEventListener('keydown', handleDashboardKeydown); document.body.appendChild(overlay);
  }
  function setBackgroundInert(inert) {
    document.querySelectorAll('.library-view').forEach(function(element) { element.inert = inert; });
  }
  function dashboardFocusables() {
    if (!overlay) return [];
    return Array.prototype.filter.call(overlay.querySelectorAll('button, select, [href], [tabindex]:not([tabindex="-1"])'), function(element) {
      return !element.disabled && element.getClientRects().length > 0;
    });
  }
  function handleDashboardKeydown(event) {
    if (!overlay || !overlay.classList.contains('active')) return;
    if (event.key === 'Escape') { event.preventDefault(); closeDashboard(); return; }
    if (event.key !== 'Tab') return;
    var focusables = dashboardFocusables();
    if (!focusables.length) { event.preventDefault(); overlay.focus(); return; }
    var first = focusables[0]; var last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
  function openDashboard() {
    if (!ready) { pending.push(openDashboard); return; }
    if (!overlay) buildDashboard();
    dashboardPreviousFocus = document.activeElement;
    renderDashboard(); overlay.classList.add('active'); setBackgroundInert(true); document.body.style.overflow = 'hidden';
    setTimeout(function() { if (!overlay || !overlay.classList.contains('active')) return; var focusables = dashboardFocusables(); (focusables[0] || overlay).focus(); }, 0);
  }
  function closeDashboard() {
    if (!overlay || !overlay.classList.contains('active')) return;
    overlay.classList.remove('active'); setBackgroundInert(false); document.body.style.overflow = '';
    var previous = dashboardPreviousFocus; dashboardPreviousFocus = null;
    if (previous && previous.isConnected && typeof previous.focus === 'function') previous.focus();
  }
  function refreshOpenDashboard() { if (overlay && overlay.classList.contains('active')) renderDashboard(); }
  function observeArticles() {
    if (!('IntersectionObserver' in window)) return;
    articleObserver = new IntersectionObserver(function(entries) { entries.forEach(function(entry) { if (entry.isIntersecting && entry.intersectionRatio >= .25) { var section = entry.target.closest('.column-section'); if (section) trackArticle(section.id); } }); }, { threshold: [.25] });
    document.querySelectorAll('.essay-block').forEach(function(block) { articleObserver.observe(block); });
  }
  function init() {
    buildIndexes(); load();
    document.querySelectorAll('.progress-entry').forEach(function(entry) { entry.disabled = true; entry.setAttribute('aria-busy', 'true'); entry.addEventListener('click', openDashboard); });
    return hydrate().then(function() {
      migrateLegacyStars(); ready = true;
      document.querySelectorAll('.progress-entry').forEach(function(entry) { entry.disabled = false; entry.removeAttribute('aria-busy'); });
      var queued = pending.slice(); pending = []; queued.forEach(function(operation) { operation(); }); observeArticles();
      window.addEventListener('pagehide', function() { if (saveTimer) clearTimeout(saveTimer); writeProfileNow().catch(function() {}); });
      return api;
    });
  }
  var api = {
    init: init,
    open: openDashboard,
    close: closeDashboard,
    trackWord: trackWord,
    trackArticle: trackArticle,
    trackAnalysis: trackAnalysis,
    rateWord: rateWord,
    getDueEntries: getDueEntries,
    getEntryState: getEntryState,
    getStarredEntryIds: getStarredEntryIds,
    setStarred: setStarred,
    recallProbability: recallProbability,
    memoryState: memoryState,
    getData: function() { return load(); },
    getDayKey: dayKey,
    isReady: function() { return ready; },
    getPersistenceMode: function() { return persistenceMode; }
  };
  return api;
})();
