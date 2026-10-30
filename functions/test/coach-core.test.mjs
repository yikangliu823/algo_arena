/**
 * @fileoverview Unit tests (node:test) for functions/coach-core.js and the Firestore-backed deps in
 * functions/deps.js: access control for hosts and recent players, input validation, the daily and per-session AI quotas
 * and their refunds, the Anthropic request shape, upstream error mapping, structured report output and the call log.
 * An in-memory stand-in for the Admin SDK Firestore and fake fetch functions replace the network; no emulator is needed.
 * The round-2 tests target mutants that survived Stryker (verify/evidence/round2/MUTATION_SURVIVORS.md).
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
import { test } from "node:test";
import assert from "node:assert/strict";
import { runCoach, DEFAULTS, CoachError, dayKey, sessionCap, SCHEMAS } from "../coach-core.js";
import { firestoreDeps } from "../deps.js";

/* ---------- a tiny stand-in for the Admin SDK Firestore used by deps.js ---------- */
/**
 * Builds an in-memory stand-in for the Admin SDK Firestore subset that deps.js uses.
 *
 * Documents live in a Map keyed by full path; `set` with `{merge: true}` shallow-merges into the stored document.
 * `collection(c).add` appends to `added` instead of storing, and `runTransaction` runs the callback with a
 * transaction that delegates to the refs (no isolation).
 * @param {!Object<string, !Object>=} seed Initial documents keyed by path.
 * @return {!Object} The fake db: `docs`, `added`, `doc(path)`, `collection(c)` and `runTransaction(fn)`.
 */
function fakeAdminDb(seed = {}) {
  const docs = new Map(Object.entries(seed)); const added = [];
  /**
   * Returns a snapshot-like view of the document stored at `path`.
   * @param {string} path Document path.
   * @return {{exists: boolean, get: function(string): *, data: function(): (!Object|undefined)}} The snapshot.
   */
  const snap = (path) => { const d = docs.get(path); return { exists: d !== undefined, get: (f) => (d ? d[f] : undefined), data: () => d }; };
  /**
   * Returns a document reference whose async `get` and merge-aware `set` act on the Map.
   * @param {string} path Document path.
   * @return {{path: string, get: function(): !Promise<!Object>, set: function(!Object, ?Object=): !Promise<*>}} The ref.
   */
  const ref = (path) => ({ path, get: async () => snap(path), set: async (v, o) => docs.set(path, o && o.merge ? { ...(docs.get(path) || {}), ...v } : v) });
  return {
    docs, added,
    doc: ref,
    /** Returns a collection whose `add` records `{c, v}` in `added` and resolves to a fake id. */
    collection: (c) => ({ add: async (v) => { added.push({ c, v }); return { id: "x" + added.length }; } }),
    /** Runs `fn` with a transaction object whose get and set delegate to the refs. */
    runTransaction: async (fn) => fn({ get: (r) => r.get(), set: (r, v, o) => r.set(v, o) }),
  };
}
const NOW = Date.UTC(2026, 9, 29, 15, 0, 0);
/**
 * Returns a fake `fetch` that answers every request with a successful plain-text Messages API reply.
 *
 * The reply echoes the requested model, reports 120 input and 40 output tokens and stops with `end_turn`; `extra`
 * overrides fields of the reply body. Each call is recorded on `f.calls` with the parsed request body.
 * @param {string=} text Text of the single text content block.
 * @param {!Object=} extra Fields merged over the reply body.
 * @return {function(string, !Object): !Promise<!Object>} The fake fetch, with a `calls` array property.
 */
function okFetch(text = '{"performance_summary":"ok"}', extra = {}) {
  const calls = [];
  /**
   * Records the request and resolves to an HTTP 200 response.
   * @param {string} url Request URL.
   * @param {!Object} init Fetch init; `init.body` is JSON.
   * @return {!Promise<!Object>} A response-like object with `ok`, `status` and `json()`.
   */
  const f = async (url, init) => { calls.push({ url, init, body: JSON.parse(init.body) }); return { ok: true, status: 200, json: async () => ({ model: JSON.parse(init.body).model, content: [{ type: "text", text }], stop_reason: "end_turn", usage: { input_tokens: 120, output_tokens: 40 }, ...extra }) }; };
  f.calls = calls; return f;
}
/**
 * Returns a fake `fetch` that always fails with the given HTTP status and an error body.
 * @param {number} status HTTP status code to return.
 * @return {function(): !Promise<!Object>} The fake fetch.
 */
