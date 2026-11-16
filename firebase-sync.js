/**
 * Firebase Sync & Storage Module for Lexicon
 * Handles Cloud Firestore synchronization, Authentication, and Local Cache fallback.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.FirebaseSync = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const CONFIG_KEY = 'lexicon-firebase-config-v1';
  let app = null;
  let auth = null;
  let db = null;
  let currentUser = null;
  let syncStatus = 'offline'; // 'offline' | 'disconnected' | 'connecting' | 'connected' | 'syncing' | 'error'
  let statusListeners = [];
  let authListeners = [];
  let autoSyncDebounceTimer = null;

  function setStatus(status, details = '') {
    syncStatus = status;
    statusListeners.forEach((fn) => {
      try {
        fn(status, details);
      } catch (e) {
        console.error('Status listener error:', e);
      }
    });
  }

  function getConfig() {
    try {
      return JSON.parse(localStorage.getItem(CONFIG_KEY) || 'null');
    } catch (e) {
      return null;
    }
  }

  function saveConfig(config) {
    if (!config) {
      localStorage.removeItem(CONFIG_KEY);
    } else {
      localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
    }
  }

  function isConfigured() {
    const cfg = getConfig();
    return Boolean(cfg && cfg.apiKey && cfg.projectId);
  }

  function loadScripts() {
    return new Promise((resolve, reject) => {
      if (typeof window.firebase !== 'undefined') {
        return resolve(window.firebase);
      }

      const appScript = document.createElement('script');
      appScript.src = 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js';
      appScript.onload = () => {
        const authScript = document.createElement('script');
        authScript.src = 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth-compat.js';

        const firestoreScript = document.createElement('script');
        firestoreScript.src = 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore-compat.js';

        let loadedCount = 0;
        const checkBoth = () => {
          loadedCount++;
          if (loadedCount === 2) resolve(window.firebase);
        };

        authScript.onload = checkBoth;
        authScript.onerror = () => reject(new Error('Failed to load Firebase Auth SDK.'));
        firestoreScript.onload = checkBoth;
        firestoreScript.onerror = () => reject(new Error('Failed to load Firebase Firestore SDK.'));

        document.head.appendChild(authScript);
        document.head.appendChild(firestoreScript);
      };
      appScript.onerror = () => reject(new Error('Failed to load Firebase App SDK.'));
      document.head.appendChild(appScript);
    });
  }

  async function init() {
    const config = getConfig();
    if (!config || !config.apiKey || !config.projectId) {
      setStatus('disconnected', 'No Firebase configuration set.');
      return false;
    }

    try {
      setStatus('connecting', 'Connecting to Firebase...');
      await loadScripts();

      if (!window.firebase.apps.length) {
        app = window.firebase.initializeApp(config);
      } else {
        app = window.firebase.app();
      }

      auth = window.firebase.auth();
      db = window.firebase.firestore();

      auth.onAuthStateChanged((user) => {
        currentUser = user;
        if (user) {
          setStatus('connected', user.isAnonymous ? 'Guest session' : user.email);
        } else {
          setStatus('disconnected', 'Signed out');
        }
        authListeners.forEach((fn) => fn(user));
      });

      return true;
    } catch (err) {
      console.error('Firebase init failed:', err);
      setStatus('error', err.message || 'Connection failed');
      return false;
    }
  }

  async function signIn(email, password) {
    if (!auth) await init();
    if (!auth) throw new Error('Firebase Auth is not initialized. Please verify your config.');
    return auth.signInWithEmailAndPassword(email, password);
  }

  async function signUp(email, password) {
    if (!auth) await init();
    if (!auth) throw new Error('Firebase Auth is not initialized. Please verify your config.');
    return auth.createUserWithEmailAndPassword(email, password);
  }

  async function signInGuest() {
    if (!auth) await init();
    if (!auth) throw new Error('Firebase Auth is not initialized. Please verify your config.');
    return auth.signInAnonymously();
  }

  async function signOut() {
    if (auth) {
      await auth.signOut();
      currentUser = null;
      setStatus('disconnected', 'Signed out');
    }
  }

  /**
   * Upload all user data (entries, history, settings) to Firestore under `users/{uid}`.
   */
  async function uploadData(data) {
    if (!db || !currentUser) {
      throw new Error('You must be signed in with a connected Firebase project to sync.');
    }

    setStatus('syncing', 'Uploading to cloud...');
    try {
      const userDocRef = db.collection('lexicon_users').doc(currentUser.uid);
      await userDocRef.set({
        entries: data.entries || [],
        reviewHistory: data.reviewHistory || [],
        settings: data.settings || {},
        updatedAt: window.firebase.firestore.FieldValue.serverTimestamp(),
        clientTimestamp: new Date().toISOString()
      }, { merge: true });

      setStatus('connected', currentUser.isAnonymous ? 'Guest (Synced)' : `${currentUser.email} (Synced)`);
      return true;
    } catch (err) {
      console.error('Upload to Firestore failed:', err);
      setStatus('error', `Sync failed: ${err.message}`);
      throw err;
    }
  }

  /**
   * Download user data from Firestore.
   */
  async function downloadData() {
    if (!db || !currentUser) {
      throw new Error('You must be signed in to download cloud data.');
    }

    setStatus('syncing', 'Downloading from cloud...');
    try {
      const userDocRef = db.collection('lexicon_users').doc(currentUser.uid);
      const snapshot = await userDocRef.get();

      if (!snapshot.exists) {
        setStatus('connected', 'No remote data yet.');
        return null;
      }

      const data = snapshot.data();
      setStatus('connected', currentUser.isAnonymous ? 'Guest (Synced)' : `${currentUser.email} (Synced)`);
      return data;
    } catch (err) {
      console.error('Download from Firestore failed:', err);
      setStatus('error', `Download failed: ${err.message}`);
      throw err;
    }
  }

  function queueAutoSync(getDataFn) {
    if (!currentUser || !db) return;
    clearTimeout(autoSyncDebounceTimer);
    autoSyncDebounceTimer = setTimeout(async () => {
      try {
        const data = getDataFn();
        await uploadData(data);
      } catch (e) {
        console.warn('Auto-sync skipped/failed:', e);
      }
    }, 2000);
  }

  function onStatusChange(callback) {
    statusListeners.push(callback);
    callback(syncStatus);
    return () => {
      statusListeners = statusListeners.filter((fn) => fn !== callback);
    };
  }

  function onAuthChange(callback) {
    authListeners.push(callback);
    callback(currentUser);
    return () => {
      authListeners = authListeners.filter((fn) => fn !== callback);
    };
  }

  return {
    getConfig,
    saveConfig,
    isConfigured,
    init,
    signIn,
    signUp,
    signInGuest,
    signOut,
    uploadData,
    downloadData,
    queueAutoSync,
    onStatusChange,
    onAuthChange,
    getUser: () => currentUser,
    getStatus: () => syncStatus
  };
});
