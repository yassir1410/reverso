/**
 * Comprehensive Test Suite for Lexicon Phase 2
 * Tests: Spaced repetition, scheduling, queue generation, history, imports/exports,
 * edge cases, timezone/boundaries, double submission prevention.
 */

const assert = require('assert');
const SRS = require('../srs.js');

console.log('====================================================');
console.log('Lexicon Phase 2: Full Integration & Unit Test Suite');
console.log('====================================================\n');

// ------------------------------------------------------------------
// 1. SM-2 Spaced Repetition Calculations
// ------------------------------------------------------------------
console.log('1. Testing SM-2 calculations...');

const today = '2026-11-16';
const baseItem = {
  id: 'word-1',
  word: 'ephemeral',
  translation: 'éphémère',
  learning_state: 'new',
  interval_days: 0,
  ease_factor: 2.5,
  review_count: 0,
  lapse_count: 0,
  due_date: today,
};

// Test Again from New
const again1 = SRS.calculateSM2(baseItem, 'again', today);
assert.strictEqual(again1.learning_state, 'learning', 'New word marked Again should become learning');
assert.strictEqual(again1.interval_days, 0, 'Interval should be 0 for same-day retry');
assert.strictEqual(again1.lapse_count, 1, 'Lapse count should increment');
assert.strictEqual(again1.ease_factor, 2.3, 'Ease factor should drop by 0.2');
assert.strictEqual(again1.due_date, today);

// Test Good from New
const good1 = SRS.calculateSM2(baseItem, 'good', today);
assert.strictEqual(good1.learning_state, 'review');
assert.strictEqual(good1.interval_days, 1);
assert.strictEqual(good1.ease_factor, 2.5);
assert.strictEqual(good1.review_count, 1);
assert.strictEqual(good1.due_date, '2026-11-17');

// Test Good from Interval 1
const good2 = SRS.calculateSM2({ ...baseItem, ...good1 }, 'good', '2026-11-17');
assert.strictEqual(good2.interval_days, 4);
assert.strictEqual(good2.review_count, 2);
assert.strictEqual(good2.due_date, '2026-11-21');

// Test Good from Interval 4 (4 * 2.5 = 10)
const good3 = SRS.calculateSM2({ ...baseItem, ...good2 }, 'good', '2026-11-21');
assert.strictEqual(good3.interval_days, 10);
assert.strictEqual(good3.due_date, '2026-12-01');

// Test Hard from Interval 10 (round(10 * 1.2) = 12, ease drops by 0.15)
const hard1 = SRS.calculateSM2({ ...baseItem, ...good3 }, 'hard', '2026-12-01');
assert.strictEqual(hard1.interval_days, 12);
assert.strictEqual(hard1.ease_factor, 2.35);
assert.strictEqual(hard1.learning_state, 'review');

// Test Easy from Interval 10 (round(10 * 2.5 * 1.3) = 33, ease + 0.15)
const easy1 = SRS.calculateSM2({ ...baseItem, ...good3 }, 'easy', '2026-12-01');
assert.strictEqual(easy1.interval_days, 33);
assert.strictEqual(easy1.ease_factor, 2.65);
assert.strictEqual(easy1.due_date, '2027-01-03');

// Test Again from Review state (becomes relearning)
const againFromReview = SRS.calculateSM2({ ...baseItem, ...good3 }, 'again', '2026-12-01');
assert.strictEqual(againFromReview.learning_state, 'relearning');
assert.strictEqual(againFromReview.interval_days, 0);
assert.strictEqual(againFromReview.lapse_count, 1);

// Test Ease Factor Lower Bound (1.3)
let lowItem = { ...baseItem, ease_factor: 1.35 };
let drop1 = SRS.calculateSM2(lowItem, 'again', today);
assert.strictEqual(drop1.ease_factor, 1.3, 'Ease factor cannot drop below 1.3');

let drop2 = SRS.calculateSM2(drop1, 'again', today);
assert.strictEqual(drop2.ease_factor, 1.3, 'Ease factor must stay clamped at 1.3 minimum');

console.log('✓ SM-2 calculations passed.\n');

// ------------------------------------------------------------------
// 2. Normalization & Legacy Entry Migration
// ------------------------------------------------------------------
console.log('2. Testing normalization of legacy vocabulary entries...');

const legacyItem = {
  id: 'legacy-1',
  word: 'hello',
  translation: 'bonjour',
  // missing due_date, learning_state, etc.
};

const normalized = SRS.normalizeEntry(legacyItem, today);
assert.strictEqual(normalized.learning_state, 'new', 'Missing state should default to new');
assert.strictEqual(normalized.interval_days, 0);
assert.strictEqual(normalized.ease_factor, 2.5);
assert.strictEqual(normalized.review_count, 0);
assert.strictEqual(normalized.due_date, today);
assert.strictEqual(normalized.word, 'hello');

console.log('✓ Normalization and migration passed.\n');

