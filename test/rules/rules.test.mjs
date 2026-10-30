/**
 * @fileoverview Firestore security-rules tests for firestore.rules, run on the Firestore emulator with
 * @firebase/rules-unit-testing: private user data, the question bank, rooms, the timed answer window, public player
 * records, report deliveries, and the server-only AI quota and log collections.
 *
 * Run with the Firestore emulator:
 *   cd test/rules && npm install
 *   firebase emulators:exec --only firestore --project demo-algoarena "npm test"
 * (run the firebase command from the repo root so it finds firebase.json and firestore.rules)
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
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc, collection, query, where, getDocs, serverTimestamp, Timestamp } from "firebase/firestore";

let env;
const HOST = "host_uid_aaaaaaaaaaaaaaaaaaaa";
const A = "alice_uid_aaaaaaaaaaaaaaaaaaa";
const B = "bob_uid_aaaaaaaaaaaaaaaaaaaaa";
const SID = "Stest1";

/** Starts the rules test environment for project demo-algoarena with ../../firestore.rules. */
before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-algoarena",
    firestore: { rules: readFileSync(new URL("../../firestore.rules", import.meta.url), "utf8") },
  });
});
/** Tears down the rules test environment. */
after(async () => { await env.cleanup(); });
/** Clears all emulator data before each test. */
beforeEach(async () => { await env.clearFirestore(); });

/**
 * Returns a Firestore client authenticated as `uid`, subject to the rules.
 * @param {string} uid User id.
 * @return {!Object} The Firestore instance.
 */
const as = (uid) => env.authenticatedContext(uid).firestore();
/**
 * Returns an unauthenticated Firestore client, subject to the rules.
 * @return {!Object} The Firestore instance.
 */
const anon = () => env.unauthenticatedContext().firestore();
/**
 * Writes a document with the security rules disabled.
 * @param {string} path Document path.
 * @param {!Object} data Document data.
 * @return {!Promise<void>}
 */
async function seed(path, data) { await env.withSecurityRulesDisabled(async (c) => { await setDoc(doc(c.firestore(), path), data); }); }

// A room whose question was shown `shownAgoMs` ago with reading time readS and answer time T.
/**
 * Seeds rooms/HOST for session SID with a server-side shownSrv set `shownAgoMs` before now, and openNowSrv
 * only when `openNowAgoMs` is given.
 * @param {{shownAgoMs: number, readS: (number|undefined), T: (number|undefined), status: (string|undefined),
 *     qIndex: (number|undefined), openNowAgoMs: (?number|undefined)}} options Room timing and state.
 * @return {!Promise<void>}
 */
async function seedRoom({ shownAgoMs, readS = 3, T = 15, status = "question", qIndex = 0, openNowAgoMs = null }) {
  const r = { sid: SID, code: "ABC123", hostId: HOST, status, qIndex, readS, q: { T, R: readS }, shownSrv: Timestamp.fromMillis(Date.now() - shownAgoMs) };
  if (openNowAgoMs != null) r.openNowSrv = Timestamp.fromMillis(Date.now() - openNowAgoMs);
  await seed(`rooms/${HOST}`, r);
}
/**
 * Returns a valid answer payload for `uid` on question 0 of SID, with the server timestamp and `over` merged on top.
 * @param {string} uid Author uid.
 * @param {!Object=} over Fields to add or override.
 * @return {!Object} The answer data.
 */
const answer = (uid, over = {}) => ({ uid, sid: SID, q: 0, ct: "sealed", srv: serverTimestamp(), mono: 1200, dev: "d1", ...over });
/**
 * Returns the answer document id `<uid>_<sid>_<q>` that the rules require.
 * @param {string} uid Author uid.
 * @param {number=} q Question index; defaults to 0.
 * @param {string=} sid Session id; defaults to SID.
 * @return {string} The document id.
 */
const aid = (uid, q = 0, sid = SID) => `${uid}_${sid}_${q}`;
/**
 * Returns a reference to an answer document in HOST's room.
 * @param {!Object} db Firestore instance.
 * @param {string} id Answer document id.
 * @return {!Object} The document reference.
 */
const ansRef = (db, id) => doc(db, `rooms/${HOST}/answers/${id}`);

