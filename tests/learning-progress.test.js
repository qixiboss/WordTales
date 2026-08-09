const test = require('node:test');
const assert = require('node:assert/strict');

const { createStorage, loadLearningApp } = require('./helpers/browser-env');
const { RADIATE_PRIMARY_ID, RADIATE_ALIAS_ID } = require('./helpers/constants');

async function readyProgress(initialStorage = {}) {
  const localStorage = createStorage(initialStorage);
  const context = loadLearningApp({ localStorage });
  await context.WordTales.LearningProgress.init();
  return { context, localStorage, data: context.WordTales.Data, progress: context.WordTales.LearningProgress };
}

test('Again、Hard 和 Good 分别更新复习状态与生词状态', async () => {
  const { data, progress } = await readyProgress();
  const [againEntry, hardEntry, goodEntry] = data.getAllEntries();

  const again = await progress.rateWord(againEntry.id, 'Again', {}, 'again-1');
  const hard = await progress.rateWord(hardEntry.id, 'Hard', {}, 'hard-1');
  const good = await progress.rateWord(goodEntry.id, 'Good', {}, 'good-1');

  assert.equal(again.lastResult, 'Again');
  assert.equal(again.reviewCount, 1);
  assert.equal(again.lapseCount, 1);
  assert.equal(again.successStreak, 0);
  assert.equal(again.isStarred, true);
  assert.equal(hard.lastResult, 'Hard');
  assert.equal(hard.successStreak, 1);
  assert.equal(hard.isStarred, false);
  assert.equal(good.lastResult, 'Good');
  assert.equal(good.successStreak, 1);
  assert.equal(good.isStarred, false);

  const day = progress.getData().days[progress.getDayKey()];
  assert.equal(day.again, 1);
  assert.equal(day.hard, 1);
  assert.equal(day.good, 1);
  assert.equal(day.unfamiliar, 1);
  assert.equal(day.known, 2);
});

test('重复 submission ID 不会造成二次调度或重复事件', async () => {
  const { data, progress } = await readyProgress();
  const entry = data.getAllEntries()[0];

  await progress.rateWord(entry.id, 'Good', {}, 'same-submission');
  const before = progress.getEntryState(entry.id);
  const eventCount = progress.getData().events.length;
  const duplicate = await progress.rateWord(entry.id, 'Again', {}, 'same-submission');

  assert.equal(duplicate.reviewCount, before.reviewCount);
  assert.equal(duplicate.lastResult, 'Good');
  assert.equal(duplicate.nextReviewAt, before.nextReviewAt);
  assert.equal(progress.getData().events.length, eventCount);
  assert.equal(progress.getData().days[progress.getDayKey()].again, 0);
});

test('出现项 ID 统一写入规范词条，别名不会产生第二份档案', async () => {
  const { progress } = await readyProgress();
  const primaryId = 's1col1-radiate';
  const aliasId = 's6col2-radiate';

  await progress.rateWord(aliasId, 'Hard', { occurrenceId: aliasId }, 'alias-rating');

  assert.equal(progress.getEntryState(primaryId).reviewCount, 1);
  assert.equal(progress.getEntryState(aliasId).entryId, primaryId);
  assert.deepEqual(Object.keys(progress.getData().words), [primaryId]);
  assert.equal(progress.getData().words[primaryId].sourceOccurrenceId, aliasId);
});

test('评分接口拒绝无效评分，并安全忽略未知词条', async () => {
  const { progress } = await readyProgress();

  await assert.rejects(progress.rateWord('s1col1-radiate', 'Easy'), /Unsupported learning rating/);
  assert.equal(await progress.rateWord('missing-entry', 'Good', {}, 'missing'), null);
  assert.equal(progress.getData().events.length, 0);
});

test('到期队列排除未来词条并优先返回逾期更久的词条', async () => {
  const { data, progress } = await readyProgress();
  const [olderEntry, newerEntry, futureEntry] = data.getAllEntries();
  await progress.rateWord(olderEntry.id, 'Good', {}, 'due-old');
  await progress.rateWord(newerEntry.id, 'Good', {}, 'due-new');
  await progress.rateWord(futureEntry.id, 'Good', {}, 'due-future');

  const now = new Date();
  progress.getData().words[olderEntry.id].nextReviewAt = new Date(now.getTime() - 3 * 86400000).toISOString();
  progress.getData().words[newerEntry.id].nextReviewAt = new Date(now.getTime() - 86400000).toISOString();
  progress.getData().words[futureEntry.id].nextReviewAt = new Date(now.getTime() + 86400000).toISOString();

  const dueIds = Array.from(progress.getDueEntries(now), (item) => item.entry.id);
  assert.deepEqual(dueIds, [olderEntry.id, newerEntry.id]);
});

test('v1 档案迁移会幂等合并别名记录并保留关键统计', async () => {
  const primaryId = 's1col1-radiate';
  const aliasId = 's6col2-radiate';
  const legacyProfile = {
    version: 1,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-02-01T00:00:00.000Z',
    words: {
      [primaryId]: {
        firstSeenAt: '2025-01-10T00:00:00.000Z',
        lastSeenAt: '2025-01-20T00:00:00.000Z',
        reviewCount: 2,
        lapseCount: 1,
        successStreak: 1,
        isStarred: false
      },
      [aliasId]: {
        firstSeenAt: '2025-01-05T00:00:00.000Z',
        lastSeenAt: '2025-01-25T00:00:00.000Z',
        reviewCount: 3,
        lapseCount: 2,
        successStreak: 2,
        isStarred: true,
        starredAt: '2025-01-25T00:00:00.000Z'
      }
    }
  };
  const { progress } = await readyProgress({
    'wordtales.learning.v1': JSON.stringify(legacyProfile),
    'wordtales.learning.v2-migrated': '1'
  });
  const record = progress.getEntryState(primaryId);

  assert.deepEqual(Object.keys(progress.getData().words), [primaryId]);
  assert.equal(record.firstSeenAt, '2025-01-05T00:00:00.000Z');
  assert.equal(record.lastSeenAt, '2025-01-25T00:00:00.000Z');
  assert.equal(record.reviewCount, 5);
  assert.equal(record.lapseCount, 3);
  assert.equal(record.successStreak, 1);
  assert.equal(record.isStarred, true);
});
