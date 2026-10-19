## 2026-10-19 — Bake-off row 2: Figma context to a slice and field inventory, with the result (P1-61, #1439)

This is workspace#1's row 2: the T4 step that turns a Figma design into the list of CMS slices and text fields a build needs. It adds `scripts/model-bakeoff/tasks/figma-inventory.mjs` and the measured result, and changes no routing.

**The input.** The Figma connector was authorised in this cloud session (Tucker Lemos, Reddoor Creative), so nothing had to be asked. I pinned the Roalson Interests comp, `U5KIPY7HmZOQwqJXGGsEIl`, whose key was in roalson-interests' own journal (2026-09-21, the parity harness). I chose two frames: the Homepage `6802:1416` (7 bands, one component) and Properties `6903:1030`. Properties has hidden top-level bands, hidden map pins and repeated cards, which exercise the visibility rules.

The frozen files are the connector's own responses, copied byte for byte out of this session's transcript rather than retyped. One edit was needed. Claude Code appended an `[OUTPUT TRUNCATED]` note to the 72 KB design-context response, although the payload itself was complete (it ends at the closing `}` and the slices match the metadata). Left in, the note would tell every arm that the data was incomplete. The JSON is not committed, because this repo is public.

**The truth, and proving it.** A script truth derives 14 slices and 106 fields from the two JSON payloads, so each run has 630 checks:

- **Slices:** the page frame's visible children, with name, type, rounded height, text count, `.png` count and visible instance names.
- **Fields:** the deepest JSX elements with a `data-node-id` and visible text.

Before the truth existed, I counted the Homepage by hand at 7 slices and 34 fields. The script then gave the same numbers.

Before any arm ran, the scorer was proven twice. The truth scored against itself gave 630/630. A perturbed copy failed exactly the two checks I changed, and a re-spaced name passed, as the `layer` kind intends.

The gold, Opus `high`, then scored 630/630 against the truth. Two parsers the truth does not use, ElementTree and `@babel/parser`, later rebuilt it and matched every slice and field. That makes three independent derivations that agree, and the self-score is the least of them: as row 4 found, a self-score proves the scorer, not the truth.

**The result.**

| Arm                   | Score            | Cost per run (a floor, #1435) |
| --------------------- | ---------------- | ----------------------------- |
| Gold: Opus 5.5 `high` | 630/630          | ≥$1.01                        |
| Haiku 5.5 `low`       | 532/630, 630/630 | ≥$0.12, ≥$0.11                |
| Haiku 5.5 `medium`    | 630/630, 630/630 | ≥$0.20, ≥$0.17                |
| Sonnet 5.5 `medium`   | 630/630, 630/630 | ≥$0.70, ≥$0.41                |

Every transcript shows the model and effort it asked for. The whole run cost at least $3.15. By the decision rule, Haiku `medium` is the cheapest arm that matched on every check across two runs. The result is on workspace#1.

**The one miss was a hand-off, not a reading.** haiku-low-1 printed its 14 slices with its last command, and its own `final_compact.json` scores 630/630. Its `StructuredOutput` call then sent `slices: []`, which cost 98 checks. The referee had only that to rule on: 14 presence disagreements caused by the empty list. A schema with `minItems` would have caught it. I did not add one, because the schema is what every arm is compared under, and changing it mid-row would make the arms incomparable.

**Beliefs corrected on contact.**

- **The costs are floors, not measurements (#1435).** The result-honesty lens found it, and I confirmed it in the gold transcript. 14 of its 15 messages carry `stop_reason: null` and 4 to 16 output tokens, although they hold up to 10K characters of content. Only the final message has a real count (6864). The ledger keeps the last line per `message.id`, and for these messages no later line exists. Row 4's figures (#1417) have the same gap. Input and cache counts are complete. I filed it rather than fix it, because a true figure needs a different source (OpenTelemetry, or the API's usage), and that is the harness's decision.
- **The task did not discriminate.** No model got a single field value wrong. The prompt spells out the algorithm, every arm wrote a parser for it, and the `text` kind keeps only `a-z0-9`. That leniency mattered on one field only: 105 of the 106 raw texts matched the truth byte for byte. So the result bounds the error rate (about 0.24% for Haiku `medium` on this kind of task) and does not rank anything. "Haiku `medium` over `low`" rests on one slip in two runs.

**Three review rounds.** Each round ran three lenses: truth correctness, harness and tests, and the honesty of the result.

- **Round 1** found tests that could not fail. The worst was the hidden-ancestor fixture: its hidden instance shared a name with a visible one, so dedup hid the bug. Two mutations of the hidden check survived all 12 tests. Round 1 also found the result worded as more than it measured.
- **Round 2** found that the new duplicate-field guard ran per page, so a footer component shared by two frames still gave duplicate ids.

Every fix kept the truth on the measured run byte-identical, which I checked after each one. The truth now refuses what it cannot read: non-literal JSX expressions, unknown components, unmatched `img` sources, `href` expressions, unknown entities, unreadable metadata, and repeated node ids. I chose refusing over guessing because a silently wrong truth costs a whole bake-off. Row 4's wrong `"node:"` truth was caught only because eight of nine arms disagreed with it.

**Process slips, mine.**

- I launched the round-2 wording reviewer before writing two of the three files it was told to read. It found them only because I wrote them within a minute.
- In parallel with an edit to the saved description, I sent a PR description update with a placeholder body. I restored the real one at once.

Both have the same cause: sending calls in parallel whose inputs did not exist yet.
