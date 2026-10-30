# Evidence table, AlgoArena route B (2026-10-29)

"Sandbox" is the developer sandbox (no network, no Firebase tools). Only rows whose oracle is independent of the
author count as evidence. Author-written mock tests are regression checks, not evidence.

| Claim | Oracle | Threshold (fixed before running) | Result | Where it ran | Status |
|---|---|---|---|---|---|
| Platform and function code type-check | tsc 6.0.3 (`verify/tsconfig.json`) | 0 errors | 2 errors found (undeclared `window` properties), fixed; now 0 | sandbox, independent tool | PASS |
| I1 to I3 security rules | Firestore emulator: rules.test.mjs (17 cases), properties.test.mjs (200 generated cases vs a reference model), rules coverage report | all pass; every allow condition seen true and false | not run | your machine or CI | NOT RUN |
| Test strength | StrykerJS on functions/ | mutation score >= 70% | not run | CI | NOT RUN |
| Clean-checkout build | GitHub Actions `verify.yml` | all jobs green | not run | CI | NOT RUN |
| I4 timing validity | `driver.mjs calibrate` on staging over classroom Wi-Fi, then `bland_altman.py` | 95% limits of agreement within +/-250 ms, no refused taps | not run (analysis script checked on synthetic data only) | staging | NOT RUN |
| Load at 1x and 2x a 120-student class | `driver.mjs load --clients 120` and `--clients 240` | join 100%, answer acceptance >= 99%, write p95 <= 500 ms | not run | staging | NOT RUN |
| I5 AI spend within limits | `reconcile.mjs`: aiQuota vs aiLog vs Anthropic Console | exact agreement; session counters within caps | not run (needs Blaze) | staging | NOT RUN |
| I6 reference clicks recorded once and attributed correctly | no oracle built yet | 100% of scripted clicks, no duplicates | gap | none | NOT BUILT |
| I7 AI reports grounded | `grounding.mjs` on exported reports; blinded ratings scored by `kappa.py` | 0 violations; each item mean >= 4/5, weighted kappa >= 0.6, no ability claims | not run (scripts checked on planted synthetic data) | staging plus instructor | NOT RUN |
| C5 usability | think-aloud with 5 students, SUS | task success >= 80%, SUS >= 68 | not run | classroom | NOT RUN |
| C6 compliance | IRB decision, university IT review | approved | not run | university | NOT RUN |
| Regression only | functions unit 32/32, browser on mock 43/43 | n/a | unit 32/32; browser 43/43 in 5 of 6 runs, one run 42/43 with the failing check not captured (likely a timing-bound check) | sandbox, author-written | does not count; flaky check to identify |

Run order on your machine: (1) rules on the emulator with coverage; (2) push to GitHub so CI runs mutation and types;
(3) staging project on Spark with `coach: false`: calibration from the classroom, then load 120 and 240;
(4) if Blaze is approved: enable AI, one scripted session, export, grounding, reconcile, ratings; (5) students.
