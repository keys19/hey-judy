import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type TraceEvent = {
  t: number; // ms since start
  kind:
    | "model_request"
    | "model_response"
    | "tool_call"
    | "tool_run_start"
    | "tool_result"
    | "tool_error"
    | "final"
    | "error";
  data: Record<string, unknown>;
};

export type AgentResult = {
  finalText: string;
  trace: TraceEvent[];
  stats: {
    modelTurns: number;
    toolExecutions: number;
    inputTokens: number;
    outputTokens: number;
    stopReason: string | null;
    finishedNormally: boolean;
    hitIterationLimit: boolean;
    durationMs: number;
  };
  error?: string;
};

const MODEL = "claude-sonnet-5-5";
const MAX_ITERATIONS = 6;

export const runAgent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ prompt: z.string().min(1).max(2000) }).parse(d))
  .handler(async ({ data, context }): Promise<AgentResult> => {
    const start = Date.now();
    const trace: TraceEvent[] = [];
    const log = (kind: TraceEvent["kind"], d: Record<string, unknown>) =>
      trace.push({ t: Date.now() - start, kind, data: d });
    const stats: AgentResult["stats"] = {
      modelTurns: 0,
      toolExecutions: 0,
      inputTokens: 0,
      outputTokens: 0,
      stopReason: null,
      finishedNormally: false,
      hitIterationLimit: false,
      durationMs: 0,
    };

    const apiKey = process.env["ANTHROPIC_API_KEY"];
    if (!apiKey) {
      return {
        finalText: "",
        trace,
        stats,
        error: "ANTHROPIC_API_KEY is not configured on the server yet.",
      };
    }

    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const { betaZodTool } = await import("@anthropic-ai/sdk/helpers/beta/zod");
    const anthropic = new Anthropic({ apiKey, timeout: 60_000, maxRetries: 1 });
    const { supabase, userId } = context; // user id comes from verified JWT only

    const saveMemory = betaZodTool({
      name: "save_user_memory",
      description:
        "Save one personal safety rule for the current user to persistent storage. Use when the user asks you to remember a rule.",
      inputSchema: z.object({ content: z.string().describe("The safety rule text to save") }),
      run: async (input) => {
        stats.toolExecutions++;
        log("tool_run_start", { tool: "save_user_memory", input });
        const content = input.content.trim().slice(0, 1000);
        const { data: row, error } = await supabase
          .from("agent_sdk_test_memories")
          .insert({ user_id: userId, content })
          .select("id, content, created_at")
          .single();
        if (error) {
          log("tool_error", { tool: "save_user_memory", error: error.message });
          throw new Error(`Database error: ${error.message}`);
        }
        const out = { success: true, saved: row };
        log("tool_result", { tool: "save_user_memory", result: out });
        return JSON.stringify(out);
      },
    });

    const getMemories = betaZodTool({
      name: "get_user_memories",
      description: "Retrieve all safety rules the current user has saved, oldest first.",
      inputSchema: z.object({}),
      run: async () => {
        stats.toolExecutions++;
        log("tool_run_start", { tool: "get_user_memories", input: {} });
        const { data: rows, error } = await supabase
          .from("agent_sdk_test_memories")
          .select("id, content, created_at")
          .eq("user_id", userId)
          .order("created_at", { ascending: true });
        if (error) {
          log("tool_error", { tool: "get_user_memories", error: error.message });
          throw new Error(`Database error: ${error.message}`);
        }
        const out = { count: rows.length, memories: rows, note: rows.length ? undefined : "No saved rules yet." };
        log("tool_result", { tool: "get_user_memories", result: out });
        return JSON.stringify(out);
      },
    });

    let finalText = "";
    try {
      const runner = anthropic.beta.messages.toolRunner({
        model: MODEL,
        max_tokens: 2048,
        max_iterations: MAX_ITERATIONS,
        system:
          "You are a personal anti-scam safety assistant. You can save and retrieve the user's personal safety rules using the provided tools. Use tools whenever needed; never invent saved rules.",
        tools: [saveMemory, getMemories],
        messages: [{ role: "user", content: data.prompt }],
      });

      log("model_request", { turn: 1, model: MODEL });
      for await (const message of runner) {
        stats.modelTurns++;
        stats.inputTokens += message.usage?.input_tokens ?? 0;
        stats.outputTokens += message.usage?.output_tokens ?? 0;
        stats.stopReason = message.stop_reason;
        const text = message.content
          .filter((b) => b.type === "text")
          .map((b) => (b as { text: string }).text)
          .join("\n");
        log("model_response", {
          turn: stats.modelTurns,
          id: message.id,
          stop_reason: message.stop_reason,
          usage: message.usage,
          text: text || undefined,
        });
        for (const b of message.content) {
          if (b.type === "tool_use") log("tool_call", { tool: b.name, id: b.id, input: b.input });
        }
        if (message.stop_reason === "tool_use") {
          log("model_request", { turn: stats.modelTurns + 1, note: "SDK continues with tool results" });
        } else {
          finalText = text;
        }
      }
      stats.hitIterationLimit = stats.stopReason === "tool_use" && stats.modelTurns >= MAX_ITERATIONS;
      stats.finishedNormally = stats.stopReason === "end_turn";
      // pop the dangling request log if the loop ended on tool_use
      log("final", { text: finalText, stop_reason: stats.stopReason });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[agent] error:", msg);
      log("error", { message: msg });
      stats.durationMs = Date.now() - start;
      return { finalText, trace, stats, error: msg };
    }
    stats.durationMs = Date.now() - start;
    return { finalText, trace, stats };
  });
