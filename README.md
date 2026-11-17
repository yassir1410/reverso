# Lexicon

A minimalist, high-focus personal vocabulary learning tool and spaced repetition system for words collected from Reverso Context and everyday reading.

## Features

### 1. Dedicated Review Mode
- Distraction-free, minimal card interface focused on concentration.
- **Card Front**: Prominent word, language pair indicator, optional tags, and optional example sentence.
- **Card Back**: Reveals translation (visually distinct in high-contrast typography), full example sentence, example translation, personal notes, and direct Reverso Context lookup link.
- **Evaluation Controls**: Again, Hard, Good, Easy with interval estimates and keyboard shortcuts.
- **Keyboard Shortcuts**:
  - `Space`: Reveal answer
  - `1`: Again (reset/retry)
  - `2`: Hard (short interval)
  - `3`: Good (normal progression)
  - `4`: Easy (larger progression)
  - `←` (`ArrowLeft`): Previous card
  - `Esc`: Exit review session / Close modals

### 2. Spaced Repetition System (SuperMemo SM-2)
- Reliable, documented SM-2 algorithm:
  - Tracks `due_date`, `last_reviewed_at`, `review_count`, `lapse_count`, `interval_days`, `ease_factor`, `learning_state`, and `last_rating`.
  - Four learning states: `New`, `Learning`, `Review`, `Relearning`.
  - Independent review history log stored in local storage (`lexicon-review-history-v1`) without data loss.

### 3. Smart Review Queue
- Intelligent priority order:
  1. Overdue cards (`due_date < today`)
  2. Cards due today (`due_date == today`)
  3. Cards in `learning` / `relearning` needing review
  4. New cards up to the configurable daily new-word quota
- Session configuration allows reviewing due words, all words, only new words, favorites, or words filtered by tag and language pair.

### 4. Learning Dashboard
- 7 core metrics calculated live from real records: Total words, Due today, Learning, Mastered (21d+), New words, Total reviews, and Learning streak (`X days 🔥`).
- **Weekly Activity Chart**: 7-day visual bar chart tracking reviews completed per day.
- **Retention Overview**: Segmented progress bar showing the distribution of vocabulary by learning state.

### 5. Vocabulary Details & History
- Comprehensive word detail modal with pronunciation/lookup links, metadata, and a full chronological table of past reviews with interval and state changes.
- Manual edits preserve learning progress.
- Optional progress reset with confirmation.

### 6. Collection Filters & Bulk Actions
- Filter by state (`Due today`, `New`, `Learning`, `Review`, `Mastered`), language pair, tag, or search query.
- Sort by newest, oldest, A–Z, Z–A, next review date, or review counts.
- Bulk operations: add tag, remove tag, toggle favorites, export selected, and delete selected with confirmation.

### 7. Import & Export
- Supports CSV, TSV, and JSON formats.
- Safely imports and exports all spaced repetition schedule parameters without breaking legacy files.

## Run locally

This is a dependency-free browser application. Serve the folder with any static file server:

```bash
python3 -m http.server 4173
```

Then open `http://localhost:4173`.

## Run tests

Run the unit and integration test suite:

```bash
npm test
# or
node tests/full-suite.test.js
```

## GitHub Pages Deployment

The repository includes an automated GitHub Actions deployment workflow in [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml).

To enable GitHub Pages in your repository:
1. Push this project to GitHub.
2. In your repository, go to **Settings** → **Pages**.
3. Under **Build and deployment** → **Source**, select **GitHub Actions**.
4. Future pushes to `main` or `master` will automatically run tests and publish the live site.

## Optional Firebase sync

The app remains fully usable offline and keeps `localStorage` as the UI data source. To enable Google sign-in and Firestore synchronization:

1. Create a Firebase web app in the Firebase console and enable Google Authentication.
2. In Firebase Console → Authentication → Settings → Authorized domains, add `yassir1410.github.io` (and `localhost` for local testing).
3. Deploy [firestore.rules](./firestore.rules).
4. The provided public web configuration is included in the client. The **Override config** action is available if you need to use another Firebase project. Never paste service-account credentials.
5. Sign in with Google from the account menu in the top bar. The app uses a popup first and falls back to redirect when the browser blocks popups.

Cloud data is stored per account at `/users/{uid}/vocabulary/{wordId}`, `/users/{uid}/reviewHistory/{historyId}`, and `/users/{uid}/settings/preferences`. Writes are chunked below Firestore's batch limit. Local account namespaces and deletion tombstones prevent data leaking between accounts or deleted records reappearing. Switching accounts loads the new UID namespace before syncing and never migrates the previous account's in-memory data. Conflict resolution uses a monotonic per-record revision, then ISO timestamp and device ID as deterministic tie-breakers. Firebase SDK configuration and console deployment are not claimed as completed by this static project.
# reverso