const statusFetch = (status) => async () => ({ ok: false, status, json: async () => ({ type: "error" }) });
/**
 * Creates a fake db wired into firestoreDeps with a fixed API key and clock.
 *
 * The default seed makes host1 an admin, gives stu1 a player record for S1, and stores host1's session S1 (created an
 * hour ago, ended ten minutes ago) with participants stu1 and stu2.
 * @param {{seed: (!Object|undefined), fetch: (!Function|undefined), now: (number|undefined)}=} options Extra
 *     documents merged over the defaults, the fake fetch (default okFetch()), and the clock in ms (default NOW).
 * @return {{db: !Object, deps: !Object, fetch: !Function}} The fake db, the deps and the fetch.
 */
function setup({ seed = {}, fetch = okFetch(), now = NOW } = {}) {
  const db = fakeAdminDb({ "meta/admins": { uids: ["host1"] }, "pub/stu1": { sid: "S1", host: "host1", joinedAt: now - 3600e3 },
    "data/users/host1/profile/sessions/S1": { createdAt: now - 3600e3, endAt: now - 600e3, participants: [{ uid: "stu1" }, { uid: "stu2" }] }, ...seed });
  const deps = firestoreDeps(db, { fetch, apiKey: () => "sk-test", now: () => now });
  return { db, deps, fetch };
}
// Hosts' calls name a session; the helper adds each test host's own session unless the test sets sid itself.
const HOST_SID = { host1: "S1", ta1: "T1" };
/**
 * Calls runCoach as `uid`, adding the host's own session id from HOST_SID unless `data` has a `sid` key.
 * @param {!Object} deps Dependencies from setup().
 * @param {?string} uid Caller uid; null or "" means signed out.
 * @param {!Object} data Request payload.
 * @return {!Promise<!Object>} The runCoach result.
 */
const call = (deps, uid, data) => runCoach({ uid, data: { ...(HOST_SID[uid] && !("sid" in data) ? { sid: HOST_SID[uid] } : {}), ...data }, deps });
/**
 * Returns the per-session quota count of a user, or 0 when the counter document does not exist.
 * @param {!Object} db Fake db from setup().
 * @param {string} uid User id.
 * @param {string} sid Session id.
 * @return {number} The session count.
 */
const sessionUsed = (db, uid, sid) => (db.docs.get(`aiQuota/${uid}_s_${sid}`) || {}).count || 0;
/**
 * Returns the daily quota count of a user for the UTC day of `now`, or 0 when there is none.
 * @param {!Object} db Fake db from setup().
 * @param {string} uid User id.
 * @param {number=} now Clock value in ms; defaults to NOW.
 * @return {number} The daily count.
 */
const quota = (db, uid, now = NOW) => (db.docs.get(`aiQuota/${uid}_${dayKey(now)}`) || {}).count || 0;
// Every refusal carries a page error code and a non-empty message the page can show.
/**
 * Asserts that `p` rejects with a CoachError of the given code whose message matches `msg`.
 * @param {!Promise<*>} p The promise under test.
 * @param {string} code Expected CoachError code.
 * @param {!RegExp=} msg Pattern the message must match; defaults to any non-whitespace character.
 * @return {!Promise<void>} Resolves when the assertion passes.
 */
const rejects = (p, code, msg = /\S/) => assert.rejects(p, (e) => e instanceof CoachError && e.name === "CoachError" && e.code === code && msg.test(e.message));

/** Verifies that a call without a uid is refused with not_granted. */
test("signed-out callers are refused", async () => { const { deps } = setup(); await rejects(call(deps, null, { prompt: "x" }), "not_granted"); });

/**
 * Verifies that a uid that is neither a host nor a recent player is refused with not_granted, and that no upstream
 * request is made.
 */
test("users who are neither hosts nor recent players are refused", async () => {
  const { deps, fetch } = setup(); await rejects(call(deps, "stranger", { prompt: "x" }), "not_granted"); assert.equal(fetch.calls.length, 0);
});

/** Verifies that a player whose session was created 4 days ago is refused (players qualify for 3 days). */
test("a player whose session is older than 3 days is refused", async () => {
  const { deps } = setup({ seed: { "pub/old": { sid: "S0", host: "host1" }, "data/users/host1/profile/sessions/S0": { createdAt: NOW - 4 * 864e5, participants: [{ uid: "old" }] } } });
  await rejects(call(deps, "old", { prompt: "x" }), "not_granted");
});

/**
 * Verifies that a player record naming a real session is not enough: the host's session must list the user as a
 * participant. No upstream request is made.
 */
test("a forged player record is refused when the host's session does not list the user", async () => {
  const { deps, fetch } = setup({ seed: { "pub/forger": { sid: "S1", host: "host1", joinedAt: NOW } } });
  await rejects(call(deps, "forger", { prompt: "x" }), "not_granted"); assert.equal(fetch.calls.length, 0);
});

