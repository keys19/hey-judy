import { createServer } from "vite";
import { createClient } from "@supabase/supabase-js";
import path from "node:path";

const sdkOnly = process.argv.includes("--sdk-only");
const server = await createServer({
  configFile: false,
  root: process.cwd(),
  appType: "custom",
  server: { middlewareMode: true, hmr: false, watch: null },
  resolve: { alias: { "@": path.resolve("src") } },
});
let supabase;
try {
  const { runPipeline } = await server.ssrLoadModule("/src/lib/pipeline/runner.ts");
  const { createLiveAgents } = await server.ssrLoadModule("/src/lib/pipeline/claude-agents.ts");
  const { DEFAULT_CONFIGS } = await server.ssrLoadModule("/src/lib/pipeline/defaults.ts");
  const { readUserMemories } = await server.ssrLoadModule("/src/lib/memory-tools.ts");
  const { loadConfigs, createPipelineStore } = await server.ssrLoadModule(
    "/src/lib/pipeline/repository.ts",
  );
  const input =
    process.env.PIPELINE_TEST_INPUT ||
    "A stranger sent: transfer £500 to this unfamiliar account within 10 minutes to unlock your prize. Do not call your bank.";
  let configs = DEFAULT_CONFIGS,
    load,
    store,
    runId = null;
  if (sdkOnly) {
    console.log(
      "LIVE CLAUDE + REAL CLIENT SDK; synthetic memory fixture; no Supabase persistence. This is NOT the full database integration test.",
    );
    load = async () => [
      {
        id: "11111111-1111-4111-8111-111111111111",
        content: "Never transfer money to an unfamiliar account.",
        created_at: "2026-10-14T12:00:00Z",
      },
    ];
  } else {
    const email = process.env.PIPELINE_TEST_EMAIL,
      password = process.env.PIPELINE_TEST_PASSWORD;
    if (!email || !password)
      throw new Error(
        "Full live test requires PIPELINE_TEST_EMAIL and PIPELINE_TEST_PASSWORD in your private .env.local. Or run --sdk-only for live Claude with a synthetic memory fixture.",
      );
    supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error || !data.user)
      throw new Error("Test-account login failed: " + (error?.message ?? "no user"));
    const userId = data.user.id;
    configs = await loadConfigs(supabase);
    const { data: row, error: insertError } = await supabase
      .from("pipeline_runs")
      .insert({ user_id: userId, input_text: input, status: "running" })
      .select("id")
      .single();
    if (insertError) throw insertError;
    runId = row.id;
    store = createPipelineStore(supabase, userId, runId);
    load = (signal) => readUserMemories(supabase, userId, signal);
    console.log(
      "FULL LIVE TEST: real Claude, real authenticated Supabase memory reads and persisted stage records. No saved memories or configurations are modified.",
    );
  }
  const result = await runPipeline(input, configs, {
    agents: createLiveAgents(load),
    store,
    runId,
  });
  console.log(
    JSON.stringify(
      {
        mode: sdkOnly ? "live-claude-synthetic-memories" : "live-claude-authenticated-supabase",
        status: result.status,
        runId: result.runId,
        durationMs: result.durationMs,
        stages: result.stages.map((s) => ({
          stage: s.stage,
          attempt: s.attempt,
          status: s.status,
          model: s.model,
          tools: s.tool_calls,
          durationMs: s.duration_ms,
          validation: s.validation,
        })),
        approved: !!result.finalReport,
        riskLevel: result.finalReport?.risk_level,
        error: result.error,
        warnings: result.warnings,
      },
      null,
      2,
    ),
  );
  if (result.status !== "completed") process.exitCode = 1;
} catch (error) {
  let message = error instanceof Error ? error.message : String(error);
  for (const key of [process.env.ANTHROPIC_API_KEY, process.env.PIPELINE_TEST_PASSWORD])
    if (key) message = message.split(key).join("[redacted]");
  console.error(message);
  process.exitCode = 1;
} finally {
  if (supabase) await supabase.auth.signOut({ scope: "local" });
  await server.close();
}
