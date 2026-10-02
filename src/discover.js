import { readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

/** Where Claude Code keeps transcripts. Honors CLAUDE_CONFIG_DIR. */
export function projectsDir() {
  const base = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
  return join(base, 'projects');
}

/**
 * Claude Code names a project's folder after its path with every non-alphanumeric char as "-".
 * @param {string} path
 */
export function encodeProjectDir(path) {
  return resolve(path).replace(/[^A-Za-z0-9]/g, '-');
}

/**
 * @param {string} dir
 * @returns {Promise<string[]>}
 */
async function listJsonl(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.filter((e) => e.isFile() && e.name.endsWith('.jsonl')).map((e) => join(dir, e.name));
}

/**
 * Find session transcripts, newest first. Sub-agent transcripts (nested folders) are skipped.
 * @param {{root?: string, project?: string, sinceMs?: number, limit?: number}} [opts]
 * @returns {Promise<{file: string, mtimeMs: number}[]>}
 */
export async function discoverSessions(opts = {}) {
  const root = opts.root ?? projectsDir();
  let dirs;
  if (opts.project) {
    dirs = [join(root, encodeProjectDir(opts.project))];
  } else {
    try {
      const entries = await readdir(root, { withFileTypes: true });
      dirs = entries.filter((e) => e.isDirectory()).map((e) => join(root, e.name));
    } catch {
      return [];
    }
  }
  const found = [];
  for (const dir of dirs) {
    for (const file of await listJsonl(dir)) {
      const { mtimeMs, size } = await stat(file);
      if (size === 0) continue;
      if (opts.sinceMs && mtimeMs < opts.sinceMs) continue;
      found.push({ file, mtimeMs });
    }
  }
  found.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return opts.limit ? found.slice(0, opts.limit) : found;
}
