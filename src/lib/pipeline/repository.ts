import type { SupabaseClient } from "@supabase/supabase-js";
import type { PipelineStore } from "./contracts";
import type { PipelineRunResult, StageView } from "./schemas";
import { mergeConfigs, type AgentConfigRow } from "./defaults";
const timeout = () => AbortSignal.timeout(10_000);
export async function loadConfigs(supabase: SupabaseClient) {
  const rows = await Promise.all(
    (["reader", "analyzer", "checker"] as const).map(async (name) => {
      const { data, error } = await supabase
        .from("agent_configurations")
        .select("agent_name, version, system_prompt, skills_manual, model")
        .eq("agent_name", name)
        .order("version", { ascending: false })
        .limit(1)
        .abortSignal(timeout());
      if (error) throw new Error("Configuration load failed: " + error.message);
      return (data ?? []) as AgentConfigRow[];
    }),
  );
  return mergeConfigs(rows.flat());
}
export async function requireConfigAdmin(supabase: SupabaseClient, userId: string) {
  const { data, error } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .abortSignal(timeout())
    .maybeSingle();
  if (error) throw new Error("Authorization check failed: " + error.message);
  if (!data)
    throw new Error("Only authorised developers (admin role) may change agent configurations.");
}
export function createPipelineStore(
  supabase: SupabaseClient,
  userId: string,
  runId: string,
): PipelineStore {
  async function updateRun(values: Record<string, unknown>) {
    const { error } = await supabase
      .from("pipeline_runs")
      .update(values)
      .eq("id", runId)
      .eq("user_id", userId)
      .abortSignal(timeout());
    if (error) throw new Error(error.message);
  }
  return {
    started: async (stage) =>
      updateRun({
        validation: { progress: { stage: stage.stage, attempt: stage.attempt, status: "running" } },
      }),
    stage: async (stage: StageView) => {
      const { error } = await supabase
        .from("pipeline_stages")
        .insert({
          run_id: runId,
          stage: stage.stage,
          attempt: stage.attempt,
          status: stage.status,
          model: stage.model ?? null,
          output: stage.output ?? null,
          trace: stage.trace,
          validation: stage.validation ?? null,
          tokens_in: stage.tokens_in ?? null,
          tokens_out: stage.tokens_out ?? null,
          tool_calls: stage.tool_calls ?? null,
          duration_ms: stage.duration_ms ?? null,
          error: stage.error ?? null,
        })
        .abortSignal(timeout());
      if (error) throw new Error(error.message);
    },
    finish: async (result: PipelineRunResult) =>
      updateRun({
        status: result.status,
        final_report: result.finalReport ?? null,
        validation: result.validation ?? null,
        duration_ms: result.durationMs,
        error: [result.error, ...result.warnings].filter(Boolean).join("; ") || null,
      }),
  };
}
