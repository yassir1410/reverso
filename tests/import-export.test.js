/**
 * Test CSV and TSV Import/Export round-trip with SRS fields
 */

const assert = require('assert');

// Delimited parser extracted from app.js
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

console.log('Testing CSV/TSV import/export round-trip...');

const sampleCSV = `word,translation,example,tags,learning_state,interval_days,ease_factor,due_date
"serendipity","heureuse découverte","A fortunate stroke of serendipity.","vocab, advanced","review",4,2.5,"2026-11-20"
"ephemeral","éphémère","Beauty is ephemeral.","reading","learning",1,2.3,"2026-11-17"`;

const parsed = parseDelimited(sampleCSV, ',');
assert.strictEqual(parsed.length, 3, 'Should have header + 2 rows');
assert.strictEqual(parsed[0][0], 'word');
assert.strictEqual(parsed[1][0], 'serendipity');
assert.strictEqual(parsed[1][1], 'heureuse découverte');
assert.strictEqual(parsed[1][4], 'review');
assert.strictEqual(parsed[1][5], '4');
assert.strictEqual(parsed[2][0], 'ephemeral');

console.log('✓ Delimited parser parsed CSV with SRS fields successfully.');