/** Verifies that a player record pointing at a missing session document is refused. */
test("a player record pointing at a session that does not exist is refused", async () => {
  const { deps } = setup({ seed: { "pub/ghost": { sid: "Snope", host: "host1", joinedAt: NOW } } });
  await rejects(call(deps, "ghost", { prompt: "x" }), "not_granted");
});

/**
 * Verifies that a missing, blank or over-long prompt and an unknown tier are refused with invalid_argument, and
 * that the daily quota stays at 0 (validation runs before any quota is consumed).
 */
test("bad input is refused before any quota is used", async () => {
  const { deps, db } = setup();
  await rejects(call(deps, "host1", {}), "invalid_argument");
  await rejects(call(deps, "host1", { prompt: "   " }), "invalid_argument");
  await rejects(call(deps, "host1", { prompt: "x".repeat(DEFAULTS.maxPromptChars + 1) }), "invalid_argument");
  await rejects(call(deps, "host1", { prompt: "x", tier: "gpt" }), "invalid_argument");
  assert.equal(quota(db, "host1"), 0);
});

/**
 * Verifies the Messages API request: endpoint, API key and version headers, the quick-tier model, max_tokens, the
 * fixed system prompt and a single user message; also the reported model, tier and truncation flag.
 */
test("the request to Anthropic has the right shape and model for the tier", async () => {
  const { deps, fetch } = setup();
  const out = await call(deps, "host1", { prompt: "Write the report.", tier: "quick" });
  const c = fetch.calls[0];
  assert.equal(c.url, "https://api.anthropic.com/v1/messages");
  assert.equal(c.init.headers["x-api-key"], "sk-test");
  assert.equal(c.init.headers["anthropic-version"], "2023-06-01");
  assert.equal(c.body.model, "claude-haiku-5-5");
  assert.equal(c.body.max_tokens, DEFAULTS.maxTokens);
  assert.match(c.body.system, /out_of_scope/);
  assert.deepEqual(c.body.messages, [{ role: "user", content: "Write the report." }]);
  assert.equal(out.modelApplied, "claude-haiku-5-5"); assert.equal(out.modelTierApplied, "quick"); assert.equal(out.truncated, false);
});

/** Verifies that omitting the tier selects DEFAULTS.models.default. */
test("default tier uses the default model", async () => {
  const { deps, fetch } = setup(); await call(deps, "host1", { prompt: "x" }); assert.equal(fetch.calls[0].body.model, DEFAULTS.models.default);
});

/**
 * Verifies that a player gets participantDailyCap calls a day and the next is refused with quota_exceeded, with
 * the counter left at the cap.
 */
test("players get the participant cap, then quota_exceeded", async () => {
  const { deps, db } = setup();
  for (let k = 0; k < DEFAULTS.participantDailyCap; k++) await call(deps, "stu1", { prompt: "x" });
  await rejects(call(deps, "stu1", { prompt: "x" }), "quota_exceeded");
  assert.equal(quota(db, "stu1"), DEFAULTS.participantDailyCap);
});

/**
 * Verifies that a host one call below hostDailyCap gets that call, then quota_exceeded, with the counter at the
 * cap.
 */
test("hosts get the host cap", async () => {
  const { deps, db } = setup({ seed: { [`aiQuota/host1_${dayKey(NOW)}`]: { count: DEFAULTS.hostDailyCap - 1 } } });
  await call(deps, "host1", { prompt: "x" });
  await rejects(call(deps, "host1", { prompt: "x" }), "quota_exceeded");
  assert.equal(quota(db, "host1"), DEFAULTS.hostDailyCap);
});

/** Verifies that a uid listed in meta/aiHosts (and not in meta/admins) is served as a host. */
test("hosts can also be listed in meta/aiHosts", async () => {
  const { deps } = setup({ seed: { "meta/aiHosts": { uids: ["ta1"] }, "data/users/ta1/profile/sessions/T1": { createdAt: NOW, endAt: NOW, participants: [] } } });
  await call(deps, "ta1", { prompt: "x" });
});

/**
 * Verifies the HTTP status mapping (429 and 529 to rate_limited, 500 to upstream_error, 401 to misconfigured,
 * 400 to invalid_argument) and that each failure refunds the daily quota unit.
 */
test("upstream failures map to page codes and give the quota unit back", async () => {
  for (const [status, code] of [[429, "rate_limited"], [529, "rate_limited"], [500, "upstream_error"], [401, "misconfigured"], [400, "invalid_argument"]]) {
    const { deps, db } = setup({ fetch: statusFetch(status) });
    await rejects(call(deps, "host1", { prompt: "x" }), code);
    assert.equal(quota(db, "host1"), 0, `quota refunded after HTTP ${status}`);
  }
});

