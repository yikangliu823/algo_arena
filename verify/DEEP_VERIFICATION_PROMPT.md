# Deep verification prompt: AlgoArena route B (round 3)

Work in the project folder (branch `verify/firebase-round3`, cut from `verify/firebase-round2`). Run this where you can
install packages and start the Firebase Emulator Suite (for example Claude Code on my machine). Reply to me in Chinese;
keep code and documents in English.

## Goal
Go deeper, not bigger. No new features. Move the remaining claims in verify/EVIDENCE.md from NOT RUN to evidence from
oracles that are independent of the author and of me, starting with the ones that need no classroom.

## State after round 2
- Thresholds are fixed (do not change them without asking me): I4 95% limits of agreement within +/-250 ms; load at
  120 and 240 clients with join 100%, acceptance >= 99%, write p95 <= 500 ms; mutation >= 70%; rules coverage: every
  boolean condition seen true and false; AI ratings mean >= 4/5 with weighted kappa >= 0.6 and no ability claims;
  usability task success >= 80% and SUS >= 68.
- Evidence so far: tsc 0 errors; rules 22/22 and 500 generated cases with 0 disagreements on the emulator; rules
  coverage 74/74; mutation 97.29% locally (12 survivors argued equivalent); CI on `verify/firebase-round2`: see
  verify/EVIDENCE.md for the run link and result. firestore.rules deployed to algoarena-for-research only if
  EVIDENCE.md says so.
- Known gaps: I6 (reference clicks recorded once and attributed correctly) has no oracle. The 12 equivalent mutants
  rest on my reading of the code. The functions wiring (index.js, deps.js) has never run against real
  firebase-functions and firebase-admin.
- Decisions from round 2: Blaze approved (I enable it and set the Anthropic key myself); staging uses the current
  project algoarena-for-research (Firestore nam5); two project members will be added later.

## This round, in order
1. Baseline: check out the branch, record tool versions, run every suite once, confirm CI is green on the new branch.
2. Build the I6 oracle and run it on the emulator: scripted reference clicks, each recorded exactly once and
   attributed to the right uid, sid and question; report duplicates and losses.
3. Functions wiring on the Functions and Firestore emulators: call `coach` through the real firebase-functions and
   firebase-admin with a fake Anthropic endpoint; check quota consume and refund, session caps and the aiLog fields.
   Then try to kill the 12 "equivalent" mutants with emulator-backed tests; any one killed was not equivalent.
4. Once I confirm Blaze and the secret are set: deploy the function, set `coach: true`, run one scripted session,
   export, `grounding.mjs`, `reconcile.mjs`. Ask me before every deploy.
5. Staging in algoarena-for-research: tag every load-test document so it can be found and deleted, and plan the
   cleanup before the run. Calibration from the classroom network, then load at 120 and 240. If I am not in the
   classroom, stop before this step and say what you need from me.

## Rules of evidence
Label every result by where it ran (emulator, CI, staging, classroom, rater). Mock and sandbox results do not count.
Report negative and null results. Never ask for, print or store secrets: I set the Anthropic key with
`firebase functions:secrets:set ANTHROPIC_API_KEY` myself; never paste it into chat, code or logs.

## Unchanged decisions
Frozen Artifact 2.1.1; Google sign-in; scores not graded; server-authoritative answer timing; AI only through the
coach function with the key in Secret Manager; per-session AI quota 2 x participants + 1 plus a daily guard, players
3 a day; no token-consuming automatic retries; reports capped at 400 words with schema-forced output; Firebase
project under my account; `coach: false` until the function is deployed and tested.

## Output
1. verify/EVIDENCE.md updated: claim, oracle, threshold, result, where it ran, status.
2. Evidence files under verify/evidence/round3/: I6 oracle results, emulator wiring results, CI link, staging results
   if any.
3. Updated ZIP, an IMPROVEMENT_LOG.md entry, and this prompt rewritten for round 4.
4. A short Chinese summary: what is now proven, what failed, what is still not run.
