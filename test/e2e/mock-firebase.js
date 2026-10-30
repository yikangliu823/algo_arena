/**
 * @fileoverview Test stand-in for the Firebase JS SDK subset that platform-firebase.js uses.
 * All iframes share one store in the harness page (window.parent.__FB). The server clock is the harness page's clock;
 * iframes may have skewed clocks.
 * Security: a JavaScript mirror of firestore.rules for the paths the app uses, so the app is tested against the same
 * refusals (answer window, create-only answers, host-filtered pub queries). The rules file itself is tested separately
 * against the real emulator (test/rules).
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
const M = window.parent.__FB;
const ME = new URLSearchParams(location.search).get("u");
const LAT = 20;
/**
 * Runs `fn` after the simulated network latency (LAT ms).
 * @param {function()} fn Callback.
 * @return {number} The timer id.
 */
const later = (fn) => setTimeout(fn, LAT);
/**
 * Returns a promise that resolves after the simulated network latency.
 * @return {!Promise<void>}
 */
const delay = () => new Promise((r) => setTimeout(r, LAT));

/**
 * Minimal Firestore Timestamp holding milliseconds.
 *
 * `constructor(ms)` stores the time, `toMillis()` returns it, and the static `fromMillis(ms)` builds one. The methods
 * share the class's single line, so they are documented here.
 */
export class Timestamp { constructor(ms) { this._ms = ms; } toMillis() { return this._ms; } static fromMillis(ms) { return new Timestamp(ms); } }
/** Field path for updateDoc; the constructor stores its segments in `segs`. */
export class FieldPath { constructor(...segs) { this.segs = segs; } }
/** Google auth provider stub; `setCustomParameters()` is a no-op. */
export class GoogleAuthProvider { setCustomParameters() {} }
const SENT = "__srv";
/**
 * Returns the server-timestamp sentinel, which enc() replaces with the server time on write.
 * @return {!Object} The sentinel.
 */
export function serverTimestamp() { return { [SENT]: true }; }
/**
 * Returns whether `v` is the server-timestamp sentinel.
 * @param {*} v Any value.
 * @return {*} True for the sentinel; a falsy value otherwise.
 */
const isSent = (v) => v && typeof v === "object" && v[SENT] === true;

/* ---------- app and auth ---------- */
/**
 * Returns a fake app object.
 * @param {!Object} config Firebase config.
 * @return {{config: !Object}} The app.
 */
export function initializeApp(config) { return { config }; }
const auth = { currentUser: null };
/**
 * Returns the user of this frame (test uid ME) when signed in in the shared state, else null.
 * @return {?{uid: string, displayName: string, email: string}} The user.
 */
function userObj() { return M.signedIn[ME] ? { uid: ME, displayName: M.names[ME] || ME, email: ME + "@example.edu" } : null; }
/**
 * Refreshes and returns the module's single auth object.
 * @return {{currentUser: ?Object}} The auth object.
 */
export function getAuth() { auth.currentUser = userObj(); return auth; }
/**
 * Calls `cb` once, after the simulated latency, with the current user.
 * @param {!Object} a Auth object (unused).
 * @param {function(?Object)} cb Listener.
 * @return {function()} A no-op unsubscribe function.
 */
export function onAuthStateChanged(a, cb) { later(() => cb(userObj())); return () => {}; }
/**
 * Resolves to null: there is never a pending redirect result.
 * @return {!Promise<null>}
 */
export async function getRedirectResult() { return null; }
/**
 * Signs this frame's user in, after the simulated latency, in the shared state and on `a`.
 * @param {{currentUser: ?Object}} a Auth object.
 * @return {!Promise<{user: !Object}>} The sign-in result.
 */
export async function signInWithPopup(a) { await delay(); M.signedIn[ME] = true; a.currentUser = userObj(); return { user: a.currentUser }; }
/** Alias of signInWithPopup: the mock signs in at once instead of redirecting. */
export const signInWithRedirect = signInWithPopup;
/**
 * Signs this frame's user out in the shared state and clears `a.currentUser`.
 * @param {{currentUser: ?Object}} a Auth object.
 * @return {!Promise<void>}
 */
export async function signOut(a) { M.signedIn[ME] = false; a.currentUser = null; }

/* ---------- encoding: stored data is JSON with {__ts: ms} for timestamps ---------- */
/**
 * Encodes a value for storage.
 *
 * The sentinel becomes `{__ts: now}`, Timestamp-like values become `{__ts: ms}`, arrays and objects are encoded
 * recursively, and undefined object fields are dropped.
 * @param {*} v Value to encode.
 * @param {number} now Server time in ms used for sentinels.
 * @return {*} The encoded value.
 */
