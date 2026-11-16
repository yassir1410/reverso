/**
 * Lexicon — Advanced Personal Vocabulary Learning & Review System
 * Phase 2 Implementation with Spaced Repetition (SM-2)
 */

const STORAGE_KEY = "lexicon-vocabulary-v1";
const HISTORY_KEY = "lexicon-review-history-v1";
const SETTINGS_KEY = "lexicon-settings-v1";
const DELETED_KEY = "lexicon-deleted-v1";
const THEME_KEY = "lexicon-theme";
const ACCOUNT_KEY = "lexicon-active-account-v1";
let activeAccountId = localStorage.getItem(ACCOUNT_KEY) || "local";
let isApplyingSync = false;

const coreFields = [
  "word", "translation", "example", "example_translation",
  "notes", "language_from", "language_to", "tags", "source_url"
];

const srsFields = [
  "due_date", "last_reviewed_at", "review_count",
  "lapse_count", "interval_days", "ease_factor",
  "learning_state", "last_rating"
];

const allFields = [...coreFields, ...srsFields];

const fieldLabels = {
  word: "Word / expression",
  translation: "Translation",
  example: "Example sentence",
  example_translation: "Example translation",
  notes: "Notes",
  language_from: "Language from",
  language_to: "Language to",
  tags: "Tags",
  source_url: "Reverso URL",
  due_date: "Next review date",
  learning_state: "Learning state",
  interval_days: "Interval (days)",
  ease_factor: "Ease factor"
};

const defaultSettings = {
  daily_new_limit: 10,
  session_size: "20",
  default_language_from: "English",
  default_language_to: "Arabic",
  review_algorithm: "sm2",
  daily_review_target: 20,
  show_example_on_front: false,
  hide_translation_initially: true,
  keyboard_shortcuts_enabled: true
};

// Application State
let entries = loadEntries();
let reviewHistory = loadHistory();
let settings = loadSettings();
let deletedEntries = loadDeletedEntries();
let activeView = "dashboard";
// Import State
let importedRows = [];
let importedHeaders = [];
let rawParsedRows = [];
let importHasHeader = true;
let importFileName = "";

// Review Session State
let reviewQueue = [];
let reviewIndex = 0;
let reviewAnswerRevealed = false;
let isSubmittingReview = false;
let sessionReviewHistory = []; // Tracks actions in current session for Back button and completion summary

// Bulk Selection State
let selectedIds = new Set();

// DOM Helper
const $ = (id) => document.getElementById(id);
const escapeHTML = (value = "") => String(value).replace(/[&<>"']/g, (char) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;" })[char]);
const stripHTML = (value = "") => { const el = document.createElement("div"); el.innerHTML = value.replace(/<br\s*\/?>/gi, "\n"); return (el.textContent || el.innerText || "").replace(/\u00a0/g, " ").trim(); };
const normaliseTags = (value) => [...new Set(String(value || "").split(/[,;|]/).map((tag) => tag.trim().replace(/^#/, "")).filter(Boolean))];
const formatDate = (date) => new Intl.DateTimeFormat(undefined, {month:"short", day:"numeric", year:"numeric"}).format(new Date(date));
const pairOf = (entry) => [entry.language_from, entry.language_to].filter(Boolean).join(" → ") || "Unspecified";
const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/* ==========================================================================
   Persistence & Migration
   ========================================================================== */
function loadEntries() {
  try {
    const raw = JSON.parse(localStorage.getItem(`${STORAGE_KEY}:${activeAccountId}`) || (activeAccountId === "local" ? localStorage.getItem(STORAGE_KEY) : "[]") || "[]");
    const todayStr = SRS.formatDateToDayString();
    return raw.map((entry) => SRS.normalizeEntry(entry, todayStr));
  } catch (error) {
    console.error("Could not load vocabulary entries:", error);
    return [];
  }
}

function persistEntries() {
  localStorage.setItem(`${STORAGE_KEY}:${activeAccountId}`, JSON.stringify(entries));
  queueCloudSync();
}

function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem(`${HISTORY_KEY}:${activeAccountId}`) || (activeAccountId === "local" ? localStorage.getItem(HISTORY_KEY) : "[]") || "[]");
  } catch (error) {
    console.error("Could not load review history:", error);
    return [];
  }
}

function persistHistory() {
  localStorage.setItem(`${HISTORY_KEY}:${activeAccountId}`, JSON.stringify(reviewHistory));
  queueCloudSync();
}

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(`${SETTINGS_KEY}:${activeAccountId}`) || (activeAccountId === "local" ? localStorage.getItem(SETTINGS_KEY) : "{}") || "{}");
    const merged = { ...defaultSettings, ...saved };
    // Migrate default goal language to Arabic if unset or legacy default
    if (!saved.default_language_to || saved.default_language_to === "French") {
      merged.default_language_to = "Arabic";
    }
    return merged;
  } catch (error) {
    console.error("Could not load settings:", error);
    return { ...defaultSettings };
  }
}

function persistSettings() {
  localStorage.setItem(`${SETTINGS_KEY}:${activeAccountId}`, JSON.stringify(settings));
  queueCloudSync();
}

function loadDeletedEntries() {
  try {
    return JSON.parse(localStorage.getItem(`${DELETED_KEY}:${activeAccountId}`) || "[]");
  } catch (error) {
    console.error("Could not load deletion tombstones:", error);
    return [];
  }
}

function persistDeletedEntries() {
  localStorage.setItem(`${DELETED_KEY}:${activeAccountId}`, JSON.stringify(deletedEntries));
  queueCloudSync();
}

function syncSnapshot() {
  return { entries: [...entries, ...deletedEntries], reviewHistory: [...reviewHistory], settings: { ...settings } };
}

function queueCloudSync() {
  if (!isApplyingSync && window.FirebaseSync && window.FirebaseSync.getUser() && window.LexiconSyncAdapter) {
    window.FirebaseSync.queueSync(window.LexiconSyncAdapter.snapshot, window.LexiconSyncAdapter.applyRemote);
  }
}

function applySyncedData(data) {
  isApplyingSync = true;
  const syncedEntries = (data.entries || []);
  deletedEntries = syncedEntries.filter((entry) => entry._sync?.deletedAt);
  entries = syncedEntries.filter((entry) => !entry._sync?.deletedAt).map((entry) => {
    const copy = { ...entry };
    delete copy._sync;
    return SRS.normalizeEntry(copy, SRS.formatDateToDayString());
  });
  reviewHistory = (data.reviewHistory || []).map((item) => {
    const copy = { ...item };
    delete copy._sync;
    return copy;
  });
  settings = { ...defaultSettings, ...(data.settings || {}) };
  persistEntries();
  persistHistory();
  persistSettings();
  persistDeletedEntries();
  render();

  function renderSyncStatus(status, detail = "") {
    const badge = $("sync-status");
    const detailNode = $("sync-detail");
    if (!badge || !detailNode) return;
    const labels = { connected: "Synced", syncing: "Synchronizing", connecting: "Connecting", offline: "Offline", disconnected: "Local only", error: "Sync error" };
    badge.textContent = labels[status] || status;
    badge.dataset.status = status;
    detailNode.textContent = detail || (status === "offline" ? "Changes stay safe in this browser and will sync later." : "Cloud sync is optional.");
  }

  async function switchToAccount(user) {
    if (!user) {
      activeAccountId = "local";
      localStorage.setItem(ACCOUNT_KEY, activeAccountId);
      entries = loadEntries();
      reviewHistory = loadHistory();
      settings = loadSettings();
      deletedEntries = loadDeletedEntries();
      render();
      return;
    }
    const beforeLogin = syncSnapshot();
    activeAccountId = user.uid;
    localStorage.setItem(ACCOUNT_KEY, activeAccountId);
    const accountSnapshot = syncSnapshot();
    const unique = (items) => [...new Map(items.map((item) => [item.id, item])).values()];
    entries = loadEntries();
    reviewHistory = loadHistory();
    settings = loadSettings();
    deletedEntries = loadDeletedEntries();
    try {
      await FirebaseSync.sync({
        entries: unique([...beforeLogin.entries, ...accountSnapshot.entries]),
        reviewHistory: unique([...beforeLogin.reviewHistory, ...accountSnapshot.reviewHistory]),
        settings: { ...accountSnapshot.settings, ...beforeLogin.settings }
      }, applySyncedData);
    } catch (error) {
      showToast(`Cloud sync unavailable: ${error.message}`);
      render();
    }
  }

  if (window.FirebaseSync) {
    FirebaseSync.onStatusChange(renderSyncStatus);
    FirebaseSync.onAuthChange((user) => {
      $("account-label").textContent = user ? (user.email || "Signed in with Google") : "Not signed in";
      $("google-sign-in").hidden = Boolean(user);
      $("google-sign-out").hidden = !user;
      $("sync-now").hidden = !user;
      switchToAccount(user);
    });
    $("google-sign-in")?.addEventListener("click", async () => {
      try {
        if (!FirebaseSync.isConfigured()) {
          showToast("Configure Firebase before signing in.");
          setView("settings");
          return;
        }
        await FirebaseSync.init();
        await FirebaseSync.signInWithGoogle();
      } catch (error) {
        showToast(error.message || "Google sign-in failed.");
      }
    });
    $("google-sign-out")?.addEventListener("click", () => FirebaseSync.signOut().catch((error) => showToast(error.message)));
    $("sync-now")?.addEventListener("click", () => FirebaseSync.sync(syncSnapshot, applySyncedData).catch(() => {}));
    $("configure-firebase")?.addEventListener("click", () => {
      const raw = prompt("Paste your Firebase web app configuration as JSON. Do not paste service-account credentials.");
      if (!raw) return;
      try {
        const config = JSON.parse(raw);
        FirebaseSync.saveConfig(config);
        showToast("Firebase configuration saved locally.");
        FirebaseSync.init();
      } catch (_) {
        showToast("That configuration is not valid JSON.");
      }
    });
  }
  isApplyingSync = false;
}