/** Verifies that a signed-out client cannot read a room or the bank. */
test("signed-out users read nothing", async () => {
  await seedRoom({ shownAgoMs: 0 });
  await assertFails(getDoc(doc(anon(), `rooms/${HOST}`)));
  await assertFails(getDoc(doc(anon(), "bank/b0001")));
});

/** Verifies that a user can write and read their own profile, and another user can neither read it nor write under it. */
test("own data is private", async () => {
  await assertSucceeds(setDoc(doc(as(A), `data/users/${A}/profile`), { displayName: "Alice" }));
  await assertSucceeds(getDoc(doc(as(A), `data/users/${A}/profile`)));
  await assertFails(getDoc(doc(as(B), `data/users/${A}/profile`)));
  await assertFails(setDoc(doc(as(B), `data/users/${A}/profile/sets/s1`), { title: "x" }));
});

/** Verifies that signed-in users read the bank, a non-admin cannot write it, and a uid in meta/admins can. */
test("bank: everyone signed in reads, only admins write", async () => {
  await seed("bank/b0001", { prompt: "q" });
  await assertSucceeds(getDoc(doc(as(A), "bank/b0001")));
  await assertFails(setDoc(doc(as(A), "bank/b0002"), { prompt: "x" }));
  await seed("meta/admins", { uids: [HOST] });
  await assertSucceeds(setDoc(doc(as(HOST), "bank/b0002"), { prompt: "x" }));
});

/** Verifies that any signed-in user can read a room but only its host can update it. */
test("only the host writes its room", async () => {
  await seedRoom({ shownAgoMs: 0 });
  await assertSucceeds(getDoc(doc(as(A), `rooms/${HOST}`)));
  await assertFails(updateDoc(doc(as(A), `rooms/${HOST}`), { status: "ended" }));
  await assertSucceeds(updateDoc(doc(as(HOST), `rooms/${HOST}`), { status: "ended" }));
});

/**
 * Verifies that an answer with the server timestamp is accepted 5 s after the question was shown (2 s into a 15 s
 * window that opens after 3 s of reading).
 */
test("answer accepted inside the window with the server timestamp", async () => {
  await seedRoom({ shownAgoMs: 5000, readS: 3, T: 15 });
  await assertSucceeds(setDoc(ansRef(as(A), aid(A)), answer(A)));
});

/** Verifies that an answer is refused during the reading phase (1 s after shown, 10 s reading time). */
test("answer rejected during the reading phase", async () => {
  await seedRoom({ shownAgoMs: 1000, readS: 10, T: 15 });
  await assertFails(setDoc(ansRef(as(A), aid(A)), answer(A)));
});

/** Verifies that once the host has set openNowSrv, an answer is accepted before the reading time has elapsed. */
test("answer accepted during reading once the host opened answers early", async () => {
  await seedRoom({ shownAgoMs: 2000, readS: 10, T: 15, openNowAgoMs: 500 });
  await assertSucceeds(setDoc(ansRef(as(A), aid(A)), answer(A)));
});

/** Verifies that an answer is refused 30 s after shown, past 3 s of reading plus 15 s of answer time. */
test("answer rejected after the deadline", async () => {
  await seedRoom({ shownAgoMs: 30000, readS: 3, T: 15 });
  await assertFails(setDoc(ansRef(as(A), aid(A)), answer(A)));
});

/** Verifies that an answer is refused when the room status is not "question". */
test("answer rejected when the room is not taking answers", async () => {
  await seedRoom({ shownAgoMs: 5000, status: "closed" });
  await assertFails(setDoc(ansRef(as(A), aid(A)), answer(A)));
});

/** Verifies that an answer whose srv is a client-chosen Timestamp instead of the server time is refused. */
test("answer rejected with a client-chosen timestamp", async () => {
  await seedRoom({ shownAgoMs: 5000 });
  await assertFails(setDoc(ansRef(as(A), aid(A)), answer(A, { srv: Timestamp.fromMillis(Date.now() - 4000) })));
});

/**
 * Verifies that answers are refused for another user, for a question or session other than the room's current one,
 * under an id not of the form uid_sid_q, and with an extra field (score).
 */