/** Verifies that a fetch that throws maps to upstream_error and refunds the quota unit. */
test("network errors map to upstream_error and refund", async () => {
  const { deps, db } = setup({ fetch: async () => { throw new TypeError("fetch failed"); } });
  await rejects(call(deps, "host1", { prompt: "x" }), "upstream_error"); assert.equal(quota(db, "host1"), 0);
});

/** Verifies that a whitespace-only completion maps to empty_completion and refunds the quota unit. */
test("an empty completion maps to empty_completion and refunds", async () => {
  const { deps, db } = setup({ fetch: okFetch("  ") }); await rejects(call(deps, "host1", { prompt: "x" }), "empty_completion"); assert.equal(quota(db, "host1"), 0);
});

/** Verifies that stop_reason max_tokens is reported as `truncated: true`. */
test("max_tokens stop is reported as truncated", async () => {
  const { deps } = setup({ fetch: okFetch("{}", { stop_reason: "max_tokens" }) }); const out = await call(deps, "host1", { prompt: "x" }); assert.equal(out.truncated, true);
});

/**
 * Verifies that the aiLog entry records the prompt length, a SHA-256 hex hash, the token usage and the host role,
 * and contains no prompt text (privacy invariant).
 */
test("the call log has sizes and a hash, never the prompt or reply", async () => {
  const { deps, db } = setup(); const prompt = "EVIDENCE: Alice answered B on question 3"; await call(deps, "host1", { prompt });
  const e = db.added.find((x) => x.c === "aiLog").v;
  assert.equal(e.prompt_chars, prompt.length); assert.match(e.prompt_sha256, /^[0-9a-f]{64}$/);
  assert.equal(e.input_tokens, 120); assert.equal(e.output_tokens, 40); assert.equal(e.role, "host");
  assert.ok(!JSON.stringify(e).includes("Alice"), "no prompt text in the log");
});

/** Verifies that a refund with nothing consumed leaves both the daily and the session counter at 0. */
test("refunds never take the counter below zero", async () => {
  const { deps, db } = setup(); await deps.refundQuota({ uid: "host1", day: dayKey(NOW), sid: "S1" });
  assert.equal(quota(db, "host1"), 0); assert.equal(sessionUsed(db, "host1", "S1"), 0);
});

/* ---------- per-session quota for hosts (user decision C: 2 x participants + 1 per session, plus a daily guard) ---------- */
/** Verifies sessionCap(n) = 2n + 1 for 0, 2 and 30 participants. */
test("session cap formula", () => { assert.equal(sessionCap(0), 1); assert.equal(sessionCap(2), 5); assert.equal(sessionCap(30), 61); });

/**
 * Verifies that host1 gets 5 calls on S1 (2 participants), then quota_exceeded with a message naming the session
 * limit; both counters end at 5.
 */
test("a host gets 2 x participants + 1 calls per session, then quota_exceeded naming the session limit", async () => {
  const { deps, db } = setup(); // S1 has 2 participants: cap 5
  for (let k = 0; k < 5; k++) await call(deps, "host1", { prompt: "x" });
  await assert.rejects(call(deps, "host1", { prompt: "x" }), (e) => e.code === "quota_exceeded" && /session/.test(e.message));
  assert.equal(sessionUsed(db, "host1", "S1"), 5); assert.equal(quota(db, "host1"), 5);
});

/**
 * Verifies that session caps are independent: S1 allows 5 calls and S2 (1 participant) allows 3, while the
 * daily counter totals 8.
 */
test("each session has its own cap", async () => {
  const { deps, db } = setup({ seed: { "data/users/host1/profile/sessions/S2": { createdAt: NOW, endAt: NOW, participants: [{ uid: "x" }] } } });
  for (let k = 0; k < 5; k++) await call(deps, "host1", { prompt: "x" });
  for (let k = 0; k < 3; k++) await call(deps, "host1", { prompt: "x", sid: "S2" });
  await rejects(call(deps, "host1", { prompt: "x", sid: "S2" }), "quota_exceeded");
  assert.equal(sessionUsed(db, "host1", "S2"), 3); assert.equal(quota(db, "host1"), 8);
});

/** Verifies that a host call with a null session id is refused with invalid_argument (hosts must name a session). */
test("a host call without a session id is refused", async () => { const { deps } = setup(); await rejects(call(deps, "host1", { prompt: "x", sid: null }), "invalid_argument"); });

/** Verifies that a session id containing path characters ("../S1") is refused with invalid_argument. */
test("a malformed session id is refused", async () => { const { deps } = setup(); await rejects(call(deps, "host1", { prompt: "x", sid: "../S1" }), "invalid_argument"); });

