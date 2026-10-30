/**
 * @fileoverview Firestore-backed dependencies for runCoach (functions/coach-core.js). Quota counters
 * (aiQuota) and the call log (aiLog) live in top-level collections that the security rules do not open to any
 * client, so users cannot reset or read them.
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
/**
 * Builds the deps object that runCoach expects, backed by the Admin SDK Firestore.
 *
 * @param {!Object} db Admin SDK Firestore instance (or a test stand-in with doc, collection and runTransaction).
 * @param {{fetch: function(string, !Object): !Promise<!Object>, apiKey: function(): string, now: function(): number}}
 *     io Network fetch, a getter for the Anthropic API key, and the clock in epoch milliseconds.
 * @return {!Object} The deps object documented on runCoach.
 */
export function firestoreDeps(db, { fetch, apiKey, now }) {
  /**
   * Checks whether a document's `uids` array contains a user.
   *
   * @param {string} path Document path, for example "meta/admins".
   * @param {string} uid User id to look for.
   * @return {!Promise<boolean>} True when the document exists and lists the uid.
   */
  const uidsIn = async (path, uid) => { const s = await db.doc(path).get(); return s.exists && (s.get("uids") || []).includes(uid); };
  return {
    now, fetch, apiKey,
    /**
     * @param {string} uid Caller's uid.
     * @return {!Promise<boolean>} True when the caller is listed in meta/aiHosts or meta/admins.
     */
    isHost: async (uid) => (await uidsIn("meta/aiHosts", uid)) || (await uidsIn("meta/admins", uid)),
    /**
     * Decides whether a non-host caller is a recent player.
     *
     * A player qualifies only if the host's own session record (which players cannot write) lists them and the
     * session is at most 3 days old. The player's pub record only says which session to look at.
     *
     * @param {string} uid Caller's uid.
     * @return {!Promise<({sid: string}|boolean)>} The session played in, or false.
     */
    hasJoined: async (uid) => {
      const p = await db.doc(`pub/${uid}`).get(); if (!p.exists) return false;
      const sid = p.get("sid"), host = p.get("host"); if (!sid || !host) return false;
      const sess = await db.doc(`data/users/${host}/profile/sessions/${sid}`).get();
      if (!sess.exists || now() - (sess.get("createdAt") || 0) > 3 * 864e5) return false;
      return (sess.get("participants") || []).some((x) => x && x.uid === uid) ? { sid } : false;
    },
    /**
     * Reads the host's own session record: ended once it has endAt; participants is written when the session ends.
     *
     * @param {string} uid Host's uid.
     * @param {string} sid Session id named in the request.
     * @return {!Promise<?{ended: boolean, participants: number}>} The session state, or null if the host has no
     *     such session.
     */
    hostSession: async (uid, sid) => {
      const s = await db.doc(`data/users/${uid}/profile/sessions/${sid}`).get(); if (!s.exists) return null;
      return { ended: !!s.get("endAt"), participants: (s.get("participants") || []).length };
    },
    /**
     * Takes one unit from the daily counter and, for hosts, the per-session counter, in one transaction.
     *
     * @param {{uid: string, day: string, dailyCap: number, sid: ?string, sessionCap: ?number}} quota Counters to
     *     charge; sid is null for players.
     * @return {!Promise<{ok: boolean, limit: (string|undefined)}>} ok, or the limit that was reached ("session" or
     *     "daily"). Nothing is written when a limit is reached.
     */
    consumeQuota: ({ uid, day, dailyCap, sid, sessionCap }) => db.runTransaction(async (tx) => {
      const dRef = db.doc(`aiQuota/${uid}_${day}`); const sRef = sid ? db.doc(`aiQuota/${uid}_s_${sid}`) : null;
      const dSnap = await tx.get(dRef); const sSnap = sRef ? await tx.get(sRef) : null;
      const dUsed = dSnap.exists ? dSnap.get("count") || 0 : 0; const sUsed = sSnap && sSnap.exists ? sSnap.get("count") || 0 : 0;
      if (sRef && sUsed >= sessionCap) return { ok: false, limit: "session" };
      if (dUsed >= dailyCap) return { ok: false, limit: "daily" };
      tx.set(dRef, { uid, day, count: dUsed + 1, updatedAt: now() }, { merge: true });
      if (sRef) tx.set(sRef, { uid, sid, count: sUsed + 1, cap: sessionCap, updatedAt: now() }, { merge: true });
      return { ok: true };
    }),
    /**
     * Gives back one unit to the daily counter and, when sid is set, the session counter, never going below zero.
     * Merges so the counters' other fields (uid, day, sid, cap) are kept.
     *
     * @param {{uid: string, day: string, sid: ?string}} quota The counters charged by consumeQuota.
     * @return {!Promise<void>}
     */
    refundQuota: ({ uid, day, sid }) => db.runTransaction(async (tx) => {
      const refs = [db.doc(`aiQuota/${uid}_${day}`), ...(sid ? [db.doc(`aiQuota/${uid}_s_${sid}`)] : [])];
      const snaps = []; for (const r of refs) snaps.push(await tx.get(r));
      refs.forEach((r, k) => tx.set(r, { count: Math.max(0, (snaps[k].exists ? snaps[k].get("count") || 0 : 0) - 1), updatedAt: now() }, { merge: true }));
    }),
    /**
     * @param {!Object} entry Call-log record (sizes, hash, model, role; no prompt or reply text).
     * @return {!Promise<!Object>} The new aiLog document reference.
     */
    log: (entry) => db.collection("aiLog").add(entry),
  };
}
