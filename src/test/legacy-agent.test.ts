// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { MEMORIES } from "./pipeline-fixtures";
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    let validate = (data: unknown) => data;
    const builder: any = {
      middleware: () => builder,
      inputValidator: (validator: typeof validate) => {
        validate = validator;
        return builder;
      },
      handler: (fn: (ctx: any) => unknown) => (ctx: any) =>
        fn({ ...ctx, data: validate(ctx.data) }),
    };
    return builder;
  },
}));
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));
import { runAgent, type AgentResult } from "@/lib/agent.functions";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
const toolCall = (name: string, input: unknown) => ({
  type: "tool_use",
  id: "tool_mock",
  name,
  input,
});
function msg(content: unknown[], stop = "tool_use") {
  return {
    id: "msg_mock",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-5-5",
    content,
    stop_reason: stop,
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 5 },
  };
}
describe("preserve existing Tests 1–3 using the actual SDK with mocked HTTP/database", () => {
  it.each([
    { name: "Test 1 — Write", tools: ["save_user_memory"] },
    { name: "Test 2 — Read", tools: ["get_user_memories"] },
    { name: "Test 3 — Multi-step", tools: ["save_user_memory", "get_user_memories"] },
  ])("$name", async ({ tools }) => {
    vi.stubEnv("ANTHROPIC_API_KEY", "mock-key-not-real");
    const responses = tools.map((name) =>
      msg([toolCall(name, name === "save_user_memory" ? { content: MEMORIES[0]!.content } : {})]),
    );
    responses.push(msg([{ type: "text", text: "Done." }], "end_turn"));
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify(responses.shift()), {
            headers: { "content-type": "application/json" },
          }),
      ),
    );
    const query: any = {
      insert: vi.fn(() => query),
      select: () => query,
      eq: vi.fn(() => query),
      order: () => query,
      limit: () => query,
      single: async () => ({ data: MEMORIES[0], error: null }),
      abortSignal: async () => ({ data: MEMORIES, error: null }),
    };
    const invoke = runAgent as unknown as (ctx: unknown) => Promise<AgentResult>;
    const result = await invoke({
      data: { prompt: "Run the requested memory test." },
      context: { userId: "verified-user", supabase: { from: () => query } },
    });
    expect(result.error).toBeUndefined();
    expect(result.stats.finishedNormally).toBe(true);
    expect(result.stats.toolExecutions).toBe(tools.length);
    expect(result.trace.filter((e) => e.kind === "tool_call").map((e) => e.data["tool"])).toEqual(
      tools,
    );
    if (tools.includes("save_user_memory"))
      expect(query.insert).toHaveBeenCalledWith({
        user_id: "verified-user",
        content: MEMORIES[0]!.content,
      });
    if (tools.includes("get_user_memories"))
      expect(query.eq).toHaveBeenCalledWith("user_id", "verified-user");
  });
});
