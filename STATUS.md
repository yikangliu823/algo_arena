# AlgoArena route B: status

Updated 2026-10-29. One line per milestone, in order. A milestone is done only with the evidence named.

| # | Milestone | What you can do once it is done | Status | Evidence or blocker | Owner |
|---|---|---|---|---|---|
| M1 | Code complete (B0 to B2) | nothing yet; the code exists | DONE | IMPROVEMENT_LOG.md, B2 cycles 1 to 6 | Claude |
| M2 | Verified without live services | trust the rules, timing and AI quota logic | DONE | verify/EVIDENCE.md; CI green on Node 22, run 41008562398 | Claude |
| M3 | Security rules live | the database refuses forged, early, late and repeated answers | DONE | deployed to algoarena-for-research on 2026-10-29 | Claude |
| M4 | Site online at a public URL | open the app in a browser | DONE | https://yikangliu823.github.io/algo_arena/ serves 3.0.0-b2 and shows the sign-in screen with no console errors (Pages deploy run 41010189111); algo_arena made public on 2026-10-29 at your request | Claude |
| M5 | First sign-in, question bank imported, you are admin | create and host games | BLOCKED | authorized domain and Google provider already set. Sign-in failed: the popup was blocked, and the redirect fallback cannot complete on github.io because Chrome 115+, Firefox 109+ and Safari 16.1+ block third-party storage (Firebase docs, redirect best practices). No user was created. Needs a hosting/sign-in decision | you decide, Claude fixes |
| M6 | Two-device test, including iPhone Safari sign-in | **use it in class, without AI reports** | NOT DONE | needs M5; about 30 minutes, two Google accounts | you |
| M7 | AI learning reports live | AI reports for hosts and players | NOT DONE | needs Blaze, budget alert, Anthropic spend limit, secret set (you); then deploy and test (Claude) | you, then Claude |
| M8 | Classroom calibration and load at 120 and 240 | confidence that a full class of 120 works | NOT DONE | needs you on the classroom network | you + Claude |
| M9 | Research-ready: IRB approval, usability test with 5 students, pilot | data counts for the study | NOT DONE | university and instructor | you |

Where we are: M4 done, M5 blocked by the sign-in defect above. After the fix, M6 (usable in class without AI) is
about 1 hour away.
