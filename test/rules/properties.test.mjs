/**
 * @fileoverview Property-based test of invariant I1 (who may write an answer, and when) against the
 * real rules engine (Firestore emulator), using fast-check.
 * The expected outcome comes from a reference model written from the invariant's text, not from firestore.rules,
 * so the emulator (not the rules author) decides whether the rules match the specification.
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
import { test, before, after } from "node:test";
import { readFileSync } from "node:fs";
import fc from "fast-check";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, setDoc, serverTimestamp, Timestamp } from "firebase/firestore";

let env;
/** Starts the rules test environment for project demo-algoarena with ../../firestore.rules. */
before(async () => { env = await initializeTestEnvironment({ projectId: "demo-algoarena", firestore: { rules: readFileSync(new URL("../../firestore.rules", import.meta.url), "utf8") } }); });
/** Tears down the rules test environment. */
after(async () => { await env.cleanup(); });

// I1: accepted iff the room takes answers for this question, the writer is the author named in the document and its id,
// the timestamp is the server's, the fields are the allowed ones, and the server time is inside [open, open + T + 250 ms].
// Timings are generated at least 2 s away from either window edge so clock skew cannot make the case ambiguous.
/**
 * Returns whether the reference model of I1 accepts the write described by a generated case.
 * @param {!Object} c A case drawn from caseArb.
 * @return {boolean} True when the emulator is expected to accept the write.
 */
function expected(c) {
  return c.status === "question" && c.writerIsAuthor && c.idMatches && c.sid === "S" && c.q === c.roomQ
    && c.serverTime && !c.extraKey && c.window === "inside" && !c.exists;
}
// Faults are drawn with probability 1/6 each so that about a quarter of the cases are fully valid and reach the
// window check; with uniform booleans (round 1) only ~1 case in 4600 reached it, so the "accepted" side of the model
// was almost never compared with the emulator.
const good = fc.integer({ min: 0, max: 5 }).map((n) => n !== 0), fault = fc.integer({ min: 0, max: 5 }).map((n) => n === 0);
const caseArb = fc.record({
  status: fc.constantFrom("question", "question", "question", "question", "closed", "reveal"), writerIsAuthor: good, idMatches: good,
  sid: fc.constantFrom("S", "S", "S", "S", "S", "S2"), q: fc.constantFrom(0, 1), roomQ: fc.constantFrom(0, 1), serverTime: good, extraKey: fault,
  window: fc.constantFrom("before", "inside", "after"), openEarly: fc.boolean(), readS: fc.integer({ min: 0, max: 10 }), T: fc.integer({ min: 5, max: 30 }), exists: fault,
});
let run = 0; const outcomes = { allowed: 0, refused: 0 }; const paths = new Set();
/**
 * Verifies I1 on 500 generated cases: the emulator's decision must equal the reference model's, and all six window
 * paths (timed or early open; before, inside or after the window) must be reached with every other condition valid.
 */
test("I1 holds for generated cases (reference model vs emulator)", async () => {
  await fc.assert(fc.asyncProperty(caseArb, async (c) => {
    const host = `host${++run}`, me = `me${run}`, other = `other${run}`;
    // open time relative to now, chosen per window state
    const openAgo = c.window === "before" ? -3000 : c.window === "inside" ? 2000 : c.T * 1000 + 2500;
    const room = { sid: "S", hostId: host, status: c.status, qIndex: c.roomQ, readS: c.readS, q: { T: c.T } };
    if (c.openEarly) { room.openNowSrv = Timestamp.fromMillis(Date.now() - openAgo); room.shownSrv = Timestamp.fromMillis(Date.now() - openAgo - 500); }
    else { room.openNowSrv = null; room.shownSrv = Timestamp.fromMillis(Date.now() - openAgo - c.readS * 1000); }
    const author = c.writerIsAuthor ? me : other;
    const id = c.idMatches ? `${me}_${c.sid}_${c.q}` : `${me}_${c.sid}_${c.q + 7}`;
    // Call x.firestore() once: each call re-runs useEmulator(), which throws once the instance has started.
    await env.withSecurityRulesDisabled(async (x) => {
      const admin = x.firestore();
      await setDoc(doc(admin, `rooms/${host}`), room);
      if (c.exists) await setDoc(doc(admin, `rooms/${host}/answers/${id}`), { uid: me, sid: c.sid, q: c.q, ct: "x", srv: Timestamp.now() });
    });
    const data = { uid: author, sid: c.sid, q: c.q, ct: "sealed", srv: c.serverTime ? serverTimestamp() : Timestamp.fromMillis(Date.now()), mono: 100, dev: "d" };
    if (c.extraKey) data.score = 1000;
    let ok = true; try { await setDoc(doc(env.authenticatedContext(me).firestore(), `rooms/${host}/answers/${id}`), data); } catch { ok = false; }
    outcomes[ok ? "allowed" : "refused"]++; if (expected(c) || (c.status === "question" && c.writerIsAuthor && c.idMatches && c.sid === "S" && c.q === c.roomQ && c.serverTime && !c.extraKey && !c.exists)) paths.add(`${c.openEarly ? "early" : "timed"}:${c.window}`);
    if (ok !== expected(c)) throw new Error(`mismatch: emulator ${ok ? "allowed" : "refused"}, model ${expected(c) ? "allows" : "refuses"}: ${JSON.stringify(c)}`);
  }), { numRuns: 500 });
  console.log(`I1 cases: ${JSON.stringify(outcomes)}; window paths reached with all other conditions valid: ${[...paths].sort().join(", ")}`);
  if (paths.size !== 6) throw new Error(`only ${paths.size} of 6 window paths reached`);
});