window.LexiconSyncAdapter = {
  snapshot: syncSnapshot,
  applyRemote: applySyncedData
};

function showToast(message) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  $("toast-region").append(toast);
  setTimeout(() => toast.remove(), 3200);
}

function openModal(id) {
  $(id).classList.add("open");
  $(id).setAttribute("aria-hidden", "false");
}

function closeModals() {
  document.querySelectorAll(".modal-backdrop").forEach((modal) => {
    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");
  });
}

function reversoUrl(entry) {
  if (entry.source_url && /^https?:\/\/([a-z0-9-]+\.)?reverso\.net\//i.test(entry.source_url)) {
    return entry.source_url;
  }
  const codes = {
    english:"english", french:"french", spanish:"spanish", german:"german",
    italian:"italian", portuguese:"portuguese", dutch:"dutch", russian:"russian",
    arabic:"arabic", chinese:"chinese", japanese:"japanese", polish:"polish", turkish:"turkish"
  };
  const from = codes[String(entry.language_from || "English").toLowerCase()] || String(entry.language_from || "English").toLowerCase();
  const to = codes[String(entry.language_to || "Arabic").toLowerCase()] || String(entry.language_to || "Arabic").toLowerCase();
  return `https://context.reverso.net/translation/${encodeURIComponent(from)}-${encodeURIComponent(to)}/${encodeURIComponent(entry.word.trim())}`;
}

function openReverso(entry) {
  if (entry) window.open(reversoUrl(entry), "_blank", "noopener,noreferrer");
}

function duplicateOf(entry, ignoreId = "") {
  const key = (item) => [item.word, item.translation, item.language_from || "", item.language_to || ""].map((part) => String(part).trim().toLocaleLowerCase()).join("\u0000");
  const target = key(entry);
  return entries.find((item) => item.id !== ignoreId && key(item) === target);
}

/* ==========================================================================
   Main Render Function
   ========================================================================== */
function render() {
  const todayStr = SRS.formatDateToDayString();
  const stats = SRS.calculateLearningStats(entries, reviewHistory, todayStr);

  renderNavBadge(stats.dueToday);
  renderDashboard(stats);
  renderReviewConfig();
  renderCollection();
  renderFavorites();
  renderTags();
  updateFilters();
  renderSettingsForm();

  $("storage-count").textContent = `${entries.length} ${entries.length === 1 ? "entry" : "entries"} saved in this browser.`;
}

function renderNavBadge(dueCount) {
  const badge = $("nav-due-badge");
  badge.textContent = dueCount;
  badge.classList.toggle("has-due", dueCount > 0);
}

/* ==========================================================================
   Dashboard View
   ========================================================================== */
function renderDashboard(stats) {
  // 1. Review Callout Banner
  const banner = $("dashboard-review-banner");
  const title = $("banner-title");
  const subtitle = $("banner-subtitle");
  const btn = $("banner-start-review");

  if (stats.dueToday > 0) {
    title.textContent = `You have ${stats.dueToday} ${stats.dueToday === 1 ? 'word' : 'words'} due for review today.`;
    subtitle.textContent = "Keep your memory fresh with a quick spaced repetition session.";
    btn.textContent = "Start review";
    btn.className = "button button-primary";
  } else if (stats.newWords > 0) {
    title.textContent = "All caught up on due reviews!";
    subtitle.textContent = `You have ${stats.newWords} new ${stats.newWords === 1 ? 'word' : 'words'} ready to learn.`;
    btn.textContent = "Learn new words";
    btn.className = "button button-secondary";
  } else {
    title.textContent = "Your vocabulary is up to date.";
    subtitle.textContent = "No words are due today. Add new words or practice all vocabulary.";
    btn.textContent = "Review all words";
    btn.className = "button button-secondary";
  }

  // 2. Learning Statistics Grid (7 metrics)
  const items = [
    ["Total vocabulary", stats.totalVocabulary],
    ["Due today", stats.dueToday],
    ["Learning", stats.learningWords],
    ["Mastered", stats.masteredWords],
    ["New words", stats.newWords],
    ["Total reviews", stats.totalReviews],
    ["Learning streak", `${stats.currentStreak} ${stats.currentStreak === 1 ? 'day' : 'days'} 🔥`]
  ];

  $("stats-grid").innerHTML = items.map(([label, val]) => `
    <div class="stat">
      <div class="stat-label">${label}</div>
      <div class="stat-value">${val}</div>
    </div>
  `).join("");

  // 3. Streak indicator & Weekly Activity Chart
  $("streak-indicator").textContent = `${stats.currentStreak} day streak 🔥`;

  const maxWeeklyCount = Math.max(...stats.weeklyActivity.map((d) => d.count), 1);
  $("weekly-chart").innerHTML = stats.weeklyActivity.map((day) => {
    const heightPercent = day.count === 0 ? 0 : Math.max(10, Math.round((day.count / maxWeeklyCount) * 100));
    return `
      <div class="chart-col ${day.isToday ? 'is-today' : ''}" title="${day.date}: ${day.count} reviews">
        <span class="chart-count">${day.count > 0 ? day.count : ''}</span>
        <div class="chart-bar-wrap">
          <div class="chart-bar-fill ${day.count === 0 ? 'zero' : ''}" style="height: ${heightPercent}%;"></div>
        </div>
        <span class="chart-label">${day.dayName}</span>
      </div>
    `;
  }).join("");

  // 4. Learning State Progress Breakdown
  const total = Math.max(stats.totalVocabulary, 1);
  const pNew = ((stats.distribution.new / total) * 100).toFixed(1);
  const pLearning = ((stats.distribution.learning / total) * 100).toFixed(1);
  const pReview = ((stats.distribution.review / total) * 100).toFixed(1);
  const pRelearning = ((stats.distribution.relearning / total) * 100).toFixed(1);

  $("progress-breakdown").innerHTML = `
    <div class="stacked-progress-bar" title="New: ${pNew}%, Learning: ${pLearning}%, Review: ${pReview}%, Relearning: ${pRelearning}%">
      <div class="segment-fill segment-new" style="width: ${pNew}%;"></div>
      <div class="segment-fill segment-learning" style="width: ${pLearning}%;"></div>
      <div class="segment-fill segment-review" style="width: ${pReview}%;"></div>
      <div class="segment-fill segment-relearning" style="width: ${pRelearning}%;"></div>
    </div>
    <div class="progress-legend">
      <div class="legend-item"><span class="legend-dot segment-new"></span> New <strong>${stats.distribution.new}</strong></div>
      <div class="legend-item"><span class="legend-dot segment-learning"></span> Learning <strong>${stats.distribution.learning}</strong></div>
      <div class="legend-item"><span class="legend-dot segment-review"></span> Review <strong>${stats.distribution.review}</strong></div>
      <div class="legend-item"><span class="legend-dot segment-relearning"></span> Relearning <strong>${stats.distribution.relearning}</strong></div>
    </div>
  `;

  // 5. Recent Words List
  const recent = [...entries].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 5);
  $("recent-list").innerHTML = recent.length ? recent.map((entry) => `
    <div class="word-row">
      <div class="word-main">
        <button class="word-link" data-detail="${entry.id}">${escapeHTML(entry.word)}</button>
        <span class="translation">— ${escapeHTML(entry.translation)}</span>
        <div class="item-meta">
          <span class="state-pill state-${entry.learning_state}">${entry.learning_state}</span>
          ${tagsHTML(entry)}
        </div>
      </div>
      <span class="row-date">${formatDate(entry.created_at)}</span>
      <button class="star ${entry.is_favorite ? "favorite" : ""}" data-favorite="${entry.id}" aria-label="Favorite">
        ${entry.is_favorite ? "★" : "☆"}
      </button>
    </div>
  `).join("") : emptyState("Your collection is waiting", "Add your first word to get started.");

  // 6. Language breakdown
  const counts = entries.reduce((acc, entry) => {
    const pair = pairOf(entry);
    acc[pair] = (acc[pair] || 0) + 1;
    return acc;
  }, {});
  const max = Math.max(...Object.values(counts), 1);
  $("language-breakdown").innerHTML = Object.keys(counts).length ? Object.entries(counts).sort((a,b) => b[1] - a[1]).slice(0, 6).map(([pair, count]) => `
    <div class="language-item">
      <div class="language-label"><span>${escapeHTML(pair)}</span><span>${count}</span></div>
      <div class="bar"><i style="width:${Math.max(8, (count / max) * 100)}%"></i></div>
    </div>
  `).join("") : emptyState("No language pairs yet", "They will appear as you add vocabulary.");
}

