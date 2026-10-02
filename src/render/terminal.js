import { bar, fit, fmtTokens, palette, pct, sparkline } from '../format.js';

/**
 * @param {import('../report.js').Report} report
 * @param {{color?: boolean, width?: number, top?: number, price?: number}} [opts]
 */
export function renderTerminal(report, opts = {}) {
  const c = palette(opts.color ?? false);
  const width = Math.max(60, Math.min(opts.width ?? 100, 110));
  const top = opts.top ?? 8;
  const s = report.summary;
  /** @type {string[]} */
  const out = [];
  const push = (/** @type {string} */ line = '') => out.push(line);

  const scope = s.sessions === 1 ? '1 session' : `${s.sessions} sessions`;
  push(
    `${c.bold('ctxrent')}  ${c.dim('·')}  ${scope} ${c.dim('·')} ${s.turns} model calls ${c.dim('·')} ` +
      `${c.bold(fmtTokens(s.totalRead))} tokens re-read`,
  );
  if (report.demo) push(c.yellow('synthetic demo session - fabricated to show the report, not your data'));
  push();

  // 1. where the re-read tokens came from
  push(c.bold('Where the re-read tokens came from'));
  const rows = [
    ['tool outputs', s.toolRent, c.red],
    ['fixed baseline (prompt, tools, memory)', s.baselineRent, c.cyan],
    ['messages, thinking & other', s.conversationRent, c.magenta],
  ];
  const denom = Math.max(s.totalRead, s.toolRent + s.baselineRent + s.conversationRent, 1);
  for (const [name, value, color] of /** @type {[string, number, (s: string) => string][]} */ (rows)) {
    push(
      `  ${fit(name, 38)} ${color(bar(value / denom, 24))} ${pct(value, denom).padStart(4)}  ${c.dim(fmtTokens(value))}`,
    );
  }
  push();

  // 2. context profile (single session)
  if (report.sessions.length === 1) {
    const a = report.sessions[0];
    const compaction = a.compactions.length
      ? ` · ${a.compactions.length} compaction${a.compactions.length > 1 ? 's' : ''}`
      : '';
    push(`${c.bold('Context size per call')}  ${c.dim(`peak ${fmtTokens(a.peakCtx)}${compaction}`)}`);
    push(`  ${c.cyan(sparkline(a.profile, Math.min(width - 4, a.profile.length)))}`);
    push();
  }

  // 3. who pays the rent
  push(c.bold('Who pays the rent') + c.dim('   (output size x calls that re-read it)'));
  const rentTotal = Math.max(s.toolRent, 1);
  push(
    c.dim(
      `  ${fit('', 30)} ${'calls'.padStart(5)}  ${'size'.padStart(6)}  ${'rent'.padStart(7)}  share of tool rent`,
    ),
  );
  for (const g of report.bySignature.slice(0, top)) {
    push(
      `  ${fit(g.key, 30)} ${String(g.calls).padStart(5)}  ${fmtTokens(g.tokens).padStart(6)}  ` +
        `${c.bold(fmtTokens(g.rent).padStart(7))}  ${c.red(bar(g.rent / rentTotal, 14))} ${pct(g.rent, rentTotal)}`,
    );
  }
  push();

  // 4. biggest single outputs
  push(c.bold('Most expensive single outputs'));
  push(c.dim(`  ${fit('', 30)} ${'size'.padStart(6)}  ${'x calls'.padStart(7)}  ${'= rent'.padStart(7)}`));
  for (const r of report.biggest.slice(0, 5)) {
    const dup = r.duplicate ? c.yellow('  duplicate') : '';
    push(
      `  ${fit(r.label, 30)} ${fmtTokens(r.tokens).padStart(6)}  ${String(r.carried).padStart(7)}  ${c.bold(fmtTokens(r.rent).padStart(7))}${dup}`,
    );
  }
  push();

  // 5. advice
  if (report.advice.length > 0) {
    push(c.bold('What would have helped'));
    for (const a of report.advice) {
      push(`  ${c.green('•')} ${c.bold(a.title)}`);
      for (const line of wrap(a.detail, width - 6)) push(`    ${line}`);
    }
    push();
  }

  if (opts.price) {
    const dollars = (s.toolRent / 1e6) * opts.price;
    push(
      c.dim(
        `Tool-output rent at $${opts.price}/M tokens: ≈ $${dollars.toFixed(2)} (you supply the price; cache-read rates vary by model).`,
      ),
    );
  }
  const est = report.estimate;
  push(
    c.dim(
      est.calibratedSessions > 0
        ? `Sizes are estimates: ${est.charsPerToken.toFixed(1)} chars/token, fitted from API-reported usage in ${est.calibratedSessions}/${s.sessions} session(s).`
        : 'Sizes are estimates at 3.5 chars/token (too little usage data to calibrate).',
    ),
  );
  return out.join('\n') + '\n';
}

/**
 * @param {string} text
 * @param {number} width
 */
function wrap(text, width) {
  const lines = [];
  let line = '';
  for (const word of text.split(' ')) {
    if (line && line.length + word.length + 1 > width) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines;
}
