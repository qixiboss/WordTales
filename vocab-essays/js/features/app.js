/* ============================================================
 * App：唯一启动入口
 *
 * 先渲染，再根据 URL hash 激活正确词集并初始化该词集功能，最后恢复
 * 星标与异步学习档案。hashchange 复用同一路径以支持深链接和浏览器历史。
 * ============================================================ */
WordTales.Features = WordTales.Features || {};
WordTales.Features.App = (function() {
function init() {
WordTales.Renderer.render();
document.querySelectorAll('.set-btn').forEach(function(btn){
btn.addEventListener('click', function(){ WordTales.Features.Navigation.switchSet(btn.dataset.set, btn); });
});
function switchToHash() {
var targetId = '';
try {
targetId = window.location.hash ? decodeURIComponent(window.location.hash.slice(1)) : '';
} catch (e) {
targetId = window.location.hash.slice(1);
}
if (targetId === 'study') {
// 已发布的旧链接仍可打开，但不再保留已移除的背词路由。
try {
window.history.replaceState(null, '', window.location.href.split('#')[0] + '#library');
} catch (e) {
window.location.hash = 'library';
return;
}
targetId = '';
}
if (targetId === 'library') targetId = '';
if (targetId === 'changelog') {
var changelogBtn = document.querySelector('.set-btn[data-set="changelog"]');
WordTales.Features.Navigation.switchSet('changelog', changelogBtn);
return;
}
// hash 可以指向词集或专栏；先反查所属词集，切换后再滚动到具体专栏。
var targetSet = null;
WordTales.Data.sets.some(function(set){
var containsTarget = set.id === targetId || set.columns.some(function(column){ return column.id === targetId; });
if (containsTarget) targetSet = set;
return containsTarget;
});
if (!targetSet) targetSet = WordTales.Data.sets[0];
if (!targetSet) return;
var targetButton = null;
document.querySelectorAll('.set-btn').forEach(function(button){
if (button.dataset.set === targetSet.id) targetButton = button;
});
WordTales.Features.Navigation.switchSet(targetSet.id, targetButton);
if (targetId && document.getElementById(targetId)) {
requestAnimationFrame(function(){
document.getElementById(targetId).scrollIntoView({ block: 'start' });
});
}
}
WordTales.Auth.init().then(function(){
return WordTales.CloudSync.init();
}).then(function(){
return WordTales.LearningProgress.init();
}).then(function(){
WordTales.StudyRecord.init();
WordTales.Features.Progress.refresh();
window.addEventListener('hashchange', switchToHash);
switchToHash();
return WordTales.CloudSync.connectProfile();
});
}

return {
init: init
};
})();

/*
 * 兼容别名：历史上 features.js 曾把这些模块摊平到顶层。保留别名是为了
 * 不破坏 learning-progress 等模块在运行时对 WordTales.Progress.refresh
 * 的调用；新代码请直接使用 WordTales.Features.*。
 */
WordTales.Navigation = WordTales.Features.Navigation;
WordTales.Reader = WordTales.Features.Reader;
WordTales.WordPopup = WordTales.Features.WordPopup;
WordTales.Progress = WordTales.Features.Progress;
WordTales.Game = WordTales.Features.Game;
WordTales.CopyPractice = WordTales.Features.CopyPractice;
WordTales.Analysis = WordTales.Features.Analysis;
WordTales.Cards = WordTales.Features.Cards;
WordTales.App = WordTales.Features.App;

document.addEventListener('DOMContentLoaded', WordTales.App.init);
