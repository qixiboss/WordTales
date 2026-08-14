/* ============================================================
 * Analysis：段落解析
 *
 * 把原 essay-block 增强为前后两面：正面保留整篇文章，背面只渲染
 * 用户所选段落的原文、翻译和语言点。
 * ============================================================ */
WordTales.Features = WordTales.Features || {};
WordTales.Features.Analysis = (function() {
function initParaFlip(root) {
(root || document).querySelectorAll('.essay-block').forEach(function(block){
if (block.querySelector('.essay-inner')) return;
var inner = document.createElement('div');
inner.className = 'essay-inner';
var front = document.createElement('div');
front.className = 'essay-face';
var back = document.createElement('div');
back.className = 'essay-back';
var essayHead = block.querySelector('.essay-head');
if (essayHead) {
block.removeChild(essayHead);
}
while (block.firstChild) {
front.appendChild(block.firstChild);
}
inner.appendChild(front);
inner.appendChild(back);
block.appendChild(inner);
if (essayHead) block.insertBefore(essayHead, inner);

block.querySelectorAll('p').forEach(function(p, idx){
var btn = document.createElement('button');
btn.type = 'button';
btn.className = 'para-btn';
btn.textContent = '解析';
btn.addEventListener('click', function(e){
e.stopPropagation();
var paraEl = block.querySelectorAll('.essay-face p')[idx];
if (paraEl && paraEl.dataset.paragraphId) {
WordTales.LearningProgress.trackAnalysis(paraEl.dataset.paragraphId);
}
block._scrollReturnPara = paraEl;
block._scrollReturnButton = btn;
showAnalysis(block, back, idx);
block.classList.add('flipped');
front.setAttribute('aria-hidden', 'true');
back.setAttribute('aria-hidden', 'false');
setTimeout(function(){
var top = block.getBoundingClientRect().top + window.pageYOffset - 80;
window.scrollTo({ top: top, behavior:'smooth' });
returnBtn.focus();
}, 650);
});
var lastText = p.lastChild;
while (lastText && lastText.nodeType !== 3) {
lastText = lastText.previousSibling;
}
if (lastText && lastText.nodeType === 3) {
p.appendChild(btn);
} else {
p.appendChild(btn);
}
});

var returnBtn = document.createElement('button');
returnBtn.type = 'button';
returnBtn.className = 'return-btn';
returnBtn.textContent = '← 返回短文';
returnBtn.addEventListener('click', function(e){
e.stopPropagation();
var targetPara = block._scrollReturnPara;
var targetButton = block._scrollReturnButton;
block._scrollReturnPara = null;
block._scrollReturnButton = null;
block.classList.remove('flipped');
front.setAttribute('aria-hidden', 'false');
back.setAttribute('aria-hidden', 'true');
if (targetPara) {
setTimeout(function(){
var top = targetPara.getBoundingClientRect().top + window.pageYOffset - 80;
window.scrollTo({ top: top, behavior:'smooth' });
if (targetButton) targetButton.focus();
}, 650);
}
});
back.appendChild(returnBtn);
back.setAttribute('aria-hidden', 'true');
});
}

function showAnalysis(block, backEl, paraIdx) {
WordTales.Features.WordPopup.close();
var paragraphs = block.querySelectorAll('.essay-face p');
var paragraphId = paragraphs[paraIdx] ? paragraphs[paraIdx].dataset.paragraphId : '';
var paragraphData = WordTales.Data.getParagraph(paragraphId);
var data = paragraphData ? paragraphData.analysis : null;

while (backEl.children.length > 1) {
backEl.removeChild(backEl.lastChild);
}

var srcDiv = document.createElement('div');
srcDiv.className = 'analysis-src';
// 从结构化 segments 重建原文，避免把正面按钮文字或朗读 token 混进解析标题。
if (paragraphData && paragraphData.segments) {
paragraphData.segments.forEach(function(segment){
if (typeof segment === 'string') {
srcDiv.appendChild(document.createTextNode(segment));
} else {
var emphasizedWord = document.createElement('strong');
emphasizedWord.className = 'analysis-word';
emphasizedWord.textContent = segment.text;
srcDiv.appendChild(emphasizedWord);
}
});
} else {
srcDiv.textContent = paragraphs[paraIdx] ? paragraphs[paraIdx].textContent.replace('解析','').trim() : '';
}
backEl.appendChild(srcDiv);

if (data) {
var transDiv = document.createElement('div');
transDiv.className = 'analysis-trans';
var label = document.createElement('span');
label.className = 'label';
label.textContent = '翻译：';
transDiv.appendChild(label);
transDiv.appendChild(document.createTextNode(data.translation));
backEl.appendChild(transDiv);
var list = document.createElement('ol');
list.className = 'analysis-list';
data.points.forEach(function(pt){
var li = document.createElement('li');
var temp = document.createElement('div');
temp.textContent = pt;
/*
 * 先把整条说明转义，再只恢复精确的 <span class="keyword"> 白名单。
 * 数据可保留重点标记，同时不会开放任意 HTML 注入能力。
 */
var safe = temp.innerHTML
.replace(/&lt;span class="keyword"&gt;/g, '<span class="keyword">')
.replace(/&lt;\/span&gt;/g, '</span>');
li.innerHTML = safe;
list.appendChild(li);
});
backEl.appendChild(list);
} else {
var loading = document.createElement('div');
loading.style.cssText = 'color:var(--muted);font-size:.85rem;padding:1rem 0';
loading.textContent = '该段落解析内容待生成';
backEl.appendChild(loading);
}
}

return {
init: initParaFlip,
show: showAnalysis
};
})();