test("answer rejected for another user, question, session or id", async () => {
  await seedRoom({ shownAgoMs: 5000 });
  await assertFails(setDoc(ansRef(as(A), aid(B)), answer(B)));
  await assertFails(setDoc(ansRef(as(A), aid(A, 1)), answer(A, { q: 1 })));
  await assertFails(setDoc(ansRef(as(A), aid(A, 0, "Sother")), answer(A, { sid: "Sother" })));
  await assertFails(setDoc(ansRef(as(A), "anything"), answer(A)));
  await assertFails(setDoc(ansRef(as(A), aid(A)), answer(A, { score: 1000 })));
});

/** Verifies that answers are create-only: a second write to the same id is refused. */
test("one answer per question: a second write is refused", async () => {
  await seedRoom({ shownAgoMs: 5000 });
  await assertSucceeds(setDoc(ansRef(as(A), aid(A)), answer(A)));
  await assertFails(setDoc(ansRef(as(A), aid(A)), answer(A, { ct: "changed" })));
});

/**
 * Verifies that an answer is readable by its author and the host but not another player, and that only the host
 * can list the room's answers.
 */
test("answers are readable by the host and their author only", async () => {
  await seedRoom({ shownAgoMs: 5000 });
  await setDoc(ansRef(as(A), aid(A)), answer(A));
  await assertSucceeds(getDoc(ansRef(as(A), aid(A))));
  await assertSucceeds(getDoc(ansRef(as(HOST), aid(A))));
  await assertFails(getDoc(ansRef(as(B), aid(A))));
  await assertSucceeds(getDocs(query(collection(as(HOST), `rooms/${HOST}/answers`), where("sid", "==", SID))));
  await assertFails(getDocs(query(collection(as(B), `rooms/${HOST}/answers`), where("sid", "==", SID))));
});

/**
 * Verifies that a public record is readable by its owner and the host it names, that the host's list query must
 * filter by host, and that another user cannot overwrite it.
 */
test("public record: readable by its owner and the host it names", async () => {
  await seed(`pub/${A}`, { sid: SID, host: HOST, name: "Alice" });
  await assertSucceeds(getDoc(doc(as(A), `pub/${A}`)));
  await assertSucceeds(getDoc(doc(as(HOST), `pub/${A}`)));
  await assertFails(getDoc(doc(as(B), `pub/${A}`)));
  await assertSucceeds(getDocs(query(collection(as(HOST), "pub"), where("sid", "==", SID), where("host", "==", HOST))));
  await assertFails(getDocs(query(collection(as(HOST), "pub"), where("sid", "==", SID))));
  await assertFails(setDoc(doc(as(B), `pub/${A}`), { sid: SID, host: B }));
});

/**
 * Verifies that a report delivery is readable by its recipient and the host, that a player may read the path for
 * their own id before the report exists, and that players cannot write deliveries.
 */
test("report deliveries: recipient and host only, even before the report exists", async () => {
  await seed(`rooms/${HOST}/r/${SID}_${A}`, { sid: SID, sealed: "x" });
  await assertSucceeds(getDoc(doc(as(A), `rooms/${HOST}/r/${SID}_${A}`)));
  await assertSucceeds(getDoc(doc(as(HOST), `rooms/${HOST}/r/${SID}_${A}`)));
  await assertFails(getDoc(doc(as(B), `rooms/${HOST}/r/${SID}_${A}`)));
  await assertSucceeds(getDoc(doc(as(B), `rooms/${HOST}/r/${SID}_${B}`)));
  await assertFails(setDoc(doc(as(A), `rooms/${HOST}/r/${SID}_${A}`), { sealed: "forged" }));
});

/** Verifies that clients, hosts included, can neither read nor write aiQuota counters or aiLog entries. */
test("AI quota counters and the AI call log are closed to clients", async () => {
  await seed(`aiQuota/${A}_2026-10-29`, { count: 1 });
  await seed("aiLog/e1", { uid: A });
  await assertFails(getDoc(doc(as(A), `aiQuota/${A}_2026-10-29`)));
  await assertFails(setDoc(doc(as(A), `aiQuota/${A}_2026-10-29`), { count: 0 }));
  await assertFails(getDoc(doc(as(HOST), "aiLog/e1")));
  await assertFails(setDoc(doc(as(HOST), "aiLog/e2"), { uid: HOST }));
});