function wordHTML(entry) {
  return `<button class="word-link" data-detail="${entry.id}">${escapeHTML(entry.word)}</button><span class="translation">— ${escapeHTML(entry.translation)}</span>`;
}

function tagsHTML(entry) {
  return normaliseTags(entry.tags).map((tag) => `<span class="tag">${escapeHTML(tag)}</span>`).join("");
}

function emptyState(title, message) {
  return `<div class="empty-state"><strong>${title}</strong>${message}</div>`;
}

/* ==========================================================================
   Review Mode & Spaced Repetition Engine
   ========================================================================== */
function renderReviewConfig() {
  const mode = $("review-filter-mode").value;
  const tagSelect = $("review-tag-select");
  const pairSelect = $("review-pair-select");
  const size = $("review-size-select").value;

  $("config-tag-field").style.display = mode === "tag" ? "grid" : "none";
  $("config-pair-field").style.display = mode === "pair" ? "grid" : "none";

  const queue = SRS.buildReviewQueue({
    entries,
    reviewHistory,
    mode,
    tag: tagSelect.value,
    pair: pairSelect.value,
    dailyNewLimit: Number(settings.daily_new_limit),
    sessionSize: size,
    todayStr: SRS.formatDateToDayString()
  });

  $("session-eligible-count").textContent = `${queue.length} ${queue.length === 1 ? 'word' : 'words'}`;
  $("start-session-btn").disabled = queue.length === 0;
  $("start-session-btn").style.opacity = queue.length === 0 ? "0.5" : "1";
}

function startReviewSession() {
  const mode = $("review-filter-mode").value;
  const tag = $("review-tag-select").value;
  const pair = $("review-pair-select").value;
  const size = $("review-size-select").value;

  reviewQueue = SRS.buildReviewQueue({
    entries,
    reviewHistory,
    mode,
    tag,
    pair,
    dailyNewLimit: Number(settings.daily_new_limit),
    sessionSize: size,
    todayStr: SRS.formatDateToDayString()
  });

  if (reviewQueue.length === 0) {
    showToast("No words eligible for this review session.");
    return;
  }

  reviewIndex = 0;
  reviewAnswerRevealed = false;
  isSubmittingReview = false;
  sessionReviewHistory = [];

  $("review-config-screen").style.display = "none";
  $("review-complete-screen").style.display = "none";
  $("review-active-screen").style.display = "block";

  renderCurrentCard();
}

function exitReviewSession() {
  if (reviewIndex < reviewQueue.length && reviewIndex > 0) {
    if (!confirm("Exit this review session? Completed reviews have been saved.")) {
      return;
    }
  }

  $("review-active-screen").style.display = "none";
  $("review-complete-screen").style.display = "none";
  $("review-config-screen").style.display = "block";
  renderReviewConfig();
}

function renderCurrentCard() {
  if (reviewIndex >= reviewQueue.length) {
    finishReviewSession();
    return;
  }

  reviewAnswerRevealed = false;
  isSubmittingReview = false;

  const current = reviewQueue[reviewIndex];
  const total = reviewQueue.length;
  const currentNum = reviewIndex + 1;
  const remaining = total - reviewIndex;

  // Header meta
  $("session-position-text").textContent = `Card ${currentNum} of ${total}`;
  $("session-remaining-text").textContent = `${remaining} remaining`;
  $("session-progress-fill").style.width = `${((reviewIndex) / total) * 100}%`;

  const stateBadge = $("review-card-state");
  stateBadge.textContent = current.learning_state;
  stateBadge.className = `state-pill state-${current.learning_state}`;

  // Card Front
  $("card-pair-badge").textContent = pairOf(current);
  $("card-tags-list").innerHTML = tagsHTML(current);
  $("card-prompt-word").textContent = current.word;

  if (settings.show_example_on_front && current.example) {
    $("card-front-example").textContent = `“${current.example}”`;
    $("card-front-example").style.display = "block";
  } else {
    $("card-front-example").style.display = "none";
  }

  // Answer Section (Initially hidden)
  $("review-back").style.display = "none";
  $("reveal-area").style.display = "block";
  $("rating-area").style.display = "none";

  // Pre-fill answer section
  $("card-answer-translation").textContent = current.translation;

  if (current.example) {
    $("card-example-source").textContent = current.example;
    $("card-example-target").textContent = current.example_translation || "";
    $("card-example-section").style.display = "block";
  } else {
    $("card-example-section").style.display = "none";
  }

  if (current.notes) {
    $("card-notes-body").textContent = current.notes;
    $("card-notes-section").style.display = "block";
  } else {
    $("card-notes-section").style.display = "none";
  }

  const reversoWrap = $("card-reverso-wrap");
  const reversoBtn = $("card-reverso-btn");
  if (current.word) {
    reversoWrap.style.display = "block";
    reversoBtn.onclick = () => openReverso(current);
  } else {
    reversoWrap.style.display = "none";
  }

  // Calculate upcoming intervals for each rating button
  const todayStr = SRS.formatDateToDayString();
  const againSim = SRS.calculateSM2(current, "again", todayStr);
  const hardSim = SRS.calculateSM2(current, "hard", todayStr);
  const goodSim = SRS.calculateSM2(current, "good", todayStr);
  const easySim = SRS.calculateSM2(current, "easy", todayStr);

  $("interval-again").textContent = "< 1d";
  $("interval-hard").textContent = `${hardSim.interval_days}d`;
  $("interval-good").textContent = `${goodSim.interval_days}d`;
  $("interval-easy").textContent = `${easySim.interval_days}d`;

  // Previous card button visibility
  $("review-prev-btn").style.visibility = reviewIndex > 0 ? "visible" : "hidden";
}

function revealAnswer() {
  if (reviewAnswerRevealed) return;
  reviewAnswerRevealed = true;

  $("review-back").style.display = "block";
  $("reveal-area").style.display = "none";
  $("rating-area").style.display = "block";

  // Focus primary rating button for accessibility
  const goodBtn = document.querySelector(".rating-good");
  if (goodBtn) goodBtn.focus();
}

