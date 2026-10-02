import { analyzeSession, groupRent, summarize } from './analyze.js';
import { advise } from './advice.js';
import { redactLabel } from './signature.js';

/**
 * @typedef {object} Report
 * @property {string} version
 * @property {boolean} demo
 * @property {boolean} redacted
 * @property {ReturnType<typeof summarize>} summary
 * @property {import('./analyze.js').Analysis[]} sessions
 * @property {ReturnType<typeof groupRent>} byTool
 * @property {ReturnType<typeof groupRent>} bySignature
 * @property {(import('./analyze.js').RentResult & {session: string})[]} biggest
 * @property {import('./advice.js').Advice[]} advice
 * @property {{charsPerToken: number, calibratedSessions: number}} estimate
 */

/**
 * Build the full, renderer-independent report.
 * @param {import('./parse.js').Session[]} sessions
 * @param {{version: string, demo?: boolean, redact?: boolean, cap?: number, top?: number}} opts
 * @returns {Report}
 */
export function buildReport(sessions, opts) {
  const top = opts.top ?? 8;
  const analyses = sessions.map(analyzeSession).filter((a) => a.turns > 0);
  const label = (/** @type {string} */ l) => (opts.redact ? redactLabel(l) : l);

  const byTool = groupRent(analyses, (r) => r.name);
  const bySignature = groupRent(analyses, (r) => label(r.label)).map((g) => g);
  const biggest = analyses
    .flatMap((a) => a.results.map((r) => ({ ...r, label: label(r.label), session: a.id })))
    .sort((a, b) => b.rent - a.rent)
    .slice(0, top);

  const calibrated = analyses.filter((a) => a.calibrated);
  const charsPerToken = calibrated.length
    ? calibrated.reduce((t, a) => t + a.charsPerToken, 0) / calibrated.length
    : (analyses[0]?.charsPerToken ?? 0);

  if (opts.redact) {
    for (const a of analyses) {
      a.cwd = null;
      a.file = '(redacted)';
      a.results = a.results.map((r) => ({ ...r, label: label(r.label) }));
    }
  }

  return {
    version: opts.version,
    demo: Boolean(opts.demo),
    redacted: Boolean(opts.redact),
    summary: summarize(analyses),
    sessions: analyses,
    byTool,
    bySignature,
    biggest,
    advice: advise(analyses, { cap: opts.cap }),
    estimate: { charsPerToken, calibratedSessions: calibrated.length },
  };
}
