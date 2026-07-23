#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const htmlPath = path.resolve(__dirname, '../vocab-essays/vocab-essays.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const marker = '  var sets = ';
const markerIndex = html.indexOf(marker);

if (markerIndex === -1) {
  throw new Error('Unable to locate the sets data.');
}

const dataStart = markerIndex + marker.length;
let depth = 0;
let inString = false;
let escaped = false;
let dataEnd = -1;

for (let index = dataStart; index < html.length; index += 1) {
  const character = html[index];
  if (inString) {
    if (escaped) escaped = false;
    else if (character === '\\') escaped = true;
    else if (character === '"') inString = false;
    continue;
  }
  if (character === '"') inString = true;
  else if (character === '[') depth += 1;
  else if (character === ']' && --depth === 0) {
    dataEnd = index + 1;
    break;
  }
}

if (dataEnd === -1) {
  throw new Error('Unable to find the end of the sets data.');
}

const sets = JSON.parse(html.slice(dataStart, dataEnd));

function plainText(value) {
  return value.replace(/<[^>]+>/g, '');
}

function normalizeChinesePunctuation(value) {
  return value.split(/(<[^>]+>)/g).map((part) => {
    if (part.startsWith('<')) return part.replace(/class=[“”"]keyword[“”"]/g, 'class="keyword"');
    const straightQuotes = part.replace(/[“”]/g, '"');
    return straightQuotes
      .replace(/([\u3400-\u9fff])\s*,\s*/g, '$1，')
      .replace(/([\u3400-\u9fff])\s*:\s*/g, '$1：')
      .replace(/([\u3400-\u9fff])\s*;\s*/g, '$1；')
      .replace(/"([^"\n]*[\u3400-\u9fff][^"\n]*)"/g, '“$1”')
      .replace(/\s+([，。；：！？])/g, '$1');
  }).join('');
}

