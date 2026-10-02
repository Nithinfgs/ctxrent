import { signature } from './signature.js';

export const DEFAULT_CHARS_PER_TOKEN = 3.5;
export const IMAGE_TOKENS = 1500;
const MIN_CALIBRATION_PAIRS = 5;
const MIN_GAP_CHARS = 3000;

/**
 * @typedef {object} RentResult
 * @property {string} name
 * @property {string} label      Grouping label, e.g. "Bash: npm test".
 * @property {number} turn       First turn that carried this output (index into turns).
 * @property {number} tokens     Estimated size.
 * @property {number} carried    Number of model calls that re-read it before compaction/end.
 * @property {number} rent       tokens * carried.
 * @property {boolean} duplicate Byte-identical to an output already in context.
 * @property {boolean} isError
 */

/**
 * @typedef {object} Analysis
 * @property {string} id
 * @property {string} file
 * @property {string|null} cwd
 * @property {string|null} model
 * @property {number} turns
 * @property {number} peakCtx
 * @property {number} baseline         Tokens present on the very first call (system prompt, tools, memory files).
 * @property {number} charsPerToken
 * @property {boolean} calibrated      Whether charsPerToken was fitted from reported usage.
 * @property {number[]} compactions    Turn indexes where context was compacted.
 * @property {number[]} profile        Context size per turn.
 * @property {number} totalRead        Sum of context sizes: every token the model re-read.
 * @property {number} baselineRent
 * @property {number} toolRent
 * @property {number} conversationRent
 * @property {number} duplicateRent
 * @property {RentResult[]} results
 */

/**
 * Fit chars-per-token from the session itself: the growth in reported context between two
 * calls, minus the model's own output, is the text that arrived in between.
 * @param {import('./parse.js').Session} session
 * @param {Set<number>} boundaries
 */
function calibrate(session, boundaries) {
  const { turns, results, gapChars, dirtyGaps } = session;
  const chars = new Array(turns.length).fill(0);
  const hasImage = new Array(turns.length).fill(false);
  for (const r of results) {
    if (r.afterTurn < 0) continue;
    chars[r.afterTurn] += r.chars;
    if (r.images > 0) hasImage[r.afterTurn] = true;
  }
  for (const [t, c] of gapChars) if (t >= 0) chars[t] += c;
  // Prefer clean gaps: harness-injected text (reminders, tool deltas) inflates the growth and
  // drags the ratio down. Sessions where every gap carries one fall back to all sizeable gaps.
  const clean = [];
  const any = [];
  for (let i = 0; i + 1 < turns.length; i++) {
    if (boundaries.has(i + 1) || hasImage[i] || chars[i] < MIN_GAP_CHARS) continue;
    const grown = turns[i + 1].ctx - turns[i].ctx - turns[i].output;
    if (grown <= 0) continue;
    any.push(chars[i] / grown);
    if (!dirtyGaps.has(i)) clean.push(chars[i] / grown);
  }
  const ratios = clean.length >= MIN_CALIBRATION_PAIRS ? clean : any;
  if (ratios.length < MIN_CALIBRATION_PAIRS)
    return { charsPerToken: DEFAULT_CHARS_PER_TOKEN, calibrated: false };
  ratios.sort((a, b) => a - b);
  const median = ratios[Math.floor(ratios.length / 2)];
  return { charsPerToken: Math.min(6, Math.max(1.5, median)), calibrated: true };
}

/**
 * Compute the rent every tool output paid: its size times the number of model calls
 * that re-read it before the context was compacted (or the session ended).
 * @param {import('./parse.js').Session} session
 * @returns {Analysis}
 */
