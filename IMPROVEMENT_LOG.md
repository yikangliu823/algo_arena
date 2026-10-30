# Improvement log

Each entry: what was reviewed, what was found (severity, evidence), what changed, and how it was verified.
"Dev env" means the developer sandbox (mock runtime, no network); it is not evidence from Firebase or real devices.

## History before B2
- 2.1.1: native confirm()/prompt() blocked in the sandboxed artifact frame made Delete, Add link, Add note and End game do nothing. Replaced with in-page dialogs; End game had also skipped its confirmation because the click event was read as "finished naturally". Verified: 19/19 dialog checks, dev env.
- B1: the rules require the sealed answer `ct` to be a string, but the page wrote an object; every real answer would have been refused in production. Found by the JavaScript mirror of the rules in the browser test. Fixed by storing `JSON.stringify(sealed)`. Verified: 27/27, dev env.

## B2, cycle 1: build
- Added `functions/coach-core.js` (pure logic), `functions/deps.js` (Firestore), `functions/index.js` (callable `coach`), the `sample` capability in `site/platform-firebase.js`, and the mock callable plus a fake Anthropic API in the harness.
- Verified: unit 15/15, browser 35/35 (dev env). Covered: request shape, tier-to-model mapping, caps, error mapping with quota refunds, retry after HTTP 529, reports delivered to players, log without student text.

## B2, cycle 2: review and fixes
| id | area | severity | finding | change | verified by |
|---|---|---|---|---|---|
| R1 | trust boundary, cost | High | A user could write their own `pub/{uid}` record and become "a player who joined", unlocking AI calls on the course's key | Eligibility now requires the host's own session record (not writable by players) to list the user, and the session to be under 3 days old | 2 new unit tests (forged record, missing session); browser check "forged player record does not unlock AI calls" |
| R2 | security rules | Medium | No test proved that quota counters and the AI log are closed to clients | Added a rules test (reads and writes refused for owner and host) | rules test written; emulator NOT RUN |
| R3 | privacy | Medium | No check that AI prompts are free of display names | Browser check that no prompt contains a display name (prompts send totals, topics and per-question data only) | browser check |
- Verified: unit 17/17, browser 37/37 (dev env).

## B2, cycle 3: re-review (stop)
No High findings left that can be fixed and verified here. Remaining Medium and Low items need the user's environment or a product decision; they are listed in RECURSIVE_IMPROVEMENT_PROMPT.md section 7.

## B2, cycle 4: per-session AI quota (user decision C)
- Decision: hosts get 2 x participants + 1 AI calls per session plus a daily guard; players keep 3 a day. A flat daily cap of 15 would have covered only 7 to 14 players per game.
- Change: every AI call from the page names its session (`sid`); the function reads the host's own session record (must exist and be ended), counts the daily and the per-session counters in one transaction, and refunds both on upstream failure. Players may only name the session they played in.
- Verified: unit 27/27 (10 new: formula, per-session cap, separate sessions, missing or malformed sid, another host's session, session not ended, refund of both counters, daily guard, player sid check); browser 39/39 (session counter and cap 5 for 2 players, host stopped at the cap, call without a session refused). Developer sandbox.
- Open: JSON parse retries count against the session allowance (documented in README as a known limit).

## B2, cycle 5: no token-consuming automatic retries (user request)
- Change: the page retries only `rate_limited` (HTTP 429 and now 529, both unprocessed requests). Unparseable or empty replies are no longer retried; reports over 300 words are shortened locally instead of a second AI call.
- Verified: unit 27/27; browser 41/41 (unparseable reply: 1 call then failure; long report: 1 call, 300 words or fewer). Developer sandbox.

## B2, cycle 6: report length and structure (user decision: all three, cap 400 words)
- Finding: the page already trims reports locally (composePersonal), so the cycle-5 trimming duplicated it; and the prompt's limits allowed 309 words of model text before the fixed sections, so generated items were routinely discarded (wasted output tokens).
- Change: removed the duplicate; cap raised to 400 words; prompt limits set to 50-word summary and up to 3 items of 18 words per list so the maximum fits; report calls send `kind` and the function forces a server-defined tool schema (learning_report, class_summary).
- Verified: unit 32/32 (5 new: tool forcing and schema for both kinds, unknown kind, missing tool call, plain text without kind); browser 43/43 (both tools used, 400-word budget in prompts, long report trimmed to 400 or fewer with one call). Rebuild tool reproduces site/index.html byte for byte. Developer sandbox.

## Deep verification, round 1 (2026-10-29)
- Thresholds fixed before running: I4 95% limits of agreement within +/-250 ms (user); load at 120 and 240 clients (user: class of 61-120); mutation >= 70%, ratings mean >= 4/5 with weighted kappa >= 0.6, SUS >= 68 (proposed defaults).
- External oracle run here: tsc found 2 type errors in site/platform-firebase.js (undeclared window properties); fixed; 0 errors.
- Built the verification kit: property-based rules test against a reference model, coverage runner, Stryker config, CI workflow, staging driver (calibration and load), Bland-Altman analysis, AI export, grounding check, ledger reconciliation, blinded rating sheet and kappa. Analysis scripts checked on synthetic and planted data only.
- Threat model (STRIDE) mapped to tests; it exposed one untested control (admin and AI-host lists), now covered by a rules test.
- Still NOT RUN: everything that needs the emulator, CI, staging, the instructor or students. I6 (reference clicks) has no oracle yet.
- Browser mock suite was intermittent in the fresh-unzip check: 42/43 once, 43/43 in five reruns; the failing check was not captured. Next round: run it 20 times with full output and fix or widen the timing-bound check that flakes.
