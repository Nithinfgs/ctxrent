# Contributing

Thanks for helping. This is a small project; the bar for a good contribution is "it has a test and the README stays honest".

## Setup

```bash
git clone https://github.com/Nithinfgs/ctxrent && cd ctxrent
npm install
npm run check      # lint + typecheck + format check + tests
node bin/ctxrent.js demo
```

Node 22+ is required. There are no runtime dependencies; please don't add any without discussing it in an issue first. Types are checked from JSDoc (`npm run typecheck`).

## Good first contributions

- **Transcript samples from other agents** (Codex CLI, Gemini CLI, OpenCode). Redact them first: replace all text content with filler of the same length, keep `usage` numbers and structure.
- A parser for another agent's format that produces the same `Session` shape (see `src/parse.js`).
- Better command labels in `src/signature.js` for tools you use.
- Bug reports with a redacted `ctxrent --json` output.

## Guidelines

- Add a test for behavior changes (`test/`, uses `node:test`). The helper in `test/helpers.js` builds transcripts with realistic usage numbers.
- Keep output claims verifiable. If you add a number to a report, it must be derivable from the transcript.
- Never commit real transcripts, they contain your code and prompts.
- Run `npm run build:assets` if you change the terminal report so `docs/assets/demo.svg` stays in sync.
- Commit messages: `feat:`, `fix:`, `docs:`, `test:`, `chore:`, `ci:`.

By contributing you agree your work is released under the MIT license.