/** Verifies that a host cannot charge a session that belongs to another host (not_granted). */
test("a host cannot charge another host's session", async () => {
  const { deps } = setup({ seed: { "meta/aiHosts": { uids: ["ta1"] } } }); // S1 belongs to host1
  await rejects(call(deps, "ta1", { prompt: "x", sid: "S1" }), "not_granted");
});

/** Verifies that a session without endAt (not yet ended) is refused with not_granted. */
test("no AI calls before the session ends", async () => {
  const { deps } = setup({ seed: { "data/users/host1/profile/sessions/S3": { createdAt: NOW, participants: [] } } });
  await rejects(call(deps, "host1", { prompt: "x", sid: "S3" }), "not_granted");
});

/** Verifies that an upstream 429 refunds both the daily and the session unit. */
test("a failed upstream call gives back both the daily and the session unit", async () => {
  const { deps, db } = setup({ fetch: statusFetch(429) });
  await rejects(call(deps, "host1", { prompt: "x" }), "rate_limited");
  assert.equal(quota(db, "host1"), 0); assert.equal(sessionUsed(db, "host1", "S1"), 0);
});

/**
 * Verifies that a host at hostDailyCap is refused with a message naming the daily limit, although the session cap
 * is not reached.
 */
test("the daily guard still applies to hosts across sessions", async () => {
  const { deps } = setup({ seed: { [`aiQuota/host1_${dayKey(NOW)}`]: { count: DEFAULTS.hostDailyCap } } });
  await assert.rejects(call(deps, "host1", { prompt: "x" }), (e) => e.code === "quota_exceeded" && /daily/.test(e.message));
});

/**
 * Verifies that a player naming a session other than the one they played in is refused, and that naming their
 * own session succeeds.
 */
test("a player may name only the session they played in", async () => {
  const { deps } = setup();
  await rejects(call(deps, "stu1", { prompt: "x", sid: "S9" }), "not_granted");
  await call(deps, "stu1", { prompt: "x", sid: "S1" });
});

/* ---------- structured output for report kinds ---------- */
/**
 * Returns a fake `fetch` that answers with a forced tool call echoing `input` under the requested tool name.
 *
 * With `input === null` the reply has no content blocks, modeling a tool-mode reply without the tool call. Requests
 * are recorded on `f.calls` as `{body}`.
 * @param {?Object} input Tool input to return, or null for empty content.
 * @param {!Object=} extra Fields merged over the reply body.
 * @return {function(string, !Object): !Promise<!Object>} The fake fetch, with a `calls` array property.
 */
function toolFetch(input, extra = {}) {
  const calls = [];
  /**
   * Records the parsed request body and resolves to an HTTP 200 tool_use response.
   * @param {string} url Request URL (unused).
   * @param {!Object} init Fetch init; `init.body` is JSON.
   * @return {!Promise<!Object>} A response-like object with `ok`, `status` and `json()`.
   */
  const f = async (url, init) => { const body = JSON.parse(init.body); calls.push({ body });
    return { ok: true, status: 200, json: async () => ({ model: body.model, content: input === null ? [] : [{ type: "tool_use", id: "t1", name: body.tool_choice.name, input }], stop_reason: "tool_use", usage: { input_tokens: 10, output_tokens: 5 }, ...extra }) }; };
  f.calls = calls; return f;
}
/**
 * Verifies that kind "personal" forces the learning_report tool with the six expected schema properties and
 * returns the tool input as JSON text.
 */
test("personal reports force the learning_report tool and return its input as JSON text", async () => {
  const input = { performance_summary: "s", knowledge_points: ["a"], weak_or_risky_areas: [], possible_confusions: [], next_steps: ["n"], resource_ids: [] };
  const { deps, fetch } = setup({ fetch: toolFetch(input) });
  const out = await call(deps, "host1", { prompt: "x", kind: "personal" });
  const b = fetch.calls[0].body;
  assert.equal(b.tools[0].name, "learning_report"); assert.deepEqual(b.tool_choice, { type: "tool", name: "learning_report" });
  assert.deepEqual(Object.keys(b.tools[0].input_schema.properties).sort(), ["knowledge_points", "next_steps", "performance_summary", "possible_confusions", "resource_ids", "weak_or_risky_areas"]);
  assert.deepEqual(JSON.parse(out.text), input);
});
/**
 * Verifies that kind "class" forces the class_summary tool and that the class schema requires the five expected
 * fields. The required list is sorted as a copy: sorting it in place reordered the shared, shallowly frozen schema.
 */
