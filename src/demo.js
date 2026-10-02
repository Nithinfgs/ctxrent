/**
 * Generates a deterministic, synthetic Claude Code-style transcript so `ctxrent demo` works
 * with nothing installed. It is fabricated data modelled on a typical debugging session
 * (a noisy test runner, a huge file read twice, a broad grep, one compaction) and is
 * labelled as such everywhere it is shown.
 */

const TRUE_CHARS_PER_TOKEN = 3.6;
const BASELINE_TOKENS = 16_800;

/** @param {number} seed */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const WORDS = [
  'handler',
  'session',
  'token',
  'cache',
  'router',
  'schema',
  'retry',
  'queue',
  'state',
  'index',
];

/**
 * @param {() => number} rand
 * @param {number} chars
 * @param {string} kind
 */
function filler(rand, chars, kind) {
  const lines = [];
  let total = 0;
  let i = 0;
  while (total < chars) {
    const w = WORDS[Math.floor(rand() * WORDS.length)];
    const w2 = WORDS[Math.floor(rand() * WORDS.length)];
    i += 1;
    const line =
      kind === 'log'
        ? `  ✓ ${w}.${w2} handles case ${i} (${Math.floor(rand() * 90) + 1}ms)`
        : kind === 'grep'
          ? `src/${w}/${w2}.ts:${Math.floor(rand() * 400) + 1}:  const ${w}${i} = await ${w2}(ctx, opts);`
          : `export async function ${w}${i}(${w2}: ${w2[0].toUpperCase()}${w2.slice(1)}Options) { return ${w2}.run(${i}); }`;
    lines.push(line);
    total += line.length + 1;
  }
  return lines.join('\n').slice(0, chars);
}

/**
 * @returns {string[]} JSONL lines
 */
export function generateDemoTranscript() {
  const rand = rng(42);
  /** @type {string[]} */
  const lines = [];
  let ctx = BASELINE_TOKENS;
  let seq = 0;
  const t0 = Date.UTC(2026, 9, 1, 9, 0, 0);

  /**
   * @param {string} text
   */
  const tokensOf = (text) => Math.round(text.length / TRUE_CHARS_PER_TOKEN);

  /** @type {{name: string, input: Record<string, unknown>, kind: string, chars: number, reuse?: string}[]} */
  const plan = [];
  /** @param {string} name @param {Record<string, unknown>} input @param {string} kind @param {number} chars @param {string} [reuse] */
  const call = (name, input, kind, chars, reuse) =>
    plan.push({ name, input, kind, chars: Math.round(chars * 1.6), reuse });

  call('Grep', { pattern: 'refreshToken' }, 'grep', 21_000);
  call('Read', { file_path: '/work/api/src/auth/session.ts' }, 'code', 6_500);
  call('Bash', { command: 'npm test' }, 'log', 15_000, 'npm-test-fail');
  call('Read', { file_path: '/work/api/src/auth/refresh.ts' }, 'code', 4_200);
  call('Edit', { file_path: '/work/api/src/auth/refresh.ts' }, 'code', 300);
  call('Bash', { command: 'npm test' }, 'log', 15_000, 'npm-test-fail');
  call('Read', { file_path: '/work/api/src/db/schema.ts' }, 'code', 38_000, 'schema');
  call('Edit', { file_path: '/work/api/src/auth/session.ts' }, 'code', 300);
  call('Bash', { command: 'npm test' }, 'log', 15_000, 'npm-test-fail');
  call('Bash', { command: 'git diff' }, 'code', 17_000);
  call('Read', { file_path: '/work/api/src/db/schema.ts' }, 'code', 38_000, 'schema');
  call('WebFetch', { url: 'https://docs.example.com/oauth/refresh-tokens' }, 'code', 24_000);
  call('Edit', { file_path: '/work/api/src/auth/session.ts' }, 'code', 300);
  call('Bash', { command: 'npm test' }, 'log', 15_000);
  call('Read', { file_path: '/work/api/src/auth/session.ts' }, 'code', 6_800);
  call('Bash', { command: 'git status --short' }, 'code', 600);
  call('Bash', { command: 'npm run lint' }, 'log', 9_000);
  call('Edit', { file_path: '/work/api/src/auth/refresh.ts' }, 'code', 300);
  call('Bash', { command: 'npm test' }, 'log', 15_000);
  call('Grep', { pattern: 'SessionStore' }, 'grep', 12_000);
  call('Bash', { command: 'git diff' }, 'code', 21_000);
  call('Bash', { command: 'npm test' }, 'log', 15_000);

  const reuseCache = new Map();
  const stepsPerCall = 3;
  const total = plan.length * stepsPerCall;
  const compactAt = Math.floor(total * 0.62);

  /** @param {Record<string, unknown>} rec */
  const emit = (rec) => lines.push(JSON.stringify({ cwd: '/work/api', sessionId: 'demo', ...rec }));
  const stamp = () => new Date(t0 + seq * 21_000).toISOString();

  emit({
    type: 'user',
    timestamp: stamp(),
    message: { role: 'user', content: 'Refresh tokens expire too early, fix the auth flow.' },
  });

  let turnNo = 0;
  for (const step of plan) {
    for (let k = 0; k < stepsPerCall; k++) {
      turnNo += 1;
      seq += 1;
      const isCall = k === 0;
      const outputTokens = isCall ? 90 : 160;
      const compacted = turnNo === compactAt;
      if (compacted) ctx = BASELINE_TOKENS + 5200;
      const id = `msg_demo_${turnNo}`;
      const toolId = `toolu_demo_${turnNo}`;
      const content = isCall
        ? [{ type: 'tool_use', id: toolId, name: step.name, input: step.input }]
        : [{ type: 'text', text: 'Looking at the result and deciding what to do next.' }];
      const usage = {
        input_tokens: 3,
        cache_read_input_tokens: Math.max(0, ctx - 400),
        cache_creation_input_tokens: 397,
        output_tokens: outputTokens,
      };
      if (compacted) emit({ type: 'system', subtype: 'compact_boundary', timestamp: stamp() });
      emit({
        type: 'assistant',
        uuid: `a${turnNo}`,
        timestamp: stamp(),
        message: { id, model: 'claude-demo', role: 'assistant', content, usage },
      });
      ctx += outputTokens;
      if (isCall) {
        let text = step.reuse && reuseCache.get(step.reuse);
        if (!text) {
          text = filler(rand, step.chars, step.kind);
          if (step.reuse) reuseCache.set(step.reuse, text);
        }
        emit({
          type: 'user',
          uuid: `u${turnNo}`,
          timestamp: stamp(),
          message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolId, content: text }] },
        });
        ctx += tokensOf(text);
      }
    }
  }
  return lines;
}
