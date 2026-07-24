#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const htmlPath = path.resolve(__dirname, '../vocab-essays/vocab-essays.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const errors = [];

const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)];
scripts.forEach((match, index) => {
  try {
    new vm.Script(match[1], { filename: `inline-script-${index + 1}.js` });
  } catch (error) {
    errors.push(`inline script ${index + 1}: ${error.message}`);
  }
});

const marker = '  var sets = ';
const markerIndex = html.indexOf(marker);
if (markerIndex === -1) {
  errors.push('Unable to locate the sets data.');
}

let sets = [];
if (markerIndex !== -1) {
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
    errors.push('Unable to find the end of the sets data.');
  } else {
    try {
      sets = JSON.parse(html.slice(dataStart, dataEnd));
    } catch (error) {
      errors.push(`Invalid sets JSON: ${error.message}`);
    }
  }
}

const ids = new Map();
const totals = { sets: sets.length, columns: 0, words: 0, paragraphs: 0, audioColumns: 0 };

function registerId(id, type) {
  if (typeof id !== 'string' || !id.trim()) {
    errors.push(`${type} is missing a valid id.`);
  } else if (ids.has(id)) {
    errors.push(`Duplicate id "${id}" used by ${ids.get(id)} and ${type}.`);
  } else {
    ids.set(id, type);
  }
}

sets.forEach((set, setIndex) => {
  registerId(set.id, `set ${setIndex + 1}`);
  if (!Array.isArray(set.columns)) {
    errors.push(`Set "${set.id || setIndex + 1}" has no columns array.`);
    return;
  }
  set.columns.forEach((column, columnIndex) => {
    totals.columns += 1;
    registerId(column.id, `column ${columnIndex + 1} in ${set.id}`);
    const words = Array.isArray(column.words) ? column.words : [];
    const paragraphs = Array.isArray(column.paragraphs) ? column.paragraphs : [];
    const localWordIds = new Set();

    if (!Array.isArray(column.words)) errors.push(`Column "${column.id}" has no words array.`);
    if (!Array.isArray(column.paragraphs)) errors.push(`Column "${column.id}" has no paragraphs array.`);

    if (column.audio !== undefined) {
      totals.audioColumns += 1;
      if (!column.audio || typeof column.audio.src !== 'string' || !column.audio.src.trim()) {
        errors.push(`Column "${column.id}" has an invalid audio source.`);
      } else {
        const audioPath = path.resolve(path.dirname(htmlPath), column.audio.src);
        if (!fs.existsSync(audioPath) || !fs.statSync(audioPath).isFile()) {
          errors.push(`Column "${column.id}" audio file is missing: ${column.audio.src}`);
        }
      }

      const articleTokens = paragraphs.flatMap((paragraph) => {
        if (!Array.isArray(paragraph.segments)) return [];
        return paragraph.segments.flatMap((segment) => {
          const text = typeof segment === 'string' ? segment : segment.text;
          return String(text || '').split(/\s+/).filter(Boolean);
        });
      });
      const cues = column.audio && column.audio.cues;
      if (!Array.isArray(cues)) {
        errors.push(`Column "${column.id}" has no audio cue array.`);
      } else if (cues.length !== articleTokens.length) {
        errors.push(
          `Column "${column.id}" has ${cues.length} audio cues for ${articleTokens.length} article tokens.`
        );
      } else {
        let previousEnd = -Infinity;
        cues.forEach((cue, cueIndex) => {
          if (cue === null) return;
          const validCue = Array.isArray(cue) && cue.length === 2 &&
            cue.every(Number.isFinite) && cue[0] >= 0 && cue[1] > cue[0];
          if (!validCue) {
            errors.push(`Column "${column.id}" has an invalid audio cue at token ${cueIndex + 1}.`);
            return;
          }
          if (cue[0] < previousEnd) {
            errors.push(`Column "${column.id}" has overlapping audio cues at token ${cueIndex + 1}.`);
          }
          previousEnd = cue[1];
        });
      }
    }

    words.forEach((word, wordIndex) => {
      totals.words += 1;
      registerId(word.id, `word ${wordIndex + 1} in ${column.id}`);
      localWordIds.add(word.id);
      ['word', 'pos', 'meaning'].forEach((field) => {
        if (typeof word[field] !== 'string' || !word[field].trim()) {
          errors.push(`Word "${word.id}" is missing "${field}".`);
        }
      });
    });

    paragraphs.forEach((paragraph, paragraphIndex) => {
      totals.paragraphs += 1;
      registerId(paragraph.id, `paragraph ${paragraphIndex + 1} in ${column.id}`);
      if (!Array.isArray(paragraph.segments)) {
        errors.push(`Paragraph "${paragraph.id}" has no segments array.`);
      } else {
        paragraph.segments.forEach((segment) => {
          if (segment && typeof segment === 'object' && !localWordIds.has(segment.vocabId)) {
            errors.push(`Paragraph "${paragraph.id}" references non-local word "${segment.vocabId}".`);
          }
        });
      }
      if (!paragraph.analysis || typeof paragraph.analysis.translation !== 'string' ||
          !Array.isArray(paragraph.analysis.points)) {
        errors.push(`Paragraph "${paragraph.id}" has an invalid analysis object.`);
      }
    });
  });
});

if (errors.length) {
  console.error(`Integrity check failed with ${errors.length} error(s):`);
  errors.forEach((error) => console.error(`- ${error}`));
  process.exitCode = 1;
} else {
  console.log(
    `Integrity check passed: ${scripts.length} scripts, ` +
    `${totals.sets} sets, ${totals.columns} columns, ` +
    `${totals.words} words, ${totals.paragraphs} paragraphs, ` +
    `${totals.audioColumns} recorded columns.`
  );
}
