# Security

`ctxrent` runs locally, reads transcript files you point it at, and makes no network requests. It writes files only when you pass `--html` or `demo --write`.

## Reporting a vulnerability

Please use GitHub's [private vulnerability reporting](https://github.com/Nithinfgs/ctxrent/security/advisories/new) rather than a public issue. Expect an acknowledgement within a few days.

## Things worth knowing

- Transcripts contain your prompts, code and tool output. `ctxrent` never prints file contents; it prints command names (and file paths/patterns unless you use `--redact`). Review output before posting it publicly, and prefer `--redact`.
- The HTML report escapes all transcript-derived text and contains no scripts or external requests.
