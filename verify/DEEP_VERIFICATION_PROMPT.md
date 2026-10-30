# Deep verification prompt: AlgoArena route B (round 2)

Attach the latest algoarena-b-stage-B2.zip. Run this where you can install packages and start the Firebase Emulator
Suite (for example Claude Code on my machine). Reply to me in Chinese; keep code and documents in English.

## Goal
Go deeper, not bigger. No new features. Turn the claims in verify/EVIDENCE.md into evidence from oracles that are
independent of the author and of me. One claim closed with external evidence beats five closed with your own tests.

## State after round 1
- Thresholds are fixed (do not change them without asking me): I4 95% limits of agreement within +/-250 ms; load at
  120 and 240 clients with join 100%, acceptance >= 99%, write p95 <= 500 ms; mutation >= 70%; AI ratings mean >= 4/5
  with weighted kappa >= 0.6 and no ability claims; usability task success >= 80% and SUS >= 68.
- Only external evidence so far: tsc 0 errors (after fixing 2). Everything else in verify/EVIDENCE.md is NOT RUN.
- Known gap: I6 (reference clicks recorded once and attributed correctly) has no oracle. Design one against the
  emulator before claiming anything about engagement.

## This round, in order
1. Baseline from a fresh unzip; record tool versions (Node, Java, firebase-tools, emulator, Stryker, fast-check).
   Run test/e2e 20 times with full output; one run in six failed one check in round 1 and it was not captured.
2. Rules on the emulator with coverage. When an emulator result disagrees with the reference model or an example
   test, the emulator wins: decide whether the rule or the test is wrong, fix it, and record both.
3. Mutation testing on functions/; for each surviving mutant, add a test or explain why it is equivalent.
4. Push and confirm CI is green from a clean checkout; link the run.
5. Build the I6 oracle and run it on the emulator.
6. If I give you a staging project: calibration from the classroom network, then load at 120 and 240. Otherwise stop
   before step 6 and say what you need from me.

## Raw material and methods
Unchanged from round 1 (see verify/ and the round 1 prompt in IMPROVEMENT_LOG.md): the code and the real rules engine,
not README or the mock; official documentation fetched now with versions; raw per-event exports; full AI prompts and
replies for a consented sample.

## Rules of evidence
Label every result by where it ran (emulator, CI, staging, classroom, rater). Mock and sandbox results do not count.
Report negative and null results. Never ask for, print or store secrets.

## Unchanged decisions
Frozen Artifact 2.1.1; Google sign-in; scores not graded; server-authoritative answer timing; AI only through the
coach function with the key in Secret Manager; per-session AI quota 2 x participants + 1 plus a daily guard, players
3 a day; no token-consuming automatic retries; reports capped at 400 words with schema-forced output; Firebase
project under my account; Blaze undecided (staging on Spark with `coach: false` until decided).

## Output
1. verify/EVIDENCE.md updated: claim, oracle, threshold, result, where it ran, status.
2. Evidence files: coverage report, mutation report, CI link, and any staging results.
3. Updated ZIP, an IMPROVEMENT_LOG.md entry, and this prompt rewritten for round 3.
4. A short Chinese summary: what is now proven, what failed, what is still not run.