function handleRating(rating) {
  if (!reviewAnswerRevealed || isSubmittingReview) return;
  isSubmittingReview = true;

  const current = reviewQueue[reviewIndex];
  const todayStr = SRS.formatDateToDayString();
  const update = SRS.calculateSM2(current, rating, todayStr);

  // 1. Create review history record
  const historyRecord = {
    id: uid(),
    word_id: current.id,
    word: current.word,
    reviewed_at: update.last_reviewed_at,
    rating: rating,
    interval_before: update._history.interval_before,
    interval_after: update._history.interval_after,
    ease_factor_before: update._history.ease_factor_before,
    ease_factor_after: update._history.ease_factor_after,
    learning_state_before: update._history.learning_state_before,
    learning_state_after: update._history.learning_state_after
  };

  reviewHistory.unshift(historyRecord);
  persistHistory();

  // 2. Update entry in database
  const entryIdx = entries.findIndex((e) => e.id === current.id);
  if (entryIdx !== -1) {
    entries[entryIdx] = {
      ...entries[entryIdx],
      learning_state: update.learning_state,
      interval_days: update.interval_days,
      ease_factor: update.ease_factor,
      review_count: update.review_count,
      lapse_count: update.lapse_count,
      last_reviewed_at: update.last_reviewed_at,
      last_rating: update.last_rating,
      due_date: update.due_date,
      updated_at: new Date().toISOString()
    };
    persistEntries();
  }

  // 3. Track session history
  sessionReviewHistory.push({
    entry: current,
    record: historyRecord,
    rating: rating
  });

  // 4. If rating was "again", optionally re-insert card at end of session queue for immediate retry
  if (rating === "again") {
    reviewQueue.push({ ...current, ...update });
  }

  // 5. Advance to next card
  reviewIndex++;
  setTimeout(() => {
    renderCurrentCard();
  }, 120);
}

function handlePreviousCard() {
  if (reviewIndex <= 0) return;
  reviewIndex--;
  renderCurrentCard();
}

function finishReviewSession() {
  $("review-active-screen").style.display = "none";
  $("review-complete-screen").style.display = "block";

  const total = sessionReviewHistory.length;
  const againCount = sessionReviewHistory.filter(h => h.rating === "again").length;
  const hardCount = sessionReviewHistory.filter(h => h.rating === "hard").length;
  const goodCount = sessionReviewHistory.filter(h => h.rating === "good").length;
  const easyCount = sessionReviewHistory.filter(h => h.rating === "easy").length;

  $("complete-total-count").textContent = total;
  $("complete-again-count").textContent = againCount;
  $("complete-hard-count").textContent = hardCount;
  $("complete-good-count").textContent = goodCount;
  $("complete-easy-count").textContent = easyCount;

  // Refresh overall application data
  render();
}

/* ==========================================================================
   Collection View & Bulk Actions
   ========================================================================== */
function filteredEntries(source = entries) {
  const query = ($("search-input")?.value || "").trim().toLocaleLowerCase();
  const state = $("state-filter")?.value || "";
  const language = $("language-filter")?.value || "";
  const tag = $("tag-filter")?.value || "";
  const todayStr = SRS.formatDateToDayString();

  const result = source.filter((entry) => {
    // Search query matches word, translation, example, or notes
    if (query) {
      const haystack = [entry.word, entry.translation, entry.example, entry.notes].join(" ").toLocaleLowerCase();
      if (!haystack.includes(query)) return false;
    }

    // State filter
    if (state) {
      if (state === "due") {
        if (!SRS.isDue(entry, todayStr)) return false;
      } else if (state === "mastered") {
        if (entry.interval_days < 21) return false;
      } else if (entry.learning_state !== state) {
        return false;
      }
    }

    // Language pair filter
    if (language && pairOf(entry) !== language) return false;

    // Tag filter
    if (tag && !normaliseTags(entry.tags).includes(tag)) return false;

    return true;
  });

  const sort = $("sort-select")?.value || "newest";
  return result.sort((a, b) => {
    switch (sort) {
      case "az":
        return a.word.localeCompare(b.word);
      case "za":
        return b.word.localeCompare(a.word);
      case "oldest":
        return new Date(a.created_at) - new Date(b.created_at);
      case "due":
        return (a.due_date || "").localeCompare(b.due_date || "");
      case "most-reviewed":
        return (b.review_count || 0) - (a.review_count || 0);
      case "least-reviewed":
        return (a.review_count || 0) - (b.review_count || 0);
      case "newest":
      default:
        return new Date(b.created_at) - new Date(a.created_at);
    }
  });
}

function renderCollection() {
  const list = filteredEntries();
  const todayStr = SRS.formatDateToDayString();

  if (list.length === 0) {
    $("collection-list").innerHTML = emptyState("Nothing found", "Try another search filter or add a new word.");
    $("collection-subtitle").textContent = "0 words in view";
    updateBulkBar();
    return;
  }

  $("collection-subtitle").textContent = `${list.length} ${list.length === 1 ? "word" : "words"} in view`;

  $("collection-list").innerHTML = list.map((entry) => {
    const isSelected = selectedIds.has(entry.id);
    const dueLabel = entry.due_date ? (entry.due_date <= todayStr ? "Due today" : `Due ${formatDate(entry.due_date)}`) : "No due date";

    return `
      <div class="collection-item ${isSelected ? 'is-selected' : ''}" data-id="${entry.id}">
        <label class="item-select-wrap" aria-label="Select ${escapeHTML(entry.word)}">
          <input type="checkbox" class="entry-checkbox" data-select="${entry.id}" ${isSelected ? 'checked' : ''} />
        </label>
        <div class="word-main">
          <div style="display: flex; align-items: baseline; gap: 8px;">
            <button class="word-link" data-detail="${entry.id}">${escapeHTML(entry.word)}</button>
            <span class="translation">— ${escapeHTML(entry.translation)}</span>
          </div>
          <div class="item-meta">
            <span class="state-pill state-${entry.learning_state}">${entry.learning_state}</span>
            <span style="font-family: var(--font-mono); font-size: 11px;">${dueLabel}</span>
            <span>${escapeHTML(pairOf(entry))}</span>
            ${tagsHTML(entry)}
            <span>${formatDate(entry.created_at)}</span>
          </div>
        </div>
        <div class="item-actions">
          <button class="star ${entry.is_favorite ? "favorite" : ""}" data-favorite="${entry.id}" aria-label="Favorite">
            ${entry.is_favorite ? "★" : "☆"}
          </button>
          <button class="small-action" data-edit="${entry.id}" aria-label="Edit">✎</button>
          <button class="small-action delete" data-delete="${entry.id}" aria-label="Delete">×</button>
        </div>
      </div>
    `;
  }).join("");

  updateBulkBar();
}

function updateBulkBar() {
  const bar = $("bulk-bar");
  const countLabel = $("bulk-count-label");
  const selectAll = $("bulk-select-all");

  const count = selectedIds.size;
  if (count > 0) {
    bar.style.display = "flex";
    countLabel.textContent = `${count} ${count === 1 ? 'word' : 'words'} selected`;
    const list = filteredEntries();
    selectAll.checked = list.length > 0 && list.every((e) => selectedIds.has(e.id));
  } else {
    bar.style.display = "none";
    selectAll.checked = false;
  }
}

function toggleSelectAll(checked) {
  const list = filteredEntries();
  if (checked) {
    list.forEach((entry) => selectedIds.add(entry.id));
  } else {
    selectedIds.clear();
  }
  renderCollection();
}

function bulkAddTag(tagName) {
  const norm = normaliseTags(tagName)[0];
  if (!norm) return;

  entries = entries.map((entry) => {
    if (selectedIds.has(entry.id)) {
      const existing = normaliseTags(entry.tags);
      if (!existing.includes(norm)) {
        return { ...entry, tags: [...existing, norm], updated_at: new Date().toISOString() };
      }
    }
    return entry;
  });

  persistEntries();
  selectedIds.clear();
  render();
  showToast(`Added tag #${norm} to selected words`);
}

function bulkRemoveTag(tagName) {
  if (!tagName) return;

  entries = entries.map((entry) => {
    if (selectedIds.has(entry.id)) {
      const existing = normaliseTags(entry.tags);
      return { ...entry, tags: existing.filter((t) => t !== tagName), updated_at: new Date().toISOString() };
    }
    return entry;
  });

  persistEntries();
  selectedIds.clear();
  render();
  showToast(`Removed tag #${tagName} from selected words`);
}

function bulkToggleFavorites() {
  const selectedEntries = entries.filter((e) => selectedIds.has(e.id));
  const anyNotFav = selectedEntries.some((e) => !e.is_favorite);

  entries = entries.map((entry) => {
    if (selectedIds.has(entry.id)) {
      return { ...entry, is_favorite: anyNotFav, updated_at: new Date().toISOString() };
    }
    return entry;
  });

  persistEntries();
  render();
  showToast(anyNotFav ? "Marked selected as favorites" : "Unmarked selected favorites");
}

