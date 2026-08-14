/* ============================================================
 * WordPopup：文章内单词释义弹层
 *
 * 优先用稳定的 data-vocab-id 查 Data；cardMap 和模糊文本匹配只为
 * 兼容旧手写 DOM。弹层挂到 body，可避开文章翻转与 overflow 的裁切上下文。
 * ============================================================ */
WordTales.Features = WordTales.Features || {};
WordTales.Features.WordPopup = (function() {
var _currentClosePopup = null;
var _wordPopupOwnerId = 0;

function closeWordPopups() {
if (_currentClosePopup) {
document.removeEventListener('click', _currentClosePopup);
_currentClosePopup = null;
}
document.querySelectorAll('.word-popup').forEach(function(popup){
var wordId = popup.dataset.ownerWordId;
var owner = wordId ? document.getElementById(wordId) : null;
if (owner) owner.setAttribute('aria-expanded', 'false');
popup.remove();
});
}

function initWordJump(root) {
(root || document).querySelectorAll('.essay-block').forEach(function(block){
var section = block.closest('.column-section');
if (!section) return;
var grid = section.querySelector('.vocab-grid');
if (!grid) return;
var cards = grid.querySelectorAll('.vocab-card');
var cardMap = {};
cards.forEach(function(card){
var w = card.querySelector('.vw');
if (w) {
var key = w.textContent.trim().toLowerCase();
if (!cardMap[key]) {
var vp = card.querySelector('.vp');
var vm = card.querySelector('.vm');
cardMap[key] = {
word: w.textContent.trim(),
pos: vp ? vp.textContent.trim() : '',
meaning: vm ? vm.textContent.trim() : ''
};
}
}
});
block.querySelectorAll('strong.word').forEach(function(wordEl){
if (wordEl.dataset.popupInitialized === 'true') return;
wordEl.dataset.popupInitialized = 'true';
if (!wordEl.id) wordEl.id = 'word-popup-owner-' + (++_wordPopupOwnerId);
wordEl.setAttribute('role', 'button');
wordEl.setAttribute('tabindex', '0');
wordEl.setAttribute('aria-expanded', 'false');
wordEl.setAttribute('aria-label', wordEl.textContent.trim() + '，查看释义并朗读');
wordEl.addEventListener('click', function(e){
e.stopPropagation();
var word = wordEl.textContent.trim().toLowerCase();
var info = WordTales.Data.getWord(wordEl.dataset.vocabId) || cardMap[word];
if (!info) {
for (var k in cardMap) {
if (k.indexOf(word) >= 0 || word.indexOf(k) >= 0) {
info = cardMap[k];
break;
}
}
}
if (!info) return;
WordTales.LearningProgress.trackWord(wordEl.dataset.vocabId, 'click', {
paragraphId: wordEl.closest('p') ? wordEl.closest('p').dataset.paragraphId : '',
occurrenceId: wordEl.dataset.vocabId
});
document.querySelectorAll('.word-popup').forEach(function(p){
var owner = p.dataset.ownerWordId ? document.getElementById(p.dataset.ownerWordId) : null;
if (owner) owner.setAttribute('aria-expanded', 'false');
p.remove();
});
var popup = document.createElement('div');
popup.className = 'word-popup';
popup.setAttribute('role', 'status');
popup.setAttribute('aria-live', 'polite');
popup.dataset.ownerWordId = wordEl.id;
var pw = document.createElement('div');
pw.className = 'pw';
pw.textContent = info.word;
popup.appendChild(pw);
if (info.pos || info.meaning) {
var line = document.createElement('div');
if (info.pos) {
var pp = document.createElement('span');
pp.className = 'pp';
pp.textContent = info.pos;
line.appendChild(pp);
}
if (info.meaning) {
var pm = document.createElement('span');
pm.className = 'pm';
pm.textContent = info.meaning;
line.appendChild(pm);
}
popup.appendChild(line);
}
popup.addEventListener('click', function(ev){ ev.stopPropagation(); });
popup.style.visibility = 'hidden';
popup.style.animation = 'none';
document.body.appendChild(popup);
// 先不可见地测量真实尺寸，再在上下可用空间中选择更宽裕的一侧并钳制到视口。
var wordRect = wordEl.getBoundingClientRect();
var popupRect = popup.getBoundingClientRect();
var viewportGap = 8;
var popupGap = 6;
var left = wordRect.left + (wordRect.width - popupRect.width) / 2;
left = Math.max(viewportGap, Math.min(left, window.innerWidth - popupRect.width - viewportGap));
var roomBelow = window.innerHeight - wordRect.bottom - popupGap - viewportGap;
var roomAbove = wordRect.top - popupGap - viewportGap;
var placeAbove = popupRect.height > roomBelow && roomAbove > roomBelow;
var top = placeAbove
? Math.max(viewportGap, wordRect.top - popupRect.height - popupGap)
: Math.min(wordRect.bottom + popupGap, window.innerHeight - popupRect.height - viewportGap);
popup.style.left = Math.round(left) + 'px';
popup.style.top = Math.round(Math.max(viewportGap, top)) + 'px';
popup.style.visibility = '';
popup.style.animation = '';
wordEl.setAttribute('aria-expanded', 'true');
WordTales.Features.Reader.speakWord(info.word);
if (_currentClosePopup) {
document.removeEventListener('click', _currentClosePopup);
_currentClosePopup = null;
}
var closePopup = function(ev){
if (!popup.contains(ev.target) && ev.target !== wordEl) {
popup.remove();
wordEl.setAttribute('aria-expanded', 'false');
document.removeEventListener('click', closePopup);
_currentClosePopup = null;
}
};
_currentClosePopup = closePopup;
document.addEventListener('click', closePopup);
});
wordEl.addEventListener('keydown', function(e){
if (e.key === 'Enter' || e.key === ' ') {
e.preventDefault();
wordEl.click();
} else if (e.key === 'Escape') {
closeWordPopups();
wordEl.setAttribute('aria-expanded', 'false');
}
});
});
});
}

return {
init: initWordJump,
close: closeWordPopups
};
})();
