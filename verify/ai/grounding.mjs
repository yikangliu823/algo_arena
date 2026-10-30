/**
 * @fileoverview Automatic grounding check for AI reports (invariant I7). Input: reports.json from export-reports.mjs.
 *    node grounding.mjs ../results/reports.json [--limit 400]
 * Checks per personal report: word count, every cited question exists, weak areas cite only questions the student
 * did not get right, no ability language, no other student's name. Class report: no student names at all.
 * Exit code 0 only if there are no violations. Prints one CSV line per report.
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
import { readFileSync } from "node:fs";
/** Words and phrases that describe a student's ability rather than their answers; reports must not use them. */
export const ABILITY = /\b(smart|intelligent|intelligence|talent(ed)?|gifted|lazy|careless|innate(ly)?|natural(ly)? (good|bad)|IQ|ability level|not cut out)\b/i;
/**
 * Counts words in a Markdown report the way the 400-word cap counts them: link targets are dropped and only tokens
 * with a letter or digit count.
 *
 * @param {*} md Report Markdown (converted with String()).
 * @return {number} The word count.
 */
export const words = (md) => String(md).replace(/\]\([^)]*\)/g, "]").split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
/**
 * Lists the question numbers a text cites, written as "Q3" or "question 3" (1-based, up to 3 digits).
 *
 * @param {*} text Text to scan (converted with String()).
 * @return {!Array<number>} Cited question numbers in order of appearance, with repeats.
 */
export const cited = (text) => [...String(text).matchAll(/\b(?:Q|question\s*)(\d{1,3})\b/gi)].map((m) => Number(m[1]));
/**
 * Checks one personal report: ready, within the word limit, cites only existing questions, lists as weak only
 * questions the student did not answer correctly, has no ability language, and names no other student.
 *
 * @param {{uid: string, name: string, submissions: !Array<{q_index: number, correct: boolean}>,
 *     report: ?{status: string, md: string, json: ?Object}}} player The student and their report.
 * @param {!Array<{uid: string, name: string}>} all Every student in the session.
 * @param {number} nQuestions Number of questions in the session.
 * @param {number=} limit Word limit (default 400).
 * @return {!Array<string>} Violations; empty when the report passes.
 */
export function checkReport(player, all, nQuestions, limit = 400) {
  const v = []; const r = player.report;
  if (!r || r.status !== "ready") return ["report not ready"];
  if (words(r.md) > limit) v.push(`over ${limit} words (${words(r.md)})`);
  for (const n of cited(r.md)) if (n < 1 || n > nQuestions) v.push(`cites Q${n}, which does not exist`);
  const right = new Set(player.submissions.filter((s) => s.correct).map((s) => s.q_index + 1));
  for (const item of (r.json && r.json.weak_or_risky_areas) || []) for (const n of cited(item)) if (right.has(n)) v.push(`weak area cites Q${n}, answered correctly`);
  const m = String(r.md).match(ABILITY); if (m) v.push(`ability language: "${m[0]}"`);
  for (const o of all) if (o.uid !== player.uid && o.name && o.name.length > 1 && String(r.md).includes(o.name)) v.push("names another student");
  return v;
}
/**
 * Checks the class report: ready, names no student, and has no ability language.
 *
 * @param {?{status: string, md: string}} cls The class report, or null.
 * @param {!Array<{name: string}>} players Every student in the session.
 * @return {!Array<string>} Violations; empty when the report passes.
 */
export function checkClass(cls, players) {
  if (!cls || cls.status !== "ready") return ["class report not ready"];
  const v = []; for (const p of players) if (p.name && p.name.length > 1 && String(cls.md).includes(p.name)) v.push("class report names a student");
  const m = String(cls.md).match(ABILITY); if (m) v.push(`ability language: "${m[0]}"`); return v;
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const data = JSON.parse(readFileSync(process.argv[2], "utf8")); const limit = process.argv.includes("--limit") ? Number(process.argv[process.argv.indexOf("--limit") + 1]) : 400;
  const n = data.questions.length; let bad = 0; console.log("report,violations");
  for (const p of data.players) { const v = checkReport(p, data.players, n, limit); bad += v.length; console.log(`${p.pid},"${v.join("; ")}"`); }
  const vc = checkClass(data.class, data.players); bad += vc.length; console.log(`class,"${vc.join("; ")}"`);
  console.log(bad ? `FAIL: ${bad} violation(s)` : "PASS: no violations"); process.exit(bad ? 1 : 0);
}
