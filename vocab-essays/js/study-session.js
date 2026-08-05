/* ============================================================
 * Module: StudySession
 * 打开即学的单卡主页、20 词轮次、每日 40 新词与中断恢复。
 * ============================================================ */
WordTales.StudySession = (function() {
  var STORAGE_KEY = 'wordtales.study-session.v1';
  var ROUND_LIMIT = 20;
  var DAILY_NEW_LIMIT = 40;
  var stage = null;
  var state = null;
  var active = false;
  var runtimeAudioActivated = false;
  var submitting = false;

  function nowIso() { return new Date().toISOString(); }
  function unique(values) {
    var seen = Object.create(null);
    return (values || []).filter(function(value) { if (!value || seen[value]) return false; seen[value] = true; return true; });
  }
  function emptyDaily() {
    return { date: WordTales.LearningProgress.getDayKey(), completedIds: [], newCompletedIds: [], good: 0, hard: 0, again: 0 };
  }
  function freshState() {
    return { version: 1, daily: emptyDaily(), round: null, lastCompletedRound: null, articleReview: null, audioActivated: false };
  }
  function loadState() {
    var value = null;
    try { value = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch (e) {}
    if (!value || value.version !== 1) value = freshState();
    value.daily = value.daily || emptyDaily();
    if (value.daily.date !== WordTales.LearningProgress.getDayKey()) value.daily = emptyDaily();
    value.daily.completedIds = unique(value.daily.completedIds);
    value.daily.newCompletedIds = unique(value.daily.newCompletedIds);
    value.daily.good = Number(value.daily.good) || 0;
    value.daily.hard = Number(value.daily.hard) || 0;
    value.daily.again = Number(value.daily.again) || 0;
    return value;
  }
  function saveState() {
    state.audioActivated = runtimeAudioActivated;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); return true; } catch (e) { return false; }
  }
  function makeId() { return 'round-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9); }
  function itemSnapshot(entry, occurrence, kind) {
    var context = entry.contexts.filter(function(item) { return item.occurrenceId === occurrence.id; })[0] || entry.contexts[0] || {};
    return {
      entryId: entry.id,
      occurrenceId: occurrence.id,
      kind: kind,
      word: entry.word,
      pos: entry.pos,
      meaning: entry.meaning,
      setId: occurrence.set.id,
      setLabel: occurrence.set.label,
      columnId: occurrence.column.id,
      columnTitle: occurrence.column.title,
      paragraphId: context.paragraphId || occurrence.paragraphId || '',
      contextSentence: context.sentence || occurrence.contextSentence || '',
      sourceOrder: entry.sourceOrder
    };
  }
  function weightedMerge(reviewItems, newItems) {
    var output = []; var reviewIndex = 0; var newIndex = 0;
    while (reviewIndex < reviewItems.length || newIndex < newItems.length) {
      var chooseReview = reviewIndex < reviewItems.length && (newIndex >= newItems.length || reviewIndex / Math.max(1, reviewItems.length) <= newIndex / Math.max(1, newItems.length));
      output.push(chooseReview ? reviewItems[reviewIndex++] : newItems[newIndex++]);
    }
    return output;
  }
  function generateRound() {
    var excluded = Object.create(null);
    state.daily.completedIds.forEach(function(id) { excluded[id] = true; });
    var due = WordTales.LearningProgress.getDueEntries(new Date()).filter(function(item) { return !excluded[item.entry.id]; });
    var dueItems = due.slice(0, ROUND_LIMIT).map(function(item) { return itemSnapshot(item.entry, item.occurrence, 'review'); });
    var newItems = [];
    if (dueItems.length < ROUND_LIMIT) {
      var allowance = Math.max(0, DAILY_NEW_LIMIT - state.daily.newCompletedIds.length);
      var needed = Math.min(ROUND_LIMIT - dueItems.length, allowance);
      WordTales.Data.getAllEntries().some(function(entry) {
        if (!needed) return true;
        if (excluded[entry.id] || WordTales.LearningProgress.getEntryState(entry.id)) return false;
        var occurrence = WordTales.Data.getOccurrence(entry.primaryOccurrenceId) || entry.occurrences[0];
        newItems.push(itemSnapshot(entry, occurrence, 'new'));
        excluded[entry.id] = true;
        needed--;
        return false;
      });
    }
    var queue = weightedMerge(dueItems, newItems);
    if (!queue.length) { state.round = null; saveState(); return null; }
    state.round = {
      id: makeId(),
      createdAt: nowIso(),
      queue: queue,
      cursor: 0,
      phase: 'prompt',
      results: {},
      finished: false,
      counts: { Good: 0, Hard: 0, Again: 0, newCount: newItems.length, reviewCount: dueItems.length }
    };
    saveState();
    return state.round;
  }
  function firstUnfinishedIndex(round) {
    for (var index = 0; index < round.queue.length; index++) {
      if (!round.results[round.queue[index].entryId]) return index;
    }
    return round.queue.length;
  }
  function restoreRound() {
    var round = state.round;
    if (!round || !Array.isArray(round.queue) || !round.queue.length) return generateRound();
    if (round.finished) return round;
    round.results = round.results || {};
    var savedCursor = Math.max(0, Math.min(Number(round.cursor) || 0, round.queue.length - 1));
    var savedItem = round.queue[savedCursor];
    if (round.phase === 'answer' && savedItem && round.results[savedItem.entryId]) {
      round.cursor = savedCursor;
      saveState();
      return round;
    }
    var unfinished = firstUnfinishedIndex(round);
    if (unfinished >= round.queue.length) {
      round.finished = true;
      return round;
    }
    round.cursor = unfinished;
    round.phase = round.results[round.queue[round.cursor].entryId] ? 'answer' : (round.phase === 'hint' ? 'hint' : 'prompt');
    saveState();
    return round;
  }
  function clearStage() { while (stage.firstChild) stage.removeChild(stage.firstChild); }
  function element(tag, className, text) {
    var node = document.createElement(tag); if (className) node.className = className; if (text != null) node.textContent = text; return node;
  }
  function button(className, text, handler) {
    var node = element('button', className, text); node.type = 'button'; node.addEventListener('click', function(event) { activateAudio(); handler(event); }); return node;
  }
  function activateAudio() { runtimeAudioActivated = true; state.audioActivated = true; saveState(); }
  function speak(word) {
    activateAudio();
    try { if (WordTales.Reader && WordTales.Reader.speakWord) WordTales.Reader.speakWord(word); } catch (e) {}
  }
  function appendHighlightedSentence(container, sentence, word) {
    var source = String(sentence || '');
    var index = source.toLowerCase().indexOf(String(word || '').toLowerCase());
    if (index < 0) { container.textContent = source; return; }
    container.appendChild(document.createTextNode(source.slice(0, index)));
    var mark = element('mark', 'study-context-word', source.slice(index, index + word.length)); container.appendChild(mark);
    container.appendChild(document.createTextNode(source.slice(index + word.length)));
  }
  function sourceLabel(item) { return item.setLabel + ' · ' + item.columnTitle; }
  function renderProgress(shell, round) {
    var head = element('div', 'study-progress-row');
    var label = element('span', 'study-progress-copy', Math.min(round.cursor + 1, round.queue.length) + ' / ' + round.queue.length); head.appendChild(label);
    var type = round.queue[round.cursor] ? round.queue[round.cursor].kind : '';
    head.appendChild(element('span', 'study-progress-kind ' + type, type === 'review' ? '复习' : '新词'));
    shell.appendChild(head);
    var track = element('div', 'study-progress-track'); var fill = element('span', 'study-progress-fill'); fill.style.width = Math.round((round.cursor / round.queue.length) * 100) + '%'; track.appendChild(fill); shell.appendChild(track);
  }
  function renderWordHeader(card, item) {
    card.appendChild(element('p', 'study-source', sourceLabel(item)));
    var wordLine = element('div', 'study-word-line');
    wordLine.appendChild(element('h1', 'study-word', item.word));
    var audio = button('study-audio', '🔊', function() { speak(item.word); }); audio.setAttribute('aria-label', '播放 ' + item.word + ' 的发音'); wordLine.appendChild(audio);
    card.appendChild(wordLine);
  }
  function renderCurrent() {
    if (!active || !stage) return;
    var round = state.round;
    if (!round) { renderDone(); return; }
    if (round.finished || round.cursor >= round.queue.length) { renderSummary(round); return; }
    var item = round.queue[round.cursor]; var result = round.results[item.entryId];
    clearStage(); var shell = element('div', 'study-session-shell'); renderProgress(shell, round);
    var card = element('article', 'study-card'); renderWordHeader(card, item);
    if (round.phase === 'hint') renderHint(card, item);
    else if (round.phase === 'answer' || result) renderAnswer(card, item, result);
    else renderPrompt(card, item);
    shell.appendChild(card); stage.appendChild(shell);
  }
  function renderPrompt(card, item) {
    card.appendChild(element('p', 'study-instruction', '先在心里回忆它的含义'));
    var actions = element('div', 'study-actions two');
    actions.appendChild(button('study-btn primary', '我认识', function() { submitRating(item, 'Good'); }));
    actions.appendChild(button('study-btn secondary', '提示一下', function() { state.round.phase = 'hint'; saveState(); renderCurrent(); }));
    card.appendChild(actions);
  }
  function renderHint(card, item) {
    var context = element('blockquote', 'study-context'); appendHighlightedSentence(context, item.contextSentence, item.word); card.appendChild(context);
    card.appendChild(element('p', 'study-instruction', '借助语境，你想起它了吗？'));
    var actions = element('div', 'study-actions two');
    actions.appendChild(button('study-btn primary', '想起来了', function() { submitRating(item, 'Hard'); }));
    actions.appendChild(button('study-btn danger', '没想起来', function() { submitRating(item, 'Again'); }));
    card.appendChild(actions);
  }
  function formatReviewDate(value) {
    var date = value ? new Date(value) : null; if (!date || isNaN(date.getTime())) return '待计算';
    try { return new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date); } catch (e) { return date.toLocaleString(); }
  }
  function ratingCopy(rating) { return rating === 'Good' ? '我认识 · Good' : rating === 'Hard' ? '想起来了 · Hard' : '没想起来 · Again'; }
  function renderAnswer(card, item, result) {
    result = result || {};
    var badge = element('p', 'study-result ' + String(result.rating || '').toLowerCase(), ratingCopy(result.rating)); card.appendChild(badge);
    var definition = element('div', 'study-definition');
    definition.appendChild(element('span', 'study-pos', item.pos)); definition.appendChild(element('p', 'study-meaning', item.meaning)); card.appendChild(definition);
    var context = element('blockquote', 'study-context answer'); appendHighlightedSentence(context, item.contextSentence, item.word); card.appendChild(context);
    var meta = element('div', 'study-answer-meta');
    meta.appendChild(element('span', '', '下次复习：' + formatReviewDate(result.nextReviewAt)));
    meta.appendChild(element('span', '', '连续记对：' + (result.successStreak || 0) + ' 次'));
    meta.appendChild(element('span', '', result.isStarred ? '★ 已加入生词' : '未加入生词'));
    card.appendChild(meta);
    if (result.saved === false) card.appendChild(element('p', 'study-save-warning', '本次进度暂未保存，但可以继续学习。'));
    var next = button('study-btn primary wide', '下一个', nextCard); card.appendChild(next);
  }
  function roundIsLast() { return state.round.cursor >= state.round.queue.length - 1; }
  function submitRating(item, rating) {
    if (submitting || state.round.results[item.entryId]) return;
    submitting = true; renderSubmitting(true);
    var submissionId = state.round.id + ':' + item.entryId + ':' + state.round.cursor;
    WordTales.LearningProgress.rateWord(item.entryId, rating, { source: 'study-home', occurrenceId: item.occurrenceId, columnId: item.columnId, kind: item.kind }, submissionId).then(function(record) {
      var result = {
        rating: rating,
        answeredAt: nowIso(),
        nextReviewAt: record ? record.nextReviewAt : '',
        successStreak: record ? record.successStreak : 0,
        isStarred: record ? record.isStarred : rating === 'Again',
        saved: !record || record.saved !== false,
        kind: item.kind
      };
      state.round.results[item.entryId] = result;
      state.round.counts[rating]++;
      state.round.phase = 'answer';
      state.daily.completedIds = unique(state.daily.completedIds.concat(item.entryId));
      if (item.kind === 'new') state.daily.newCompletedIds = unique(state.daily.newCompletedIds.concat(item.entryId));
      state.daily[rating.toLowerCase()]++;
      saveState(); submitting = false; renderCurrent();
    }).catch(function() {
      submitting = false; renderSubmitting(false);
      var warning = stage.querySelector('.study-save-warning'); if (!warning) { warning = element('p', 'study-save-warning', '本次进度暂未保存，请再试一次。'); stage.querySelector('.study-card').appendChild(warning); }
    });
  }
  function renderSubmitting(busy) {
    stage.querySelectorAll('button').forEach(function(node) { node.disabled = !!busy; });
    var card = stage.querySelector('.study-card'); var existing = card && card.querySelector('.study-saving');
    if (busy && card && !existing) card.appendChild(element('p', 'study-saving', '正在保存…'));
    if (!busy && existing) existing.remove();
  }
  function nextCard() {
    if (submitting) return;
    var shouldSpeak = runtimeAudioActivated;
    if (state.round.cursor >= state.round.queue.length - 1) {
      state.round.finished = true; state.lastCompletedRound = JSON.parse(JSON.stringify(state.round)); saveState(); renderSummary(state.round); return;
    }
    state.round.cursor++; state.round.phase = 'prompt'; saveState(); renderCurrent();
    if (shouldSpeak) { var item = state.round.queue[state.round.cursor]; setTimeout(function() { try { WordTales.Reader.speakWord(item.word); } catch (e) {} }, 120); }
  }
  function summaryMetric(label, value, className) {
    var node = element('div', 'study-summary-metric ' + (className || '')); node.appendChild(element('strong', '', String(value))); node.appendChild(element('span', '', label)); return node;
  }
  function sourceGroups(round) {
    var groups = Object.create(null);
    round.queue.forEach(function(item) {
      if (!groups[item.columnId]) groups[item.columnId] = { columnId: item.columnId, label: sourceLabel(item), count: 0, again: 0 };
      groups[item.columnId].count++;
      if (round.results[item.entryId] && round.results[item.entryId].rating === 'Again') groups[item.columnId].again++;
    });
    return Object.keys(groups).map(function(id) { return groups[id]; });
  }
  function renderArticleChoices(container, round) {
    var groups = sourceGroups(round); if (!groups.length) return;
    container.appendChild(element('h3', 'study-subheading', '在原文中巩固'));
    var list = element('div', 'study-article-list');
    groups.forEach(function(group) {
      var item = button('study-article-link', '', function() { openArticleReview(group.columnId, round); });
      item.appendChild(element('strong', '', group.label)); item.appendChild(element('span', '', group.count + ' 词' + (group.again ? ' · ' + group.again + ' 个没想起' : ''))); list.appendChild(item);
    });
    container.appendChild(list);
  }
  function renderSummary(round) {
    clearStage();
    var total = round.queue.length; var correct = round.counts.Good + round.counts.Hard; var rate = total ? Math.round(correct / total * 100) : 0;
    var shell = element('div', 'study-summary'); shell.appendChild(element('p', 'study-summary-eyebrow', 'Round complete')); shell.appendChild(element('h1', '', '这一轮完成了'));
    shell.appendChild(element('p', 'study-summary-lead', '正确回忆率 ' + rate + '% · Good 与 Hard 使用不同的复习间隔'));
    var grid = element('div', 'study-summary-grid'); grid.appendChild(summaryMetric('本轮完成', total)); grid.appendChild(summaryMetric('直接认识', round.counts.Good, 'good')); grid.appendChild(summaryMetric('提示后想起', round.counts.Hard, 'hard')); grid.appendChild(summaryMetric('没想起来', round.counts.Again, 'again')); grid.appendChild(summaryMetric('新学习', round.counts.newCount)); grid.appendChild(summaryMetric('到期复习', round.counts.reviewCount)); grid.appendChild(summaryMetric('当前生词', WordTales.LearningProgress.getStarredEntryIds().length)); shell.appendChild(grid);
    var actions = element('div', 'study-summary-actions'); actions.appendChild(button('study-btn primary', '继续下一轮', continueRound)); actions.appendChild(element('a', 'study-btn secondary', '文章学习')); actions.lastChild.href = '#library'; shell.appendChild(actions);
    renderArticleChoices(shell, round); stage.appendChild(shell);
  }
  function continueRound() {
    if (state.round && state.round.finished) state.lastCompletedRound = JSON.parse(JSON.stringify(state.round));
    state.round = null; generateRound(); renderCurrent();
  }
  function tomorrowDueCount() {
    var tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1); tomorrow.setHours(0, 0, 0, 0); var end = new Date(tomorrow); end.setHours(23, 59, 59, 999);
    return Object.keys(WordTales.LearningProgress.getData().words || {}).filter(function(id) { var record = WordTales.LearningProgress.getData().words[id]; var due = new Date(record.nextReviewAt); return record.nextReviewAt && due >= tomorrow && due <= end; }).length;
  }
  function renderDone() {
    clearStage();
    var unlearned = WordTales.Data.getAllEntries().filter(function(entry) { return !WordTales.LearningProgress.getEntryState(entry.id); }).length;
    var reachedLimit = state.daily.newCompletedIds.length >= DAILY_NEW_LIMIT;
    var shell = element('div', 'study-summary done'); shell.appendChild(element('p', 'study-summary-eyebrow', 'Today complete')); shell.appendChild(element('h1', '', '今天的单词学习已完成'));
    shell.appendChild(element('p', 'study-summary-lead', unlearned && reachedLimit ? '今天的复习和新词任务已经完成，词库中仍有未学习单词。' : unlearned ? '当前没有可学习单词。' : '今天没有到期单词，全部单词都已经进入学习计划。'));
    var grid = element('div', 'study-summary-grid'); grid.appendChild(summaryMetric('今天学习', state.daily.completedIds.length)); grid.appendChild(summaryMetric('直接认识', state.daily.good, 'good')); grid.appendChild(summaryMetric('提示后想起', state.daily.hard, 'hard')); grid.appendChild(summaryMetric('没想起来', state.daily.again, 'again')); grid.appendChild(summaryMetric('明天预计复习', tomorrowDueCount())); grid.appendChild(summaryMetric('当前生词', WordTales.LearningProgress.getStarredEntryIds().length)); shell.appendChild(grid);
    var link = element('a', 'study-btn secondary wide', '文章学习'); link.href = '#library'; shell.appendChild(link); stage.appendChild(shell);
  }
  function openArticleReview(columnId, round) {
    var sourceRound = round || state.lastCompletedRound || state.round; if (!sourceRound) { window.location.hash = columnId; return; }
    state.articleReview = { roundId: sourceRound.id, columnId: columnId, items: sourceRound.queue.filter(function(item) { return item.columnId === columnId; }).map(function(item) { return { occurrenceId: item.occurrenceId, entryId: item.entryId, rating: sourceRound.results[item.entryId] ? sourceRound.results[item.entryId].rating : '' }; }) };
    saveState(); window.location.hash = columnId;
  }
  function applyArticleHighlights() {
    document.querySelectorAll('.study-round-good,.study-round-hard,.study-round-again').forEach(function(node) { node.classList.remove('study-round-good', 'study-round-hard', 'study-round-again'); });
    var review = state && state.articleReview; if (!review) return;
    review.items.forEach(function(item) {
      var className = item.rating === 'Again' ? 'study-round-again' : item.rating === 'Hard' ? 'study-round-hard' : 'study-round-good';
      document.querySelectorAll('.essay-block [data-vocab-id="' + item.occurrenceId + '"]').forEach(function(node) { node.classList.add(className); });
    });
  }
  function activate() {
    active = true; document.body.classList.add('study-mode'); document.body.classList.remove('library-mode');
    runtimeAudioActivated = false;
    try { if (WordTales.Reader) WordTales.Reader.stop(); } catch (e) {}
    restoreRound(); renderCurrent();
  }
  function deactivate() {
    active = false; runtimeAudioActivated = false; state.audioActivated = false; saveState();
    try { if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel(); } catch (e) {}
  }
  function init() {
    stage = document.getElementById('studyStage'); state = loadState(); runtimeAudioActivated = false;
    document.addEventListener('visibilitychange', function() { if (document.hidden) { runtimeAudioActivated = false; state.audioActivated = false; saveState(); } });
    return api;
  }
  var api = { init: init, activate: activate, deactivate: deactivate, generateRound: generateRound, openArticleReview: openArticleReview, applyArticleHighlights: applyArticleHighlights };
  return api;
})();