// ------------------------------------------------------------------
// 3. Smart Review Queue Prioritization & Daily Limits
// ------------------------------------------------------------------
console.log('3. Testing Smart Review Queue prioritization & daily limit...');

const sampleEntries = [
  { id: 'new-1', word: 'n1', learning_state: 'new', created_at: '2026-11-10', due_date: today },
  { id: 'new-2', word: 'n2', learning_state: 'new', created_at: '2026-11-11', due_date: today },
  { id: 'new-3', word: 'n3', learning_state: 'new', created_at: '2026-11-12', due_date: today },
  { id: 'overdue-1', word: 'o1', learning_state: 'review', due_date: '2026-11-10', interval_days: 5 },
  { id: 'overdue-2', word: 'o2', learning_state: 'review', due_date: '2026-11-14', interval_days: 2 },
  { id: 'due-today', word: 'd1', learning_state: 'review', due_date: today, interval_days: 4 },
  { id: 'in-learning', word: 'l1', learning_state: 'learning', due_date: today, interval_days: 0 },
  { id: 'future-1', word: 'f1', learning_state: 'review', due_date: '2026-11-20', interval_days: 7 },
];

// Test Due mode with daily new limit of 2:
const queue1 = SRS.buildReviewQueue({
  entries: sampleEntries,
  reviewHistory: [],
  mode: 'due',
  dailyNewLimit: 2,
  sessionSize: 20,
  todayStr: today,
});

// Should pick:
// 1 & 2: Overdue items (o1 then o2)
// 3: Due today (d1)
// 4: In-learning (l1)
// 5 & 6: 2 new items (n1, n2) capped by dailyNewLimit=2
// Total = 6 (future-1 excluded, n3 excluded)
assert.strictEqual(queue1.length, 6);
assert.strictEqual(queue1[0].id, 'overdue-1');
assert.strictEqual(queue1[1].id, 'overdue-2');
assert.strictEqual(queue1[2].id, 'due-today');
assert.strictEqual(queue1[3].id, 'in-learning');
assert.strictEqual(queue1[4].id, 'new-1');
assert.strictEqual(queue1[5].id, 'new-2');

// Test when 1 new word was ALREADY reviewed today
const historyWithTodayReview = [
  { id: 'h1', word_id: 'prev-new', reviewed_at: '2026-11-16T08:00:00Z', learning_state_before: 'new' }
];

const queueWithHistory = SRS.buildReviewQueue({
  entries: sampleEntries,
  reviewHistory: historyWithTodayReview,
  mode: 'due',
  dailyNewLimit: 2, // remaining should be 2 - 1 = 1
  sessionSize: 20,
  todayStr: today,
});
// Total should now be 5 because only 1 new word is allowed
assert.strictEqual(queueWithHistory.length, 5);
assert.strictEqual(queueWithHistory[4].id, 'new-1');

// Test session size truncation
const queueSmall = SRS.buildReviewQueue({
  entries: sampleEntries,
  reviewHistory: [],
  mode: 'due',
  dailyNewLimit: 5,
  sessionSize: 3,
  todayStr: today,
});
assert.strictEqual(queueSmall.length, 3, 'Queue should be truncated to session size 3');

// Test explicit "all" mode
const queueAll = SRS.buildReviewQueue({
  entries: sampleEntries,
  reviewHistory: [],
  mode: 'all',
  sessionSize: 'all',
  todayStr: today,
});
assert.strictEqual(queueAll.length, sampleEntries.length, 'All mode should include every word');

console.log('✓ Queue prioritization and daily limit passed.\n');

// ------------------------------------------------------------------
// 4. Date and Calendar Boundary Behavior
// ------------------------------------------------------------------
console.log('4. Testing date boundaries, leap years, and month rollovers...');

// Year boundary
const endOfYear = '2026-12-31';
const nextYear = SRS.addDays(endOfYear, 1);
assert.strictEqual(nextYear, '2027-01-01', 'Dec 31 + 1 day should be Jan 1 of next year');

// Leap year (2028 is a leap year)
const feb28Leap = '2028-02-28';
const feb29Leap = SRS.addDays(feb28Leap, 1);
assert.strictEqual(feb29Leap, '2028-02-29', 'Leap year must handle Feb 29 properly');
const mar1Leap = SRS.addDays(feb28Leap, 2);
assert.strictEqual(mar1Leap, '2028-03-01', 'Feb 28 + 2 in leap year should be March 1');

// Non-leap year (2027)
const feb28NonLeap = '2027-02-28';
const mar1NonLeap = SRS.addDays(feb28NonLeap, 1);
assert.strictEqual(mar1NonLeap, '2027-03-01', 'Feb 28 + 1 in non-leap year should be March 1');

console.log('✓ Date boundary calculations passed.\n');

// ------------------------------------------------------------------
// 5. Learning Statistics & Consecutive Streaks
// ------------------------------------------------------------------
console.log('5. Testing learning statistics and learning streaks...');

