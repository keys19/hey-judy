# Three-Agent Pipeline Test

The developer tools at `/dev` exercise the current Judy conversation and Reader → Analyzer → Checker → Validator pipeline, using the installed Anthropic Client SDK, authentication middleware and user-scoped Supabase access. The obsolete standalone memory-write/read demo has been removed. This cleanup does not change database schemas, migrations, generated database types or cloud deployments.

## Implementation map

- `src/lib/pipeline/claude-agents.ts`: independent Reader, Analyzer and Checker invocations using the current Client SDK.
- `src/lib/pipeline/runner.ts`, `contracts.ts`: deterministic sequential orchestration, timers, one revision maximum and persistence callbacks.
- `src/lib/pipeline/schemas.ts`, `validator.ts`: strict Zod outputs and deterministic evidence/business checks.
- `src/lib/pipeline/defaults.ts`, `manuals/*.md`: separate developer prompts, default Markdown manuals and model settings. Admin-saved database versions override the built-in defaults.
- `src/lib/memory-tools.ts`: SDK rule-reading tool used by Analyzer; the authenticated user ID comes from the backend, never model arguments.
- `src/lib/pipeline/repository.ts`, `src/lib/pipeline.functions.ts`: existing Supabase configurations, backend admin authorization, versioned saves, user-owned run history, atomic run claiming and checkpoints.
- `src/components/pipeline/PipelineTest.tsx`, `src/routes/dev.tsx`: configuration tabs, server-confirmed progress, real traces and gated final report.
- `src/test/*pipeline*.test.*`, `src/test/judy-*.test.ts`: deterministic tests for the active pipeline and Judy conversation.
- `scripts/test-pipeline-live.mjs`: explicitly opt-in live API test.

## SDK versus application responsibilities

Reader uses `messages.create()`. Analyzer and Checker use the SDK Tool Runner with strict Structured Outputs. Their optional `web_search` client tool performs native Claude web search in a separate request, because native search citations cannot share a request with strict JSON outputs. The application still validates the final JSON with Zod and semantic checks.

Analyzer calls `beta.messages.toolRunner()` with `betaZodTool()` tools for reading the user's active rules and optional web research. The SDK chooses and executes requested tool calls and sends actual results back to Claude. The application records events, rejects malformed arguments and missing/failed retrieval, and caps execution at six iterations. It never substitutes a hard-coded memory call for the model's request. The installed SDK supports output_config.format directly on Tool Runner, so its completed response is already structured JSON; no additional formatting call is needed.

TypeScript chooses the next Agent, enforces handoffs, and permits exactly one Analyzer revision and Checker re-review for `needs_revision`. `rejected` stops immediately. Checker approval and the deterministic Validator are both necessary for a final report.

Facts need original-input quotes and unique IDs; evidence must reference those IDs. Triggered boundaries must match the exact retrieved rule and refer to risk evidence. Risk-level score bands and the hard-boundary risk floor are enforced in TypeScript. JSON conformity does not prove factual accuracy; the independent Checker evaluates meaning and evidence.

## Local use

1. Keep `ANTHROPIC_API_KEY` in Git-ignored `.env.local`. The existing `.env` selects Judy's independent Supabase project.
2. Run `bun run dev --host 127.0.0.1 --port 3000` and sign in at http://127.0.0.1:3000/.
3. Open `/dev` for the Judy conversation test panel and **Three-Agent Pipeline Test**.
4. Reader, Analyzer and Checker tabs each expose a model, System Prompt and Markdown manual. The existing admin user can save a new version. Other users can read but cannot save. Runs use saved configuration snapshots, so save edits before starting.
5. Paste a suspicious conversation and select **Run entire pipeline**. Each completed stage exposes its structured output, validation, duration, model and token counts. Analyzer events show actual model tool requests, validated arguments, execution results and subsequent responses; thinking blocks are never logged.
6. Only an approved, validated final report appears in section D. Other results show the failure stage or review-required reason. Saved runs are scoped to the signed-in user.

Running a pipeline creates only records in the existing `pipeline_runs` and `pipeline_stages` tables. It reads the signed-in user's active rules from `rules`; it does not modify those rules. Configuration saves intentionally insert versioned `agent_configurations` rows. None of this writes to the original Lovable database.

## Automated and live tests

```sh
bun run typecheck
bun run test
bun run build
```

Unit/UI tests use mocked Claude HTTP responses and Supabase responses. Tool Runner tests exercise the real installed SDK with mocked HTTP transport, not a replacement tool loop. These are not live API integration tests.

To test real Claude and the actual SDK, without signing in or persisting database data:

```sh
bun run test:live --sdk-only
```

This mode uses an explicitly labelled synthetic memory fixture; it does NOT prove authenticated database integration.

For a full live Claude + Supabase test, optionally set `PIPELINE_TEST_EMAIL` and `PIPELINE_TEST_PASSWORD` in private `.env.local` using an existing test account. Then:

