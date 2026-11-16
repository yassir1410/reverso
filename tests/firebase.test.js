const assert = require('assert');

// Mock localStorage for node environment
global.localStorage = (function () {
  let store = {};
  return {
    getItem: (key) => store[key] || null,
    setItem: (key, val) => { store[key] = String(val); },
    removeItem: (key) => { delete store[key]; },
    clear: () => { store = {}; }
  };
})();

const FirebaseSync = require('../firebase-sync.js');

console.log('Testing FirebaseSync Module...');

// 1. Initial State without configuration
assert.strictEqual(FirebaseSync.isConfigured(), false, 'Should not be configured initially');
assert.strictEqual(FirebaseSync.getConfig(), null);
assert.strictEqual(FirebaseSync.getStatus(), 'offline');

// 2. Saving and Loading Configuration
const dummyConfig = {
  apiKey: "AIzaSyFakeKey123",
  authDomain: "lexicon-app.firebaseapp.com",
  projectId: "lexicon-app",
  storageBucket: "lexicon-app.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abcdef"
};

FirebaseSync.saveConfig(dummyConfig);
assert.strictEqual(FirebaseSync.isConfigured(), true, 'Should be configured after saving config');
const loaded = FirebaseSync.getConfig();
assert.strictEqual(loaded.projectId, "lexicon-app");
assert.strictEqual(loaded.apiKey, "AIzaSyFakeKey123");

// 3. Status Listeners
let lastStatus = null;
const unsubscribe = FirebaseSync.onStatusChange((status) => {
  lastStatus = status;
});
assert.strictEqual(typeof lastStatus, 'string');
unsubscribe();

// 4. Clearing config
FirebaseSync.saveConfig(null);
assert.strictEqual(FirebaseSync.isConfigured(), false, 'Should not be configured after clearing');

console.log('✓ All FirebaseSync module tests passed!');
