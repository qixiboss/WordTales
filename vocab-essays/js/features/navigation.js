/* ============================================================
 * Navigation：词集切换
 *
 * 切换前先终止朗读和弹层，再改变 active/inert 状态，让隐藏词集里不会
 * 残留语音、高亮或可被键盘聚焦的控件。目录始终从 Data 重建以保持一致。
 * ============================================================ */
WordTales.Features = WordTales.Features || {};
WordTales.Features.Navigation = (function() {
function initSetFeatures(root) {
// 各初始化器都具备幂等保护，因此切回已访问词集不会重复绑定事件。
if (!root) return;
WordTales.Features.Cards.init(root);
WordTales.Features.Cards.initToolbar(root);
WordTales.Features.Analysis.init(root);
WordTales.Features.Reader.init(root);
WordTales.Features.WordPopup.init(root);
}

function switchSet(setId, btn) {
WordTales.Features.WordPopup.close();
WordTales.Features.Reader.stop();
document.querySelectorAll('.set-content').forEach(function(el){ el.classList.remove('active'); });
document.querySelectorAll('.set-content').forEach(function(el){
el.setAttribute('aria-hidden', 'true');
el.inert = true;
});
document.querySelectorAll('.set-btn').forEach(function(b){
b.classList.remove('active');
b.setAttribute('aria-pressed', 'false');
});
if(btn) {
btn.classList.add('active');
btn.setAttribute('aria-pressed', 'true');
}
var nav = document.getElementById('toc');
nav.innerHTML = '';
if (setId === 'changelog') {
// 更新日志没有 column 数据，因此走独立元信息分支，但仍复用 set-content 容器。
var activeSet = document.getElementById('changelog');
if (!activeSet) return;
activeSet.classList.add('active');
activeSet.setAttribute('aria-hidden', 'false');
activeSet.inert = false;
document.getElementById('setMeta').textContent = '第八份 · 更新日志';
} else {
var setData = WordTales.Data.getSet(setId) || WordTales.Data.sets[0];
if (!setData) return;
setId = setData.id;
var activeSet = document.getElementById(setId);
if (!activeSet) return;
initSetFeatures(activeSet);
activeSet.classList.add('active');
activeSet.setAttribute('aria-hidden', 'false');
activeSet.inert = false;
setData.columns.forEach(function(column){
var a = document.createElement('a');
a.href = '#' + column.id;
a.textContent = column.title;
nav.appendChild(a);
});
document.getElementById('setMeta').textContent = WordTales.Data.getMeta(setData);
}
}

return {
switchSet: switchSet
};
})();