export function analyzeSession(session) {
  const { turns } = session;
  const n = turns.length;

  const boundaries = new Set();
  turns.forEach((t, i) => {
    const prev = turns[i - 1];
    const dropped = prev && prev.ctx > 20_000 && t.ctx < prev.ctx * 0.6;
    if (i > 0 && (t.compactBefore || dropped)) boundaries.add(i);
  });
  const sortedBoundaries = [...boundaries].sort((a, b) => a - b);
  const { charsPerToken, calibrated } = calibrate(session, boundaries);

  const profile = turns.map((t) => t.ctx);
  const totalRead = profile.reduce((a, b) => a + b, 0);
  const baseline = n > 0 ? turns[0].ctx : 0;

  /** @type {RentResult[]} */
  const results = [];
  /** @type {Map<string, number>} hash key -> index of the compaction window it was last seen in */
  const seen = new Map();
  for (const r of session.results) {
    const first = r.afterTurn + 1;
    const tokens = Math.round(r.chars / charsPerToken + r.images * IMAGE_TOKENS);
    let carried = 0;
    if (first < n && !boundaries.has(first)) {
      const nextBoundary = sortedBoundaries.find((b) => b > first);
      carried = (nextBoundary ?? n) - first;
    }
    const window = sortedBoundaries.filter((b) => b <= first).length;
    const key = `${r.name}\u0000${r.hash}`;
    const duplicate = r.chars > 200 && seen.get(key) === window;
    seen.set(key, window);
    results.push({
      name: r.name,
      label: signature(r.name, r.input, session.cwd),
      turn: first,
      tokens,
      carried,
      rent: tokens * carried,
      duplicate,
      isError: r.isError,
    });
  }

  const toolRent = results.reduce((a, r) => a + r.rent, 0);
  const duplicateRent = results.reduce((a, r) => a + (r.duplicate ? r.rent : 0), 0);
  const baselineRent = baseline * n;
  const conversationRent = Math.max(0, totalRead - baselineRent - toolRent);

  return {
    id: session.id,
    file: session.file,
    cwd: session.cwd,
    model: session.model,
    turns: n,
    peakCtx: Math.max(0, ...profile),
    baseline,
    charsPerToken,
    calibrated,
    compactions: sortedBoundaries,
    profile,
    totalRead,
    baselineRent,
    toolRent,
    conversationRent,
    duplicateRent,
    results,
  };
}

/**
 * Sum rent into groups.
 * @param {Analysis[]} analyses
 * @param {(r: RentResult) => string} keyOf
 */
export function groupRent(analyses, keyOf) {
  /** @type {Map<string, {key: string, calls: number, tokens: number, rent: number, maxTokens: number}>} */
  const groups = new Map();
  for (const a of analyses) {
    for (const r of a.results) {
      const key = keyOf(r);
      const g = groups.get(key) ?? { key, calls: 0, tokens: 0, rent: 0, maxTokens: 0 };
      g.calls += 1;
      g.tokens += r.tokens;
      g.rent += r.rent;
      g.maxTokens = Math.max(g.maxTokens, r.tokens);
      groups.set(key, g);
    }
  }
  return [...groups.values()].sort((a, b) => b.rent - a.rent);
}

/**
 * What would have been saved if every output larger than `cap` tokens had been trimmed to `cap`.
 * @param {Analysis[]} analyses
 * @param {number} cap
 */
export function capSavings(analyses, cap) {
  let saved = 0;
  let affected = 0;
  for (const a of analyses) {
    for (const r of a.results) {
      if (r.tokens > cap) {
        saved += (r.tokens - cap) * r.carried;
        affected += 1;
      }
    }
  }
  return { saved, affected };
}

/**
 * Totals across sessions.
 * @param {Analysis[]} analyses
 */
export function summarize(analyses) {
  const sum = (/** @type {(a: Analysis) => number} */ f) => analyses.reduce((t, a) => t + f(a), 0);
  const totalRead = sum((a) => a.totalRead);
  return {
    sessions: analyses.length,
    turns: sum((a) => a.turns),
    totalRead,
    baselineRent: sum((a) => a.baselineRent),
    toolRent: sum((a) => a.toolRent),
    conversationRent: sum((a) => a.conversationRent),
    duplicateRent: sum((a) => a.duplicateRent),
    compactions: sum((a) => a.compactions.length),
    peakCtx: Math.max(0, ...analyses.map((a) => a.peakCtx)),
  };
}
