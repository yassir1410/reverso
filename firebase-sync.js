/**
 * Firebase integration for the static Lexicon client.
 *
 * The Firebase compat SDK is loaded only after configuration is supplied.
 * Firestore is a remote sync layer; localStorage remains the UI's source of
 * truth and every account gets a separate local namespace.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.FirebaseSync = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const CONFIG_KEY = "lexicon-firebase-config-v2";
  const DEVICE_KEY = "lexicon-device-id-v1";
  const SDK_VERSION = "10.12.2";
  const BATCH_SIZE = 400;
  const DEFAULT_CONFIG = {
    apiKey: "AIzaSyDnJkLEitDLNnWGqbJLtQhfvgdeA9eqmeU",
    authDomain: "reverse-4547d.firebaseapp.com",
    projectId: "reverse-4547d",
    storageBucket: "reverse-4547d.firebasestorage.app",
    messagingSenderId: "691675420409",
    appId: "1:691675420409:web:c486a30759ee55faaff428"
  };
  let firebaseApp;
  let auth;
  let db;
  let currentUser = null;
  let status = "offline";
  let statusDetail = "Not configured";
  let initialized = false;
  let initPromise = null;
  let authBound = false;
  let listeners = [];
  let authListeners = [];
  let syncTimer;
  const deviceId = getDeviceId();

  function getDeviceId() {
    try {
      let id = localStorage.getItem(DEVICE_KEY);
      if (!id) {
        id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
        localStorage.setItem(DEVICE_KEY, id);
      }
      return id;
    } catch (_) {
      return "browser";
    }
  }

  function setStatus(next, detail = "") {
    status = next;
    statusDetail = detail;
    listeners.slice().forEach((listener) => listener(next, detail));
  }

  function getConfig() {
    try {
      const saved = JSON.parse(localStorage.getItem(CONFIG_KEY) || "null");
      if (saved) return saved;
      return typeof window !== "undefined" ? DEFAULT_CONFIG : null;
    }
    catch (error) { console.error("Could not read Firebase configuration", error); return null; }
  }

  function saveConfig(config) {
    if (!config) localStorage.removeItem(CONFIG_KEY);
    else localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  }

  function isConfigured() {
    const config = getConfig();
    return Boolean(config?.apiKey && config?.authDomain && config?.projectId && config?.appId);
  }

  function loadScripts() {
    if (typeof window === "undefined") return Promise.reject(new Error("Firebase requires a browser."));
    if (window.firebase?.firestore && window.firebase?.auth) return Promise.resolve(window.firebase);
    const load = (src) => new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`Failed to load Firebase SDK: ${src}`));
      document.head.appendChild(script);
    });
    return load(`https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-app-compat.js`)
      .then(() => Promise.all([
        load(`https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-auth-compat.js`),
        load(`https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-firestore-compat.js`)
      ]))
      .then(() => window.firebase);
  }

  async function init() {
    if (initialized) return Boolean(auth && db);
    if (initPromise) return initPromise;
    if (!isConfigured()) {
      setStatus("offline", "Firebase configuration is missing.");
      return false;
    }
    initPromise = (async () => {
      try {
      setStatus("connecting", "Connecting to Firebase...");
      const sdk = await loadScripts();
      firebaseApp = sdk.apps.length ? sdk.app() : sdk.initializeApp(getConfig());
      auth = sdk.auth(firebaseApp);
      db = sdk.firestore(firebaseApp);
      try {
        await db.enablePersistence({ synchronizeTabs: true });
      } catch (error) {
        // Persistence can fail in private browsing or when another tab owns
        // the lease. Firestore still works online, so keep going explicitly.
        console.warn("Firestore offline persistence unavailable:", error.message);
      }
      if (!authBound) {
        authBound = true;
        auth.onAuthStateChanged((user) => {
          currentUser = user;
          setStatus(user ? "connected" : "disconnected", user ? user.email || "Signed in" : "Signed out");
          authListeners.slice().forEach((listener) => listener(user));
        });
      }
      initialized = true;
      return true;
      } catch (error) {
        setStatus("error", error.message || "Firebase initialization failed.");
        console.error("Firebase initialization failed:", error);
        return false;
      } finally {
        initPromise = null;
      }
    })();
    return initPromise;
  }

  async function signInWithGoogle() {
    if (!await init()) throw new Error("Firebase is not configured. Add the web app configuration first.");
    const provider = new window.firebase.auth.GoogleAuthProvider();
    try {
      return await auth.signInWithPopup(provider);
    } catch (error) {
      // A popup can be blocked by browser policy. Redirect is the fallback,
      // while configuration/provider errors must remain visible to the user.
      if (error?.code === "auth/popup-blocked" || error?.code === "auth/cancelled-popup-request") {
        return auth.signInWithRedirect(provider);
      }
      setStatus("error", getAuthErrorMessage(error));
      throw new Error(getAuthErrorMessage(error));
    }
  }

  async function handleRedirectResult() {
    if (!await init() || !auth) return null;
    try {
      const result = await auth.getRedirectResult();
      return result?.user || null;
    } catch (error) {
      const message = getAuthErrorMessage(error);
      setStatus("error", message);
      console.error("Google redirect sign-in failed:", error);
      throw new Error(message);
    }
  }

  function getAuthErrorMessage(error) {
    if (error?.code === "auth/unauthorized-domain") {
      return "Google sign-in is not enabled for this website. Add yassir1410.github.io under Firebase Authentication > Settings > Authorized domains.";
    }
    if (error?.code === "auth/operation-not-allowed") {
      return "Google sign-in is disabled. Enable Google under Firebase Authentication > Sign-in providers.";
    }
    if (error?.code === "auth/popup-closed-by-user") {
      return "Google sign-in was cancelled. Select an account to continue.";
    }
    return error?.message || "Google sign-in failed. Try again.";
  }

  async function signOut() {
    if (auth) await auth.signOut();
    currentUser = null;
    setStatus("disconnected", "Signed out");
  }

  function userPath(collection, id = "") {
    if (!currentUser) throw new Error("Authentication is required.");
    return db.collection("users").doc(currentUser.uid).collection(collection).doc(id || undefined);
  }

  function userCollection(collection) {
    if (!currentUser) throw new Error("Authentication is required.");
    return db.collection("users").doc(currentUser.uid).collection(collection);
  }

  function compareRecords(local, remote) {
    const localRevision = Number(local?._sync?.revision || local?.revision || 0);
    const remoteRevision = Number(remote?._sync?.revision || remote?.revision || 0);
    if (localRevision !== remoteRevision) return localRevision > remoteRevision ? 1 : -1;
    const localTime = String(local?._sync?.updatedAt || local?.updated_at || "");
    const remoteTime = String(remote?._sync?.updatedAt || remote?.updated_at || "");
    if (localTime !== remoteTime) return localTime > remoteTime ? 1 : -1;
    return String(local?._sync?.deviceId || "").localeCompare(String(remote?._sync?.deviceId || ""));
  }

  function withSyncMetadata(record, existing) {
    const revision = Math.max(Number(existing?._sync?.revision || 0), Number(record?._sync?.revision || 0)) + 1;
    return {
      ...record,
      _sync: { revision, updatedAt: new Date().toISOString(), deviceId, pending: true }
    };
  }

  function chunks(items) {
    const result = [];
    for (let index = 0; index < items.length; index += BATCH_SIZE) result.push(items.slice(index, index + BATCH_SIZE));
    return result;
  }

  async function sync(snapshot, applyRemote) {
    if (!currentUser || !db) return { uploaded: 0, downloaded: 0, conflicts: 0 };
    if (!navigator.onLine) {
      setStatus("offline", "Changes will sync when you reconnect.");
      return { uploaded: 0, downloaded: 0, conflicts: 0 };
    }
    setStatus("syncing", "Synchronizing...");
    try {
      const remoteSnapshot = await Promise.all(["vocabulary", "reviewHistory", "settings"].map((collection) => userCollection(collection).get()));
      const remoteEntries = remoteSnapshot[0].docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      const remoteHistory = remoteSnapshot[1].docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      const remoteSettings = remoteSnapshot[2].docs.map((doc) => ({ id: doc.id, ...doc.data() }))[0] || {};
      const localEntries = snapshot.entries || [];
      const localHistory = snapshot.reviewHistory || [];
      const mergeCollection = (local, remote) => {
        const byId = new Map(remote.map((item) => [item.id, item]));
        let conflicts = 0;
        local.forEach((item) => {
          const remoteItem = byId.get(item.id);
          if (!remoteItem || compareRecords(item, remoteItem) >= 0) {
            byId.set(item.id, withSyncMetadata(item, remoteItem));
            if (remoteItem && compareRecords(item, remoteItem) !== 0) conflicts++;
          }
        });
        return { records: [...byId.values()], conflicts };
      };
      const entriesMerge = mergeCollection(localEntries, remoteEntries);
      const historyMerge = mergeCollection(localHistory, remoteHistory);
      const merged = { entries: entriesMerge.records, reviewHistory: historyMerge.records, settings: { ...remoteSettings, ...(snapshot.settings || {}) } };
      const allWrites = [
        ...merged.entries.map((item) => ["vocabulary", item.id, item]),
        ...merged.reviewHistory.map((item) => ["reviewHistory", item.id || crypto.randomUUID(), item]),
        ["settings", "preferences", merged.settings]
      ];
      let uploaded = 0;
      for (const batchItems of chunks(allWrites)) {
        const batch = db.batch();
        batchItems.forEach(([collection, id, data]) => batch.set(userPath(collection, id), { ...data, _sync: { ...(data._sync || {}), pending: false } }, { merge: true }));
        await batch.commit();
        uploaded += batchItems.length;
      }
      const clean = {
        entries: merged.entries.map((item) => ({ ...item, _sync: { ...(item._sync || {}), pending: false } })),
        reviewHistory: merged.reviewHistory.map((item) => ({ ...item, _sync: { ...(item._sync || {}), pending: false } })),
        settings: merged.settings
      };
      await applyRemote(clean);
      setStatus("connected", "Synced");
      return { uploaded, downloaded: remoteEntries.length + remoteHistory.length, conflicts: entriesMerge.conflicts + historyMerge.conflicts };
    } catch (error) {
      setStatus("error", `Sync failed: ${error.message}`);
      console.error("Firestore synchronization failed:", error);
      throw error;
    }
  }

  function queueSync(getSnapshot, applyRemote) {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => sync(getSnapshot(), applyRemote).catch(() => {}), 800);
  }

  function onStatusChange(listener) {
    listeners.push(listener);
    listener(status, statusDetail);
    return () => { listeners = listeners.filter((item) => item !== listener); };
  }

  function onAuthChange(listener) {
    authListeners.push(listener);
    listener(currentUser);
    return () => { authListeners = authListeners.filter((item) => item !== listener); };
  }

  if (typeof window !== "undefined") {
    window.addEventListener("online", () => { if (currentUser && window.LexiconSyncAdapter) queueSync(window.LexiconSyncAdapter.snapshot, window.LexiconSyncAdapter.applyRemote); });
    window.addEventListener("offline", () => setStatus("offline", "Offline — local changes are safe."));
  }

  return {
    getConfig, saveConfig, isConfigured, init, signInWithGoogle, handleRedirectResult, signOut, sync, queueSync,
    onStatusChange, onAuthChange, getUser: () => currentUser, getStatus: () => status,
    getStatusDetail: () => statusDetail, compareRecords, withSyncMetadata
  };
});