function enc(v, now) {
  if (isSent(v)) return { __ts: now };
  if (v instanceof Timestamp || (v && typeof v.toMillis === "function")) return { __ts: v.toMillis() };
  if (Array.isArray(v)) return v.map((x) => enc(x, now));
  if (v && typeof v === "object") { const o = {}; for (const [k, x] of Object.entries(v)) if (x !== undefined) o[k] = enc(x, now); return o; }
  return v;
}
/**
 * Decodes stored data: an object whose only key is `__ts` becomes a Timestamp; arrays and objects recurse.
 * @param {*} v Stored value.
 * @return {*} The decoded value.
 */
function dec(v) {
  if (v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 1 && "__ts" in v) return new Timestamp(v.__ts);
  if (Array.isArray(v)) return v.map(dec);
  if (v && typeof v === "object") { const o = {}; for (const [k, x] of Object.entries(v)) o[k] = dec(x); return o; }
  return v;
}
/**
 * Returns `v.__ts` for an encoded timestamp, else `v` unchanged.
 * @param {*} v Stored value.
 * @return {*} Milliseconds or the original value.
 */
const ms = (v) => (v && typeof v === "object" && "__ts" in v ? v.__ts : v);
/**
 * Splits a path into its non-empty segments.
 * @param {string} p Path.
 * @return {!Array<string>} The segments.
 */
const segs = (p) => p.split("/").filter(Boolean);
/**
 * Returns the path of the collection that contains a document.
 * @param {string} p Document path.
 * @return {string} The parent collection path.
 */
const parentOf = (p) => segs(p).slice(0, -1).join("/");
/**
 * Returns a permission-denied error shaped like the SDK's.
 * @return {!Error} The error, with code "permission-denied".
 */
const denied = () => Object.assign(new Error("Missing or insufficient permissions."), { code: "permission-denied" });

/* ---------- rules mirror ---------- */
/**
 * Returns whether `uid` is listed in meta/admins.
 * @param {string} uid User id.
 * @return {boolean} True for an admin.
 */
function isAdmin(uid) { const a = M.docs.get("meta/admins"); return !!(a && (a.uids || []).includes(uid)); }
/**
 * Returns whether `now` lies in the answer window [open, open + T s + 250 ms].
 *
 * `open` is openNowSrv when set, else shownSrv plus readS seconds (mirror of the rules).
 * @param {!Object} r Stored room document.
 * @param {number} now Server time in ms.
 * @return {boolean} True inside the window.
 */
function inWindow(r, now) {
  const T = Number(r.q && r.q.T) * 1000;
  const open = r.openNowSrv != null ? ms(r.openNowSrv) : ms(r.shownSrv) + Number(r.readS) * 1000;
  return now >= open && now <= open + T + 250;
}
/**
 * Mirrors the rules' check for creating an answer.
 *
 * The room must be in "question"; the keys must be allowed and include uid, sid, q, ct and srv; uid must be the writer;
 * sid and q must match the room's session and question; ct must be a string shorter than 4096; the id must be
 * `<uid>_<sid>_<q>`; srv must be the sentinel; and the time must be inside the window. Reasons for a refusal are
 * appended to M.refusedWhy for debugging.
 * @param {string} host Host uid (the room id).
 * @param {string} aid Answer document id.
 * @param {!Object} raw Unencoded data being written.
 * @param {number} now Server time in ms.
 * @return {boolean} True when the write is allowed.
 */
function validAnswer(host, aid, raw, now) {
  const r = M.docs.get(`rooms/${host}`); if (!r || r.status !== "question") return false;
  const keys = Object.keys(raw); const allowed = ["uid", "sid", "q", "ct", "srv", "mono", "localAt", "offset", "rtt", "dev"];
  if (!keys.every((k) => allowed.includes(k)) || !["uid", "sid", "q", "ct", "srv"].every((k) => keys.includes(k))) { M.refusedWhy = [...(M.refusedWhy || []), { who: ME, why: ["keys"], keys }]; return false; }
  const why = [["uid", raw.uid === ME], ["sid", raw.sid === r.sid], ["q", raw.q === r.qIndex], ["ct", typeof raw.ct === "string" && raw.ct.length < 4096],
    ["aid", aid === `${ME}_${r.sid}_${r.qIndex}`], ["srv", isSent(raw.srv)], ["window", inWindow(r, now)]].filter(([, ok]) => !ok).map(([k]) => k);
  if (why.length) M.refusedWhy = [...(M.refusedWhy || []), { who: ME, why, ctLen: raw.ct && raw.ct.length }];
  return !why.length;
}
/**
 * Mirrors the rules' read checks for this frame's user (ME).
 *
 * Allowed: own user data; the bank and meta; any room; a report delivery for its host or recipient; an answer for
 * the host or its author; a public record for its owner or the host it names. Signed-out users read nothing.
 * @param {string} path Document path.
 * @return {boolean} True when the read is allowed.
 */
