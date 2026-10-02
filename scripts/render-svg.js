// Renders `ctxrent demo` into docs/assets/demo.svg so the README image is always real output.
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSessionLines } from '../src/parse.js';
import { generateDemoTranscript } from '../src/demo.js';
import { buildReport } from '../src/report.js';
import { renderTerminal } from '../src/render/terminal.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;

const COLORS = /** @type {Record<string, string>} */ ({
  31: '#ff7b72',
  32: '#7ee787',
  33: '#e3b341',
  35: '#d2a8ff',
  36: '#79c0ff',
});
const ESC = String.fromCharCode(27);
const SGR_SPLIT = new RegExp(`(${ESC}\\[[0-9;]*m)`);
const SGR_ONE = new RegExp(`^${ESC}\\[([0-9;]*)m$`);
const SGR_ALL = new RegExp(`${ESC}\\[[0-9;]*m`, 'g');
const FG = '#e6edf3';
const COL_W = 8.4;
const ROW_H = 20;
const PAD_X = 20;
const TOP = 52;

/** @param {string} s */
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Convert one line of ANSI-colored text to SVG <tspan>s.
 * @param {string} line
 */
function spans(line) {
  let bold = false;
  let dim = false;
  let color = FG;
  let out = '';
  for (const part of line.split(SGR_SPLIT)) {
    const m = SGR_ONE.exec(part);
    if (m) {
      const code = Number(m[1] || 0);
      if (code === 0) [bold, dim, color] = [false, false, FG];
      else if (code === 1) bold = true;
      else if (code === 2) dim = true;
      else if (COLORS[code]) color = COLORS[code];
      continue;
    }
    if (!part) continue;
    const attrs = [`fill="${dim ? '#8b949e' : color}"`];
    if (bold) attrs.push('font-weight="700"');
    out += `<tspan ${attrs.join(' ')}>${esc(part)}</tspan>`;
  }
  return out;
}

const session = parseSessionLines(generateDemoTranscript(), 'demo.jsonl');
const report = buildReport([session], { version, demo: true });
const text = renderTerminal(report, { color: true, width: 100 });
const lines = text.replace(/\n$/, '').split('\n');
const visible = (/** @type {string} */ l) => l.replace(SGR_ALL, '').length;
const cols = Math.max(...lines.map(visible));
const width = Math.ceil(cols * COL_W + PAD_X * 2);
const height = TOP + lines.length * ROW_H + 20;

const body = lines
  .map((l, i) => `<text x="${PAD_X}" y="${TOP + i * ROW_H}" xml:space="preserve">${spans(l)}</text>`)
  .join('\n');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="ctxrent demo output: tool outputs account for about half of all tokens the model re-read">
<rect width="${width}" height="${height}" rx="10" fill="#0d1117"/>
<rect width="${width}" height="32" rx="10" fill="#161b22"/>
<rect y="22" width="${width}" height="10" fill="#161b22"/>
<circle cx="20" cy="16" r="6" fill="#ff5f56"/><circle cx="40" cy="16" r="6" fill="#ffbd2e"/><circle cx="60" cy="16" r="6" fill="#27c93f"/>
<text x="${width / 2}" y="21" fill="#8b949e" font-family="system-ui, sans-serif" font-size="12" text-anchor="middle">npx ctxrent demo</text>
<g font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, 'DejaVu Sans Mono', monospace" font-size="14">
${body}
</g>
</svg>
`;

const outDir = join(root, 'docs', 'assets');
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'demo.svg'), svg);
console.log(`wrote docs/assets/demo.svg (${(svg.length / 1024).toFixed(1)} KB, ${lines.length} lines)`);