function bulkDelete() {
  const count = selectedIds.size;
  if (!count) return;

  if (!confirm(`Delete ${count} ${count === 1 ? 'word' : 'words'}? This cannot be undone.`)) {
    return;
  }

  const removedEntries = entries.filter((entry) => selectedIds.has(entry.id));
  entries = entries.filter((entry) => !selectedIds.has(entry.id));
  deletedEntries.push(...[...selectedIds].map((id) => {
    const previous = removedEntries.find((entry) => entry.id === id);
    const now = new Date().toISOString();
    return { id, _sync: { revision: Number(previous?._sync?.revision || 0) + 1, updatedAt: now, deviceId: "local", deletedAt: now, pending: true } };
  }));
  persistEntries();
  persistDeletedEntries();
  selectedIds.clear();
  render();
  showToast(`Deleted ${count} ${count === 1 ? 'word' : 'words'}`);
}

function bulkExport() {
  const selectedEntries = entries.filter((e) => selectedIds.has(e.id));
  if (!selectedEntries.length) return;

  const name = `lexicon-selected-${new Date().toISOString().slice(0, 10)}`;
  download(`${name}.json`, JSON.stringify(selectedEntries, null, 2), "application/json");
  showToast(`Exported ${selectedEntries.length} words to JSON`);
}

/* ==========================================================================
   Favorites & Tags Views
   ========================================================================== */
function renderFavorites() {
  const list = entries.filter((entry) => entry.is_favorite).sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
  $("favorites-list").innerHTML = list.length ? list.map((entry) => `
    <div class="collection-item">
      <div class="word-main">
        <div style="display: flex; align-items: baseline; gap: 8px;">
          <button class="word-link" data-detail="${entry.id}">${escapeHTML(entry.word)}</button>
          <span class="translation">— ${escapeHTML(entry.translation)}</span>
        </div>
        <div class="item-meta">
          <span class="state-pill state-${entry.learning_state}">${entry.learning_state}</span>
          <span>${escapeHTML(pairOf(entry))}</span>
          ${tagsHTML(entry)}
        </div>
      </div>
      <div class="item-actions">
        <button class="star favorite" data-favorite="${entry.id}" aria-label="Favorite">★</button>
        <button class="small-action" data-edit="${entry.id}" aria-label="Edit">✎</button>
      </div>
    </div>
  `).join("") : emptyState("No favorites yet", "Tap the star beside a word to keep it close.");
}

function renderTags() {
  const counts = {};
  entries.forEach((entry) => normaliseTags(entry.tags).forEach((tag) => counts[tag] = (counts[tag] || 0) + 1));
  $("tag-grid").innerHTML = Object.keys(counts).length ? Object.entries(counts).sort((a,b) => a[0].localeCompare(b[0])).map(([tag,count]) => `
    <div class="tag-card" data-tag="${escapeHTML(tag)}">
      <strong>#${escapeHTML(tag)}</strong>
      <span>${count} ${count === 1 ? "word" : "words"}</span>
    </div>
  `).join("") : emptyState("No tags yet", "Tags make larger collections easier to browse.");
}

function updateFilters() {
  const pairs = [...new Set(entries.map(pairOf))].sort();
  const tags = [...new Set(entries.flatMap((entry) => normaliseTags(entry.tags)))].sort();

  const updateSelect = (id, values, label) => {
    const select = $(id);
    if (!select) return;
    const current = select.value;
    select.innerHTML = `<option value="">${label}</option>` + values.map((value) => `<option value="${escapeHTML(value)}">${escapeHTML(value)}</option>`).join("");
    if (values.includes(current)) select.value = current;
  };

  updateSelect("language-filter", pairs, "All language pairs");
  updateSelect("tag-filter", tags, "All tags");
  updateSelect("review-tag-select", tags, "Select a tag");
  updateSelect("review-pair-select", pairs, "Select a language pair");
}

/* ==========================================================================
   Vocabulary Detail Modal
   ========================================================================== */
function openDetailModal(id) {
  const entry = entries.find((e) => e.id === id);
  if (!entry) return;

  $("detail-kicker").textContent = pairOf(entry);
  $("detail-word-title").textContent = entry.word;

  const history = reviewHistory.filter((h) => h.word_id === entry.id);

  const historyRows = history.length ? history.map((h) => `
    <tr>
      <td>${formatDate(h.reviewed_at)}</td>
      <td><span class="rating-badge rating-${h.rating}">${h.rating}</span></td>
      <td>${h.interval_before || 0}d → ${h.interval_after || 0}d</td>
      <td><span class="state-pill state-${h.learning_state_after}">${h.learning_state_after}</span></td>
    </tr>
  `).join("") : `<tr><td colspan="4" style="color: var(--muted); text-align: center; padding: 16px;">No reviews recorded yet.</td></tr>`;

  $("detail-content").innerHTML = `
    <div class="detail-translation-box">
      <div class="detail-translation-label">Translation</div>
      <div class="detail-translation-text">${escapeHTML(entry.translation)}</div>
    </div>

    ${entry.example ? `
      <div class="example-section" style="margin-bottom: var(--space-16);">
        <div class="example-source">${escapeHTML(entry.example)}</div>
        <div class="example-target">${escapeHTML(entry.example_translation || "")}</div>
      </div>
    ` : ""}

    ${entry.notes ? `
      <div class="notes-section" style="margin-bottom: var(--space-16);">
        <span class="notes-label">Notes:</span>
        <span class="notes-body">${escapeHTML(entry.notes)}</span>
      </div>
    ` : ""}

    <div style="display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: var(--space-16);">
      ${tagsHTML(entry)}
    </div>

    <div class="detail-srs-grid">
      <div class="detail-srs-stat">
        <span>Learning state</span>
        <strong><span class="state-pill state-${entry.learning_state}">${entry.learning_state}</span></strong>
      </div>
      <div class="detail-srs-stat">
        <span>Next review</span>
        <strong>${entry.due_date ? formatDate(entry.due_date) : "Immediate"}</strong>
      </div>
      <div class="detail-srs-stat">
        <span>Interval / Ease</span>
        <strong>${entry.interval_days || 0}d · ${Number(entry.ease_factor || 2.5).toFixed(2)}</strong>
      </div>
      <div class="detail-srs-stat">
        <span>Reviews / Lapses</span>
        <strong>${entry.review_count || 0} · ${entry.lapse_count || 0}</strong>
      </div>
    </div>

    <div class="detail-history-wrap">
      <h3>Review history (${history.length})</h3>
      <div class="history-table-container">
        <table class="history-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Rating</th>
              <th>Interval</th>
              <th>State</th>
            </tr>
          </thead>
          <tbody>
            ${historyRows}
          </tbody>
        </table>
      </div>
    </div>

    <div class="detail-footer">
      <button class="button button-secondary" id="detail-reset-progress-btn" data-id="${entry.id}">
        Reset learning progress
      </button>
      <div class="detail-footer-right">
        <button class="button button-secondary close-modal">Close</button>
        <button class="button button-secondary" id="detail-reverso-btn" data-id="${entry.id}">
          Reverso ↗
        </button>
        <button class="button button-primary" id="detail-edit-btn" data-id="${entry.id}">
          Edit word
        </button>
      </div>
    </div>
  `;

  openModal("detail-modal");

  // Event handlers inside modal
  $("detail-edit-btn").onclick = () => {
    closeModals();
    editEntry(entry.id);
  };

  $("detail-reverso-btn").onclick = () => {
    openReverso(entry);
  };

  $("detail-reset-progress-btn").onclick = () => {
    if (confirm(`Reset learning progress for "${entry.word}"? The word will return to "New" state with an interval of 0 days.`)) {
      const resetEntry = SRS.resetLearningProgress(entry, SRS.formatDateToDayString());
      const idx = entries.findIndex((e) => e.id === entry.id);
      if (idx !== -1) {
        entries[idx] = resetEntry;
        persistEntries();
        render();
        openDetailModal(entry.id);
        showToast("Learning progress reset");
      }
    }
  };
}

/* ==========================================================================
   Navigation & View Routing
   ========================================================================== */
