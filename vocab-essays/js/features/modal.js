/* ============================================================
 * Modal：共享的全屏弹层基础设施
 *
 * 游戏、抄写和旋转提示都需要相同的无障碍行为：背景 inert、焦点圈定、
 * Escape 关闭和退出后恢复焦点。集中管理可避免多个全屏功能叠加监听器。
 * ============================================================ */
WordTales.Features = WordTales.Features || {};
WordTales.Features.Modal = (function() {
var _activeModal = null;
var _modalPreviousFocus = null;
var _modalClose = null;

function setPageInert(inert) {
document.querySelectorAll('body > header, body > nav, body > main, body > footer').forEach(function(el){
el.inert = inert;
if (inert) el.setAttribute('aria-hidden', 'true');
else el.removeAttribute('aria-hidden');
});
}

function getModalFocusables(container) {
return Array.prototype.filter.call(container.querySelectorAll('button, input, [href], [tabindex]:not([tabindex="-1"])'), function(el){
return !el.disabled && el.getClientRects().length > 0;
});
}

function handleModalKeydown(e) {
if (!_activeModal) return;
if (e.key === 'Escape') {
e.preventDefault();
if (_modalClose) _modalClose();
return;
}
if (e.key !== 'Tab') return;
// 手工构造焦点环，防止 Tab 离开无原生 <dialog> 的自定义遮罩。
var focusables = getModalFocusables(_activeModal);
if (focusables.length === 0) {
e.preventDefault();
_activeModal.focus();
return;
}
var first = focusables[0];
var last = focusables[focusables.length - 1];
if (e.shiftKey && document.activeElement === first) {
e.preventDefault();
last.focus();
} else if (!e.shiftKey && document.activeElement === last) {
e.preventDefault();
first.focus();
}
}

function activateModal(container, closeFn, label, initialFocus) {
if (!_activeModal) {
// 仅第一层 modal 隔离页面；横竖屏提示切到画板时会复用同一层状态。
_modalPreviousFocus = document.activeElement;
setPageInert(true);
document.addEventListener('keydown', handleModalKeydown);
}
_activeModal = container;
_modalClose = closeFn;
container.setAttribute('role', 'dialog');
container.setAttribute('aria-modal', 'true');
container.setAttribute('aria-label', label);
container.setAttribute('tabindex', '-1');
setTimeout(function(){
if (_activeModal !== container || !container.isConnected) return;
var preferredFocus = typeof initialFocus === 'function' ? initialFocus() : initialFocus;
if (preferredFocus && container.contains(preferredFocus) && !preferredFocus.disabled && preferredFocus.getClientRects().length > 0) {
preferredFocus.focus();
return;
}
var focusables = getModalFocusables(container);
(focusables[0] || container).focus();
}, 0);
}

function deactivateModal() {
document.removeEventListener('keydown', handleModalKeydown);
setPageInert(false);
var previous = _modalPreviousFocus;
_activeModal = null;
_modalPreviousFocus = null;
_modalClose = null;
if (previous && typeof previous.focus === 'function') previous.focus();
}

return {
activate: activateModal,
deactivate: deactivateModal
};
})();