function canRead(path) {
  const s = segs(path); if (!M.signedIn[ME]) return false;
  if (s[0] === "data" && s[1] === "users") return s[2] === ME;
  if (s[0] === "bank" || s[0] === "meta") return true;
  if (s[0] === "rooms" && s.length === 2) return true;
  if (s[0] === "rooms" && s[2] === "r") return s[1] === ME || s[3].endsWith("_" + ME);
  if (s[0] === "rooms" && s[2] === "answers") return s[1] === ME || s[3].startsWith(ME + "_");
  if (s[0] === "pub") { const d = M.docs.get(path); return s[1] === ME || !!(d && d.host === ME); }
  return false;
}
/**
 * Mirrors the rules' list checks: pub queries must filter on `host == ME`, a room's answers are listable by its host
 * only, the rooms collection is listable, and other collections fall back to canRead on a child path.
 * @param {string} colPath Collection path.
 * @param {!Array<!Object>} cons Query constraints.
 * @return {boolean} True when the query is allowed.
 */
function canList(colPath, cons) {
  const s = segs(colPath); if (!M.signedIn[ME]) return false;
  if (s[0] === "pub" && s.length === 1) return cons.some((c) => c.k === "where" && c.f === "host" && c.op === "==" && c.v === ME);
  if (s[0] === "rooms" && s[2] === "answers") return s[1] === ME;
  if (s[0] === "rooms" && s.length === 1) return true;
  return canRead(colPath + "/x");
}
/**
 * Mirrors the rules' write checks: own user data; the bank and meta for admins; a room and its report deliveries for
 * the host; answers only as new documents that pass validAnswer; public records for their owner.
 * @param {string} path Document path.
 * @param {?Object} raw Data being written, or null for update and delete.
 * @param {boolean} exists Whether the document already exists.
 * @param {number} now Server time in ms.
 * @return {boolean} True when the write is allowed.
 */
function canWrite(path, raw, exists, now) {
  const s = segs(path); if (!M.signedIn[ME]) return false;
  if (s[0] === "data" && s[1] === "users") return s[2] === ME;
  if (s[0] === "bank" || s[0] === "meta") return isAdmin(ME);
  if (s[0] === "rooms" && s.length === 2) return s[1] === ME;
  if (s[0] === "rooms" && s[2] === "r") return s[1] === ME;
  if (s[0] === "rooms" && s[2] === "answers") return !exists && raw != null && validAnswer(s[1], s[3], raw, now);
  if (s[0] === "pub") return s[1] === ME;
  return false;
}

/* ---------- subscriptions ---------- */
/**
 * Schedules a delivery, after the simulated latency, to each subscription on the document or its parent
 * collection that is still active at that time.
 * @param {string} path Changed document path.
 */
function notify(path) {
  for (const sub of M.subs) if (sub.path === path || sub.col === parentOf(path)) later(() => { if (M.subs.has(sub)) sub.deliver(); });
}

/* ---------- firestore ---------- */
/**
 * Returns the fake Firestore handle.
 * @return {{kind: string}} The handle.
 */
export function initializeFirestore() { return { kind: "firestore" }; }
/**
 * Returns the fake Firestore handle.
 * @return {{kind: string}} The handle.
 */
export function getFirestore() { return { kind: "firestore" }; }
/**
 * Returns a document reference.
 *
 * Given a collection reference, it picks a random id under that collection (the reference's `id` is then the
 * placeholder "x"); otherwise `path` is the full document path.
 * @param {!Object} db Firestore handle or collection reference.
 * @param {string=} path Document path.
 * @return {{kind: string, path: string, id: string}} The reference.
 */
export function doc(db, path) { if (db && db.kind === "col") return { kind: "doc", path: db.path + "/" + Math.random().toString(36).slice(2, 12), id: "x" }; return { kind: "doc", path, id: segs(path).at(-1) }; }
/**
 * Returns a collection reference.
 * @param {!Object} db Firestore handle (unused).
 * @param {string} path Collection path.
 * @return {{kind: string, path: string}} The reference.
 */
