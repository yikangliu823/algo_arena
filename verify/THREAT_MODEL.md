# STRIDE threat model, AlgoArena route B

Data flows: Google sign-in; room document (host writes, players read); answers (players create); pub records
(players write, their host reads); report deliveries (host writes, recipient reads); `coach` function (signed-in
callers; Anthropic API with a server-held key). The host is trusted; players and anyone with a Google account are not.

| # | STRIDE | Threat | Control | Test | Status |
|---|---|---|---|---|---|
| S1 | Spoofing | Answer as another student | rules: `d.uid == auth.uid` and id prefix | rules.test "another user"; properties.test (writerIsAuthor, idMatches) | emulator PASS (round 2) |
| S2 | Spoofing | Act as host (write the room) | rules: room write only by `hostId` | rules.test "only the host writes its room" | emulator PASS (round 2) |
| T1 | Tampering | Choose one's own answer time | rules: `srv == request.time` | rules.test "client-chosen timestamp"; properties.test (serverTime) | emulator PASS (round 2) |
| T2 | Tampering | Answer during reading or after the deadline | rules: answer window from server times | rules.test reading/deadline; properties.test (window) | emulator PASS (round 2) |
| T3 | Tampering | Change an answer | rules: create-only | rules.test "second write"; properties.test (exists) | emulator PASS (round 2) |
| T4 | Tampering | Reset one's AI quota | aiQuota closed to clients (default deny) | rules.test "AI quota counters... closed" | emulator PASS (round 2) |
| T5 | Tampering | Forge eligibility for AI calls | eligibility from the host's session record | functions unit "forged player record" | sandbox PASS |
| R1 | Repudiation | Dispute a recorded time or score | server timestamps; per-question logs; host events | export semantics | residual: host can edit own logs (host trusted) |
| I1 | Info disclosure | Read other players' answers | rules: author or host only | rules.test "readable by the host and their author" | emulator PASS (round 2) |
| I2 | Info disclosure | Read another player's pub record or report | rules: owner or named host; report id ends with recipient uid | rules.test pub, report deliveries | emulator PASS (round 2) |
| I3 | Info disclosure | Names or emails sent to the AI provider | prompts built from totals and per-question data | browser mock check; grounding.mjs on real reports | mock only; real NOT RUN |
| I4 | Info disclosure | Prompt or reply text in logs | aiLog stores sizes and hashes only | functions unit "call log" | sandbox PASS |
| D1 | Denial of service | Flood answers | create-only, one per question | as T3 | emulator PASS (round 2) |
| D2 | Denial of service | Flood one's own pub record | none beyond Firestore limits | none | residual risk |
| D3 | Denial of service / cost | Drain the AI budget | host allowlist, per-session and daily caps, maxInstances 5, max_tokens | functions unit tests; reconcile.mjs | unit sandbox PASS; ledgers NOT RUN |
| E1 | Elevation | Become admin or AI host | meta/* write only by admins | rules.test "only admins can change the AI host list or the admin list" | emulator PASS (round 2) |
