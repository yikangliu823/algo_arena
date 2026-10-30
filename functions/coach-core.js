/**
 * @fileoverview AlgoArena AI Learning Coach: request handling shared by the Cloud Function (functions/index.js) and
 * the browser test harness. No Node-only or Firebase APIs here; storage and network come in through `deps`, so the
 * logic can be unit-tested directly (functions/test/coach-core.test.mjs).
 *
 * Error codes are the ones the page already understands (sampleJson retries only rate_limited): not_granted,
 * quota_exceeded, invalid_argument, rate_limited, upstream_error, empty_completion, misconfigured.
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

export const DEFAULTS = Object.freeze({
  models: Object.freeze({ quick: "claude-haiku-5-5", default: "claude-sonnet-5-5", complex: "claude-opus-5-5" }),
  apiUrl: "https://api.anthropic.com/v1/messages",
  apiVersion: "2023-06-01",
  maxPromptChars: 24000,
  maxTokens: 1200,
  timeoutMs: 60000,
  // Hosts: each ended session allows 2 x participants + 1 successful calls (one report per player, one rewrite when a
  // report runs long, one class summary). hostDailyCap is only a guard against abuse across sessions.
  hostDailyCap: 250,
  participantDailyCap: 3,
  system:
    "You are the AlgoArena Learning Coach. An algorithms course uses you to write short learning reports and class " +
    "summaries from live-quiz evidence. Follow the instructions in the user message. If the user message asks for " +
    "anything other than a learning report or class summary about the quiz evidence it contains, reply with exactly " +
    '{"error":"out_of_scope"} and nothing else.',
});

/* Structured output: for report requests the model must call one tool whose input is the report, so the reply is
   always a JSON object with these keys. The schemas live on the server; the page only names the kind. */
/**
 * Builds the JSON schema of a bounded list of short strings.
 *
 * @param {number} n Maximum number of items.
 * @param {number} w Word limit stated in each item's description (advisory to the model, not enforced).
 * @return {!Object} A JSON schema object of type "array".
 */
const list = (n, w) => ({ type: "array", maxItems: n, items: { type: "string", description: `at most ${w} words` } });
/**
 * Builds a closed JSON object schema in which every listed property is required.
 *
 * @param {!Object<string, !Object>} props Property schemas keyed by property name.
 * @return {!Object} A JSON schema object with additionalProperties false.
 */
const obj = (props) => ({ type: "object", additionalProperties: false, required: Object.keys(props), properties: props });
export const SCHEMAS = Object.freeze({
  personal: { name: "learning_report", description: "Return the student's learning report.", input_schema: obj({
    performance_summary: { type: "string", description: "at most 50 words" }, knowledge_points: list(3, 18), weak_or_risky_areas: list(3, 18),
    possible_confusions: list(3, 18), next_steps: list(3, 18), resource_ids: { type: "array", maxItems: 3, items: { type: "string" } } }) },
  class: { name: "class_summary", description: "Return the class-level summary for the instructor.", input_schema: obj({
    overview: { type: "string", description: "at most 60 words" }, prominent_knowledge_points: list(4, 25), common_error_patterns: list(4, 25),
    possible_confusion_signals: list(4, 25), instructor_review_areas: list(4, 25) }) },
});

/** An expected refusal or failure, carrying a page error code that functions/index.js maps to an HTTPS error. */
export class CoachError extends Error {
  /**
   * @param {string} code Page error code, for example "quota_exceeded".
   * @param {string} message Human-readable message the page can show.
   */
  constructor(code, message) { super(message); this.name = "CoachError"; this.code = code; }
}

/**
 * Returns the UTC calendar date of a timestamp, used to key the daily quota counters.
 *
 * @param {number} ms Unix epoch milliseconds.
 * @return {string} The date as YYYY-MM-DD.
 */
export const dayKey = (ms) => new Date(ms).toISOString().slice(0, 10);

/**
 * Hashes a string with SHA-256 using Web Crypto, so the call log can identify a prompt without storing it.
 *
 * @param {string} s Text to hash (UTF-8 encoded).
 * @return {!Promise<string>} The digest as 64 lowercase hex characters.
 */
