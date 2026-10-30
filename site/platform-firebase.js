/**
 * @fileoverview AlgoArena route B platform layer. The page was written against the claude.ai capability interface
 * (claude.use("db"), "user", "downloads", ...). This module provides the same interface backed by Firebase
 * Authentication (Google sign-in) and Cloud Firestore, so the page logic stays the same. Differences from the
 * claude.ai runtime are noted where they matter:
 * - db.update() merges nested objects (claude.ai semantics); Firestore's updateDoc replaces nested maps, so updates
 *   are sent as explicit field paths.
 * - Firestore Timestamps are returned as epoch milliseconds, which is what the page stores everywhere else.
 * - db.serverTime() is a server-timestamp sentinel; db.serverNow() estimates the server clock on this device.
 *
 * Author: Yikang (Richard) Liu, M.S. Candidate in Computer Science, Khoury College of Computer Sciences,
 *     Northeastern University
 * Version: 1.0
 * Created: October 29, 2026 · San Francisco, California, USA
 *
 * License: This project is licensed under the MIT License — see LICENSE.md for details.
 * Copyright © 2026 Yikang (Richard) Liu.
 * @license MIT
 */
import CONFIG from "./firebase-config.js";

const W = /** @type {any} */ (window);
const SDK = W.AA_FIREBASE_SDK || "https://www.gstatic.com/firebasejs/10.12.2/";
const F = {};                       // loaded SDK modules and instances
const SRV = { offset: 0, rtt: null }; // server clock minus this device's clock, from round trips
const SENTINELS = new WeakSet();
let ready = null;

/**
 * Loads the Firebase SDK modules, initializes the app, auth and Firestore, finishes any redirect sign-in, waits for
 * the first auth state, and starts the server clock estimate for a signed-in user. Results are stored in F.
 *
 * @return {!Promise<void>}
 */
async function init() {
  const [appM, authM, fsM] = await Promise.all([
    import(SDK + "firebase-app.js"), import(SDK + "firebase-auth.js"), import(SDK + "firebase-firestore.js"),
  ]);
  const app = appM.initializeApp(CONFIG.firebase);
  const auth = authM.getAuth(app);
  let fdb;
  try { fdb = fsM.initializeFirestore(app, { ignoreUndefinedProperties: true }); } catch { fdb = fsM.getFirestore(app); }
  Object.assign(F, { appM, authM, fsM, app, auth, fdb });
  try { await authM.getRedirectResult(auth); } catch (e) { console.warn("Redirect sign-in did not complete:", e); }
  F.user = await new Promise((resolve) => { const stop = authM.onAuthStateChanged(auth, (u) => { if (stop) stop(); resolve(u); }); });
  if (F.user) estimateServerOffset().catch((e) => console.warn("Server clock estimate failed:", e));
}
/**
 * Runs init() once and returns the same promise to every caller.
 *
 * @return {!Promise<void>}
 */
const boot = () => (ready = ready || init());

/**
 * Estimates the server clock offset from three write-then-read round trips; the one with the lowest round-trip time
 * gives the estimate, stored in SRV. Used only for countdown display; scoring uses server timestamps written by the
 * database.
 *
 * @return {!Promise<void>}
 */
async function estimateServerOffset() {
  const { fsM, fdb } = F; const ref = fsM.doc(fdb, `data/users/${F.user.uid}/clock/probe`); let best = null;
  for (let k = 0; k < 3; k++) {
    const t0 = Date.now(); await fsM.setDoc(ref, { t: fsM.serverTimestamp() });
    const s = await fsM.getDocFromServer(ref); const t1 = Date.now();
    const srv = s.data().t.toMillis(); const rtt = t1 - t0; const off = srv - (t0 + t1) / 2;
    if (!best || rtt < best.rtt) best = { rtt, off };
  }
  SRV.offset = Math.round(best.off); SRV.rtt = best.rtt;
}

/* ---------- value conversion ---------- */
/**
 * Converts Firestore values to plain JavaScript, recursively: Timestamps become epoch milliseconds.
 *
 * @param {*} v A value read from Firestore.
 * @return {*} The same value with every Timestamp replaced by a number.
 */