/* ---------- round 2: cases the emulator's coverage report showed were never exercised ---------- */
/**
 * Verifies that a signed-out client is refused every read and write on profiles, the bank, rooms, report
 * deliveries, answers and public records.
 */
test("signed-out users are refused on every path", async () => {
  await seedRoom({ shownAgoMs: 5000 });
  await seed(`pub/${A}`, { sid: SID, host: HOST });
  await seed(`rooms/${HOST}/r/${SID}_${A}`, { sealed: "x" });
  const db = anon();
  await assertFails(getDoc(doc(db, `data/users/${A}/profile`)));
  await assertFails(setDoc(doc(db, `data/users/${A}/profile`), { displayName: "x" }));
  await assertFails(setDoc(doc(db, "bank/b0009"), { prompt: "x" }));
  await assertFails(setDoc(doc(db, `rooms/${HOST}`), { status: "ended" }));
  await assertFails(getDoc(doc(db, `rooms/${HOST}/r/${SID}_${A}`)));
  await assertFails(setDoc(doc(db, `rooms/${HOST}/r/${SID}_${A}`), { sealed: "forged" }));
  await assertFails(getDoc(ansRef(db, aid(A))));
  await assertFails(setDoc(ansRef(db, aid(A)), answer(A)));
  await assertFails(getDoc(doc(db, `pub/${A}`)));
  await assertFails(setDoc(doc(db, `pub/${A}`), { sid: SID, host: HOST }));
});

/** Verifies the allow paths for the host creating a report delivery and a player creating their own public record. */
test("the host writes report deliveries and a player writes their own public record", async () => {
  await assertSucceeds(setDoc(doc(as(HOST), `rooms/${HOST}/r/${SID}_${A}`), { sid: SID, sealed: "x" }));
  await assertSucceeds(setDoc(doc(as(A), `pub/${A}`), { sid: SID, host: HOST, name: "Alice" }));
});

/**
 * Verifies the answer field checks: a missing ct, a non-string ct and a 4096-character ct are refused, and a
 * 4095-character ct is accepted (the length boundary).
 */
test("answer rejected when a required field is missing or ct is not a short string", async () => {
  await seedRoom({ shownAgoMs: 5000 });
  const { ct, ...noCt } = answer(A);
  await assertFails(setDoc(ansRef(as(A), aid(A)), noCt));
  await assertFails(setDoc(ansRef(as(A), aid(A)), answer(A, { ct: 5 })));
  await assertFails(setDoc(ansRef(as(A), aid(A)), answer(A, { ct: "x".repeat(4096) })));
  await assertSucceeds(setDoc(ansRef(as(A), aid(A)), answer(A, { ct: "x".repeat(4095) })));
});

/** Verifies that after an early open the deadline counts from openNowSrv: 20 s after opening with T = 15 is refused. */
test("answer rejected after the deadline of an early open", async () => {
  await seedRoom({ shownAgoMs: 40000, readS: 30, T: 15, openNowAgoMs: 20000 });
  await assertFails(setDoc(ansRef(as(A), aid(A)), answer(A)));
});

/** Verifies that an openNowSrv 5 s in the future does not open answers during the reading phase. */
test("answer rejected before an early-open time that lies in the future", async () => {
  await seedRoom({ shownAgoMs: 1000, readS: 10, T: 15, openNowAgoMs: -5000 });
  await assertFails(setDoc(ansRef(as(A), aid(A)), answer(A)));
});

/** Verifies that non-admins cannot write meta/aiHosts or meta/admins, and that an admin can write meta/aiHosts. */
test("only admins can change the AI host list or the admin list", async () => {
  await seed("meta/admins", { uids: [HOST] });
  await assertFails(setDoc(doc(as(A), "meta/aiHosts"), { uids: [A] }));
  await assertFails(setDoc(doc(as(A), "meta/admins"), { uids: [A] }));
  await assertSucceeds(setDoc(doc(as(HOST), "meta/aiHosts"), { uids: [B] }));
});
