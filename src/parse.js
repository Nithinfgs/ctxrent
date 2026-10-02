import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { createHash } from 'node:crypto';
import { basename } from 'node:path';

// Tiny reminders (token counters, date stamps) are noise; big attachments distort calibration.
const ATTACHMENT_NOISE_CHARS = 600;

/**
 * A model call ("turn"): one assistant API message and the context it was sent.
 * @typedef {object} Turn
 * @property {number} index
 * @property {string} id
 * @property {string|null} ts
 * @property {number} ctx          Input tokens the model read: input + cache read + cache creation.
 * @property {number} output       Output tokens reported for the call.
 * @property {boolean} compactBefore  True when a compaction happened right before this call.
 */

/**
 * One tool output that was appended to the conversation.
 * @typedef {object} ToolResult
 * @property {string} toolUseId
 * @property {string} name
 * @property {Record<string, unknown>} input
 * @property {number} afterTurn    Index of the last turn before the result arrived (-1 if none).
 * @property {number} chars
 * @property {number} images
 * @property {boolean} isError
 * @property {string} hash         Content hash, used to spot byte-identical repeats.
 */

/**
 * @typedef {object} Session
 * @property {string} file
 * @property {string} id
 * @property {string|null} cwd
 * @property {string|null} model
 * @property {string|null} startedAt
 * @property {Turn[]} turns
 * @property {ToolResult[]} results
 * @property {Map<number, number>} gapChars  Non-tool text (user prompts) added after a turn.
 * @property {Set<number>} dirtyGaps  Gaps where the harness injected content we cannot measure.
 * @property {number} sidechainRecords
 * @property {number} badLines
 */

/** @param {unknown} content */
function flatten(content) {
  let text = '';
  let images = 0;
  if (typeof content === 'string') return { text: content, images };
  if (!Array.isArray(content)) return { text, images };
  for (const block of content) {
    if (typeof block === 'string') text += block;
    else if (block && block.type === 'text' && typeof block.text === 'string') text += block.text;
    else if (block && block.type === 'image') images += 1;
    else if (block) text += JSON.stringify(block);
  }
  return { text, images };
}

class SessionBuilder {
  /** @param {string} file */
  constructor(file) {
    /** @type {Session} */
    this.session = {
      file,
      id: basename(file).replace(/\.jsonl$/, ''),
      cwd: null,
      model: null,
      startedAt: null,
      turns: [],
      results: [],
      gapChars: new Map(),
      dirtyGaps: new Set(),
      sidechainRecords: 0,
      badLines: 0,
    };
    /** @type {Map<string, {name: string, input: Record<string, unknown>}>} */
    this.toolUses = new Map();
    /** @type {Map<string, Turn>} */
    this.turnsById = new Map();
    this.pendingCompact = false;
  }

  /** @param {string} line */
  push(line) {
    const trimmed = line.trim();
    if (!trimmed) return;
    let rec;
    try {
      rec = JSON.parse(trimmed);
    } catch {
      this.session.badLines += 1;
      return;
    }
    if (!rec || typeof rec !== 'object') return;
    // Sub-agents run in their own context window; their rent is not the main session's.
    if (rec.isSidechain) {
      this.session.sidechainRecords += 1;
      return;
    }
    const s = this.session;
    if (!s.cwd && typeof rec.cwd === 'string') s.cwd = rec.cwd;
    if (!s.startedAt && typeof rec.timestamp === 'string') s.startedAt = rec.timestamp;
    if (rec.type === 'assistant') this.assistant(rec);
    else if (rec.type === 'user') this.user(rec);
    else if (rec.type === 'attachment' && trimmed.length > ATTACHMENT_NOISE_CHARS)
      s.dirtyGaps.add(s.turns.length - 1);
    else if (rec.type === 'system' && rec.subtype === 'compact_boundary') this.pendingCompact = true;
  }

  /** @param {any} rec */
  assistant(rec) {
    const msg = rec.message;
    const usage = msg && msg.usage;
    if (!msg || !usage || msg.model === '<synthetic>') return;
    const s = this.session;
    const id = msg.id || rec.uuid;
    let turn = this.turnsById.get(id);
    if (!turn) {
      turn = {
        index: s.turns.length,
        id,
        ts: rec.timestamp || null,
        ctx: 0,
        output: 0,
        compactBefore: this.pendingCompact,
      };
      this.pendingCompact = false;
      this.turnsById.set(id, turn);
      s.turns.push(turn);
    }
    // One API message is written once per content block with the same usage; keep the latest.
    turn.ctx =
      (usage.input_tokens || 0) +
      (usage.cache_read_input_tokens || 0) +
      (usage.cache_creation_input_tokens || 0);
    turn.output = Math.max(turn.output, usage.output_tokens || 0);
    if (msg.model) s.model = msg.model;
    if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block && block.type === 'tool_use' && block.id) {
          this.toolUses.set(block.id, { name: block.name || 'unknown', input: block.input || {} });
        }
      }
    }
  }

  /** @param {any} rec */
  user(rec) {
    const s = this.session;
    if (rec.isCompactSummary) this.pendingCompact = true;
    const content = rec.message && rec.message.content;
    const afterTurn = s.turns.length - 1;
    if (typeof content === 'string') {
      this.addGap(afterTurn, content.length);
      return;
    }
    if (!Array.isArray(content)) return;
    for (const block of content) {
      if (!block) continue;
      if (block.type === 'tool_result') {
        const { text, images } = flatten(block.content);
        const use = this.toolUses.get(block.tool_use_id);
        s.results.push({
          toolUseId: block.tool_use_id,
          name: use ? use.name : 'unknown',
          input: use ? use.input : {},
          afterTurn,
          chars: text.length,
          images,
          isError: Boolean(block.is_error),
          hash: createHash('sha1').update(text).digest('hex').slice(0, 16),
        });
      } else if (block.type === 'text' && typeof block.text === 'string') {
        this.addGap(afterTurn, block.text.length);
      }
    }
  }

  /**
   * @param {number} afterTurn
   * @param {number} chars
   */
  addGap(afterTurn, chars) {
    const g = this.session.gapChars;
    g.set(afterTurn, (g.get(afterTurn) || 0) + chars);
  }
}

/**
 * Parse transcript lines already in memory (used by tests and the demo).
 * @param {Iterable<string>} lines
 * @param {string} [file]
 * @returns {Session}
 */
export function parseSessionLines(lines, file = '(memory).jsonl') {
  const builder = new SessionBuilder(file);
  for (const line of lines) builder.push(line);
  return builder.session;
}

/**
 * Stream-parse a Claude Code transcript (.jsonl) without loading it all into memory.
 * @param {string} file
 * @returns {Promise<Session>}
 */
export async function parseSessionFile(file) {
  const builder = new SessionBuilder(file);
  const rl = createInterface({
    input: createReadStream(file, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) builder.push(line);
  return builder.session;
}