test("class summaries force the class_summary tool", async () => {
  const { deps, fetch } = setup({ fetch: toolFetch({ overview: "o", prominent_knowledge_points: [], common_error_patterns: [], possible_confusion_signals: [], instructor_review_areas: [] }) });
  await call(deps, "host1", { prompt: "x", kind: "class" }); assert.equal(fetch.calls[0].body.tool_choice.name, "class_summary");
  assert.deepEqual([...SCHEMAS.class.input_schema.required].sort(), ["common_error_patterns", "instructor_review_areas", "overview", "possible_confusion_signals", "prominent_knowledge_points"]);
});
/** Verifies that an unknown report kind is refused with invalid_argument. */
test("an unknown report kind is refused", async () => { const { deps } = setup(); await rejects(call(deps, "host1", { prompt: "x", kind: "essay" }), "invalid_argument"); });
/** Verifies that a tool-mode reply without a tool_use block maps to empty_completion and refunds the quota unit. */
test("a tool-mode reply without the tool call is empty_completion and refunds", async () => {
  const { deps, db } = setup({ fetch: toolFetch(null) }); await rejects(call(deps, "host1", { prompt: "x", kind: "personal" }), "empty_completion"); assert.equal(quota(db, "host1"), 0);
});
/** Verifies that requests without a kind carry no tools (plain-text mode). */
test("requests without a kind stay plain text", async () => { const { deps, fetch } = setup(); await call(deps, "host1", { prompt: "x" }); assert.equal(fetch.calls[0].body.tools, undefined); });

/* ---------- round 2: tests for mutants that survived Stryker (verify/evidence/round2/mutation-*.json) ---------- */
/** Verifies that dayKey returns the UTC calendar date, including one second before UTC midnight. */
test("day keys are UTC calendar dates", () => { assert.equal(dayKey(NOW), "2026-10-29"); assert.equal(dayKey(Date.UTC(2026, 9, 29, 23, 59, 59)), "2026-10-29"); });

/**
 * Verifies each tier against a literal model id, so a wrong id in DEFAULTS fails (comparing with
 * DEFAULTS.models.default could not).
 */
test("each tier maps to its fixed model id", async () => {
  for (const [tier, model] of [["quick", "claude-haiku-5-5"], ["default", "claude-sonnet-5-5"], ["complex", "claude-opus-5-5"]]) {
    const { deps, fetch } = setup(); await call(deps, "host1", { prompt: "x", tier }); assert.equal(fetch.calls[0].body.model, model);
  }
});

/** Pins the exact fixed system prompt, so a mutated string literal fails. */
test("the fixed system prompt names the coach, its two tasks and the out-of-scope reply", () => {
  assert.equal(DEFAULTS.system,
    "You are the AlgoArena Learning Coach. An algorithms course uses you to write short learning reports and class " +
    "summaries from live-quiz evidence. Follow the instructions in the user message. If the user message asks for " +
    "anything other than a learning report or class summary about the quiz evidence it contains, reply with exactly " +
    '{"error":"out_of_scope"} and nothing else.');
});

/**
 * Pins both report schemas exactly: closed objects, the required fields, word-limit descriptions and maxItems on
 * every list.
 */
test("report schemas are closed objects with bounded lists of strings", () => {
  /**
   * Returns the expected schema of a list of at most `n` strings of at most `w` words each.
   * @param {number} n Maximum number of items.
   * @param {number} w Word limit stated in the item description.
   * @return {!Object} The JSON schema fragment.
   */
  const list = (n, w) => ({ type: "array", maxItems: n, items: { type: "string", description: `at most ${w} words` } });
  assert.deepEqual(SCHEMAS.personal, { name: "learning_report", description: "Return the student's learning report.", input_schema: {
    type: "object", additionalProperties: false,
    required: ["performance_summary", "knowledge_points", "weak_or_risky_areas", "possible_confusions", "next_steps", "resource_ids"],
    properties: { performance_summary: { type: "string", description: "at most 50 words" }, knowledge_points: list(3, 18), weak_or_risky_areas: list(3, 18),
      possible_confusions: list(3, 18), next_steps: list(3, 18), resource_ids: { type: "array", maxItems: 3, items: { type: "string" } } } } });
  assert.deepEqual(SCHEMAS.class, { name: "class_summary", description: "Return the class-level summary for the instructor.", input_schema: {
    type: "object", additionalProperties: false,
    required: ["overview", "prominent_knowledge_points", "common_error_patterns", "possible_confusion_signals", "instructor_review_areas"],
    properties: { overview: { type: "string", description: "at most 60 words" }, prominent_knowledge_points: list(4, 25), common_error_patterns: list(4, 25),
      possible_confusion_signals: list(4, 25), instructor_review_areas: list(4, 25) } } });
});

/** Verifies the length boundary: a prompt of exactly maxPromptChars characters is accepted. */
test("a prompt of exactly the maximum length is accepted", async () => {
  const { deps } = setup(); await call(deps, "host1", { prompt: "x".repeat(DEFAULTS.maxPromptChars) });
});

/**
 * Verifies that a non-string session id, one containing "/" and "..", and one of 101 characters are refused with
 * invalid_argument.
 */