function toPlain(v) {
  if (v && typeof v.toMillis === "function") return v.toMillis();
  if (Array.isArray(v)) return v.map(toPlain);
  if (v && typeof v === "object") { const o = {}; for (const k of Object.keys(v)) o[k] = toPlain(v[k]); return o; }
  return v;
}
/**
 * Tells whether a value is a plain object literal (not an array, sentinel, Timestamp or other class instance).
 *
 * @param {*} v Any value.
 * @return {boolean}
 */
const isPlain = (v) => v != null && typeof v === "object" && !Array.isArray(v) && !SENTINELS.has(v) && Object.getPrototypeOf(v) === Object.prototype;
/**
 * Flattens nested plain objects into [field path, value] pairs so updateDoc merges nested maps (claude.ai semantics)
 * instead of replacing them. Undefined values are skipped; empty objects are kept as values.
 *
 * @param {!Object} obj The update patch.
 * @param {!Array<string>=} prefix Path of obj inside the document (used by the recursion).
 * @param {!Array<!Array>=} out Accumulator (used by the recursion).
 * @return {!Array<!Array>} Pairs of [!Array<string> path, value].
 */
function fieldPairs(obj, prefix = [], out = []) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    const path = [...prefix, k];
    if (isPlain(v) && Object.keys(v).length) fieldPairs(v, path, out); else out.push([path, v]);
  }
  return out;
}
const CODES = { "permission-denied": "permission_denied", "not-found": "invalid_argument", "unavailable": "unavailable", "resource-exhausted": "quota_exceeded", "deadline-exceeded": "unavailable" };
/**
 * Converts a Firestore error into the claude.ai-style error the page handles (permission_denied, quota_exceeded, ...).
 *
 * @param {*} e The Firestore SDK error.
 * @return {!Error} A new Error with `code` set to the page code and `original` set to e.
 */