function setView(view) {
  activeView = view;
  document.querySelectorAll(".view").forEach((element) => {
    element.classList.toggle("active-view", element.id === `${view}-view`);
  });
  document.querySelectorAll(".nav-item").forEach((item) => {
    item.classList.toggle("active", item.dataset.view === view);
  });

  const titles = {
    dashboard: ["Overview", "Dashboard"],
    review: ["Spaced Repetition", "Review Mode"],
    all: ["Collection", "All words"],
    favorites: ["Your picks", "Favorites"],
    tags: ["Organize", "Tags"],
    transfer: ["Data", "Import / export"],
    settings: ["Preferences", "Settings"]
  };

  $("page-kicker").textContent = titles[view]?.[0] || "Lexicon";
  $("page-title").textContent = titles[view]?.[1] || "Vocabulary";
  $("sidebar").classList.remove("open");

  if (view === "review") {
    $("review-active-screen").style.display = "none";
    $("review-complete-screen").style.display = "none";
    $("review-config-screen").style.display = "block";
    renderReviewConfig();
  } else if (view === "all") {
    renderCollection();
  }
}

/* ==========================================================================
   Word Form & Creation
   ========================================================================== */
function resetForm() {
  $("word-form").reset();
  $("entry-id").value = "";
  $("word-modal-title").textContent = "Add a word";

  $("language-from").value = settings.default_language_from || "English";
  $("language-to").value = settings.default_language_to || "Arabic";
}

function editEntry(id) {
  const entry = entries.find((item) => item.id === id);
  if (!entry) return;

  $("entry-id").value = entry.id;
  coreFields.forEach((field) => {
    const input = $(field.replaceAll("_", "-"));
    if (input) {
      input.value = field === "tags" ? normaliseTags(entry.tags).join(", ") : entry[field] || "";
    }
  });

  $("word-modal-title").textContent = "Edit word";
  openModal("word-modal");
}

function handleWordSubmit(event) {
  event.preventDefault();
  const id = $("entry-id").value;
  const existing = id ? entries.find((item) => item.id === id) : null;

  const todayStr = SRS.formatDateToDayString();
  const entry = {
    id: id || uid(),
    word: $("word").value.trim(),
    translation: $("translation").value.trim(),
    example: $("example").value.trim(),
    example_translation: $("example-translation").value.trim(),
    notes: $("notes").value.trim(),
    language_from: $("language-from").value.trim(),
    language_to: $("language-to").value.trim(),
    tags: normaliseTags($("tags").value),
    source_url: $("source-url").value.trim(),
    source: existing?.source || "manual",
    source_note_id: existing?.source_note_id || "",
    is_favorite: existing?.is_favorite || false,
    created_at: existing?.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString(),

    // Preserve learning history during manual edits!
    learning_state: existing?.learning_state || "new",
    interval_days: existing?.interval_days || 0,
    ease_factor: existing?.ease_factor || 2.5,
    review_count: existing?.review_count || 0,
    lapse_count: existing?.lapse_count || 0,
    due_date: existing?.due_date || todayStr,
    last_reviewed_at: existing?.last_reviewed_at || null,
    last_rating: existing?.last_rating || null
  };

  if (!entry.word || !entry.translation) return;

  const dupe = duplicateOf(entry, id);
  if (dupe && !confirm("A matching word already exists. Save this entry anyway?")) return;

  entries = id ? entries.map((item) => item.id === id ? entry : item) : [entry, ...entries];
  persistEntries();
  closeModals();
  render();
  showToast(id ? "Word updated" : "Word saved");
}

/* ==========================================================================
   Import / Export with Smart Delimiter & Header Detection
   ========================================================================== */
function parseDelimited(text, delimiter) {
  const rows = [];
  let row = [], cell = "", quote = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i], next = text[i + 1];
    if (char === '"' && quote && next === '"') {
      cell += '"';
      i++;
    } else if (char === '"') {
      quote = !quote;
    } else if (char === delimiter && !quote) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quote) {
      if (char === "\r" && next === "\n") i++;
      row.push(cell);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  if (cell || row.length) {
    row.push(cell);
    if (row.some((value) => value.trim())) rows.push(row);
  }
  return rows;
}

function detectDelimiter(text) {
  const lines = text.split(/\r\n|\r|\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#')).slice(0, 10);
  if (!lines.length) return ',';

  const delimiters = [',', '\t', ';', '|'];
  const counts = delimiters.map(d => {
    const lineCounts = lines.map(l => {
      let c = 0, quote = false;
      for (let i = 0; i < l.length; i++) {
        if (l[i] === '"') quote = !quote;
        else if (l[i] === d && !quote) c++;
      }
      return c;
    });
    const total = lineCounts.reduce((a, b) => a + b, 0);
    const consistent = lineCounts.length > 0 && lineCounts.every(c => c > 0 && c === lineCounts[0]);
    return { d, total, consistent, firstLineCount: lineCounts[0] || 0 };
  });

  const consistentDelim = counts.find(c => c.consistent && c.firstLineCount > 0);
  if (consistentDelim) return consistentDelim.d;

  counts.sort((a, b) => b.total - a.total);
  return counts[0].total > 0 ? counts[0].d : ',';
}

function hasHeaderRow(firstRow) {
  if (!firstRow || !firstRow.length) return false;
  const headerKeywords = [
    'word', 'front', 'expression', 'term', 'question', 'vocab',
    'translation', 'back', 'answer', 'meaning', 'definition',
    'example', 'sentence', 'notes', 'tags', 'tag', 'language',
    'source', 'due', 'state', 'ease', 'interval'
  ];
  return firstRow.some(cell => {
    const clean = String(cell || '').trim().toLowerCase().replace(/[^a-z0-9]/g, ' ');
    return headerKeywords.some(kw => clean === kw || clean.startsWith(kw + ' ') || clean.endsWith(' ' + kw));
  });
}

function applyHeaderMode(hasHeader) {
  importHasHeader = hasHeader;
  if (!rawParsedRows.length) return;

  if (hasHeader && rawParsedRows.length > 1) {
    importedHeaders = rawParsedRows[0].map((h, i) => h.trim() || `Column ${i + 1}`);
    importedRows = rawParsedRows.slice(1);
  } else {
    importedHeaders = rawParsedRows[0].map((_, i) => `Column ${i + 1}`);
    importedRows = rawParsedRows;
  }
}

function renderImportStep() {
  const options = `<option value="">Do not import</option>${importedHeaders.map((header, index) => `<option value="${index}">${escapeHTML(header || `Column ${index + 1}`)}</option>`).join("")}`;

  const suggested = (field) => {
    const candidates = {
      word: ["word", "front", "expression", "term", "question", "vocab"],
      translation: ["translation", "back", "answer", "meaning", "definition"],
      example: ["example", "sentence"],
      example_translation: ["example translation", "sentence translation"],
      notes: ["notes", "note", "comment"],
      language_from: ["from", "source language", "source"],
      language_to: ["to", "target language", "target"],
      tags: ["tags", "tag"],
      source_url: ["url", "reverso", "link"],
      due_date: ["due", "due date", "due_date"],
      learning_state: ["state", "learning_state", "status"],
      interval_days: ["interval", "interval_days"],
      ease_factor: ["ease", "ease_factor"]
    }[field] || [];

    const normaliseHeader = (header) => header.toLocaleLowerCase().replace(/[_-]+/g, " ");
    const index = importedHeaders.findIndex((header) => candidates.some((c) => normaliseHeader(header).includes(c)));
    if (index >= 0) return index;

    // Smart fallbacks: Column 1 -> Word, Column 2 -> Translation
    if (field === "word" && importedHeaders.length >= 1) return 0;
    if (field === "translation" && importedHeaders.length >= 2) return 1;

    return "";
  };

  $("import-step-content").innerHTML = `
    <div class="import-file-info">
      <div>
        <strong>${escapeHTML(importFileName)}</strong>
        <span id="import-stats-count">${importedRows.length} rows detected · ${importedHeaders.length} columns</span>
      </div>
      <button class="button button-secondary" id="choose-other">Choose another</button>
    </div>

    <div style="margin: var(--space-12) 0;">
      <label class="radio-label">
        <input type="checkbox" id="toggle-has-header" ${importHasHeader ? "checked" : ""} />
        <span>First row contains column headers</span>
      </label>
    </div>

    <p class="eyebrow">Preview</p>
    <div class="preview-wrap">
      <table class="preview-table">
        <thead>
          <tr id="preview-header-row">${importedHeaders.map((header) => `<th>${escapeHTML(header)}</th>`).join("")}</tr>
        </thead>
        <tbody id="preview-body-rows">
          ${importedRows.slice(0, 3).map((row) => `
            <tr>${importedHeaders.map((_, index) => `<td>${escapeHTML(stripHTML(row[index] || ""))}</td>`).join("")}</tr>
          `).join("")}
        </tbody>
      </table>
    </div>

    <p class="eyebrow">Map columns to fields</p>
    <div class="mapping-grid">
      ${allFields.map((field) => `
        <div class="mapping-row">
          <label for="map-${field}">
            ${fieldLabels[field] || field} ${(field === 'word' || field === 'translation') ? '<b style="color: var(--danger);">*</b>' : ''}
          </label>
          <select id="map-${field}" data-map="${field}">${options}</select>
        </div>
      `).join("")}
    </div>

    <p class="eyebrow">Duplicate behavior</p>
    <div class="import-options">
      <label class="radio-label"><input type="radio" name="duplicate-mode" value="skip" checked /> Skip duplicates</label>
      <label class="radio-label"><input type="radio" name="duplicate-mode" value="update" /> Update existing</label>
      <label class="radio-label"><input type="radio" name="duplicate-mode" value="allow" /> Import anyway</label>
    </div>

    <div class="import-footer">
      <span class="muted" id="import-footer-note">Only rows with a word and translation are imported.</span>
      <button class="button button-primary" id="run-import">Import ${importedRows.length} rows</button>
    </div>
  `;

  allFields.forEach((field) => {
    const select = $(`map-${field}`);
    const suggestion = suggested(field);
    if (suggestion !== "") select.value = suggestion;
  });

  $("choose-other").onclick = () => $("import-file").click();
  $("run-import").onclick = runImport;

  $("toggle-has-header").onchange = (e) => {
    applyHeaderMode(e.target.checked);
    renderImportStep();
  };
}

function readImport(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const text = String(reader.result).replace(/^\uFEFF/, "").trim();
    if (!text) {
      showToast("The selected file is empty.");
      return;
    }

    // Check for JSON
    if (file.name.toLowerCase().endsWith(".json")) {
      try {
        const json = JSON.parse(text);
        if (Array.isArray(json) && json.length > 0) {
          importJSON(json);
          return;
        }
      } catch (e) {
        // Fall back to delimited
      }
    }

    const delimiter = detectDelimiter(text);
    const parsed = parseDelimited(text, delimiter);

    // Filter out comment lines like Anki #separator:tab or #html:true
    rawParsedRows = parsed.filter(row => row.length > 0 && !(row[0] && row[0].startsWith("#")));

    if (!rawParsedRows.length) {
      showToast("No data rows found in this file.");
      return;
    }

    importFileName = file.name;
    const hasHeader = hasHeaderRow(rawParsedRows[0]);
    applyHeaderMode(hasHeader);

    renderImportStep();
    openModal("import-modal");
  };
  reader.onerror = () => showToast("Could not read that file.");
  reader.readAsText(file, "UTF-8");
}

