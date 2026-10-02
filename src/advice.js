import { capSavings, groupRent } from './analyze.js';

export const DEFAULT_CAP = 2000;
const BASELINE_WARN_TOKENS = 25_000;
const LATE_CONTEXT_TOKENS = 150_000;

/**
 * @typedef {object} Advice
 * @property {string} id
 * @property {string} title
 * @property {string} detail
 * @property {number} saved   Token-turns this change would have avoided (0 when not quantifiable).
 */

/** Concrete, tool-specific hint for the worst offender of a kind. */
/** @param {string} label */
function hintFor(label) {
  if (label.startsWith('Bash:')) return 'cap output (`| tail -n 40`, `--quiet`, or a reporter flag)';
  if (label.startsWith('Read:')) return 'read a range (`offset`/`limit`) or Grep first';
  if (label.startsWith('Grep:')) return 'use `head_limit`, `files_with_matches`, or a narrower glob';
  if (label.startsWith('WebFetch')) return 'ask for a narrower extract instead of the whole page';
  if (label.startsWith('mcp__')) return 'use a narrower query, or disable the tool if you rarely need it';
  return 'trim or summarize the output before it reaches the model';
}

/**
 * Deterministic, rule-based suggestions. Every number comes from the analysis; nothing is guessed.
 * @param {import('./analyze.js').Analysis[]} analyses
 * @param {{cap?: number}} [opts]
 * @returns {Advice[]}
 */
export function advise(analyses, opts = {}) {
  const cap = opts.cap ?? DEFAULT_CAP;
  /** @type {Advice[]} */
  const out = [];
  const total = analyses.reduce((t, a) => t + a.totalRead, 0);
  if (total === 0) return out;

  const { saved, affected } = capSavings(analyses, cap);
  if (affected > 0 && saved / total >= 0.02) {
    const worst = groupRent(
      analyses.map((a) => ({
        ...a,
        results: a.results.filter((r) => r.tokens > cap),
      })),
      (r) => r.label,
    )[0];
    out.push({
      id: 'cap-outputs',
      title: `Cap tool outputs at ${cap.toLocaleString('en-US')} tokens`,
      detail:
        `${affected} outputs were larger; trimming them would have cut ` +
        `${Math.round((saved / total) * 100)}% of everything the model re-read. ` +
        `Worst: \`${worst.key}\` - ${hintFor(worst.key)}.`,
      saved,
    });
  }

  const dup = analyses.reduce((t, a) => t + a.duplicateRent, 0);
  if (dup / total >= 0.01) {
    out.push({
      id: 'duplicates',
      title: 'Stop re-fetching identical output',
      detail:
        `${Math.round((dup / total) * 100)}% of re-read tokens were byte-identical copies of an ` +
        'output already in context (same tool, same result). The first copy was enough.',
      saved: dup,
    });
  }

  const late = analyses.filter((a) => a.peakCtx >= LATE_CONTEXT_TOKENS);
  if (late.length > 0) {
    let lateRead = 0;
    for (const a of late) for (const c of a.profile) if (c >= LATE_CONTEXT_TOKENS) lateRead += c;
    out.push({
      id: 'compact-earlier',
      title: 'Compact or clear at task boundaries',
      detail:
        `${late.length} session(s) grew past ${LATE_CONTEXT_TOKENS / 1000}k tokens; calls made at that ` +
        `size account for ${Math.round((lateRead / total) * 100)}% of all re-read tokens.`,
      saved: 0,
    });
  }

  const baselineShare = analyses.reduce((t, a) => t + a.baselineRent, 0) / total;
  const avgBaseline = analyses.reduce((t, a) => t + a.baseline, 0) / analyses.length;
  if (avgBaseline >= BASELINE_WARN_TOKENS) {
    out.push({
      id: 'baseline',
      title: 'Shrink the fixed baseline',
      detail:
        `Every call starts with ~${Math.round(avgBaseline / 1000)}k tokens (system prompt, tool schemas, ` +
        `memory files) = ${Math.round(baselineShare * 100)}% of all re-read tokens. ` +
        'Check long CLAUDE.md files and rarely used MCP servers.',
      saved: 0,
    });
  }
  return out;
}
