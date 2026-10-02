import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../src/cli.js';
import { commandKey, signature, redactLabel } from '../src/signature.js';
import { discoverSessions, encodeProjectDir } from '../src/discover.js';
import { generateDemoTranscript } from '../src/demo.js';
import { transcript } from './helpers.js';

/**
 * Run the CLI with captured output.
 * @param {string[]} args
 */
async function run(args) {
  let out = '';
  let err = '';
  const code = await main(args, {
    stdout: { write: (s) => (out += s) },
    stderr: { write: (s) => (err += s) },
  });
  return { code, out, err };
}

test('demo prints a labelled synthetic report', async () => {
  const { code, out } = await run(['demo', '--no-color']);
  assert.equal(code, 0);
  assert.match(out, /synthetic demo session/);
  assert.match(out, /Who pays the rent/);
  assert.match(out, /Bash: npm test/);
  assert.match(out, /1 compaction/);
});

test('demo output is deterministic', async () => {
  const a = await run(['demo', '--no-color']);
  const b = await run(['demo', '--no-color']);
  assert.equal(a.out, b.out);
  assert.deepEqual(generateDemoTranscript(), generateDemoTranscript());
});

test('--json emits a parseable report', async () => {
  const { out } = await run(['demo', '--json']);
  const report = JSON.parse(out);
  assert.equal(report.demo, true);
  assert.ok(report.summary.toolRent > 0);
  assert.ok(report.bySignature.length > 0);
});

test('--md emits tables and --html writes a self-contained file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ctxrent-'));
  try {
    const md = await run(['demo', '--md']);
    assert.match(md.out, /\| tool call \| calls \|/);
    const file = join(dir, 'r.html');
    const html = await run(['demo', '--html', file, '--no-color']);
    assert.equal(html.code, 0);
    const { readFile } = await import('node:fs/promises');
    const text = await readFile(file, 'utf8');
    assert.match(text, /<!doctype html>/);
    assert.doesNotMatch(text, /<script|https?:\/\/(?!www\.w3\.org)/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('analyzes a transcript file given on the command line', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ctxrent-'));
  try {
    const t = transcript();
    t.turn().result('x'.repeat(5000));
    t.turn();
    const file = join(dir, 's.jsonl');
    await writeFile(file, t.lines.join('\n'));
    const { code, out } = await run([file, '--no-color']);
    assert.equal(code, 0);
    assert.match(out, /1 session/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('--redact hides file paths and patterns', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ctxrent-'));
  try {
    const t = transcript();
    t.turn({ name: 'Read', input: { file_path: '/secret/client-acme/keys.ts' } }).result('x'.repeat(5000));
    t.turn();
    const file = join(dir, 's.jsonl');
    await writeFile(file, t.lines.join('\n'));
    const { out } = await run([file, '--redact', '--json']);
    assert.doesNotMatch(out, /client-acme|secret/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('usage errors exit 2, missing input exits 1', async () => {
  assert.equal((await run(['--bogus'])).code, 2);
  assert.equal((await run(['--top', 'abc', 'demo'])).code, 2);
  const missing = await run(['/definitely/not/here.jsonl']);
  assert.equal(missing.code, 2);
  assert.match(missing.err, /no such file/);
});

test('--help and --version', async () => {
  assert.match((await run(['--help'])).out, /Usage/);
  assert.match((await run(['--version'])).out, /^\d+\.\d+\.\d+/);
});

test('discoverSessions finds newest-first and skips sub-agent folders', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ctxrent-'));
  try {
    const proj = join(root, encodeProjectDir('/work/api'));
    await mkdir(join(proj, 'subagents'), { recursive: true });
    await writeFile(join(proj, 'a.jsonl'), '{}\n');
    await writeFile(join(proj, 'subagents', 'b.jsonl'), '{}\n');
    await writeFile(join(proj, 'empty.jsonl'), '');
    const all = await discoverSessions({ root });
    assert.deepEqual(
      all.map((f) => f.file),
      [join(proj, 'a.jsonl')],
    );
    assert.equal((await discoverSessions({ root, project: '/work/other' })).length, 0);
    assert.equal((await discoverSessions({ root, project: '/work/api' })).length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('commandKey reduces commands to what kind of command they are', () => {
  assert.equal(commandKey('npm test -- --watch | tail -n 5'), 'npm test');
  assert.equal(commandKey('cd app && FOO=1 npm run build'), 'npm run build');
  assert.equal(commandKey('cd "/with space/app"\ngit diff --stat'), 'git diff');
  assert.equal(commandKey('pytest -x tests/'), 'pytest');
  assert.equal(commandKey('"/usr/local/bin/tool" --flag'), 'tool');
  assert.equal(commandKey(undefined), '(unknown)');
});

test('signature shortens paths relative to the project and redaction hides details', () => {
  assert.equal(signature('Read', { file_path: '/work/api/src/a.ts' }, '/work/api'), 'Read: src/a.ts');
  assert.equal(
    signature('WebFetch', { url: 'https://docs.example.com/x/y' }, null),
    'WebFetch: docs.example.com',
  );
  assert.equal(signature('mcp__x__y', {}, null), 'mcp__x__y');
  assert.equal(redactLabel('Bash: npm run build'), 'Bash: npm');
  assert.match(redactLabel('Read: src/secret.ts'), /^Read: #[0-9a-f]{6}$/);
  assert.equal(redactLabel('mcp__x__y'), 'mcp__x__y');
});
