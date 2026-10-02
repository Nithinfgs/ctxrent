const SPARK = '▁▂▃▄▅▆▇█';

/** @param {number} n */
export function fmtTokens(n) {
  if (n < 1000) return String(Math.round(n));
  if (n < 10_000) return `${(n / 1000).toFixed(1)}k`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  if (n < 10_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  return `${Math.round(n / 1_000_000)}M`;
}

/**
 * @param {number} part
 * @param {number} whole
 */
export function pct(part, whole) {
  if (whole <= 0) return '0%';
  const p = (part / whole) * 100;
  return p > 0 && p < 1 ? '<1%' : `${Math.round(p)}%`;
}

/**
 * @param {number} fraction 0..1
 * @param {number} width
 */
export function bar(fraction, width) {
  const f = Math.max(0, Math.min(1, fraction));
  const eighths = Math.round(f * width * 8);
  const full = Math.floor(eighths / 8);
  const partial = eighths % 8;
  const blocks = ' ▏▎▍▌▋▊▉';
  return (
    '█'.repeat(full) +
    (partial ? blocks[partial] : '') +
    ' '.repeat(Math.max(0, width - full - (partial ? 1 : 0)))
  );
}

/**
 * @param {number[]} values
 * @param {number} width
 */
export function sparkline(values, width) {
  if (values.length === 0) return '';
  const buckets = Math.min(width, values.length);
  const out = [];
  const max = Math.max(...values, 1);
  for (let b = 0; b < buckets; b++) {
    const from = Math.floor((b * values.length) / buckets);
    const to = Math.max(from + 1, Math.floor(((b + 1) * values.length) / buckets));
    const peak = Math.max(...values.slice(from, to));
    out.push(SPARK[Math.min(SPARK.length - 1, Math.floor((peak / max) * (SPARK.length - 1) + 0.5))]);
  }
  return out.join('');
}

/**
 * Left-justify, truncating with an ellipsis.
 * @param {string} s
 * @param {number} width
 */
export function fit(s, width) {
  if (s.length <= width) return s.padEnd(width);
  return `${s.slice(0, Math.max(0, width - 1))}…`;
}

/** @param {boolean} enabled */
export function palette(enabled) {
  /** @param {string} open */
  const wrap = (open) => (/** @type {string} */ s) => (enabled ? `\x1b[${open}m${s}\x1b[0m` : s);
  return {
    bold: wrap('1'),
    dim: wrap('2'),
    red: wrap('31'),
    green: wrap('32'),
    yellow: wrap('33'),
    cyan: wrap('36'),
    magenta: wrap('35'),
  };
}
