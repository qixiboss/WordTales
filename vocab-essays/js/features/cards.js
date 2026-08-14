/* ============================================================
 * Cards：词汇翻卡与专栏工具栏
 *
 * 把 Renderer 的三段静态文字改造成可访问的 3D 双面卡；专栏头部提供
 * 英文/自定义/释义显示策略、“今日完成”按钮以及游戏、抄写入口。
 * ============================================================ */
WordTales.Features = WordTales.Features || {};
WordTales.Features.Cards = (function() {
function initFlipCards(root) {
(root || document).querySelectorAll('.vocab-card').forEach(function(card){
if (card.querySelector('.card-inner')) return;
var vw = card.querySelector('.vw');
var vp = card.querySelector('.vp');
var vm = card.querySelector('.vm');
var star = card.querySelector('.vocab-card-star');
if (!vw) return;
var inner = document.createElement('div');
inner.className = 'card-inner';
var front = document.createElement('div');
front.className = 'card-face card-front';
front.appendChild(vw.cloneNode(true));
var back = document.createElement('div');
back.className = 'card-face card-back';
back.appendChild(vw.cloneNode(true));
if (vp) back.appendChild(vp.cloneNode(true));
if (vm) {
var line = document.createElement('div');
line.appendChild(vm.cloneNode(true));
back.appendChild(line);
}
while (card.firstChild) card.removeChild(card.firstChild);
inner.appendChild(front);
inner.appendChild(back);
// 星标放在 DOM 的第一个位置：Tab 会先聚焦右上角标记，再进入翻卡控件。
if (star) card.appendChild(star);
card.appendChild(inner);
// 翻转控件放在 card-inner，避免外层“按钮”再嵌套星标按钮。
inner.setAttribute('role', 'button');
inner.setAttribute('tabindex', '0');
inner.setAttribute('aria-pressed', 'false');
inner.setAttribute('aria-label', vw.textContent.trim() + '，单词卡片，按回车或空格键翻转');
function toggleCard() {
// 每次人为翻面都算一次接触；批量显示模式只改 DOM，不污染个人学习记录。
card.classList.toggle('flipped');
inner.setAttribute('aria-pressed', card.classList.contains('flipped') ? 'true' : 'false');
if (card.dataset.vocabId) {
WordTales.LearningProgress.trackWord(card.dataset.vocabId, 'card', {
columnId: card.closest('.column-section') ? card.closest('.column-section').id : '',
occurrenceId: card.dataset.vocabId
});
}
}
inner.addEventListener('click', function(e){
toggleCard();
});
inner.addEventListener('keydown', function(e){
if (e.key === 'Enter' || e.key === ' ') {
e.preventDefault();
toggleCard();
}
});
if (star) {
WordTales.Features.Progress.setCardStarState(card, WordTales.Features.Progress.has(vw.textContent.trim(), card.dataset.vocabId));
star.addEventListener('click', function(e){
// 星标点击不能触发外层卡片翻面。
e.preventDefault();
e.stopPropagation();
var starred = !WordTales.Features.Progress.has(vw.textContent.trim(), card.dataset.vocabId);
WordTales.LearningProgress.setStarred(card.dataset.vocabId, starred, starred ? 'manual' : '');
WordTales.Features.Progress.setCardStarState(card, starred);
});
star.addEventListener('keydown', function(e){
// Enter/Space 在按钮上只操作星标，不交给外层词卡的翻转快捷键。
e.stopPropagation();
});
}
});
}

function initFlipToggles(root) {
/*
 * “英文 / 自定义 / 释义”是专栏级显示策略：
 * 英文和释义统一全部卡面；自定义保留每张卡现状，便于逐词自测。
 */
(root || document).querySelectorAll('.column-section').forEach(function(section){
var head = section.querySelector('.section-head');
if (!head) return;
if (head.querySelector('.flip-toggle')) return;
var toggle = document.createElement('div');
toggle.className = 'flip-toggle';
var btnEn = document.createElement('button');
btnEn.type = 'button';
btnEn.textContent = '英文';
btnEn.dataset.mode = 'front';
var btnCustom = document.createElement('button');
btnCustom.type = 'button';
btnCustom.textContent = '自定义';
btnCustom.dataset.mode = 'custom';
btnCustom.classList.add('active');
var btnCn = document.createElement('button');
btnCn.type = 'button';
btnCn.textContent = '释义';
btnCn.dataset.mode = 'back';
toggle.appendChild(btnEn);
toggle.appendChild(btnCustom);
toggle.appendChild(btnCn);
head.appendChild(toggle);
toggle.setAttribute('role', 'group');
toggle.setAttribute('aria-label', '词卡显示方式');
toggle.querySelectorAll('button').forEach(function(button){
button.setAttribute('aria-pressed', button.classList.contains('active') ? 'true' : 'false');
});
toggle.querySelectorAll('button').forEach(function(btn){
btn.addEventListener('click', function(){
toggle.querySelectorAll('button').forEach(function(b){
b.classList.remove('active');
b.setAttribute('aria-pressed', 'false');
});
btn.classList.add('active');
btn.setAttribute('aria-pressed', 'true');
var mode = btn.dataset.mode;
var cards = section.querySelectorAll('.vocab-card');
if (mode === 'front') {
cards.forEach(function(c){
c.classList.remove('flipped');
var flipControl = c.querySelector('.card-inner');
if (flipControl) flipControl.setAttribute('aria-pressed', 'false');
});
} else if (mode === 'back') {
cards.forEach(function(c){
c.classList.add('flipped');
var flipControl = c.querySelector('.card-inner');
if (flipControl) flipControl.setAttribute('aria-pressed', 'true');
});
}
});
});
var completionButton = document.createElement('button');
completionButton.type = 'button';
completionButton.className = 'column-complete-btn';
completionButton.dataset.columnId = section.id;
completionButton.setAttribute('aria-live', 'off');
var completionStatus = document.createElement('span');
completionStatus.className = 'column-complete-status visually-hidden';
completionStatus.setAttribute('role', 'status');
completionStatus.setAttribute('aria-live', 'polite');
head.appendChild(completionButton);
head.appendChild(completionStatus);

function completionDateKey() {
var progress = WordTales.LearningProgress;
if (progress && progress.getDayKey) return progress.getDayKey(new Date());
var today = new Date();
return today.getFullYear() + '-' + ('0' + (today.getMonth() + 1)).slice(-2) + '-' + ('0' + today.getDate()).slice(-2);
}
function updateCompletionButton(completed) {
WordTales.Features.Progress.setColumnCompletionButtonState(completionButton, completed);
}
function announceCompletion(message, error) {
completionStatus.textContent = message;
completionStatus.classList.toggle('is-error', !!error);
}
function saveCompletion() {
var progress = WordTales.LearningProgress;
var dateKey = completionDateKey();
if (!progress || !progress.isReady || !progress.isReady()) {
announceCompletion('学习记录尚未准备好，请稍后重试', true);
return;
}
var requested = !progress.isColumnCompleted(section.id, dateKey);
var restoreFocus = document.activeElement === completionButton;
completionButton.disabled = true;
completionButton.classList.add('is-saving');
completionButton.setAttribute('aria-busy', 'true');
announceCompletion('正在保存今天的学习记录');
progress.setColumnCompleted(section.id, dateKey, requested).then(function(result) {
var completed = !!result.completed;
updateCompletionButton(completed);
if (result.saved) {
announceCompletion(completed ? '已记录今天完成' : '已取消今天的完成记录');
} else {
announceCompletion('学习记录保存失败，请重试', true);
}
if (restoreFocus && completionButton.isConnected) completionButton.focus();
}).catch(function() {
updateCompletionButton(progress.isColumnCompleted(section.id, dateKey));
announceCompletion('学习记录保存失败，请重试', true);
if (restoreFocus && completionButton.isConnected) completionButton.focus();
}).then(function() {
completionButton.disabled = false;
completionButton.classList.remove('is-saving');
completionButton.removeAttribute('aria-busy');
});
}
updateCompletionButton(WordTales.LearningProgress && WordTales.LearningProgress.isColumnCompleted
? WordTales.LearningProgress.isColumnCompleted(section.id, completionDateKey()) : false);
completionButton.addEventListener('click', saveCompletion);
var gameBtn = document.createElement('button');
gameBtn.type = 'button';
gameBtn.className = 'game-btn';
gameBtn.textContent = '游戏';
gameBtn.addEventListener('click', function(){
WordTales.Features.Game.start(section);
});
head.appendChild(gameBtn);
var copyBtn = document.createElement('button');
copyBtn.type = 'button';
copyBtn.className = 'game-btn';
copyBtn.textContent = '抄写';
copyBtn.addEventListener('click', function(){
WordTales.Features.CopyPractice.start(section);
});
head.appendChild(copyBtn);
});
}

return {
init: initFlipCards,
initToolbar: initFlipToggles
};
})();