export function collection(db, path) { return { kind: "col", path }; }
/**
 * Returns a where constraint.
 * @param {string} f Field name.
 * @param {string} op Operator.
 * @param {*} v Value.
 * @return {{k: string, f: string, op: string, v: *}} The constraint.
 */
export function where(f, op, v) { return { k: "where", f, op, v }; }
/**
 * Returns an order constraint.
 * @param {string} f Field name.
 * @param {string=} dir "asc" (default) or "desc".
 * @return {{k: string, f: string, dir: string}} The constraint.
 */
export function orderBy(f, dir = "asc") { return { k: "order", f, dir }; }
/**
 * Returns a limit constraint.
 * @param {number} n Maximum number of results.
 * @return {{k: string, n: number}} The constraint.
 */
export function limit(n) { return { k: "limit", n }; }
/**
 * Returns a query over a collection with the given constraints.
 * @param {{path: string}} col Collection reference.
 * @param {...!Object} cons Constraints.
 * @return {{kind: string, path: string, cons: !Array<!Object>}} The query.
 */
export function query(col, ...cons) { return { kind: "query", path: col.path, cons }; }

/**
 * Returns a snapshot of the stored document; `data()` gives a decoded deep copy, or undefined when absent.
 * @param {string} path Document path.
 * @return {!Object} The snapshot.
 */
function docSnapshot(path) {
  const d = M.docs.get(path);
  return { id: segs(path).at(-1), exists: () => d !== undefined, data: () => (d === undefined ? undefined : dec(JSON.parse(JSON.stringify(d)))), metadata: { hasPendingWrites: false } };
}
/**
 * Runs a query over the direct children of a collection.
 *
 * Rows are sorted by path, filtered by every where constraint (timestamps compared as ms), then sorted by the first
 * order constraint and cut by the first limit.
 * @param {string} path Collection path.
 * @param {!Array<!Object>} cons Constraints.
 * @return {{docs: !Array<!Object>, size: number, empty: boolean}} The query snapshot.
 */
function runQuery(path, cons) {
  let rows = [...M.docs.entries()].filter(([k]) => parentOf(k) === path).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  for (const c of cons.filter((x) => x.k === "where")) rows = rows.filter(([, d]) => { const a = ms(d[c.f]);
    return c.op === "==" ? a === c.v : c.op === "!=" ? a !== c.v : c.op === "<" ? a < c.v : c.op === "<=" ? a <= c.v : c.op === ">" ? a > c.v : c.op === ">=" ? a >= c.v : c.op === "in" ? c.v.includes(a) : c.op === "array-contains" ? Array.isArray(a) && a.includes(c.v) : true; });
  const o = cons.find((x) => x.k === "order"); if (o) rows.sort((x, y) => ((ms(x[1][o.f]) > ms(y[1][o.f])) - (ms(x[1][o.f]) < ms(y[1][o.f]))) * (o.dir === "desc" ? -1 : 1));
  const l = cons.find((x) => x.k === "limit"); if (l) rows = rows.slice(0, l.n);
  const docs = rows.map(([k]) => ({ id: segs(k).at(-1), data: () => dec(JSON.parse(JSON.stringify(M.docs.get(k)))) }));
  return { docs, size: docs.length, empty: !docs.length };
}
/**
 * Reads one document after the simulated latency.
 * @param {{path: string}} ref Document reference.
 * @return {!Promise<!Object>} The snapshot.
 * @throws {!Error} permission-denied when canRead refuses.
 */
export async function getDoc(ref) { await delay(); if (!canRead(ref.path)) throw denied(); return docSnapshot(ref.path); }
/** Alias of getDoc: the mock has no cache. */
export const getDocFromServer = getDoc;
/**
 * Runs a query after the simulated latency.
 * @param {{path: string, cons: (!Array<!Object>|undefined)}} q Query or collection reference.
 * @return {!Promise<!Object>} The query snapshot.
 * @throws {!Error} permission-denied when canList refuses.
 */
export async function getDocs(q) { await delay(); const cons = q.cons || []; if (!canList(q.path, cons)) throw denied(); return runQuery(q.path, cons); }
/**
 * Writes a document after the simulated latency, encoding timestamps with the server time, and notifies
 * subscribers. Refused writes are recorded in M.refused.
 * @param {{path: string}} ref Document reference.
 * @param {!Object} data Document data.
 * @return {!Promise<void>}
 * @throws {!Error} permission-denied when canWrite refuses.
 */
