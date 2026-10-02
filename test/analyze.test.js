import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSessionLines } from '../src/parse.js';
import { analyzeSession, capSavings, groupRent } from '../src/analyze.js';
import { advise } from '../src/advice.js';
import { transcript } from './helpers.js';

/** @param {number} n */
const blob = (n) => 'x'.repeat(n);

test('rent = tokens x number of later calls that re-read the output', () => {
  const t = transcript({ charsPerToken: 4 });
  t.turn().result(blob(8000)); // 2000 tokens, read by the 4 calls that follow
  t.turn();
  t.turn();
  t.turn();
  const a = analyzeSession(parseSessionLines(t.lines));
  assert.equal(a.turns, 4);
  const r = a.results[0];
  assert.equal(r.carried, 3);
  assert.equal(r.tokens, Math.round(8000 / a.charsPerToken));
  assert.equal(r.rent, r.tokens * 3);
});

test('an output that arrives after the last call is never re-read', () => {
  const t = transcript();
  t.turn().result(blob(4000));
  const a = analyzeSession(parseSessionLines(t.lines));
  assert.equal(a.results[0].carried, 0);
  assert.equal(a.results[0].rent, 0);
});

test('compaction ends the rent window', () => {
  const t = transcript();
  t.turn().result(blob(40_000));
  t.turn();
  t.turn();
  t.turn({ compact: true });
  t.turn();
  const a = analyzeSession(parseSessionLines(t.lines));
  assert.deepEqual(a.compactions, [3]);
  assert.equal(a.results[0].carried, 2); // calls 1 and 2, not the post-compaction ones
});

test('a sharp context drop is detected as compaction even without a marker', () => {
  const t = transcript({ baseline: 10_000 });
  t.turn().result(blob(400_000)); // ~100k tokens
  t.turn();
  t.turn();
  const lines = [...t.lines];
  const last = JSON.parse(lines[lines.length - 1]);
  last.message.usage.cache_read_input_tokens = 12_000;
  lines[lines.length - 1] = JSON.stringify(last);
  const a = analyzeSession(parseSessionLines(lines));
  assert.deepEqual(a.compactions, [2]);
  assert.equal(a.results[0].carried, 1);
});

test('byte-identical repeats inside one window are flagged as duplicates', () => {
  const t = transcript();
  const same = blob(2000);
  t.turn().result(same);
  t.turn().result(same);
  t.turn().result(blob(2000) + 'different');
  t.turn();
  const a = analyzeSession(parseSessionLines(t.lines));
  assert.deepEqual(
    a.results.map((r) => r.duplicate),
    [false, true, false],
  );
  assert.equal(a.duplicateRent, a.results[1].rent);
});

test('calibration recovers the real chars-per-token ratio from reported usage', () => {
  const t = transcript({ charsPerToken: 3 });
  for (let i = 0; i < 12; i++) t.turn().result(blob(6000 + i * 100));
  t.turn();
  const a = analyzeSession(parseSessionLines(t.lines));
  assert.equal(a.calibrated, true);
  assert.ok(Math.abs(a.charsPerToken - 3) < 0.1, `got ${a.charsPerToken}`);
});

test('sidechain (sub-agent) records do not affect the main session', () => {
  const t = transcript();
  t.turn().result(blob(1000));
  const lines = [
    ...t.lines,
    JSON.stringify({
      isSidechain: true,
      type: 'assistant',
      message: { id: 'x', usage: { input_tokens: 9 } },
    }),
  ];
  const s = parseSessionLines(lines);
  assert.equal(s.turns.length, 1);
  assert.equal(s.sidechainRecords, 1);
});

test('one API message split across several records is a single turn', () => {
  /** @param {object[]} content */
  const rec = (content) =>
    JSON.stringify({
      type: 'assistant',
      message: {
        id: 'm1',
        content,
        usage: { input_tokens: 1, cache_read_input_tokens: 99, output_tokens: 10 },
      },
    });
  const s = parseSessionLines([
    rec([{ type: 'text', text: 'a' }]),
    rec([{ type: 'tool_use', id: 't1', name: 'Read', input: {} }]),
  ]);
  assert.equal(s.turns.length, 1);
  assert.equal(s.turns[0].ctx, 100);
});

test('malformed lines are counted, not fatal', () => {
  const s = parseSessionLines(['{nope', '', '   ', JSON.stringify({ type: 'summary' })]);
  assert.equal(s.badLines, 1);
  assert.equal(s.turns.length, 0);
});

test('groupRent and capSavings aggregate across sessions', () => {
  const mk = () => {
    const t = transcript();
    t.turn({ input: { command: 'npm test' } }).result(blob(40_000));
    t.turn();
    t.turn();
    return analyzeSession(parseSessionLines(t.lines));
  };
  const analyses = [mk(), mk()];
  const groups = groupRent(analyses, (r) => r.label);
  assert.equal(groups[0].key, 'Bash: npm test');
  assert.equal(groups[0].calls, 2);
  const { saved, affected } = capSavings(analyses, 1000);
  assert.equal(affected, 2);
  assert.equal(saved, 2 * (analyses[0].results[0].tokens - 1000) * 2);
});

test('advice is empty for a lean session and mentions the worst offender for a bloated one', () => {
  const lean = transcript();
  lean.turn().result('ok');
  lean.turn();
  assert.deepEqual(advise([analyzeSession(parseSessionLines(lean.lines))]), []);

  const bloated = transcript();
  bloated.turn({ input: { command: 'npm test' } }).result(blob(60_000));
  for (let i = 0; i < 8; i++) bloated.turn();
  const advice = advise([analyzeSession(parseSessionLines(bloated.lines))]);
  const cap = advice.find((a) => a.id === 'cap-outputs');
  assert.ok(cap);
  assert.match(cap.detail, /Bash: npm test/);
});
