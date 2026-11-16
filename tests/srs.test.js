const assert = require('assert');
const SRS = require('../srs.js');

console.log('Running Spaced Repetition (SRS) Unit Tests...\n');

// 1. Date utilities
const today = SRS.formatDateToDayString(new Date(2026, 10, 16));
assert.strictEqual(today, '2026-11-16', 'Date format should match YYYY-MM-DD');

const plus3 = SRS.addDays(today, 3);
assert.strictEqual(plus3, '2026-11-19', 'addDays should add calendar days properly');

const minus1 = SRS.addDays(today, -1);
assert.strictEqual(minus1, '2026-11-15', 'addDays should subtract days properly');

const diff = SRS.diffDays(plus3, today);
assert.strictEqual(diff, 3, 'diffDays should calculate day difference');

// 2. Normalization
const rawEntry = { id: '1', word: 'test', translation: 'essai' };
const norm = SRS.normalizeEntry(rawEntry, today);
assert.strictEqual(norm.learning_state, 'new');
assert.strictEqual(norm.interval_days, 0);
assert.strictEqual(norm.ease_factor, 2.5);
assert.strictEqual(norm.review_count, 0);
assert.strictEqual(norm.lapse_count, 0);
assert.strictEqual(norm.due_date, today);

// 3. SM-2 Algorithm Tests
// A. Brand new word marked "Good"
const resNewGood = SRS.calculateSM2(rawEntry, 'good', today);
assert.strictEqual(resNewGood.learning_state, 'review');
assert.strictEqual(resNewGood.interval_days, 1);
assert.strictEqual(resNewGood.ease_factor, 2.5);
assert.strictEqual(resNewGood.review_count, 1);
assert.strictEqual(resNewGood.lapse_count, 0);
assert.strictEqual(resNewGood.due_date, '2026-11-17');

// B. Second review (interval 1) marked "Good"
const entryStep2 = { ...rawEntry, ...resNewGood };
const resStep2Good = SRS.calculateSM2(entryStep2, 'good', '2026-11-17');
assert.strictEqual(resStep2Good.learning_state, 'review');
assert.strictEqual(resStep2Good.interval_days, 4);
assert.strictEqual(resStep2Good.ease_factor, 2.5);
assert.strictEqual(resStep2Good.review_count, 2);
assert.strictEqual(resStep2Good.due_date, '2026-11-21');

// C. Third review (interval 4) marked "Good" -> interval = round(4 * 2.5) = 10
const entryStep3 = { ...rawEntry, ...resStep2Good };
const resStep3Good = SRS.calculateSM2(entryStep3, 'good', '2026-11-21');
assert.strictEqual(resStep3Good.interval_days, 10);
assert.strictEqual(resStep3Good.review_count, 3);
assert.strictEqual(resStep3Good.due_date, '2026-12-01');

// D. Review marked "Again" (Lapse)
const resAgain = SRS.calculateSM2(entryStep3, 'again', '2026-11-21');
assert.strictEqual(resAgain.learning_state, 'relearning');
assert.strictEqual(resAgain.interval_days, 0);
assert.strictEqual(resAgain.lapse_count, 1);
assert.strictEqual(resAgain.ease_factor, 2.3); // 2.5 - 0.2
assert.strictEqual(resAgain.due_date, '2026-11-21');

// E. Review marked "Hard"
const resHard = SRS.calculateSM2(entryStep3, 'hard', '2026-11-21');
assert.strictEqual(resHard.learning_state, 'review');
assert.strictEqual(resHard.interval_days, 5); // round(4 * 1.2) = 5
assert.strictEqual(resHard.ease_factor, 2.35); // 2.5 - 0.15

// F. Review marked "Easy"
const resEasy = SRS.calculateSM2(entryStep3, 'easy', '2026-11-21');
assert.strictEqual(resEasy.learning_state, 'review');
assert.strictEqual(resEasy.interval_days, 13); // round(4 * 2.5 * 1.3) = 13
assert.strictEqual(resEasy.ease_factor, 2.65); // 2.5 + 0.15

// G. Ease factor floor (1.3)
let lowEaseEntry = { ...entryStep3, ease_factor: 1.35 };
let resFloor = SRS.calculateSM2(lowEaseEntry, 'again', today);
assert.strictEqual(resFloor.ease_factor, 1.3, 'Ease factor must not drop below 1.3');

// 4. Reset Learning Progress
const resetEntry = SRS.resetLearningProgress(entryStep3, today);
assert.strictEqual(resetEntry.learning_state, 'new');
assert.strictEqual(resetEntry.interval_days, 0);
assert.strictEqual(resetEntry.ease_factor, 2.5);
assert.strictEqual(resetEntry.review_count, 0);
assert.strictEqual(resetEntry.due_date, today);

// 5. Smart Queue Prioritization
const testEntries = [
  { id: 'new-1', word: 'new1', learning_state: 'new', created_at: '2026-11-16' },
  { id: 'new-2', word: 'new2', learning_state: 'new', created_at: '2026-11-16' },
  { id: 'overdue-1', word: 'overdue1', learning_state: 'review', due_date: '2026-11-10', interval_days: 5 },
  { id: 'due-today', word: 'dueToday', learning_state: 'review', due_date: '2026-11-16', interval_days: 3 },
  { id: 'future', word: 'future', learning_state: 'review', due_date: '2026-11-20', interval_days: 10 },
  { id: 'learning-1', word: 'learn1', learning_state: 'learning', due_date: '2026-11-16', interval_days: 0 },
];

const queue = SRS.buildReviewQueue({
  entries: testEntries,
  reviewHistory: [],
  mode: 'due',
  dailyNewLimit: 1,
  sessionSize: 10,
  todayStr: '2026-11-16',
});

// Priority must be: Overdue -> Due Today -> Learning -> New (capped to daily limit 1)
assert.strictEqual(queue.length, 4, 'Should include 1 overdue, 1 due today, 1 learning, and 1 new (daily limit 1)');
assert.strictEqual(queue[0].id, 'overdue-1', 'Overdue should be first');
assert.strictEqual(queue[1].id, 'due-today', 'Due today should be second');
assert.strictEqual(queue[2].id, 'learning-1', 'Learning should be third');
assert.strictEqual(queue[3].id, 'new-1', 'New word should be last');

// 6. Learning Statistics & Streak Calculation
const sampleHistory = [
  { id: 'h1', word_id: '1', reviewed_at: '2026-11-14T10:00:00Z', rating: 'good' },
  { id: 'h2', word_id: '2', reviewed_at: '2026-11-15T11:00:00Z', rating: 'good' },
  { id: 'h3', word_id: '3', reviewed_at: '2026-11-16T12:00:00Z', rating: 'easy' },
];

const stats = SRS.calculateLearningStats(testEntries, sampleHistory, '2026-11-16');
assert.strictEqual(stats.totalVocabulary, 6);
assert.strictEqual(stats.totalReviews, 3);
assert.strictEqual(stats.currentStreak, 3, 'Streak should be 3 consecutive days');
assert.strictEqual(stats.weeklyActivity.length, 7, 'Weekly activity must have 7 days');

console.log('✓ All SRS unit tests passed successfully!\n');
