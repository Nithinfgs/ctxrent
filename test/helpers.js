/**
 * Tiny transcript builder for tests. Each call to `turn()` is one model call; `result()` adds a
 * tool output that arrives after the most recent call. Context size is derived the way the real
 * API reports it, so the analysis sees realistic usage numbers.
 */
export function transcript({ charsPerToken = 4, baseline = 10_000 } = {}) {
  /** @type {string[]} */
  const lines = [];
  let ctx = baseline;
  let n = 0;
  /** @type {string|null} */
  let pendingTool = null;
  /** @param {object} rec */
  const emit = (rec) => lines.push(JSON.stringify(rec));
  const api = {
    lines,
    /** @param {{name?: string, input?: object, output?: number, compact?: boolean}} [o] */
    turn({ name = 'Bash', input = { command: 'echo' }, output = 100, compact = false } = {}) {
      n += 1;
      if (compact) {
        emit({ type: 'system', subtype: 'compact_boundary' });
        ctx = baseline + 3000;
      }
      pendingTool = `tool_${n}`;
      emit({
        type: 'assistant',
        message: {
          id: `msg_${n}`,
          role: 'assistant',
          content: [{ type: 'tool_use', id: pendingTool, name, input }],
          usage: {
            input_tokens: 5,
            cache_read_input_tokens: ctx - 5,
            cache_creation_input_tokens: 0,
            output_tokens: output,
          },
        },
      });
      ctx += output;
      return api;
    },
    /** @param {string} text */
    result(text) {
      emit({
        type: 'user',
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: pendingTool, content: text }],
        },
      });
      ctx += Math.round(text.length / charsPerToken);
      return api;
    },
  };
  return api;
}