function clip(value, maxLength = 25) {
  const cleaned = value
    .replace(/[“”"']/g, '')
    .replace(/^[然而但而于是随后接着因此与此同时]+[，、]?/, '')
    .trim();
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength)}…` : cleaned;
}

function makeRoadmap(translation, source) {
  const beats = translation
    .split(/[。！？]/)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
    .map((sentence) => sentence.split(/[；;]/)[0].trim())
    .filter(Boolean);
  const selected = beats.length <= 3
    ? beats
    : [beats[0], beats[Math.floor(beats.length / 2)], beats[beats.length - 1]];
  const route = selected.map((beat) => `“${clip(beat)}”`).join(' → ');
  const hasTurn = /\b(?:yet|however|but|although|though|despite|instead|rather than|nevertheless)\b/i.test(source);
  const readingTip = hasTurn
    ? '原文含有明显的转折或对照，转折后的信息通常才是作者真正要强调的落点。'
    : '阅读时沿着这一顺序追踪场景、动作与结果，就不会被长句中的修饰成分带偏。';
  if (selected.length === 1) {
    return `<span class="keyword">段落脉络</span>：本段用一句话集中交代 ${route}。先抓住并列的主干动作，再看修饰语补充的结果或影响。`;
  }
  return `<span class="keyword">段落脉络</span>：本段按 ${route} 的顺序展开。${readingTip}`;
}

function classifyPoint(point, index) {
  const text = plainText(point);
  if (index === 0 || /主干|主系表|主谓/.test(text)) return '句子骨架';
  if (/意为|表示|固定搭配|搭配|用作|在此(?:处)?(?:指|作|表示)|词义/.test(text) &&
      !/从句|分词|不定式|独立主格|同位语|插入语|虚拟语气/.test(text)) return '地道表达';
  if (/转折|对比|并列|衔接|指代|破折号|冒号|分号/.test(text) &&
      !/定语从句|宾语从句|状语从句|同位语从句/.test(text)) return '逻辑衔接';
  if (/从句|分词|不定式|独立主格|同位语|插入语|后置定语|状语|虚拟语气|被动语态/.test(text)) return '结构拆解';
  return '语境辨析';
}

function explanationFor(point) {
  const text = plainText(point);
  if (/定语从句|后置定语/.test(text)) {
    return '阅读时先确认它修饰的对象，再暂时略过修饰部分，句子主干就会立刻显出来。';
  }
  if (/宾语从句|同位语从句/.test(text)) {
    return '这个从句承载的是完整内容；先判断它在主句中充当什么成分，再分析从句内部。';
  }
  if (/as though|as if|方式状语从句/.test(text)) {
    return '这里不是在补充事实，而是用类比或假设呈现人物感受，让画面和语气更鲜明。';
  }
  if (/分词|独立主格/.test(text)) {
    return '这种压缩结构把背景或伴随动作并入主句，使信息更紧凑，也避免连续使用多个完整分句。';
  }
  if (/状语从句|目的状语|原因状语|让步状语|结果状语/.test(text)) {
    return '连接词或非谓语形式在这里标明时间、原因、让步或目的，是判断句间逻辑的关键。';
  }
  if (/并列|转折|对比/.test(text)) {
    return '并列或转折标志划分了信息层级，后半部分往往补充、修正或反衬前半部分。';
  }
  return '';
}

function rewritePoint(point, index, explanationsUsed) {
  const category = classifyPoint(point, index);
  let rewritten = normalizeChinesePunctuation(point.trim())
    .replace(/^原句首句/, '首句')
    .replace(/^该句(?=主干|为主系表结构)/, '本句')
    .replace(/call 的宾语\(双宾语结构\)/g, 'call 的宾语；call 在这里采用“宾语 + 宾语补足语”结构')
    .replace(/as critics supposedly claimed 是<span class="keyword">方式状语从句<\/span>作插入语/, 'as critics supposedly claimed 是评论性插入语，交代这一判断的来源')
    .replace(/是<span class="keyword">让步\/对比状语从句<\/span>,while 在此表对比/, '是由 while 引出的对比分句，while 在此表对比')
    .replace(/<span class="keyword">debate on<\/span> 表示“就……展开辩论”/, 'debated 是及物动词，regulations 是其宾语；on such research 后置修饰 regulations')
    .replace(/作 began 的宾语\(不定式\)/, '与 began 构成 begin to do 结构')
    .replace(/。{2,}$/g, '。');
  let explanation = '';
  if (category === '结构拆解' || category === '逻辑衔接') {
    explanation = explanationFor(rewritten);
    if (explanation && explanationsUsed.has(explanation)) explanation = '';
    if (explanation) explanationsUsed.add(explanation);
  }
  if (explanation && !rewritten.endsWith('。')) rewritten += '。';
  return `<span class="keyword">${category}</span>：${rewritten}${explanation}`;
}

function sourceText(paragraph) {
  return paragraph.segments
    .map((segment) => typeof segment === 'string' ? segment : segment.text)
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

function phraseAround(source, word) {
  const escapedWord = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = source.match(new RegExp(`(?:[A-Za-z'-]+\\s+){0,2}${escapedWord}(?:\\s+[A-Za-z'-]+){0,3}`, 'i'));
  return match ? match[0].trim() : word;
}

function makeContextPoint(paragraph, vocabularyById, rewrittenPoints) {
  const source = sourceText(paragraph);
  const seen = new Set();
  const examples = paragraph.segments
    .filter((segment) => typeof segment !== 'string' && !seen.has(segment.vocabId) && seen.add(segment.vocabId))
    .slice(0, 4)
    .map((segment) => {
      const vocabulary = vocabularyById.get(segment.vocabId);
      const meaning = vocabulary ? vocabulary.meaning.split(/[；;]/)[0] : '';
      return `${segment.text} 出现在“${phraseAround(source, segment.text)}”中${meaning ? `，本段取“${meaning}”义` : ''}`;
    });
  if (!examples.length) {
    const phrases = [];
    const seenPhrases = new Set();
    for (const point of rewrittenPoints) {
      for (const match of point.matchAll(/<span class="keyword">([^<]*[A-Za-z][^<]*)<\/span>/g)) {
        const phrase = match[1].trim();
        if (!seenPhrases.has(phrase)) {
          seenPhrases.add(phrase);
          phrases.push(phrase);
        }
      }
    }
    if (!phrases.length) return '';
    return `<span class="keyword">语境搭配</span>：本段虽没有新增词卡，仍可把 ${phrases.slice(0, 3).map((phrase) => `“${phrase}”`).join('、')} 作为完整词块积累；回到原句观察它们承担的句法作用和前后搭配。`;
  }
  return `<span class="keyword">语境搭配</span>：${examples.join('；')}。把词连同身边的介词、动词或名词一起记，比孤立背中文释义更容易迁移到新句子中。`;
}

let paragraphCount = 0;

for (const set of sets) {
  for (const column of set.columns) {
    const vocabularyById = new Map(column.words.map((word) => [word.id, word]));
    for (const paragraph of column.paragraphs) {
      const source = sourceText(paragraph);
      const analysis = paragraph.analysis;
      analysis.translation = normalizeChinesePunctuation(analysis.translation);
      let originalPoints = analysis.points;
      if (plainText(originalPoints[0] || '').startsWith('段落脉络：')) {
        originalPoints = originalPoints.slice(1, -1).map((point) => {
          let restored = point.replace(/^<span class="keyword">(?:句子骨架|地道表达|逻辑衔接|结构拆解|语境辨析)<\/span>：/, '');
          for (const explanation of [
            '阅读时先确认它修饰的对象，再暂时略过修饰部分，句子主干就会立刻显出来。',
            '这个从句承载的是完整内容；先判断它在主句中充当什么成分，再分析从句内部。',
            '这里不是在补充事实，而是用类比或假设呈现人物感受，让画面和语气更鲜明。',
            '这种压缩结构把背景或伴随动作并入主句，使信息更紧凑，也避免连续使用多个完整分句。',
            '连接词或非谓语形式在这里标明时间、原因、让步或目的，是判断句间逻辑的关键。',
            '并列或转折标志划分了信息层级，后半部分往往补充、修正或反衬前半部分。'
          ]) {
            if (restored.endsWith(explanation)) restored = restored.slice(0, -explanation.length);
          }
          return restored.replace(/^原句该句/, '该句');
        });
      }
      const explanationsUsed = new Set();
      const rewrittenPoints = originalPoints.map((point, index) =>
        rewritePoint(point, index, explanationsUsed));
      analysis.points = [
        makeRoadmap(analysis.translation, source),
        ...rewrittenPoints,
        makeContextPoint(paragraph, vocabularyById, rewrittenPoints)
      ].filter(Boolean);
      paragraphCount += 1;
    }
  }
}

const rewrittenData = JSON.stringify(sets, null, 2);
const output = html.slice(0, dataStart) + rewrittenData + html.slice(dataEnd);
fs.writeFileSync(htmlPath, output);

console.log(`Rewrote analyses for ${paragraphCount} paragraphs.`);
