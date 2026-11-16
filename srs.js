/**
 * Spaced Repetition System (SRS) Module
 * Based on the SuperMemo-2 (SM-2) algorithm adapted for vocabulary learning.
 *
 * Parameters & States:
 * - learning_state: "new" | "learning" | "review" | "relearning"
 * - ease_factor: minimum 1.3, default 2.5
 * - interval_days: days until next review (0 = due same day / immediate)
 * - due_date: YYYY-MM-DD
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SRS = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /**
   * Returns YYYY-MM-DD representation of a Date object in local time.
   */
  function formatDateToDayString(date = new Date()) {
    const d = new Date(date);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  /**
   * Adds specified number of calendar days to a YYYY-MM-DD string or Date.
   */
  function addDays(dateInput, days) {
    let d;
    if (typeof dateInput === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateInput)) {
      const [y, m, day] = dateInput.split('-').map(Number);
      d = new Date(y, m - 1, day);
    } else {
      d = new Date(dateInput);
    }
    d.setDate(d.getDate() + Number(days));
    return formatDateToDayString(d);
  }

  /**
   * Difference in days between two YYYY-MM-DD strings (a - b).
   */
  function diffDays(dateA, dateB) {
    const [yA, mA, dA] = dateA.split('-').map(Number);
    const [yB, mB, dB] = dateB.split('-').map(Number);
    const tA = new Date(yA, mA - 1, dA).getTime();
    const tB = new Date(yB, mB - 1, dB).getTime();
    return Math.round((tA - tB) / 86400000);
  }

  /**
   * Checks if an entry is due for review on or before the reference date.
   */
  function isDue(entry, refDateStr = formatDateToDayString()) {
    if (!entry.due_date) return true;
    return entry.due_date <= refDateStr;
  }

  /**
   * Normalizes an entry's learning fields to ensure integrity.
   */
  function normalizeEntry(entry, todayStr = formatDateToDayString()) {
    return {
      ...entry,
      due_date: entry.due_date || todayStr,
      last_reviewed_at: entry.last_reviewed_at || null,
      review_count: Number(entry.review_count || 0),
      lapse_count: Number(entry.lapse_count || 0),
      interval_days: Number(entry.interval_days || 0),
      ease_factor: Math.max(1.3, Number(entry.ease_factor || 2.5)),
      learning_state: entry.learning_state || 'new',
      last_rating: entry.last_rating || null,
    };
  }

  /**
   * Calculates the next review schedule using the SM-2 algorithm.
   *
   * @param {Object} entry - The vocabulary item
   * @param {'again'|'hard'|'good'|'easy'} rating - Evaluation rating
   * @param {string} [todayStr] - Reference date (YYYY-MM-DD)
   * @returns {Object} Updated fields and transition metadata
   */
  function calculateSM2(entry, rating, todayStr = formatDateToDayString()) {
    const norm = normalizeEntry(entry, todayStr);
    const stateBefore = norm.learning_state;
    const intervalBefore = norm.interval_days;
    const easeBefore = norm.ease_factor;

    let stateAfter = stateBefore;
    let intervalAfter = intervalBefore;
    let easeAfter = easeBefore;
    let lapses = norm.lapse_count;
    let reviews = norm.review_count + 1;

    switch (rating) {
      case 'again': {
        // Incorrect recall: mark lapse, reset/reduce interval
        lapses += 1;
        stateAfter = stateBefore === 'new' ? 'learning' : 'relearning';
        easeAfter = Math.max(1.3, Number((easeBefore - 0.2).toFixed(2)));
        intervalAfter = 0; // Immediate re-test / 0 days
        break;
      }

      case 'hard': {
        // Difficult recall: small interval progression, ease slightly reduced
        stateAfter = stateBefore === 'new' ? 'learning' : 'review';
        easeAfter = Math.max(1.3, Number((easeBefore - 0.15).toFixed(2)));
        if (intervalBefore <= 0) {
          intervalAfter = 1;
        } else if (intervalBefore === 1) {
          intervalAfter = 2;
        } else {
          intervalAfter = Math.max(1, Math.round(intervalBefore * 1.2));
        }
        break;
      }

      case 'good': {
        // Normal correct recall: standard SM-2 interval progression
        stateAfter = 'review';
        easeAfter = Number(easeBefore.toFixed(2)); // Grade 4 keeps ease steady
        if (intervalBefore <= 0) {
          intervalAfter = 1;
        } else if (intervalBefore === 1) {
          intervalAfter = 4;
        } else {
          intervalAfter = Math.max(intervalBefore + 1, Math.round(intervalBefore * easeBefore));
        }
        break;
      }

      case 'easy': {
        // Effortless recall: larger interval jump, ease factor increased
        stateAfter = 'review';
        easeAfter = Math.min(5.0, Number((easeBefore + 0.15).toFixed(2)));
        if (intervalBefore <= 0) {
          intervalAfter = 4;
        } else if (intervalBefore === 1) {
          intervalAfter = 7;
        } else {
          intervalAfter = Math.max(intervalBefore + 2, Math.round(intervalBefore * easeBefore * 1.3));
        }
        break;
      }

      default:
        throw new Error(`Invalid review rating: ${rating}`);
    }

    const nextDueDate = addDays(todayStr, intervalAfter);

    return {
      learning_state: stateAfter,
      interval_days: intervalAfter,
      ease_factor: easeAfter,
      review_count: reviews,
      lapse_count: lapses,
      last_reviewed_at: new Date().toISOString(),
      last_rating: rating,
      due_date: nextDueDate,

      // Metadata for review history log
      _history: {
        learning_state_before: stateBefore,
        learning_state_after: stateAfter,
        interval_before: intervalBefore,
        interval_after: intervalAfter,
        ease_factor_before: easeBefore,
        ease_factor_after: easeAfter,
        rating: rating,
      }
    };
  }

  /**
   * Resets learning progress for a word back to 'new' state.
   */
  function resetLearningProgress(entry, todayStr = formatDateToDayString()) {
    return {
      ...entry,
      learning_state: 'new',
      interval_days: 0,
      ease_factor: 2.5,
      review_count: 0,
      lapse_count: 0,
      last_reviewed_at: null,
      last_rating: null,
      due_date: todayStr,
    };
  }

  /**
   * Prioritized Smart Queue Generator.
   * Priority:
   * 1. Overdue cards (due_date < today)
   * 2. Due today (due_date == today)
   * 3. Relearning & Learning cards that need another review
   * 4. New cards according to daily new-word limit
   */
  function buildReviewQueue({
    entries = [],
    reviewHistory = [],
    mode = 'due', // 'due' | 'all' | 'new' | 'favorites' | 'tag' | 'pair'
    tag = '',
    pair = '',
    dailyNewLimit = 10,
    sessionSize = 20,
    todayStr = formatDateToDayString()
  }) {
    let pool = entries.map((e) => normalizeEntry(e, todayStr));

    // Optional tag filter
    if (tag) {
      pool = pool.filter((e) => Array.isArray(e.tags) && e.tags.includes(tag));
    }

    // Optional language pair filter
    if (pair) {
      pool = pool.filter((e) => [e.language_from, e.language_to].filter(Boolean).join(' → ') === pair);
    }

    // Explicit modes
    if (mode === 'favorites') {
      pool = pool.filter((e) => e.is_favorite);
    } else if (mode === 'new') {
      pool = pool.filter((e) => e.learning_state === 'new');
    }

    if (mode === 'all') {
      // In 'all' mode, user explicitly requested reviewing all vocabulary
      // Order by due date, then new
      pool.sort((a, b) => {
        if (a.due_date !== b.due_date) return a.due_date.localeCompare(b.due_date);
        return new Date(b.created_at) - new Date(a.created_at);
      });
      const limit = sessionSize === 'all' ? pool.length : Number(sessionSize);
      return pool.slice(0, limit);
    }

    if (mode === 'new') {
      // Return new words up to session size
      const limit = sessionSize === 'all' ? pool.length : Number(sessionSize);
      return pool.slice(0, limit);
    }

    // For 'due' mode and filtered modes ('favorites', 'tag', 'pair' when not in 'all' mode):
    // Calculate new words already reviewed today
    const newWordsReviewedToday = reviewHistory.filter((h) => {
      if (!h.reviewed_at) return false;
      const hDate = formatDateToDayString(new Date(h.reviewed_at));
      return hDate === todayStr && h.learning_state_before === 'new';
    }).length;

    const remainingNewQuota = Math.max(0, dailyNewLimit - newWordsReviewedToday);

    const overdue = [];
    const dueToday = [];
    const inLearning = [];
    const newCards = [];

    pool.forEach((entry) => {
      if (entry.learning_state === 'new') {
        newCards.push(entry);
      } else if (entry.due_date < todayStr) {
        overdue.push(entry);
      } else if (entry.due_date === todayStr) {
        if (entry.learning_state === 'learning' || entry.learning_state === 'relearning') {
          inLearning.push(entry);
        } else {
          dueToday.push(entry);
        }
      } else if (entry.learning_state === 'learning' || entry.learning_state === 'relearning') {
        // Learning cards can be reviewed same day
        inLearning.push(entry);
      }
    });

    // Sort overdue by most overdue first
    overdue.sort((a, b) => a.due_date.localeCompare(b.due_date));

    // Sort dueToday by review count / interval
    dueToday.sort((a, b) => a.interval_days - b.interval_days);

    // Limit new cards to remaining daily quota (unless mode is explicitly favorites/tag/pair and user has words)
    const allowedNewCards = newCards.slice(0, remainingNewQuota);

    // Priority order: Overdue -> Due Today -> Learning/Relearning -> New
    const queue = [...overdue, ...dueToday, ...inLearning, ...allowedNewCards];

    const limit = sessionSize === 'all' ? queue.length : Number(sessionSize);
    return queue.slice(0, limit);
  }

  /**
   * Calculates comprehensive learning statistics from real database records.
   */
  function calculateLearningStats(entries = [], reviewHistory = [], todayStr = formatDateToDayString()) {
    const normalized = entries.map((e) => normalizeEntry(e, todayStr));

    const totalVocabulary = normalized.length;
    let newWords = 0;
    let learningWords = 0;
    let reviewWords = 0;
    let relearningWords = 0;
    let dueToday = 0;
    let masteredWords = 0;

    normalized.forEach((entry) => {
      switch (entry.learning_state) {
        case 'new':
          newWords++;
          break;
        case 'learning':
          learningWords++;
          break;
        case 'review':
          reviewWords++;
          break;
        case 'relearning':
          relearningWords++;
          break;
      }

      if (isDue(entry, todayStr) && entry.learning_state !== 'new') {
        dueToday++;
      } else if (entry.learning_state === 'new') {
        // Counted separately
      }

      if (entry.interval_days >= 21 || (entry.learning_state === 'review' && entry.review_count >= 3 && entry.lapse_count === 0)) {
        masteredWords++;
      }
    });

    const totalReviews = reviewHistory.length;

    // Calculate streak: consecutive days counting backward from today or yesterday
    const activeDates = new Set(
      reviewHistory
        .filter((h) => h.reviewed_at)
        .map((h) => formatDateToDayString(new Date(h.reviewed_at)))
    );

    let streak = 0;
    let checkDate = todayStr;

    // If no reviews today yet, check if there was a review yesterday to keep streak alive
    if (!activeDates.has(checkDate)) {
      const yesterday = addDays(checkDate, -1);
      if (activeDates.has(yesterday)) {
        checkDate = yesterday;
      }
    }

    while (activeDates.has(checkDate)) {
      streak++;
      checkDate = addDays(checkDate, -1);
    }

    // Weekly activity for the last 7 calendar days
    const weeklyActivity = [];
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    for (let i = 6; i >= 0; i--) {
      const dStr = addDays(todayStr, -i);
      const [y, m, d] = dStr.split('-').map(Number);
      const dayObj = new Date(y, m - 1, d);
      const count = reviewHistory.filter((h) => {
        if (!h.reviewed_at) return false;
        return formatDateToDayString(new Date(h.reviewed_at)) === dStr;
      }).length;

      weeklyActivity.push({
        date: dStr,
        dayName: dayNames[dayObj.getDay()],
        isToday: dStr === todayStr,
        count: count,
      });
    }

    return {
      totalVocabulary,
      newWords,
      learningWords: learningWords + relearningWords,
      inLearningBreakdown: { learning: learningWords, relearning: relearningWords },
      reviewWords,
      dueToday,
      masteredWords,
      totalReviews,
      currentStreak: streak,
      weeklyActivity,
      distribution: {
        new: newWords,
        learning: learningWords,
        review: reviewWords,
        relearning: relearningWords,
      }
    };
  }

  return {
    formatDateToDayString,
    addDays,
    diffDays,
    isDue,
    normalizeEntry,
    calculateSM2,
    resetLearningProgress,
    buildReviewQueue,
    calculateLearningStats,
  };
});