export async function sha256hex(s) {
  const d = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Validates and normalizes the callable request's data before any quota is used.
 *
 * @param {*} data The request data sent by the page: {prompt, tier?, sid?, kind?}.
 * @param {!Object=} cfg Configuration; defaults to DEFAULTS.
 * @return {{prompt: string, tier: string, sid: ?string, kind: ?string}} The validated fields; tier defaults to
 *     "default", sid and kind to null.
 * @throws {!CoachError} invalid_argument when the prompt is missing, blank or too long, the tier or kind is unknown,
 *     or the session id is not 1 to 100 characters of [A-Za-z0-9_-].
 */
export function validateInput(data, cfg = DEFAULTS) {
  const prompt = data && data.prompt;
  if (typeof prompt !== "string" || !prompt.trim()) throw new CoachError("invalid_argument", "The request needs a prompt.");
  if (prompt.length > cfg.maxPromptChars) throw new CoachError("invalid_argument", `The prompt is longer than ${cfg.maxPromptChars} characters.`);
  const tier = (data && data.tier) || "default";
  if (!Object.prototype.hasOwnProperty.call(cfg.models, tier)) throw new CoachError("invalid_argument", `Unknown model tier "${tier}".`);
  const sid = data && data.sid != null ? data.sid : null;
  if (sid !== null && (typeof sid !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(sid))) throw new CoachError("invalid_argument", "The session id is not valid.");
  const kind = data && data.kind != null ? data.kind : null;
  if (kind !== null && !Object.prototype.hasOwnProperty.call(SCHEMAS, kind)) throw new CoachError("invalid_argument", `Unknown report kind "${kind}".`);
  return { prompt, tier, sid, kind };
}

/**
 * Returns a host's AI call allowance for one session: one report per player, one rewrite per player, one class summary.
 *
 * @param {number} participants Number of players in the session (negative values count as 0).
 * @return {number} 2 x participants + 1.
 */
export const sessionCap = (participants) => 2 * Math.max(0, participants) + 1;

/**
 * Maps an Anthropic API HTTP error status to a page error code and says whether the quota unit is returned.
 *
 * @param {number} status HTTP status of a failed response.
 * @return {{code: string, refund: boolean, msg: string}} Page error code, refund flag (currently true for every
 *     status), and a message for the page.
 */
export function mapStatus(status) {
  // 429 and 529 mean the request was not processed, so the page may retry them without spending tokens.
  if (status === 429 || status === 529) return { code: "rate_limited", refund: true, msg: "The AI service is busy. Try again shortly." };
  if (status === 401 || status === 403) return { code: "misconfigured", refund: true, msg: "The AI service rejected the server's API key. Ask the course admin to check it." };
  if (status === 400 || status === 413) return { code: "invalid_argument", refund: true, msg: "The AI service refused the request." };
  return { code: "upstream_error", refund: true, msg: `The AI service failed (HTTP ${status}).` };
}

/**
 * Handles one coach request end to end: authorization, quota, the Anthropic call, and the call log.
 *
 * Hosts must name one of their own ended sessions and are limited per session and per day; players must be listed
 * in the host's record of a session less than 3 days old and are limited per day. A failed or empty upstream call
 * returns its quota unit. The log stores sizes and a prompt hash, never the prompt or the reply.
 *
 * deps: {
 *   now(): ms, fetch(url, init), apiKey(): string,
 *   isHost(uid): Promise<bool>, hostSession(uid, sid): Promise<{ended, participants} | null>,
 *   hasJoined(uid): Promise<{sid} | false>,
 *   consumeQuota({uid, day, dailyCap, sid, sessionCap}): Promise<{ok, limit?}>, refundQuota(same): Promise,
 *   log(entry): Promise
 * }
 *
 * @param {{uid: ?string, data: *, deps: !Object, cfg: (!Object|undefined)}} request The caller's uid (null when
 *     signed out), the request data, the dependencies above, and an optional configuration (defaults to DEFAULTS).
 * @return {!Promise<{text: string, truncated: boolean, modelApplied: string, modelTierApplied: string}>} The reply
 *     text (for report kinds, the forced tool's input as JSON), whether it stopped at max_tokens, and the model used.
 * @throws {!CoachError} With one of the error codes listed in the file overview.
 */
export async function runCoach({ uid, data, deps, cfg = DEFAULTS }) {
  if (!uid) throw new CoachError("not_granted", "Sign in first.");
  const { prompt, tier, sid, kind } = validateInput(data, cfg);
  const host = await deps.isHost(uid);
  const day = dayKey(deps.now());
  let quota;
  if (host) {
    // A host's calls are tied to one of their own ended sessions, read from the host's private records.
    if (!sid) throw new CoachError("invalid_argument", "AI reports must name the session they are for.");
    const sess = await deps.hostSession(uid, sid);
    if (!sess) throw new CoachError("not_granted", "That session is not one of yours.");
    if (!sess.ended) throw new CoachError("not_granted", "AI reports are generated after the session ends.");
    quota = { uid, day, dailyCap: cfg.hostDailyCap, sid, sessionCap: sessionCap(sess.participants) };
  } else {
    const joined = await deps.hasJoined(uid);
    if (!joined) throw new CoachError("not_granted", "AI reports are available to hosts and to players who joined a game.");
    if (sid && sid !== joined.sid) throw new CoachError("not_granted", "That is not the session you played in.");
    quota = { uid, day, dailyCap: cfg.participantDailyCap, sid: null, sessionCap: null };
  }
  const q = await deps.consumeQuota(quota);
  if (!q.ok) throw new CoachError("quota_exceeded", q.limit === "session"
    ? `This session's AI limit (${quota.sessionCap} reports for ${(quota.sessionCap - 1) / 2} players) has been reached.`
    : `The daily AI limit (${quota.dailyCap}) has been reached.`);

  const model = cfg.models[tier];
  const body = { model, max_tokens: cfg.maxTokens, system: cfg.system, messages: [{ role: "user", content: prompt }] };
  if (kind) { const t = SCHEMAS[kind]; body.tools = [t]; body.tool_choice = { type: "tool", name: t.name }; }
  const signal = typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(cfg.timeoutMs) : undefined;
  let res, json;
  try {
    res = await deps.fetch(cfg.apiUrl, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": deps.apiKey(), "anthropic-version": cfg.apiVersion },
      body: JSON.stringify(body), signal,
    });
    json = await res.json().catch(() => null);
  } catch (e) {
    await deps.refundQuota(quota);
    throw new CoachError("upstream_error", "Could not reach the AI service.");
  }
  if (!res.ok) {
    const m = mapStatus(res.status);
    if (m.refund) await deps.refundQuota(quota);
    throw new CoachError(m.code, m.msg);
  }
  const blocks = (json && json.content) || [];
  const tool = kind ? blocks.find((b) => b && b.type === "tool_use" && b.name === SCHEMAS[kind].name) : null;
  const text = kind ? (tool && tool.input && typeof tool.input === "object" ? JSON.stringify(tool.input) : "")
    : blocks.filter((b) => b && b.type === "text").map((b) => b.text || "").join("");
  if (!text.trim()) { await deps.refundQuota(quota); throw new CoachError("empty_completion", "The AI service returned no text."); }

  const usage = (json && json.usage) || {};
  const out = { text, truncated: json.stop_reason === "max_tokens", modelApplied: json.model || model, modelTierApplied: tier };
  // The log keeps sizes and a hash, never the prompt or the reply: both contain student evidence.
  await deps.log({
    uid, day, sid: quota.sid, kind, at: deps.now(), role: host ? "host" : "participant", model: out.modelApplied, tier,
    input_tokens: usage.input_tokens ?? null, output_tokens: usage.output_tokens ?? null, truncated: out.truncated,
    prompt_chars: prompt.length, prompt_sha256: await sha256hex(prompt),
  });
  return out;
}
