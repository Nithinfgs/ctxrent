# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-10-03

### Added

- Rent analysis of Claude Code transcripts: output size x model calls that re-read it.
- Compaction detection from markers or a sharp context drop.
- Chars-per-token calibration fitted from API-reported usage.
- Duplicate-output detection and rule-based advice (output cap, duplicates, late compaction, baseline).
- Terminal, `--md`, `--json` and self-contained `--html` output; `--redact` for sharing.
- `ctxrent demo` with a deterministic synthetic session.

[0.1.0]: https://github.com/Nithinfgs/ctxrent/releases/tag/v0.1.0
