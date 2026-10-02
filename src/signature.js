import { relative, isAbsolute } from 'node:path';

const SUBCOMMAND_TOOLS = new Set([
  'git', 'npm', 'pnpm', 'yarn', 'bun', 'npx', 'go', 'cargo', 'docker', 'kubectl', 'gh',
  'make', 'pip', 'uv', 'poetry', 'dotnet', 'gradle', 'mvn', 'terraform', 'brew',
]); // prettier-ignore

/**
 * Reduce a shell command to the part that identifies "what kind of command" it was.
 * `cd app && FOO=1 npm run test -- --watch | tail` becomes `npm run test`.
 * @param {unknown} command
 */
export function commandKey(command) {
  if (typeof command !== 'string') return '(unknown)';
  let line = command.trim().replace(/^(?:cd\s+(?:"[^"]*"|'[^']*'|\S+)\s*(?:&&|;|\n)\s*)+/, '');
  line = line.split('\n')[0] ?? '';
  const tokens = line.split(/\s+/).filter(Boolean);
  while (tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[0])) tokens.shift();
  if (tokens[0] && /^["']?\//.test(tokens[0]))
    tokens[0] =
      tokens[0]
        .replace(/^["']|["']$/g, '')
        .split('/')
        .pop() || tokens[0];
  const out = [];
  for (const tok of tokens) {
    if (/^(\||&&|;|>|>>|2>)/.test(tok)) break;
    if (out.length > 0 && tok.startsWith('-')) break;
    out.push(tok);
    const limit = out[0] && SUBCOMMAND_TOOLS.has(out[0]) ? (out[1] === 'run' ? 3 : 2) : 1;
    if (out.length >= limit) break;
  }
  return out.join(' ') || '(empty)';
}

/**
 * @param {unknown} filePath
 * @param {string|null} cwd
 */
function shortPath(filePath, cwd) {
  if (typeof filePath !== 'string') return '(unknown)';
  if (cwd && isAbsolute(filePath)) {
    const rel = relative(cwd, filePath);
    if (rel && !rel.startsWith('..')) return rel;
  }
  return filePath;
}

/**
 * A short, human-readable label that groups similar tool calls.
 * @param {string} name
 * @param {Record<string, unknown>} input
 * @param {string|null} cwd
 */
export function signature(name, input, cwd) {
  switch (name) {
    case 'Bash':
      return `Bash: ${commandKey(input.command)}`;
    case 'Read':
    case 'Write':
    case 'Edit':
      return `${name}: ${shortPath(input.file_path, cwd)}`;
    case 'Grep':
      return `Grep: ${String(input.pattern ?? '')}`.slice(0, 60);
    case 'Glob':
      return `Glob: ${String(input.pattern ?? '')}`.slice(0, 60);
    case 'WebFetch': {
      try {
        return `WebFetch: ${new URL(String(input.url)).host}`;
      } catch {
        return 'WebFetch';
      }
    }
    default:
      return name;
  }
}

/**
 * Hide anything that could identify a project or file; keeps the tool and program name.
 * @param {string} label
 */
export function redactLabel(label) {
  const i = label.indexOf(': ');
  if (i === -1) return label;
  const tool = label.slice(0, i);
  const detail = label.slice(i + 2);
  if (tool === 'Bash') return `Bash: ${detail.split(' ')[0]}`;
  let h = 0;
  for (const ch of detail) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `${tool}: #${h.toString(16).padStart(8, '0').slice(0, 6)}`;
}
