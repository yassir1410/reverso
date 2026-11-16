const assert = require('assert');

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

function processImportText(rawText) {
  const text = String(rawText || '').replace(/^\uFEFF/, '').trim();
  if (!text) return { error: 'The selected file is empty.' };

  const delimiter = detectDelimiter(text);
  const allRows = parseDelimited(text, delimiter).filter(row => !row[0] || !row[0].startsWith('#'));
  if (!allRows.length) return { error: 'No data rows found in file.' };

  const hasHeader = hasHeaderRow(allRows[0]);
  let headers, dataRows;
  if (hasHeader) {
    headers = allRows[0].map((h, i) => h.trim() || `Column ${i + 1}`);
    dataRows = allRows.slice(1);
  } else {
    headers = allRows[0].map((_, i) => `Column ${i + 1}`);
    dataRows = allRows;
  }

  return { delimiter, hasHeader, headers, dataRows };
}

console.log('Testing import processing...');

// 1. Standard CSV with header
const r1 = processImportText('word,translation,example\nhello,bonjour,say hello');
assert.strictEqual(r1.delimiter, ',');
assert.strictEqual(r1.hasHeader, true);
assert.strictEqual(r1.headers[0], 'word');
assert.strictEqual(r1.dataRows.length, 1);

// 2. CSV without header
const r2 = processImportText('hello,bonjour\nworld,monde');
assert.strictEqual(r2.hasHeader, false);
assert.strictEqual(r2.headers[0], 'Column 1');
assert.strictEqual(r2.dataRows.length, 2);

// 3. Semicolon CSV (European format)
const r3 = processImportText('word;translation;example\nhello;bonjour;salut');
assert.strictEqual(r3.delimiter, ';');
assert.strictEqual(r3.hasHeader, true);
assert.strictEqual(r3.headers.length, 3);
assert.strictEqual(r3.dataRows.length, 1);

// 4. Anki with comments
const r4 = processImportText('#separator:tab\n#html:true\nfront\tback\nbonjour\thello');
assert.strictEqual(r4.delimiter, '\t');
assert.strictEqual(r4.hasHeader, true);
assert.strictEqual(r4.headers[0], 'front');
assert.strictEqual(r4.dataRows[0][0], 'bonjour');

// 5. Single line without header
const r5 = processImportText('serendipity,heureuse découverte');
assert.strictEqual(r5.hasHeader, false);
assert.strictEqual(r5.dataRows.length, 1);
assert.strictEqual(r5.dataRows[0][0], 'serendipity');

console.log('✓ All import processing tests passed!');