test("session ids must be whole strings of safe characters", async () => {
  const { deps } = setup();
  await rejects(call(deps, "host1", { prompt: "x", sid: 123 }), "invalid_argument");
  await rejects(call(deps, "host1", { prompt: "x", sid: "S1/../S2" }), "invalid_argument");
  await rejects(call(deps, "host1", { prompt: "x", sid: "S".repeat(101) }), "invalid_argument");
});

/**
 * Verifies that signed-out callers (null and "" uid) get the "Sign in" refusal even with invalid input, so the
 * sign-in check runs before input validation.
 */
test("signed-out callers are refused before input is checked", async () => {
  const { deps } = setup(); await rejects(call(deps, null, {}), "not_granted", /Sign in/); await rejects(call(deps, "", { prompt: "x" }), "not_granted", /Sign in/);
});

/** Verifies that HTTP 403 maps to misconfigured and 413 to invalid_argument, each with a refund. */
test("HTTP 403 and 413 map like 401 and 400", async () => {
  for (const [status, code] of [[403, "misconfigured"], [413, "invalid_argument"]]) {
    const { deps, db } = setup({ fetch: statusFetch(status) }); await rejects(call(deps, "host1", { prompt: "x" }), code); assert.equal(quota(db, "host1"), 0);
  }
});

/** Verifies that the session-limit message states the cap and the player count ("5 reports for 2 players"). */
test("the session-limit message states the cap and the player count", async () => {
  const { deps } = setup(); for (let k = 0; k < 5; k++) await call(deps, "host1", { prompt: "x" });
  await rejects(call(deps, "host1", { prompt: "x" }), "quota_exceeded", /\b5 reports for 2 players\b/);
});

/** Verifies that a host session without a participants field has a cap of 1: one call, then quota_exceeded. */
test("a host session without a participant list allows one call", async () => {
  const { deps } = setup({ seed: { "data/users/host1/profile/sessions/S4": { createdAt: NOW, endAt: NOW } } });
  await call(deps, "host1", { prompt: "x", sid: "S4" }); await rejects(call(deps, "host1", { prompt: "x", sid: "S4" }), "quota_exceeded");
});

/**
 * Verifies that a session id the host does not own is refused with the "not one of yours" message, not the
 * message for a session that has not ended.
 */
test("another host's session id is refused as not yours, not as unfinished", async () => {
  const { deps } = setup({ seed: { "meta/aiHosts": { uids: ["ta1"] } } });
  await rejects(call(deps, "ta1", { prompt: "x", sid: "S1" }), "not_granted", /not one of yours/);
});

/** Verifies that the request is a POST with a JSON content-type header and an AbortSignal for the timeout. */
test("the request is a JSON POST with a timeout signal", async () => {
  const { deps, fetch } = setup(); await call(deps, "host1", { prompt: "x" });
  const { init } = fetch.calls[0];
  assert.equal(init.method, "POST"); assert.equal(init.headers["content-type"], "application/json"); assert.ok(init.signal instanceof AbortSignal);
});

/**
 * Verifies that with globalThis.AbortSignal undefined the request is still sent, without a signal; the global is
 * restored afterwards.
 */
test("without AbortSignal (older runtimes) the request is sent without a signal", async () => {
  const saved = globalThis.AbortSignal;
  try {
    globalThis.AbortSignal = undefined;
    const { deps, fetch } = setup(); await call(deps, "host1", { prompt: "x" }); assert.equal(fetch.calls[0].init.signal, undefined);
  } finally { globalThis.AbortSignal = saved; }
});

/**
 * Verifies that modelApplied is the model named in the reply when there is one, else the requested default-tier
 * model.
 */
test("the reply's model is reported when the API names one, else the requested model", async () => {
  let r = setup({ fetch: okFetch("ok", { model: "claude-sonnet-5-5-20261001" }) });
  assert.equal((await call(r.deps, "host1", { prompt: "x" })).modelApplied, "claude-sonnet-5-5-20261001");
  r = setup({ fetch: okFetch("ok", { model: undefined }) });
  assert.equal((await call(r.deps, "host1", { prompt: "x" })).modelApplied, "claude-sonnet-5-5");
});

/** Verifies that a plain reply concatenates, in order and with no separator, only text blocks that have text. */
test("plain replies concatenate only text blocks, with no separator", async () => {
  const content = [{ type: "text", text: "A" }, { type: "thinking", text: "hidden" }, { type: "text" }, { type: "text", text: "B" }];
  const { deps } = setup({ fetch: async () => ({ ok: true, status: 200, json: async () => ({ content, stop_reason: "end_turn" }) }) });
  assert.equal((await call(deps, "host1", { prompt: "x" })).text, "AB");
});

