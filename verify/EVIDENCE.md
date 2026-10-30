# Evidence table, AlgoArena route B (round 1: 2026-10-29; updated in round 2: 2026-10-29)

Where it ran: "emulator" is the Firestore emulator on the developer's machine; "local" is the developer's machine
with an independent tool; "CI" is GitHub Actions on a clean checkout; "sandbox" is the round-1 developer sandbox (no
network, no Firebase tools). Only rows whose oracle is independent of the author count as evidence. Author-written
mock tests are regression checks, not evidence. Raw logs and reports: `verify/evidence/round2/`.

| Claim | Oracle | Threshold (fixed before running) | Result | Where it ran | Status |
|---|---|---|---|---|---|
| Platform and function code type-check | tsc 6.0.3 (`verify/tsconfig.json`) | 0 errors | Round 1: 2 errors fixed, then 0. Round 2: a JSDoc type added with the comments failed (optional fields written as `(T\|undefined)`); fixed; 0 with tsc 6.0.3 and 5.9.3 | sandbox, local; CI: PASS ([run 2](https://github.com/yikangliu823/algo_arena/actions/runs/41004361852)) | PASS (local, CI) |
| I1 to I3 security rules | Firestore emulator v1.22.0: rules.test.mjs (22 cases), properties.test.mjs (500 generated cases vs a reference model, all 6 answer-window paths required) | all pass | 22/22; 500 cases, 0 disagreements (18 allowed, 482 refused), all 6 window paths reached. Same in 3 earlier runs of 500 | emulator; CI: PASS ([run 2](https://github.com/yikangliu823/algo_arena/actions/runs/41004361852)) | PASS (emulator, CI) |
| Rules coverage | emulator ruleCoverage reports merged by `verify/rules/coverage_check.py` | every boolean condition seen true and false; no non-literal allow line unevaluated | 74/74 expressions seen both ways; 0 gaps (17 gaps before the round-2 tests) | emulator; CI: PASS ([run 2](https://github.com/yikangliu823/algo_arena/actions/runs/41004361852)) | PASS (emulator, CI) |
| Test strength | StrykerJS 8.7.1 on functions/ | mutation score >= 70% | 97.29% (430 killed, 12 survived); round-1 tests alone: 77.15%. The 12 survivors are argued equivalent in `MUTATION_SURVIVORS.md` (judgment, checkable) | local; CI: PASS ([run 2](https://github.com/yikangliu823/algo_arena/actions/runs/41004361852)) | PASS (local, CI) |
| Clean-checkout build | GitHub Actions `verify.yml` | all jobs green | Run 2 at 75928f4: all 3 jobs green (unit 53/53, tsc 6.0.3 0 errors, mutation 97.29%, rules 22/22 + 500 cases, coverage 74/74, browser 43/43): [run 41004361852](https://github.com/yikangliu823/algo_arena/actions/runs/41004361852). Run 1 at 216c7d6 failed: browser-mock could not install Chromium (Playwright 1.57.0 does not support ubuntu-latest, now 26.04), no test ran; the other two jobs passed: [run 41004048849](https://github.com/yikangliu823/algo_arena/actions/runs/41004048849). Fixed by running that job on ubuntu-24.04 | CI | PASS |
| Rules deployed are the tested rules | `firebase deploy --only firestore:rules` of the file tested above | deploy succeeds from the tested commit | Deployed 2026-10-29 from the CI-tested file (sha256 688e0b5e..., last changed in 216c7d6); compiled and released | algoarena-for-research | DONE |
| I4 timing validity | `driver.mjs calibrate` on staging over classroom Wi-Fi, then `bland_altman.py` | 95% limits of agreement within +/-250 ms, no refused taps | not run (analysis script checked on synthetic data only) | staging | NOT RUN |
| Load at 1x and 2x a 120-student class | `driver.mjs load --clients 120` and `--clients 240` | join 100%, answer acceptance >= 99%, write p95 <= 500 ms | not run | staging | NOT RUN |
| I5 AI spend within limits | `reconcile.mjs`: aiQuota vs aiLog vs Anthropic Console | exact agreement; session counters within caps | not run (Blaze approved in round 2, not yet enabled) | staging | NOT RUN |
| I6 reference clicks recorded once and attributed correctly | no oracle built yet | 100% of scripted clicks, no duplicates | gap | none | NOT BUILT |
| I7 AI reports grounded | `grounding.mjs` on exported reports; blinded ratings scored by `kappa.py` | 0 violations; each item mean >= 4/5, weighted kappa >= 0.6, no ability claims | not run (scripts checked on planted synthetic data) | staging plus instructor | NOT RUN |
| C5 usability | think-aloud with 5 students, SUS | task success >= 80%, SUS >= 68 | not run | classroom | NOT RUN |
| C6 compliance | IRB decision, university IT review | approved | not run | university | NOT RUN |
| Regression only | functions unit 53/53, browser on mock 43/43 | n/a | unit 53/53. Browser: 18/20 at baseline; both failures were one check (Python half-to-even rounding against JavaScript half-up when elapsed ms % 30 == 15); fixed in the test; 20/20 after the fix and 20/20 after the comments | local, author-written | does not count |

Tool versions (round 2, local): Node 26.11.0 (CI: Node 20), Java 25.0.2 (CI: Temurin 21), Python 3.13.11 (CI: 3.12),
firebase-tools 15.33.0, cloud-firestore-emulator 1.22.0, @firebase/rules-unit-testing 3.0.4, firebase JS SDK 10.14.1,
fast-check 3.23.2, StrykerJS 8.7.1, Playwright 1.57.0, TypeScript 6.0.3. CI pins firebase-tools, Playwright and
TypeScript to these versions.

Firestore database: `projects/algoarena-for-research/databases/(default)`, Firestore native, location `nam5`
(United States multi-region). Staging runs in this same project (user decision, round 2), so load-test data must be
tagged and removable.

Next on the user's side: enable Blaze and set the Anthropic key as a secret (step 7 of the README setup; the key is
never pasted into chat); add the two project members; calibration and load from the classroom; then students.