function importJSON(items) {
  const todayStr = SRS.formatDateToDayString();
  let count = 0;
  items.forEach((item) => {
    if (!item.word || !item.translation) return;
    const normalized = SRS.normalizeEntry({
      ...item,
      id: item.id || uid(),
      created_at: item.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString()
    }, todayStr);
    entries.unshift(normalized);
    count++;
  });
  persistEntries();
  render();
  showToast(`Successfully imported ${count} words from JSON.`);
}

function runImport() {
  const mappings = Object.fromEntries(allFields.map((field) => [
    field, $(`map-${field}`).value === "" ? -1 : Number($(`map-${field}`).value)
  ]));

  if (mappings.word === -1 || mappings.translation === -1) {
    showToast("Please map both the 'Word' and 'Translation' columns to continue.");
    if (mappings.word === -1) $("map-word")?.focus();
    else $("map-translation")?.focus();
    return;
  }

  let imported = 0, skipped = 0, failed = 0, updated = 0;
  const mode = document.querySelector('input[name="duplicate-mode"]:checked').value;
  const todayStr = SRS.formatDateToDayString();

  importedRows.forEach((row) => {
    const word = stripHTML(row[mappings.word] || "").trim();
    const translation = stripHTML(row[mappings.translation] || "").trim();
    if (!word || !translation) {
      failed++;
      return;
    }

    const rawItem = {
      id: uid(),
      word,
      translation,
      example: stripHTML(row[mappings.example] || ""),
      example_translation: stripHTML(row[mappings.example_translation] || ""),
      notes: stripHTML(row[mappings.notes] || ""),
      language_from: stripHTML(row[mappings.language_from] || ""),
      language_to: stripHTML(row[mappings.language_to] || ""),
      tags: normaliseTags(stripHTML(row[mappings.tags] || "")),
      source_url: stripHTML(row[mappings.source_url] || ""),
      source: "import",
      source_note_id: "",
      is_favorite: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),

      // Imported SRS parameters if present
      due_date: stripHTML(row[mappings.due_date] || ""),
      learning_state: stripHTML(row[mappings.learning_state] || ""),
      interval_days: row[mappings.interval_days] ? Number(row[mappings.interval_days]) : 0,
      ease_factor: row[mappings.ease_factor] ? Number(row[mappings.ease_factor]) : 2.5
    };

    const item = SRS.normalizeEntry(rawItem, todayStr);
    const dupe = duplicateOf(item);

    if (dupe && mode === "skip") {
      skipped++;
      return;
    }
    if (dupe && mode === "update") {
      entries = entries.map((entry) => entry.id === dupe.id ? { ...dupe, ...item, id: dupe.id, created_at: dupe.created_at } : entry);
      updated++;
      return;
    }

    entries.unshift(item);
    imported++;
  });

  persistEntries();
  render();

  $("import-step-content").innerHTML = `
    <div class="import-result">
      <div class="result-number">${imported + updated}</div>
      <h3>Import complete</h3>
      <div class="result-stats">
        <span><b>${imported}</b>Imported</span>
        <span><b>${updated}</b>Updated</span>
        <span><b>${skipped}</b>Skipped</span>
        <span><b>${failed}</b>Failed</span>
      </div>
      <button class="button button-primary close-import">Done</button>
    </div>
  `;
  $("import-modal").querySelector(".close-import").onclick = closeModals;
  showToast(`Imported ${imported + updated} words successfully.`);
}

function exportData(format) {
  const name = `lexicon-${new Date().toISOString().slice(0, 10)}`;
  if (format === "json") {
    download(`${name}.json`, JSON.stringify(entries, null, 2), "application/json");
  } else {
    const columns = [
      "word", "translation", "example", "example_translation", "notes",
      "language_from", "language_to", "tags", "source_url", "source",
      "is_favorite", "learning_state", "due_date", "interval_days",
      "ease_factor", "review_count", "lapse_count", "created_at", "updated_at"
    ];
    const delimiter = format === "tsv" ? "\t" : ",";
    const quote = (value) => {
      const text = Array.isArray(value) ? value.join(", ") : String(value ?? "");
      return `"${text.replace(/"/g, '""').replace(/\n/g, " ")}"`;
    };
    download(
      `${name}.${format}`,
      [columns.join(delimiter), ...entries.map((e) => columns.map((col) => quote(e[col])).join(delimiter))].join("\n"),
      format === "tsv" ? "text/tab-separated-values" : "text/csv"
    );
  }
  showToast(`${format.toUpperCase()} export downloaded`);
}

function download(name, content, type) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([content], { type }));
  link.download = name;
  link.click();
  URL.revokeObjectURL(link.href);
}

/* ==========================================================================
   Settings Form Handlers
   ========================================================================== */
function renderSettingsForm() {
  $("setting-daily-new").value = settings.daily_new_limit;
  $("setting-session-size").value = settings.session_size;
  $("setting-lang-from").value = settings.default_language_from || "";
  $("setting-lang-to").value = settings.default_language_to || "";
  $("setting-daily-target").value = settings.daily_review_target;
  $("setting-show-example-front").checked = Boolean(settings.show_example_on_front);
  $("setting-hide-translation").checked = Boolean(settings.hide_translation_initially);
  $("setting-keyboard-shortcuts").checked = Boolean(settings.keyboard_shortcuts_enabled);
}