```sh
bun run test:live
```

This signs in with the public key, reads that user's active rules from `rules` under RLS, loads saved configurations and persists real run/stage records. It does not create users, save rules or change configurations. It costs API credits. `PIPELINE_TEST_INPUT` optionally supplies a different message. Using the browser UI is the simplest full live test and does not require saving test-account credentials in a file.

## Limits and future hosted execution

The current implementation runs in the existing local TanStack Start server, not in a Supabase Edge Function. Model request timeout: 45 seconds, no SDK retries; stage timeout: 90 seconds; total pipeline timeout: 240 seconds; database requests: 10 seconds; Tool Runner: six iterations; revisions: one. Timeout abort signals reach SDK requests and memory reads. A process crash can leave a running record; it does not automatically resume.

Supabase documents [Edge Function wall-clock limits](https://supabase.com/docs/guides/functions/limits) of 150 seconds on Free and 400 seconds on paid plans. A multi-call pipeline with revision can exceed an Edge request limit, even if each model call succeeds. Do not deploy this long synchronous request unchanged.

A future resumable worker should use the existing run ID plus a pinned configuration snapshot; atomically lease one next stage, persist its validated output and attempt number, enqueue the next stage, and enforce the same single revision budget and overall deadline. Poll or stream the stored states to the UI. Durable leases/idempotency and resume endpoints would require a reviewed migration and explicit deployment approval; they are not deployed by this experiment.

Prompt-injection guards, JSON-separated data, strict tool argument schemas and provenance validation reduce risk but do not guarantee factual truth or perfect resistance to prompt injection. Custom manuals are trusted developer configuration; memories and user input are never trusted instructions. No privileged credentials are sent to the model or browser. Existing RLS remains intact.

## Historical verification before the legacy cleanup

- An earlier version recorded 41 passing automated tests using simulated Claude/database responses. That historical count includes the now-removed standalone demo and is not the current suite count.
- Strict TypeScript checking, production build and ESLint on new/reworked production modules passed.
- Real Claude API test using direct Tool Runner + Structured Outputs completed in about 29 seconds, including one actual SDK-managed memory-tool execution, Checker approval and deterministic validation. Its memory source was the labelled synthetic fixture; Supabase persistence was disabled.
- The full authenticated Claude + Supabase flow is available through the signed-in UI or the full CLI mode. It has not been claimed as passed by the synthetic-memory test.
## Legacy cleanup verification (2026-10-15)

- The pre-cleanup baseline passed 84 tests. Removing the standalone demo's three cases and its obsolete data-reader case leaves 80 tests, all passing across nine files.
- TypeScript checking and the local production build passed.
- The current Judy handlers, three-agent execution, rule-reading implementation, colour rules, database schemas, migrations and generated database types were not changed.
- Live Claude and Supabase tests were not run during cleanup. The full live test now reuses Judy's existing active-rule reader instead of the removed experiment reader.
## Web research and clarification context (2026-10-15)

- Analyzer and Checker can call `web_search` for recent similar scam cases and official warnings. Reader remains unchanged. There are no new dependencies, database migrations, generated types, frontend interfaces or database configuration changes.
- Each stage attempt allows two research-tool calls. Each call permits one native search per API request and at most two SDK iterations to resume `pause_turn`. Search failure and exhausted budgets are reported explicitly; sources already retrieved remain usable if a later search hits the limit.
- Queries use general patterns. Known names and contact details are redacted before native search. Web content is untrusted reference material, never proof about the user's contact and never a replacement for Reader fact IDs or saved personal rules.
- Search summaries, source URLs, page dates and availability are stored in the existing stage trace JSON. Analyzer research is passed to Checker for review, and Checker can search independently. Existing reply-card contracts are unchanged.
- Both Analyzer and Checker receive the same redacted `follow_up_answers`, including answers from every clarification round in the current check. Checker treats them as user-reported context rather than requiring every clarification to appear in the original screenshot.
- Role prompts and Markdown manuals describe when to search, source quality, recency, privacy and uncertainty. Runtime research guidance also applies to saved role configurations without changing database rows.
- Regression coverage uses the real installed SDK and mocked HTTP for both roles, JSON compatibility, shared research and answers, native pause/resume, error handling, privacy, budgets and cancellation.
- API references: https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool and https://platform.claude.com/docs/en/build-with-claude/structured-outputs#feature-compatibility.

### Verification of this Agent change

- 87 automated tests passed across ten files; TypeScript, ESLint on the changed Agent modules/new tests, and the local production build passed.
- Real native web-search checks using the existing Sonnet Analyzer and Haiku Checker models each returned six sources. Only public synthetic queries and in-memory fixtures were used; no Supabase reads, writes or configuration saves were performed.
- These real checks confirm web-search access, not end-to-end assessment accuracy. A separate synthetic assessment produced an inconsistent risk-level/score pair and was rejected by the existing semantic validator. No risk or publication constraint was weakened.