function mapErr(e) {
  const raw = String((e && e.code) || "").replace(/^firestore\//, "");
  return Object.assign(new Error((e && e.message) || String(e)), { code: CODES[raw] || raw || "unknown", original: e });
}
/**
 * @param {!Promise<T>} p A Firestore SDK promise.
 * @return {!Promise<T>} The same result, with rejections mapped by mapErr.
 * @template T
 */
const wrap = (p) => p.catch((e) => { throw mapErr(e); });
/**
 * Adapts a Firestore DocumentSnapshot to the claude.ai snapshot shape; pending server timestamps read as estimates.
 *
 * @param {!Object} s Firestore DocumentSnapshot.
 * @return {{id: string, exists: boolean, pending: boolean, data: function(): (!Object|undefined)}}
 */
const docSnap = (s) => ({ id: s.id, exists: s.exists(), pending: !!(s.metadata && s.metadata.hasPendingWrites), data: () => (s.exists() ? toPlain(s.data({ serverTimestamps: "estimate" })) : undefined) });
/**
 * Adapts a Firestore QuerySnapshot to the claude.ai query snapshot shape.
 *
 * @param {!Object} s Firestore QuerySnapshot.
 * @return {{size: number, empty: boolean, docs: !Array<!Object>}}
 */
const querySnap = (s) => ({ size: s.size, empty: s.empty, docs: s.docs.map((d) => ({ id: d.id, exists: true, data: () => toPlain(d.data({ serverTimestamps: "estimate" })) })) });

/* ---------- db capability ---------- */
/**
 * Returns the claude.ai document API (get, set, update, delete, onSnapshot, collection) for one Firestore document.
 * update() sends explicit field paths (see fieldPairs); onSnapshot includes metadata changes.
 *
 * @param {string} path Document path.
 * @return {!Object} The document handle.
 */
function docApi(path) {
  const { fsM, fdb } = F; const ref = fsM.doc(fdb, path);
  return {
    path,
    get: () => wrap(fsM.getDoc(ref)).then(docSnap),
    set: (data) => wrap(fsM.setDoc(ref, data)),
    update: (data) => {
      const pairs = fieldPairs(data); if (!pairs.length) return Promise.resolve();
      return wrap(fsM.updateDoc(ref, ...pairs.flatMap(([p, v]) => [new fsM.FieldPath(...p), v])));
    },
    delete: () => wrap(fsM.deleteDoc(ref)),
    onSnapshot: (next, error) => fsM.onSnapshot(ref, { includeMetadataChanges: true }, (s) => next(docSnap(s)), (e) => error && error(mapErr(e))),
    collection: (c) => colApi(`${path}/${c}`, []),
  };
}
/**
 * Returns the claude.ai collection/query API (where, orderBy, limit, get, onSnapshot, doc) for a Firestore
 * collection; each where/orderBy/limit returns a new handle with one more constraint.
 *
 * @param {string} path Collection path.
 * @param {!Array<!Object>} cons Firestore query constraints collected so far.
 * @return {!Object} The collection handle.
 */
function colApi(path, cons) {
  const { fsM, fdb } = F; const q = () => fsM.query(fsM.collection(fdb, path), ...cons);
  return {
    path,
    where: (f, op, v) => colApi(path, [...cons, fsM.where(f, op, v)]),
    orderBy: (f, dir) => colApi(path, [...cons, fsM.orderBy(f, dir || "asc")]),
    limit: (n) => colApi(path, [...cons, fsM.limit(n)]),
    get: () => wrap(fsM.getDocs(q())).then(querySnap),
    onSnapshot: (next, error) => fsM.onSnapshot(q(), (s) => next(querySnap(s)), (e) => error && error(mapErr(e))),
    doc: (id) => docApi(`${path}/${id || fsM.doc(fsM.collection(fdb, path)).id}`),
  };
}
/**
 * The "db" capability: document and collection handles plus server-clock helpers. serverTime() returns a
 * server-timestamp sentinel and remembers it so isServerTime() can recognize it; serverNow() is this device's
 * estimate of the server clock in epoch milliseconds.
 */
const DB = {
  doc: (p) => docApi(p),
  collection: (p) => colApi(p, []),
  serverTime: () => { const s = F.fsM.serverTimestamp(); SENTINELS.add(s); return s; },
  isServerTime: (v) => v != null && typeof v === "object" && SENTINELS.has(v),
  serverNow: () => Date.now() + SRV.offset,
  serverOffset: () => SRV.offset,
  serverRtt: () => SRV.rtt,
};

/* ---------- user capability ---------- */
let adminCache = null;
/**
 * Tells whether the signed-in user is listed in meta/admins; the answer is cached, and read errors count as false.
 *
 * @return {!Promise<boolean>}
 */
async function isAdmin() {
  if (adminCache != null) return adminCache;
  try { const s = await F.fsM.getDoc(F.fsM.doc(F.fdb, "meta/admins")); adminCache = !!(s.exists() && (s.data().uids || []).includes(F.user.uid)); }
  catch { adminCache = false; }
  return adminCache;
}
/**
 * The "user" capability: the signed-in user's id and profile; owners and editors are the admins in meta/admins.
 */
const USER = {
  id: async () => (F.user ? F.user.uid : null),
  me: async () => ({ id: F.user.uid, name: F.user.displayName || "", email: F.user.email || "" }),
  isOwner: isAdmin,
  canEdit: isAdmin,
  can: async () => true,
  profiles: async () => ({}),
};

/* ---------- downloads capability (a normal browser download) ---------- */
const DOWNLOADS = {
  /**
   * Saves data as a browser download, with a media type chosen from the file extension.
   *
   * @param {{filename: string, data: (!Blob|string|!BufferSource)}} file File name and contents.
   * @return {!Promise<void>}
   */
  save: async ({ filename, data }) => {
    const type = /\.json$/i.test(filename) ? "application/json" : /\.zip$/i.test(filename) ? "application/zip" : /\.md$/i.test(filename) ? "text/markdown" : "application/octet-stream";
    const blob = data instanceof Blob ? data : new Blob([data], { type });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  },
};

/* ---------- sample capability: AI reports through the `coach` Cloud Function ---------- */
const FN_CODES = { "functions/permission-denied": "not_granted", "functions/unauthenticated": "not_granted", "functions/resource-exhausted": "rate_limited", "functions/unavailable": "upstream_error", "functions/deadline-exceeded": "upstream_error", "functions/internal": "upstream_error", "functions/not-found": "not_granted" };
let samplePromise = null;
/**
 * Builds the "sample" capability, which sends AI requests to the `coach` Cloud Function.
 *
 * @return {!Promise<?function((string|!Array<{role: string, content: string}>), !Object=): !Promise<!Object>>}
 *     The sample function (with .json and .limits), or null when CONFIG.coach is false (Spark plan).
 */
async function makeSample() {
  if (CONFIG.coach === false) return null;
  const fnM = await import(SDK + "firebase-functions.js");
  const call = fnM.httpsCallable(fnM.getFunctions(F.app, CONFIG.functionsRegion || "us-central1"), "coach", { timeout: 150000 });
  /**
   * Sends one prompt to the coach function and returns its reply in the claude.ai sample shape.
   *
   * @param {(string|!Array<{role: string, content: string}>)} input Prompt text, or messages joined as "role: text".
   * @param {{modelTier?: string, sid?: string, kind?: string, onText?: function(!Object)}=} opts Model tier, session
   *     id, report kind, and a text callback; every field is optional.
   * @return {!Promise<{text: string, truncated: boolean, modelApplied: ?string, modelTierApplied: ?string}>}
   * @throws {!Error} With `code` taken from the function's details.code, else mapped from the HTTPS error code.
   */
  const sample = async (input, opts = {}) => {
    const prompt = typeof input === "string" ? input : (input || []).map((m) => `${m.role}: ${m.content}`).join("\n\n");
    let r;
    try { r = await call({ prompt, tier: opts.modelTier || "default", ...(opts.sid ? { sid: opts.sid } : {}), ...(opts.kind ? { kind: opts.kind } : {}) }); }
    catch (e) {
      const code = (e && e.details && e.details.code) || FN_CODES[e && e.code] || "upstream_error";
      throw Object.assign(new Error((e && e.message) || "The AI request failed."), { code, original: e });
    }
    const d = (r && r.data) || {};
    if (opts.onText) opts.onText({ text: d.text || "", delta: d.text || "" });
    return { text: d.text || "", truncated: !!d.truncated, modelApplied: d.modelApplied || null, modelTierApplied: d.modelTierApplied || null };
  };
  /**
   * Like sample(), then parses the reply as JSON after removing a surrounding Markdown code fence.
   *
   * @param {(string|!Array<!Object>)} input See sample().
   * @param {!Object=} opts See sample().
   * @return {!Promise<*>} The parsed reply.
   */
  sample.json = async (input, opts) => { const r = await sample(input, opts); return JSON.parse(String(r.text).replace(/^\s*```(?:json)?/i, "").replace(/```\s*$/, "").trim()); };
  /** @return {!Promise<{images: boolean}>} Capabilities of this sample backend (no image input). */
  sample.limits = async () => ({ images: false });
  return sample;
}

/**
 * The claude.ai-compatible global the page uses: capabilities by name, plus Google sign-in and sign-out.
 */
W.claude = {
  /**
   * Returns a capability after Firebase has booted. "downloads" works signed out; the others need a signed-in user.
   *
   * @param {string} name "db", "user", "downloads" or "sample".
   * @return {!Promise<*>} The capability, or null when signed out, unavailable, or not provided (room, assets).
   */
  use: async (name) => {
    await boot();
    if (name === "downloads") return DOWNLOADS;
    if (!F.user) return null;
    if (name === "db") return DB;
    if (name === "user") return USER;
    if (name === "sample") return (samplePromise = samplePromise || makeSample().catch((e) => { console.warn("AI reports unavailable:", e); return null; }));
    return null; // room and assets are not provided on this platform
  },
  /**
   * Signs in with Google in a popup, falling back to a full-page redirect when popups are blocked or unsupported.
   *
   * @return {!Promise<void>}
   * @throws {*} Any other sign-in error from Firebase Authentication.
   */
  signIn: async () => {
    await boot();
    const provider = new F.authM.GoogleAuthProvider(); provider.setCustomParameters({ prompt: "select_account" });
    try { await F.authM.signInWithPopup(F.auth, provider); }
    catch (e) {
      const code = e && e.code;
      if (code === "auth/popup-blocked" || code === "auth/operation-not-supported-in-this-environment") { await F.authM.signInWithRedirect(F.auth, provider); return; }
      throw e;
    }
  },
  /** @return {!Promise<void>} Resolves once the Firebase user is signed out. */
  signOut: async () => { await boot(); await F.authM.signOut(F.auth); },
  platform: "firebase",
};