/**
 * Verifies that report mode ignores text blocks and tool_use blocks for other tools, returns the input of the
 * learning_report block, and treats a non-object input as empty_completion with a refund.
 */
test("report replies use only a tool_use block for the named tool, and only an object input", async () => {
  const input = { performance_summary: "s", knowledge_points: [], weak_or_risky_areas: [], possible_confusions: [], next_steps: [], resource_ids: [] };
  /**
   * Returns a fake `fetch` that replies with the given content blocks and stop_reason tool_use.
   * @param {!Array<!Object>} content Content blocks of the reply.
   * @return {function(): !Promise<!Object>} The fake fetch.
   */
  const reply = (content) => async () => ({ ok: true, status: 200, json: async () => ({ content, stop_reason: "tool_use" }) });
  let r = setup({ fetch: reply([{ type: "text", text: "preamble", name: "learning_report", input: { wrong: 1 } }, { type: "tool_use", name: "other_tool", input: { wrong: 2 } },
    { type: "tool_use", name: "learning_report", input }]) });
  assert.deepEqual(JSON.parse((await call(r.deps, "host1", { prompt: "x", kind: "personal" })).text), input);
  r = setup({ fetch: reply([{ type: "tool_use", name: "learning_report", input: "not an object" }]) });
  await rejects(call(r.deps, "host1", { prompt: "x", kind: "personal" }), "empty_completion"); assert.equal(quota(r.db, "host1"), 0);
});

/** Verifies that a player's aiLog entry has role "participant" and a null session id. */
test("player calls are logged with the participant role and no session", async () => {
  const { deps, db } = setup(); await call(deps, "stu1", { prompt: "x" });
  const e = db.added.find((x) => x.c === "aiLog").v; assert.equal(e.role, "participant"); assert.equal(e.sid, null);
});

/**
 * Verifies that a player record missing its host or its session id never qualifies, even when the paths a
 * missing field would produce are seeded.
 */
test("a player record without a host or without a session never qualifies", async () => {
  // Paths that a missing field would turn into ".../undefined/..." are seeded, so only the explicit guard refuses.
  const { deps } = setup({ seed: {
    "pub/nohost": { sid: "S1" }, "data/users/undefined/profile/sessions/S1": { createdAt: NOW, participants: [{ uid: "nohost" }] },
    "pub/nosid": { host: "host1" }, "data/users/host1/profile/sessions/undefined": { createdAt: NOW, participants: [{ uid: "nosid" }] } } });
  await rejects(call(deps, "nohost", { prompt: "x" }), "not_granted"); await rejects(call(deps, "nosid", { prompt: "x" }), "not_granted");
});

/** Verifies the player boundary: a session created exactly 3 days ago still qualifies. */
test("a player session exactly 3 days old still qualifies", async () => {
  const { deps } = setup({ seed: { "pub/edge": { sid: "S5", host: "host1" }, "data/users/host1/profile/sessions/S5": { createdAt: NOW - 3 * 864e5, participants: [{ uid: "edge" }] } } });
  await call(deps, "edge", { prompt: "x" });
});

/** Verifies that a failed player call (HTTP 529) refunds the daily unit. */
test("a failed player call gives back the daily unit", async () => {
  const { deps, db } = setup({ fetch: statusFetch(529) });
  await rejects(call(deps, "stu1", { prompt: "x" }), "rate_limited"); assert.equal(quota(db, "stu1"), 0);
});

/**
 * Verifies that a refund decrements both counters by exactly one (3 to 2) and keeps the other fields of the counter
 * documents. Kills the refund `merge: true` mutant and a refund that resets the counter to 0.
 */
test("a refund decrements the counters by one and keeps the other fields", async () => {
  /** Fake fetch that delegates to okFetch() while `ok` is true and fails with HTTP 429 after. */
  let ok = true; const fetch = async (u, init) => (ok ? okFetch()(u, init) : statusFetch(429)());
  const { deps, db } = setup({ fetch });
  await call(deps, "host1", { prompt: "x" }); await call(deps, "host1", { prompt: "x" }); ok = false;
  await rejects(call(deps, "host1", { prompt: "x" }), "rate_limited");
  assert.equal(quota(db, "host1"), 2); assert.equal(sessionUsed(db, "host1", "S1"), 2);
  assert.deepEqual({ ...db.docs.get("aiQuota/host1_s_S1"), updatedAt: 0 }, { uid: "host1", sid: "S1", count: 2, cap: 5, updatedAt: 0 });
  assert.deepEqual({ ...db.docs.get(`aiQuota/host1_${dayKey(NOW)}`), updatedAt: 0 }, { uid: "host1", day: dayKey(NOW), count: 2, updatedAt: 0 });
});
