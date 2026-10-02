# Architecture

`ctxrent` is a small pipeline with no runtime dependencies. Each stage is a pure function over plain objects, so it is easy to test and to reuse as a library.

```
discover.js  ->  parse.js  ->  analyze.js  ->  report.js  ->  render/{terminal,markdown,html}.js
                                   |
                               advice.js
```

| File               | Responsibility                                                                            |
| ------------------ | ----------------------------------------------------------------------------------------- |
| `src/discover.js`  | Locate transcripts under `~/.claude/projects` (or `$CLAUDE_CONFIG_DIR`), newest first     |
| `src/parse.js`     | Stream a `.jsonl` file into a `Session`: calls, tool results, gaps                        |
| `src/analyze.js`   | Calibration, compaction detection, rent, duplicates, grouping                             |
| `src/signature.js` | Turn tool calls into labels (`Bash: npm test`, `Read: src/a.ts`) and redact them          |
| `src/advice.js`    | Rule-based suggestions, each backed by numbers from the analysis                          |
| `src/report.js`    | Combine sessions into one renderer-independent report object (this is the `--json` shape) |
| `src/render/*.js`  | Terminal, markdown and self-contained HTML output                                         |
| `src/demo.js`      | Deterministic synthetic transcript for `ctxrent demo` and tests                           |

## The model

**Calls.** An assistant message is written to the transcript once per content block with identical usage. Records sharing a `message.id` are merged into one call. Its context size is `input_tokens + cache_read_input_tokens + cache_creation_input_tokens`, which is what the model actually read.

**Gaps.** The text that arrives between call _i_ and call _i+1_ (tool results and user prompts) is the "gap" after call _i_. Harness-injected attachments larger than a small threshold are noted, because they add tokens we cannot see.

**Calibration.** For each gap with at least 3,000 characters and no image or compaction:

```
growth_i = ctx[i+1] - ctx[i] - output[i]
ratio_i  = chars_in_gap_i / growth_i
```

The session's chars-per-token is the median ratio (clamped to 1.5-6). Gaps without injected attachments are preferred; if there are fewer than five of those, all qualifying gaps are used. Fewer than five usable gaps means the default of 3.5 is used and the report says so.

**Compaction.** Call _i_ starts a new window if a compaction marker immediately precedes it, or if `ctx[i] < 0.6 * ctx[i-1]` and the previous context exceeded 20k tokens.

**Rent.** For a tool result that arrives after call _a_:

```
first   = a + 1
carried = (index of next compaction, or number of calls) - first    (0 if `first` itself starts a window)
rent    = tokens * carried
```

**Totals.** `totalRead = sum(ctx)`. The fixed baseline is `ctx[0] * calls`. Tool-output rent is the sum of all `rent`. The remainder is "messages, thinking & other". These are estimates and can overlap slightly when calibration is noisy; the remainder is clamped at zero.

**Duplicates.** Within one compaction window, a result is a duplicate if a previous result from the same tool had an identical content hash and more than 200 characters.

## Design choices

- **No LLM, no network.** Advice is deterministic so the same transcript always gives the same report, and nothing leaves the machine.
- **Honest approximations.** Anything estimated is labelled as such in the output.
- **Tolerant parsing.** Unknown record types and malformed lines are skipped and counted, never fatal.
- **Streaming.** Transcripts can be hundreds of MB; they are read line by line.
