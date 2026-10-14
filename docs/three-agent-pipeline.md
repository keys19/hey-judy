# Three-Agent Pipeline Test

This extends the working local app. It keeps Tests 1–3, the installed `@anthropic-ai/sdk@0.133.0`, authentication middleware, user-scoped Supabase access and the existing five database tables. No dependencies were installed and no database migrations or cloud deployments were applied for this feature.

## Implementation map

- `src/lib/pipeline/claude-agents.ts`: independent Reader, Analyzer and Checker invocations using the current Client SDK.
- `src/lib/pipeline/runner.ts`, `contracts.ts`: deterministic sequential orchestration, timers, one revision maximum and persistence callbacks.
- `src/lib/pipeline/schemas.ts`, `validator.ts`: strict Zod outputs and deterministic evidence/business checks.
- `src/lib/pipeline/defaults.ts`, `manuals/*.md`: separate developer prompts, default Markdown manuals and model settings. Admin-saved database versions override the built-in defaults.
- `src/lib/memory-tools.ts`: shared SDK memory-reading tool used by the original tests and Analyzer; the authenticated user ID comes from the backend, never model arguments.
- `src/lib/pipeline/repository.ts`, `src/lib/pipeline.functions.ts`: existing Supabase configurations, backend admin authorization, versioned saves, user-owned run history, atomic run claiming and checkpoints.
- `src/components/pipeline/PipelineTest.tsx`, `src/routes/index.tsx`: configuration tabs, server-confirmed progress, real traces and gated final report.
- `src/test/*pipeline*.test.*`, `legacy-agent.test.ts`: deterministic tests.
- `scripts/test-pipeline-live.mjs`: explicitly opt-in live API test.

## SDK versus application responsibilities

Reader and Checker call `messages.create()` with `output_config.format` built using `zodOutputFormat()`. The application parses the returned JSON and validates it with Zod and semantic checks.

Analyzer calls `beta.messages.toolRunner()` with a `betaZodTool()` memory tool. The SDK chooses and executes requested tool calls and sends actual results back to Claude. The application records events, rejects malformed arguments and missing/failed retrieval, and caps execution at six iterations. It never substitutes a hard-coded memory call for the model's request. The installed SDK supports output_config.format directly on Tool Runner, so its completed response is already structured JSON; no additional formatting call is needed.

TypeScript chooses the next Agent, enforces handoffs, and permits exactly one Analyzer revision and Checker re-review for `needs_revision`. `rejected` stops immediately. Checker approval and the deterministic Validator are both necessary for a final report.

Facts need original-input quotes and unique IDs; evidence must reference those IDs. Triggered boundaries must match the exact retrieved rule and refer to risk evidence. Risk-level score bands and the hard-boundary risk floor are enforced in TypeScript. JSON conformity does not prove factual accuracy; the independent Checker evaluates meaning and evidence.

## Local use

1. Keep `ANTHROPIC_API_KEY` in Git-ignored `.env.local`. The existing `.env` selects Judy's independent Supabase project.
2. Run `bun run dev --host 127.0.0.1 --port 3000` and sign in at http://127.0.0.1:3000/.
3. Tests 1–3 remain at the top. Scroll to **Three-Agent Pipeline Test**.
4. Reader, Analyzer and Checker tabs each expose a model, System Prompt and Markdown manual. The existing admin user can save a new version. Other users can read but cannot save. Runs use saved configuration snapshots, so save edits before starting.
5. Paste a suspicious conversation and select **Run entire pipeline**. Each completed stage exposes its structured output, validation, duration, model and token counts. Analyzer events show actual model tool requests, validated arguments, execution results and subsequent responses; thinking blocks are never logged.
6. Only an approved, validated final report appears in section D. Other results show the failure stage or review-required reason. Saved runs are scoped to the signed-in user.

Running a pipeline creates only records in the existing `pipeline_runs` and `pipeline_stages` tables. It reads memories; it does not modify saved memories. Configuration saves intentionally insert versioned `agent_configurations` rows. None of this writes to the original Lovable database.

## Automated and live tests

```sh
bun run typecheck
bun run test
bun run build
```

Unit/UI tests use mocked Claude HTTP responses and Supabase responses. Tool Runner tests exercise the real installed SDK with mocked HTTP transport, not a replacement tool loop. These are not live API integration tests. Legacy Tests 1–3 have regression coverage for writing, reading and multi-step tool use.

To test real Claude and the actual SDK, without signing in or persisting database data:

```sh
bun run test:live --sdk-only
```

This mode uses an explicitly labelled synthetic memory fixture; it does NOT prove authenticated database integration.

For a full live Claude + Supabase test, optionally set `PIPELINE_TEST_EMAIL` and `PIPELINE_TEST_PASSWORD` in private `.env.local` using an existing test account. Then:

```sh
bun run test:live
```

This signs in with the public key, reads that user's real memories under RLS, loads saved configurations and persists real run/stage records. It does not create users, save memories or change configurations. It costs API credits. `PIPELINE_TEST_INPUT` optionally supplies a different message. Using the browser UI is the simplest full live test and does not require saving test-account credentials in a file.

## Limits and future hosted execution

The current implementation runs in the existing local TanStack Start server, not in a Supabase Edge Function. Model request timeout: 45 seconds, no SDK retries; stage timeout: 90 seconds; total pipeline timeout: 240 seconds; database requests: 10 seconds; Tool Runner: six iterations; revisions: one. Timeout abort signals reach SDK requests and memory reads. A process crash can leave a running record; it does not automatically resume.

Supabase documents [Edge Function wall-clock limits](https://supabase.com/docs/guides/functions/limits) of 150 seconds on Free and 400 seconds on paid plans. A multi-call pipeline with revision can exceed an Edge request limit, even if each model call succeeds. Do not deploy this long synchronous request unchanged.

A future resumable worker should use the existing run ID plus a pinned configuration snapshot; atomically lease one next stage, persist its validated output and attempt number, enqueue the next stage, and enforce the same single revision budget and overall deadline. Poll or stream the stored states to the UI. Durable leases/idempotency and resume endpoints would require a reviewed migration and explicit deployment approval; they are not deployed by this experiment.

Prompt-injection guards, JSON-separated data, strict tool argument schemas and provenance validation reduce risk but do not guarantee factual truth or perfect resistance to prompt injection. Custom manuals are trusted developer configuration; memories and user input are never trusted instructions. No privileged credentials are sent to the model or browser. Existing RLS remains intact.

## Verification recorded for this change

- 41 automated tests passed; these use simulated Claude/database responses and include Tests 1–3 regressions and backend run-ownership/configuration-tampering checks.
- Strict TypeScript checking, production build and ESLint on new/reworked production modules passed.
- Real Claude API test using direct Tool Runner + Structured Outputs completed in about 29 seconds, including one actual SDK-managed memory-tool execution, Checker approval and deterministic validation. Its memory source was the labelled synthetic fixture; Supabase persistence was disabled.
- The full authenticated Claude + Supabase flow is available through the signed-in UI or the full CLI mode. It has not been claimed as passed by the synthetic-memory test.