function handleSettingsSubmit(event) {
  event.preventDefault();
  settings = {
    ...settings,
    daily_new_limit: Math.max(1, Number($("setting-daily-new").value) || 10),
    session_size: $("setting-session-size").value,
    default_language_from: $("setting-lang-from").value.trim(),
    default_language_to: $("setting-lang-to").value.trim(),
    daily_review_target: Math.max(1, Number($("setting-daily-target").value) || 20),
    show_example_on_front: $("setting-show-example-front").checked,
    hide_translation_initially: $("setting-hide-translation").checked,
    keyboard_shortcuts_enabled: $("setting-keyboard-shortcuts").checked
  };
  persistSettings();
  render();
  showToast("Learning settings saved");
}

/* ==========================================================================
   Theme & Meta
   ========================================================================== */
function updateThemeMeta(dark) {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", dark ? "#09090b" : "#f4f4f5");
}

function toggleTheme() {
  const dark = document.body.classList.toggle("dark");
  localStorage.setItem(THEME_KEY, dark ? "dark" : "light");
  $("theme-toggle").textContent = dark ? "☀" : "☾";
  updateThemeMeta(dark);
}

if (localStorage.getItem(THEME_KEY) === "dark") {
  document.body.classList.add("dark");
  $("theme-toggle").textContent = "☀";
  updateThemeMeta(true);
}

/* ==========================================================================
   Global Event Listeners & Keyboard Shortcuts
   ========================================================================== */
document.addEventListener("click", (event) => {
  const target = event.target.closest("button,[data-view],[data-tag],[data-detail],[data-select]");
  if (!target) return;

  // View Navigation
  if (target.dataset.view) {
    setView(target.dataset.view);
  }

  // Dashboard Callout Review
  if (target.id === "banner-start-review") {
    setView("review");
    startReviewSession();
  }

  // Review Mode Config & Session Buttons
  if (target.id === "start-session-btn") {
    startReviewSession();
  }
  if (target.id === "review-exit-btn") {
    exitReviewSession();
  }
  if (target.id === "reveal-btn") {
    revealAnswer();
  }
  if (target.dataset.rating) {
    handleRating(target.dataset.rating);
  }
  if (target.id === "review-prev-btn") {
    handlePreviousCard();
  }
  if (target.id === "complete-dashboard-btn") {
    setView("dashboard");
  }
  if (target.id === "complete-more-btn") {
    setView("review");
  }

  // Word Creation & Modals
  if (target.id === "add-word-top" || target.id === "add-word-list") {
    resetForm();
    openModal("word-modal");
  }
  if (target.classList.contains("close-modal")) {
    closeModals();
  }

  // Word Details
  if (target.dataset.detail) {
    openDetailModal(target.dataset.detail);
  }

  // Word Actions
  if (target.dataset.favorite) {
    const entry = entries.find((item) => item.id === target.dataset.favorite);
    if (entry) {
      entry.is_favorite = !entry.is_favorite;
      entry.updated_at = new Date().toISOString();
      persistEntries();
      render();
    }
  }

  if (target.dataset.edit) {
    editEntry(target.dataset.edit);
  }

  if (target.dataset.delete && confirm("Delete this word?")) {
    const previous = entries.find((entry) => entry.id === target.dataset.delete);
    entries = entries.filter((entry) => entry.id !== target.dataset.delete);
    const deletedAt = new Date().toISOString();
    deletedEntries.push({
      id: target.dataset.delete,
      _sync: { revision: Number(previous?._sync?.revision || 0) + 1, updatedAt: deletedAt, deviceId: "local", deletedAt, pending: true }
    });
    selectedIds.delete(target.dataset.delete);
    persistEntries();
    persistDeletedEntries();
    render();
    showToast("Word deleted");
  }

  if (target.dataset.tag) {
    setView("all");
    $("tag-filter").value = target.dataset.tag;
    renderCollection();
  }

  // Bulk Actions
  if (target.id === "bulk-add-tag-btn") {
    $("bulk-tag-input").value = "";
    openModal("bulk-tag-modal");
  }

  if (target.id === "bulk-remove-tag-btn") {
    const selectedEntries = entries.filter((e) => selectedIds.has(e.id));
    const availableTags = [...new Set(selectedEntries.flatMap((e) => normaliseTags(e.tags)))].sort();
    if (!availableTags.length) {
      showToast("Selected words do not have any tags.");
      return;
    }
    $("bulk-untag-select").innerHTML = availableTags.map((t) => `<option value="${escapeHTML(t)}">#${escapeHTML(t)}</option>`).join("");
    openModal("bulk-untag-modal");
  }

  if (target.id === "bulk-toggle-fav-btn") {
    bulkToggleFavorites();
  }
  if (target.id === "bulk-export-btn") {
    bulkExport();
  }
  if (target.id === "bulk-delete-btn") {
    bulkDelete();
  }
  if (target.id === "bulk-cancel-btn") {
    selectedIds.clear();
    renderCollection();
  }

  // Transfer & System
  if (target.id === "open-import") {
    $("import-file").click();
  }
  if (target.dataset.export) {
    exportData(target.dataset.export);
  }
  if (target.id === "mobile-menu") {
    $("sidebar").classList.toggle("open");
  }
  if (target.id === "theme-toggle" || target.id === "theme-setting") {
    toggleTheme();
  }
  if (target.id === "clear-data" && confirm("Delete all vocabulary and review history? This cannot be undone.")) {
    entries = [];
    reviewHistory = [];
    deletedEntries = [];
    selectedIds.clear();
    persistEntries();
    persistHistory();
    persistDeletedEntries();
    render();
    showToast("All data cleared");
  }
});

// Checkbox selection in Collection
document.addEventListener("change", (event) => {
  const target = event.target;
  if (target.dataset.select) {
    if (target.checked) {
      selectedIds.add(target.dataset.select);
    } else {
      selectedIds.delete(target.dataset.select);
    }
    updateBulkBar();
  }
  if (target.id === "bulk-select-all") {
    toggleSelectAll(target.checked);
  }
  if (target.id === "import-file" && target.files && target.files[0]) {
    const file = target.files[0];
    target.value = "";
    readImport(file);
  }
  if (["state-filter", "language-filter", "tag-filter", "sort-select"].includes(target.id)) {
    renderCollection();
  }
  if (["review-filter-mode", "review-tag-select", "review-pair-select", "review-size-select"].includes(target.id)) {
    renderReviewConfig();
  }
});

$("search-input")?.addEventListener("input", renderCollection);
$("word-form")?.addEventListener("submit", handleWordSubmit);
$("learning-settings-form")?.addEventListener("submit", handleSettingsSubmit);

$("bulk-tag-form")?.addEventListener("submit", (e) => {
  e.preventDefault();
  bulkAddTag($("bulk-tag-input").value);
  closeModals();
});

$("bulk-untag-form")?.addEventListener("submit", (e) => {
  e.preventDefault();
  bulkRemoveTag($("bulk-untag-select").value);
  closeModals();
});


// Keyboard Shortcuts: Space, 1, 2, 3, 4, ArrowLeft, Escape
document.addEventListener("keydown", (event) => {
  // Prevent shortcuts while typing in form inputs, textareas, or selects
  if (event.target.matches("input, textarea, select") || event.target.isContentEditable) {
    if (event.key === "Escape") closeModals();
    return;
  }

  if (event.key === "Escape") {
    const openModals = document.querySelectorAll(".modal-backdrop.open");
    if (openModals.length > 0) {
      closeModals();
    } else if (activeView === "review" && $("review-active-screen").style.display !== "none") {
      exitReviewSession();
    }
    return;
  }

  // If shortcuts are disabled in settings, ignore review shortcuts
  if (!settings.keyboard_shortcuts_enabled) return;

  // Active Review Session Shortcuts
  if (activeView === "review" && $("review-active-screen").style.display !== "none") {
    if (event.code === "Space" || event.key === " ") {
      event.preventDefault();
      if (!reviewAnswerRevealed) {
        revealAnswer();
      }
    } else if (reviewAnswerRevealed && !isSubmittingReview) {
      if (event.key === "1") {
        event.preventDefault();
        handleRating("again");
      } else if (event.key === "2") {
        event.preventDefault();
        handleRating("hard");
      } else if (event.key === "3") {
        event.preventDefault();
        handleRating("good");
      } else if (event.key === "4") {
        event.preventDefault();
        handleRating("easy");
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        handlePreviousCard();
      }
    }
  }
});

// Initial boot
render();