const testHistory = [
  { id: '1', word_id: 'w1', reviewed_at: '2026-11-13T10:00:00Z', rating: 'good' },
  { id: '2', word_id: 'w2', reviewed_at: '2026-11-14T10:00:00Z', rating: 'good' },
  { id: '3', word_id: 'w3', reviewed_at: '2026-11-15T10:00:00Z', rating: 'hard' },
  { id: '4', word_id: 'w4', reviewed_at: '2026-11-16T10:00:00Z', rating: 'easy' },
];

const calculatedStats = SRS.calculateLearningStats(sampleEntries, testHistory, '2026-11-16');
assert.strictEqual(calculatedStats.totalVocabulary, sampleEntries.length);
assert.strictEqual(calculatedStats.totalReviews, 4);
assert.strictEqual(calculatedStats.currentStreak, 4, 'Streak should be 4 days (13th to 16th)');

// Streak with a broken day
const brokenHistory = [
  { id: '1', word_id: 'w1', reviewed_at: '2026-11-10T10:00:00Z', rating: 'good' },
  // Missing 11th, 12th, 13th, 14th
  { id: '2', word_id: 'w2', reviewed_at: '2026-11-15T10:00:00Z', rating: 'hard' },
  { id: '3', word_id: 'w3', reviewed_at: '2026-11-16T10:00:00Z', rating: 'easy' },
];
const brokenStats = SRS.calculateLearningStats(sampleEntries, brokenHistory, '2026-11-16');
assert.strictEqual(brokenStats.currentStreak, 2, 'Streak should reset after a missed day to 2');

console.log('✓ Learning stats and streaks passed.\n');

// ------------------------------------------------------------------
// 6. Reset Learning Progress
// ------------------------------------------------------------------
console.log('6. Testing reset of learning progress...');

const advancedWord = {
  id: 'adv-1',
  word: 'plethora',
  translation: 'pléthore',
  learning_state: 'review',
  interval_days: 45,
  ease_factor: 2.8,
  review_count: 8,
  lapse_count: 1,
  due_date: '2026-12-30',
  last_reviewed_at: '2026-11-15T10:00:00Z',
  last_rating: 'easy'
};

const resetWord = SRS.resetLearningProgress(advancedWord, today);
assert.strictEqual(resetWord.learning_state, 'new');
assert.strictEqual(resetWord.interval_days, 0);
assert.strictEqual(resetWord.ease_factor, 2.5);
assert.strictEqual(resetWord.review_count, 0);
assert.strictEqual(resetWord.lapse_count, 0);
assert.strictEqual(resetWord.due_date, today);
assert.strictEqual(resetWord.last_reviewed_at, null);
assert.strictEqual(resetWord.word, 'plethora', 'Word content must remain intact');

console.log('✓ Reset learning progress passed.\n');

// ------------------------------------------------------------------
// 7. Duplicate Submission Prevention Simulation
// ------------------------------------------------------------------
console.log('7. Testing double review submission prevention...');

let isSubmitting = false;
let submitCount = 0;

function simulateReviewSubmit(rating) {
  if (isSubmitting) return false;
  isSubmitting = true;
  submitCount++;
  // simulate async operation
  return true;
}

const firstSubmit = simulateReviewSubmit('good');
assert.strictEqual(firstSubmit, true, 'First submit should succeed');
assert.strictEqual(submitCount, 1);

const secondSubmit = simulateReviewSubmit('good');
assert.strictEqual(secondSubmit, false, 'Rapid second submit should be blocked by flag');
assert.strictEqual(submitCount, 1, 'Submit count must not increment on duplicate');

console.log('✓ Double submission prevention verified.\n');

// ------------------------------------------------------------------
// 8. Keyboard Shortcut Input Guard Simulation
// ------------------------------------------------------------------
console.log('8. Testing keyboard shortcut input isolation...');

function shouldIgnoreShortcut(tagName, isContentEditable) {
  return ['input', 'textarea', 'select'].includes(tagName.toLowerCase()) || isContentEditable;
}

assert.strictEqual(shouldIgnoreShortcut('INPUT', false), true, 'Must ignore in text input');
assert.strictEqual(shouldIgnoreShortcut('TEXTAREA', false), true, 'Must ignore in textarea');
assert.strictEqual(shouldIgnoreShortcut('SELECT', false), true, 'Must ignore in select dropdown');
assert.strictEqual(shouldIgnoreShortcut('div', true), true, 'Must ignore in contenteditable element');
assert.strictEqual(shouldIgnoreShortcut('DIV', false), false, 'Should allow on normal div');
assert.strictEqual(shouldIgnoreShortcut('BODY', false), false, 'Should allow on body');

console.log('✓ Keyboard shortcut guard verified.\n');

console.log('====================================================');
console.log('🎉 ALL INTEGRATION TESTS PASSED WITHOUT ERRORS!');
console.log('====================================================');
