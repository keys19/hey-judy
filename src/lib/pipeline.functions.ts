import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { mergeConfigs, type AgentConfigRow, type AgentConfigs } from "@/lib/pipeline/defaults";
import type { StageStatus, StageView } from "@/lib/pipeline/schemas";

async function loadConfigs(supabase: import("@supabase/supabase-js").SupabaseClient): Promise<{ configs: AgentConfigs; error?: string }> {
  const { data, error } = await supabase
    .from("agent_configurations")
    .select("agent_name, version, system_prompt, skills_manual, model")
    .order("version", { ascending: false })
    .limit(90);
  if (error) return { configs: mergeConfigs([]), error: error.message };
  return { configs: mergeConfigs((data ?? []) as AgentConfigRow[]) };
}

export const isAgentAdmin = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
    if (error) return { isAdmin: false, error: error.message };
    return { isAdmin: !!data };
  });

export const getAgentConfigs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => loadConfigs(context.supabase));

export const saveAgentConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        agent_name: z.enum(["reader", "analyzer", "checker"]),
        system_prompt: z.string().min(1).max(8000),
        skills_manual: z.string().max(8000),
        model: z.string().min(1).max(100),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    // Backend authorization: admin role check via security-definer RPC + RLS.
    const { data: isAdmin, error: rpcErr } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
    if (rpcErr) return { ok: false as const, error: `Authorization check failed: ${rpcErr.message}` };
    if (!isAdmin) return { ok: false as const, error: "Only admins can modify agent configurations." };

    const { data: maxRows, error: maxErr } = await supabase
      .from("agent_configurations")
      .select("version")
      .eq("agent_name", data.agent_name)
      .order("version", { ascending: false })
      .limit(1);
    if (maxErr) return { ok: false as const, error: maxErr.message };
    const version = (maxRows?.[0]?.version ?? 0) + 1;

    const { error: insErr } = await supabase.from("agent_configurations").insert({
      agent_name: data.agent_name,
      version,
      system_prompt: data.system_prompt,
      skills_manual: data.skills_manual,
      model: data.model,
      created_by: userId,
    });
    if (insErr) return { ok: false as const, error: insErr.message };
    return { ok: true as const, version };
  });

export const runPipelineFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ message: z.string().min(1).max(4000) }).parse(d))
  .handler(async ({ data, context }) => {
    const { configs, error } = await loadConfigs(context.supabase);
    const { runPipeline } = await import("@/lib/pipeline/runner");
    const result = await runPipeline(data.message, configs, {
      supabase: context.supabase,
      userId: context.userId,
    });
    if (error) {
      return { ...result, error: [result.error, `config load: ${error}`].filter(Boolean).join(" — ") };
    }
    return result;
  });

export const getPipelineRuns = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("pipeline_runs")
      .select("id, status, created_at, duration_ms, error")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) return { runs: [] as RunSummary[], error: error.message };
    return { runs: (data ?? []) as RunSummary[] };
  });

export type RunSummary = {
  id: string;
  status: string;
  created_at: string;
  duration_ms: number | null;
  error: string | null;
};

export const getPipelineRun = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ runId: z.string().min(1) }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: run, error } = await context.supabase
      .from("pipeline_runs")
      .select("*")
      .eq("id", data.runId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error) return { error: error.message };
    if (!run) return { error: "Run not found." };

    const { data: stageRows, error: sErr } = await context.supabase
      .from("pipeline_stages")
      .select("*")
      .eq("run_id", data.runId)
      .order("created_at", { ascending: true });
    if (sErr) return { error: sErr.message };

    const stages: StageView[] = (stageRows ?? []).map((s: Record<string, unknown>) => ({
      stage: s["stage"] as StageView["stage"],
      attempt: (s["attempt"] as number) ?? 1,
      status: (s["status"] as StageStatus) ?? "failed",
      model: (s["model"] as string) ?? undefined,
      output: s["output"] ?? undefined,
      trace: (s["trace"] ?? []) as StageView["trace"],
      validation: (s["validation"] ?? undefined) as StageView["validation"],
      tokens_in: (s["tokens_in"] as number) ?? undefined,
      tokens_out: (s["tokens_out"] as number) ?? undefined,
      tool_calls: (s["tool_calls"] as number) ?? undefined,
      duration_ms: (s["duration_ms"] as number) ?? undefined,
      error: (s["error"] as string) ?? undefined,
    }));

    return {
      run: {
        id: run["id"] as string,
        status: run["status"] as PipelineRunStatus,
        input_text: run["input_text"] as string,
        final_report: run["final_report"] ?? undefined,
        validation: (run["validation"] ?? undefined) as StageView["validation"],
        error: (run["error"] as string) ?? undefined,
        duration_ms: (run["duration_ms"] as number) ?? undefined,
        created_at: run["created_at"] as string,
      },
      stages,
    };
  });

type PipelineRunStatus = "completed" | "needs_review" | "failed" | "running";
