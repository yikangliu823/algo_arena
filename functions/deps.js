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
 * @param {!Object} db Admin SDK Firestore, or a test stand-in with doc, collection and runTransaction.
 * @param {{fetch: function(string, !Object): !Promise<!Object>, apiKey: function(): string, now: function(): number}}
 *     io `now` returns epoch milliseconds.
 * @return {!Object} The deps that runCoach expects.
 */
export function firestoreDeps(db, { fetch, apiKey, now }) {
  const uidsIn = async (path, uid) => { const s = await db.doc(path).get(); return s.exists && (s.get("uids") || []).includes(uid); };
  return {
    now, fetch, apiKey,
    isHost: async (uid) => (await uidsIn("meta/aiHosts", uid)) || (await uidsIn("meta/admins", uid)),
    // pub/{uid} is self-written and only names the session; membership comes from the host's own record, which
    // players cannot write.
    hasJoined: async (uid) => {
      const p = await db.doc(`pub/${uid}`).get(); if (!p.exists) return false;
      const sid = p.get("sid"), host = p.get("host"); if (!sid || !host) return false;
      const sess = await db.doc(`data/users/${host}/profile/sessions/${sid}`).get();
      if (!sess.exists || now() - (sess.get("createdAt") || 0) > 3 * 864e5) return false;
      return (sess.get("participants") || []).some((x) => x && x.uid === uid) ? { sid } : false;
    },
    // participants is written when the session ends (endAt), so its length is final here.
    hostSession: async (uid, sid) => {
      const s = await db.doc(`data/users/${uid}/profile/sessions/${sid}`).get(); if (!s.exists) return null;
      return { ended: !!s.get("endAt"), participants: (s.get("participants") || []).length };
    },
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
    refundQuota: ({ uid, day, sid }) => db.runTransaction(async (tx) => {
      const refs = [db.doc(`aiQuota/${uid}_${day}`), ...(sid ? [db.doc(`aiQuota/${uid}_s_${sid}`)] : [])];
      const snaps = []; for (const r of refs) snaps.push(await tx.get(r));
      refs.forEach((r, k) => tx.set(r, { count: Math.max(0, (snaps[k].exists ? snaps[k].get("count") || 0 : 0) - 1), updatedAt: now() }, { merge: true }));
    }),
    log: (entry) => db.collection("aiLog").add(entry),
  };
}
