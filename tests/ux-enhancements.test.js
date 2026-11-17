/**
 * UX Enhancements Unit Tests
 * Tests for tag-based filtering, favorites filtering, and search logic
 */

const assert = require("assert");

function normaliseTags(value) {
  return [...new Set(String(value || "").split(/[,;|]/).map((tag) => tag.trim().replace(/^#/, "")).filter(Boolean))];
}

function filterTestEntries(entries, query, state) {
  return entries.filter((entry) => {
    if (query) {
      if (query.startsWith("#")) {
        const tagQuery = query.slice(1).toLowerCase();
        if (!normaliseTags(entry.tags).some((t) => t.toLowerCase().includes(tagQuery))) return false;
      } else {
        const haystack = [entry.word, entry.translation, entry.example, entry.notes].join(" ").toLowerCase();
        if (!haystack.includes(query.toLowerCase())) return false;
      }
    }

    if (state === "favorites") {
      if (!entry.is_favorite) return false;
    }

    return true;
  });
}

console.log("Running UX Enhancements Tests...");

const sampleEntries = [
  { id: "1", word: "serendipity", translation: "heureuse découverte", tags: ["reading", "b2"], is_favorite: true },
  { id: "2", word: "ephemeral", translation: "éphémère", tags: "nature, literature", is_favorite: false },
  { id: "3", word: "ineffable", translation: "indicible", tags: "#rare; #b2", is_favorite: true },
];

// Test 1: Search by text in word
let res = filterTestEntries(sampleEntries, "seren", "");
assert.strictEqual(res.length, 1);
assert.strictEqual(res[0].id, "1");
console.log("✓ Text search matches word");

// Test 2: Search by text in translation
res = filterTestEntries(sampleEntries, "éphémère", "");
assert.strictEqual(res.length, 1);
assert.strictEqual(res[0].id, "2");
console.log("✓ Text search matches translation");

// Test 3: Tag search with # prefix
res = filterTestEntries(sampleEntries, "#b2", "");
assert.strictEqual(res.length, 2);
assert.deepStrictEqual(res.map(e => e.id), ["1", "3"]);
console.log("✓ #tag search filters exclusively by tag");

// Test 4: Tag search with # prefix - partial match
res = filterTestEntries(sampleEntries, "#lit", "");
assert.strictEqual(res.length, 1);
assert.strictEqual(res[0].id, "2");
console.log("✓ Partial #tag search works");

// Test 5: Favorites filter
res = filterTestEntries(sampleEntries, "", "favorites");
assert.strictEqual(res.length, 2);
assert.deepStrictEqual(res.map(e => e.id), ["1", "3"]);
console.log("✓ Favorites filter works");

// Test 6: Combined search and favorites filter
res = filterTestEntries(sampleEntries, "serendipity", "favorites");
assert.strictEqual(res.length, 1);
assert.strictEqual(res[0].id, "1");
console.log("✓ Combined text search and favorites filter works");

console.log("All UX Enhancements Tests passed successfully!\n");