export async function setDoc(ref, data) {
  await delay(); const now = M.now(); const exists = M.docs.has(ref.path);
  if (!canWrite(ref.path, data, exists, now)) { M.refused.push({ who: ME, path: ref.path, at: now }); throw denied(); }
  M.docs.set(ref.path, enc(data, now)); notify(ref.path);
}
/**
 * Updates fields of an existing document and notifies subscribers.
 *
 * Arguments after `ref` alternate between field paths (dotted strings or FieldPath) and values; missing or non-object
 * intermediate maps are created.
 * @param {{path: string}} ref Document reference.
 * @param {...*} args Alternating field paths and values.
 * @return {!Promise<void>}
 * @throws {!Error} not-found when the document does not exist; permission-denied when canWrite refuses.
 */
export async function updateDoc(ref, ...args) {
  await delay(); const now = M.now(); const cur = M.docs.get(ref.path);
  if (cur === undefined) throw Object.assign(new Error("No document to update: " + ref.path), { code: "not-found" });
  if (!canWrite(ref.path, null, true, now)) throw denied();
  const next = JSON.parse(JSON.stringify(cur));
  for (let k = 0; k < args.length; k += 2) {
    const p = args[k] instanceof FieldPath || (args[k] && args[k].segs) ? args[k].segs : String(args[k]).split(".");
    let o = next; for (const seg of p.slice(0, -1)) { if (!o[seg] || typeof o[seg] !== "object" || Array.isArray(o[seg])) o[seg] = {}; o = o[seg]; }
    o[p.at(-1)] = enc(args[k + 1], now);
  }
  M.docs.set(ref.path, next); notify(ref.path);
}
/**
 * Deletes a document after the simulated latency and notifies subscribers.
 * @param {{path: string}} ref Document reference.
 * @return {!Promise<void>}
 * @throws {!Error} permission-denied when canWrite refuses.
 */
export async function deleteDoc(ref) { await delay(); if (!canWrite(ref.path, null, true, M.now())) throw denied(); M.docs.delete(ref.path); notify(ref.path); }
/**
 * Subscribes to a document or a query.
 *
 * Accepts (target, next, error) or (target, options, next, error); options are ignored. The first delivery happens
 * after the simulated latency and later ones on notify(). If the read check fails at delivery time, the subscription
 * is dropped and `error` receives permission-denied.
 * @param {!Object} target Document reference or query.
 * @param {(!Object|function(!Object))} a Options or the next callback.
 * @param {function(*)=} b Next or error callback.
 * @param {function(!Error)=} c Error callback.
 * @return {function()} Unsubscribe function.
 */
export function onSnapshot(target, a, b, c) {
  const opts = typeof a === "function" ? {} : a; const next = typeof a === "function" ? a : b; const error = typeof a === "function" ? b : c;
  let sub;
  if (target.kind === "doc") {
    sub = { path: target.path, deliver: () => { if (!canRead(target.path)) { M.subs.delete(sub); return error && error(denied()); } next(docSnapshot(target.path)); } };
  } else {
    const cons = target.cons || [];
    sub = { col: target.path, deliver: () => { if (!canList(target.path, cons)) { M.subs.delete(sub); return error && error(denied()); } next(runQuery(target.path, cons)); } };
  }
  M.subs.add(sub); later(() => { if (M.subs.has(sub)) sub.deliver(); });
  return () => M.subs.delete(sub);
}

/* ---------- functions: the harness page runs coach-core.js with fake Anthropic and Firestore-backed deps ---------- */
/**
 * Returns a fake functions handle.
 * @param {!Object} app App (unused).
 * @param {string} region Region name.
 * @return {{region: string}} The handle.
 */
export function getFunctions(app, region) { return { region }; }
/**
 * Returns a callable that sends a JSON deep copy of its data to M.callFunction as this frame's user (null when
 * signed out) and resolves to `{data}`.
 *
 * Errors are rethrown with an SDK-style code `functions/<code>` mapped from the coach error code (unknown codes map to
 * internal), and the coach code is kept in `details.code`.
 * @param {!Object} fns Functions handle (unused).
 * @param {string} name Function name.
 * @return {function(*): !Promise<{data: *}>} The callable.
 */
export function httpsCallable(fns, name) {
  return async (data) => {
    try { return { data: await M.callFunction(name, M.signedIn[ME] ? ME : null, JSON.parse(JSON.stringify(data))) }; }
    catch (e) { const map = { not_granted: "permission-denied", quota_exceeded: "resource-exhausted", invalid_argument: "invalid-argument", rate_limited: "resource-exhausted", upstream_error: "unavailable", empty_completion: "internal", misconfigured: "failed-precondition" };
      throw Object.assign(new Error(e.message), { code: "functions/" + (map[e.code] || "internal"), details: { code: e.code } }); }
  };
}
