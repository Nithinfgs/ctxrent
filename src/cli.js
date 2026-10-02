import { parseArgs } from 'node:util';
import { readFileSync, writeFileSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { parseSessionFile, parseSessionLines } from './parse.js';
import { discoverSessions } from './discover.js';
import { generateDemoTranscript } from './demo.js';
import { buildReport } from './report.js';
import { renderTerminal } from './render/terminal.js';
import { renderMarkdown } from './render/markdown.js';
import { renderHtml } from './render/html.js';
import { DEFAULT_CAP } from './advice.js';

const HELP = `ctxrent - see which tool outputs pay the most rent in your AI coding context window

Usage
  ctxrent [options] [transcript.jsonl ...]   analyze Claude Code sessions
  ctxrent demo [--write FILE]                run on a built-in synthetic session

With no files, ctxrent reads recent sessions from ~/.claude/projects (or $CLAUDE_CONFIG_DIR).
Everything runs locally; nothing is uploaded.

Options
  --last              only the newest session
  --project DIR       only sessions recorded in DIR (default: all projects)
  --since DAYS        only sessions modified in the last DAYS days (default: 14)
  --all               do not limit by date
  --limit N           at most N sessions (default: 50)
  --top N             rows per table (default: 8)
  --cap TOKENS        output cap used for the "what would have helped" estimate (default: ${DEFAULT_CAP})
  --price USD         price per million cache-read tokens, to show an approximate dollar figure
  --redact            hide paths, patterns and URLs so the report is safe to share
  --json              machine-readable report on stdout
  --md                markdown summary on stdout
  --html FILE         write a self-contained HTML report
  --no-color          disable colors (also honors NO_COLOR)
  -v, --version       print version
  -h, --help          show this help
`;

function readVersion() {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  return JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
}

/**
 * @param {string} name
 * @param {string|undefined} value
 * @param {number} fallback
 */
function intOption(name, value, fallback) {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0)
    throw new UsageError(`--${name} expects a positive number, got "${value}"`);
  return n;
}

class UsageError extends Error {}

/**
 * @param {string[]} argv
 * @param {{stdout?: {write(s: string): unknown, isTTY?: boolean, columns?: number}, stderr?: {write(s: string): unknown}}} [io]
 * @returns {Promise<number>} exit code
 */
export async function main(argv, io = {}) {
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        last: { type: 'boolean' },
        project: { type: 'string' },
        since: { type: 'string' },
        all: { type: 'boolean' },
        limit: { type: 'string' },
        top: { type: 'string' },
        cap: { type: 'string' },
        price: { type: 'string' },
        redact: { type: 'boolean' },
        json: { type: 'boolean' },
        md: { type: 'boolean' },
        html: { type: 'string' },
        write: { type: 'string' },
        'no-color': { type: 'boolean' },
        version: { type: 'boolean', short: 'v' },
        help: { type: 'boolean', short: 'h' },
      },
    });

    if (values.help) {
      stdout.write(HELP);
      return 0;
    }
    const version = readVersion();
    if (values.version) {
      stdout.write(`${version}\n`);
      return 0;
    }

    const isDemo = positionals[0] === 'demo';
    const top = intOption('top', values.top, 8);
    const cap = intOption('cap', values.cap, DEFAULT_CAP);
    const price = values.price === undefined ? undefined : intOption('price', values.price, 0);

    if (isDemo && values.write) {
      writeFileSync(values.write, `${generateDemoTranscript().join('\n')}\n`);
      stderr.write(`wrote synthetic transcript to ${values.write}\n`);
      return 0;
    }

    /** @type {import('./parse.js').Session[]} */
    let sessions;
    if (isDemo) {
      sessions = [parseSessionLines(generateDemoTranscript(), 'demo.jsonl')];
    } else if (positionals.length > 0) {
      const files = [];
      for (const p of positionals) {
        const info = await stat(p).catch(() => null);
        if (!info) throw new UsageError(`no such file: ${p}`);
        files.push(resolve(p));
      }
      sessions = await Promise.all(files.map(parseSessionFile));
    } else {
      const days = values.all ? 0 : intOption('since', values.since, 14);
      const found = await discoverSessions({
        project: values.project,
        sinceMs: days ? Date.now() - days * 86_400_000 : 0,
        limit: values.last ? 1 : intOption('limit', values.limit, 50),
      });
      if (found.length === 0) {
        stderr.write(
          'No Claude Code transcripts found.\n' +
            'Looked in ~/.claude/projects (or $CLAUDE_CONFIG_DIR/projects). Try `ctxrent --all`,\n' +
            'pass a .jsonl file directly, or run `ctxrent demo` to see a sample report.\n',
        );
        return 1;
      }
      sessions = await Promise.all(found.map((f) => parseSessionFile(f.file)));
    }

    const report = buildReport(sessions, { version, demo: isDemo, redact: values.redact, cap, top });
    if (report.sessions.length === 0) {
      stderr.write('Transcripts were found but contained no model calls with usage data.\n');
      return 1;
    }

    if (values.html) {
      writeFileSync(values.html, renderHtml(report, { top }));
      stderr.write(`wrote ${values.html}\n`);
    }
    if (values.json) {
      stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } else if (values.md) {
      stdout.write(renderMarkdown(report, { top }));
    } else {
      const color =
        !values['no-color'] &&
        !process.env.NO_COLOR &&
        (Boolean(stdout.isTTY) || Boolean(process.env.FORCE_COLOR));
      stdout.write(renderTerminal(report, { color, width: stdout.columns ?? 100, top, price }));
    }
    return 0;
  } catch (err) {
    if (
      err instanceof UsageError ||
      (err instanceof Error && 'code' in err && String(err.code).startsWith('ERR_PARSE_ARGS'))
    ) {
      stderr.write(`ctxrent: ${/** @type {Error} */ (err).message}\nRun \`ctxrent --help\` for usage.\n`);
      return 2;
    }
    stderr.write(`ctxrent: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }
}
