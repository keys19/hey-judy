import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { ConfigInputSchema } from "./pipeline/defaults";
import { loadConfigs, requireConfigAdmin, createPipelineStore } from "./pipeline/repository";
import { IMAGE_MEDIA_TYPES, MAX_IMAGE_BASE64, SCREENSHOT_PLACEHOLDER } from "./pipeline/judy";

export const isAgentAdmin = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    try {
      await requireConfigAdmin(context.supabase, context.userId);
      return { isAdmin: true };
    } catch {
      return { isAdmin: false };
    }
  });
export const getAgentConfigs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => loadConfigs(context.supabase));
export const saveAgentConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => ConfigInputSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await requireConfigAdmin(supabase, userId);
    for (let attempt = 0; attempt < 3; attempt++) {
      const { data: rows, error: readError } = await supabase
        .from("agent_configurations")
        .select("version")
        .eq("agent_name", data.agent_name)
        .order("version", { ascending: false })
        .limit(1)
        .abortSignal(AbortSignal.timeout(10_000));
      if (readError) throw new Error(readError.message);
      const version = (rows?.[0]?.version ?? 0) + 1;
      const { error } = await supabase
        .from("agent_configurations")
        .insert({ ...data, version, created_by: userId })
        .abortSignal(AbortSignal.timeout(10_000));
      if (!error) return { ok: true, version };
      if (error.code !== "23505") throw new Error(error.message);
    }
    throw new Error("Another developer saved this configuration concurrently. Reload and retry.");
  });

// Start returns the run ID before the long model request, enabling honest database-backed progress polling.
export const startPipelineFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        message: z.string().trim().max(4000),
        // Hey Judy: true when a screenshot will be sent with runPipelineFn.
        screenshot: z.boolean().optional(),
      })
      .strict()
      .refine((d) => d.message.length > 0 || d.screenshot === true, {
        message: "Add a message or a screenshot.",
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    await loadConfigs(context.supabase);
    const { data: row, error } = await context.supabase
      .from("pipeline_runs")
      .insert({
        user_id: context.userId,
        // The screenshot itself is never stored, only this placeholder.
        input_text: data.message || SCREENSHOT_PLACEHOLDER,
        status: "running",
        validation: { execution: "pending" },
      })
      .select("id")
      .abortSignal(AbortSignal.timeout(10_000))
      .single();
    if (error) throw new Error(error.message);
    return { runId: row.id };
  });
export const runPipelineFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        runId: z.string().uuid(),
        // Hey Judy: optional screenshot, base64 without the "data:" prefix.
        // Sent straight to Claude; never written to the database.
        image: z
          .object({
            media_type: z.enum(IMAGE_MEDIA_TYPES),
            data: z
              .string()
              .min(100)
              .max(MAX_IMAGE_BASE64)
              .regex(/^[A-Za-z0-9+/]+={0,2}$/, "Screenshot must be plain base64."),
          })
          .strict()
          .optional(),
      })
      .strict()
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: pending, error: readError } = await supabase
      .from("pipeline_runs")
      .select("input_text, validation")
      .eq("id", data.runId)
      .eq("user_id", userId)
      .eq("status", "running")
      .abortSignal(AbortSignal.timeout(10_000))
      .maybeSingle();
    if (readError || !pending)
      throw new Error("Pending run not found or not owned by the authenticated user.");
    const snapshot = pending.validation as unknown as { execution?: string };
    if (snapshot?.execution !== "pending") throw new Error("This run has already started.");
    if (pending.input_text === SCREENSHOT_PLACEHOLDER && !data.image)
      throw new Error("The screenshot is missing. Please share it again.");
    const { data: claimed, error: claimError } = await supabase
      .from("pipeline_runs")
      .update({ validation: { execution: "active" } })
      .eq("id", data.runId)
      .eq("user_id", userId)
      .eq("status", "running")
      .eq("validation->>execution", "pending")
      .select("id")
      .abortSignal(AbortSignal.timeout(10_000))
      .maybeSingle();
    if (claimError || !claimed) throw new Error("This run has already been claimed.");
    const { runPipeline } = await import("./pipeline/runner");
    const { createLiveAgents } = await import("./pipeline/claude-agents");
    const { readUserRules } = await import("./memory-tools");
    const store = createPipelineStore(supabase, userId, data.runId);
    let result: import("./pipeline/schemas").PipelineRunResult;
    try {
      // Run records are user-owned and editable under existing RLS. Never trust
      // prompts or models supplied in those records: reload authorised configs.
      const configs = await loadConfigs(supabase);
      result = await runPipeline(pending.input_text, configs, {
        runId: data.runId,
        store,
        fromScreenshot: !!data.image,
        // Hey Judy: the Analyzer checks against the person's own rules (public.rules).
        agents: createLiveAgents(
          (signal) => readUserRules(supabase, userId, signal),
          data.image ? { image: data.image } : {},
        ),
      });
    } catch (error) {
      result = {
        runId: data.runId,
        status: "failed",
        stages: [],
        warnings: [],
        error: error instanceof Error ? error.message : String(error),
        durationMs: 0,
      };
      await store.finish(result);
    }
    return JSON.stringify(result);
  });
export const getPipelineRuns = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("pipeline_runs")
      .select("id, status, created_at, duration_ms, error")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(20)
      .abortSignal(AbortSignal.timeout(10_000));
    if (error) throw new Error(error.message);
    return data;
  });
export const getPipelineRun = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ runId: z.string().uuid() }).strict().parse(data))
  .handler(async ({ data, context }) => {
    const { data: run, error } = await context.supabase
      .from("pipeline_runs")
      .select("*")
      .eq("id", data.runId)
      .eq("user_id", context.userId)
      .abortSignal(AbortSignal.timeout(10_000))
      .maybeSingle();
    if (error || !run) throw new Error("Run not found.");
    const { data: stages, error: stageError } = await context.supabase
      .from("pipeline_stages")
      .select("*")
      .eq("run_id", data.runId)
      .order("created_at", { ascending: true })
      .abortSignal(AbortSignal.timeout(10_000));
    if (stageError) throw new Error(stageError.message);
    return JSON.stringify({ run, stages });
  });
