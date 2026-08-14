#!/usr/bin/env node

/* Export the article corpus from the app's source data into standalone files. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const projectRoot = path.resolve(__dirname, '..');
const dataPath = path.join(projectRoot, 'vocab-essays', 'js', 'data.js');
const outputDir = path.join(projectRoot, 'articles');
const source = fs.readFileSync(dataPath, 'utf8');
const context = { WordTales: {} };

vm.createContext(context);
vm.runInContext(source, context, { filename: dataPath });

function plainText(segments) {
  return segments
    .map((segment) => (typeof segment === 'string' ? segment : segment.text))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

fs.mkdirSync(outputDir, { recursive: true });

let fileCount = 0;
context.WordTales.Data.sets.forEach((set) => {
  set.columns.forEach((column) => {
    const filename = `${set.label}${column.title}.md`;
    const english = column.paragraphs.map((paragraph) => plainText(paragraph.segments)).join('\n\n');
    const translations = column.paragraphs
      .map((paragraph) => paragraph.analysis && paragraph.analysis.translation)
      .filter(Boolean)
      .join('\n\n');
    const content = [
      `# ${set.label}${column.title}`,
      '',
      `- 主题：${column.theme.zh}`,
      `- Theme: ${column.theme.en}`,
      '',
      '## 英文原文',
      '',
      english,
      '',
      '## 中文译文',
      '',
      translations,
      ''
    ].join('\n');

    fs.writeFileSync(path.join(outputDir, filename), content, 'utf8');
    fileCount += 1;
  });
});

console.log(`Exported ${fileCount} articles to ${path.relative(projectRoot, outputDir)}/`);
