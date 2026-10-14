// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import { createClaudeAgents, MAX_TOOL_ITERATIONS } from "@/lib/pipeline/claude-agents";
import { DEFAULT_CONFIGS } from "@/lib/pipeline/defaults";
import { readUserMemories, readUserRules, createGetMemoriesTool } from "@/lib/memory-tools";
import { requireConfigAdmin } from "@/lib/pipeline/repository";
import { INPUT, MEMORIES, READER, ANALYSIS, APPROVED, stageContext } from "./pipeline-fixtures";
import type { MemoryClient } from "@/lib/memory-tools";
function message(content: unknown[], stop_reason = "end_turn") {
  return {
    id: "msg_mock",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-5-5",
    content,
    stop_reason,
    stop_sequence: null,
    usage: { input_tokens: 20, output_tokens: 10 },
  };
}
const json = (output: unknown) => message([{ type: "text", text: JSON.stringify(output) }]);
const call = (input: unknown = {}) =>
  message([{ type: "tool_use", id: "tool_mock", name: "get_user_memories", input }], "tool_use");
function clientWith(responses: unknown[]) {
  const requests: Record<string, any>[] = [];
  const client = new Anthropic({
    apiKey: "mock-key-not-real",
    maxRetries: 0,
    fetch: async (_url, init) => {
      requests.push(JSON.parse(String(init?.body)));
      if (!responses.length) throw new Error("Unexpected extra model request.");
      return new Response(JSON.stringify(responses.shift()), {
        headers: { "content-type": "application/json" },
      });
    },
  });
  return { client, requests };
}
describe("real installed Client SDK with mocked HTTP transport (not live integration)", () => {
  it("uses messages.create Structured Outputs for Reader and Checker", async () => {
    const { client, requests } = clientWith([json(READER), json(APPROVED)]);
    const agents = createClaudeAgents(client, async () => MEMORIES);
    expect(await agents.reader(INPUT, DEFAULT_CONFIGS.reader, stageContext())).toEqual(READER);
    expect(
      await agents.checker(
        INPUT,
        READER,
        ANALYSIS,
        MEMORIES,
        DEFAULT_CONFIGS.checker,
        stageContext(),
      ),
    ).toEqual(APPROVED);
    expect(requests.every((r) => r["output_config"]?.format.type === "json_schema")).toBe(true);
  });
  it("lets the actual SDK run the validated memory tool and send its actual results back", async () => {
    const { client, requests } = clientWith([call(), json(ANALYSIS)]);
    const load = vi.fn(async () => MEMORIES);
    const ctx = stageContext();
    const events: unknown[] = [];
    ctx.log = (kind, data) => events.push({ kind, data });
    const result = await createClaudeAgents(client, load).analyzer(
      INPUT,
      READER,
      DEFAULT_CONFIGS.analyzer,
      ctx,
    );
    expect(load).toHaveBeenCalledOnce();
    expect(ctx.usage.tools).toBe(1);
    expect(result.output).toEqual(ANALYSIS);
    expect(result.memories).toEqual(MEMORIES);
    expect(JSON.stringify(requests[1]?.["messages"])).toContain(MEMORIES[0]!.content);
    expect(JSON.stringify(events)).toContain("tool_result");
    expect(requests).toHaveLength(2);
    expect(
      requests.every((request) => request["output_config"]?.format.type === "json_schema"),
    ).toBe(true);
  });
  it("fails closed if the model omits the memory tool", async () => {
    const { client } = clientWith([
      message([{ type: "text", text: "I did not request the tool." }]),
    ]);
    await expect(
      createClaudeAgents(client, async () => MEMORIES).analyzer(
        INPUT,
        READER,
        DEFAULT_CONFIGS.analyzer,
        stageContext(),
      ),
    ).rejects.toThrow(/did not request/);
  });
  it("rejects tool arguments that attempt to select a different user", async () => {
    const tool = createGetMemoriesTool(
      async () => MEMORIES,
      () => {},
    );
    expect(() => tool.parse({ user_id: "another-user" })).toThrow();
  });
  it("handles real SDK tool errors without publishing an empty-boundary analysis", async () => {
    const { client } = clientWith([call(), message([{ type: "text", text: "Tool failed." }])]);
    const agents = createClaudeAgents(client, async () => {
      throw new Error("database unavailable");
    });
    await expect(
      agents.analyzer(INPUT, READER, DEFAULT_CONFIGS.analyzer, stageContext()),
    ).rejects.toThrow(/tool failed/);
  });
  it("stops at max_iterations rather than formatting unfinished analysis", async () => {
    const { client, requests } = clientWith(
      Array.from({ length: MAX_TOOL_ITERATIONS }, () => call()),
    );
    await expect(
      createClaudeAgents(client, async () => MEMORIES).analyzer(
        INPUT,
        READER,
        DEFAULT_CONFIGS.analyzer,
        stageContext(),
      ),
    ).rejects.toThrow(/iteration limit/);
    expect(requests).toHaveLength(MAX_TOOL_ITERATIONS);
  });
  it("rejects truncated structured output", async () => {
    const { client } = clientWith([message([{ type: "text", text: "{}" }], "max_tokens")]);
    await expect(
      createClaudeAgents(client, async () => MEMORIES).reader(
        INPUT,
        DEFAULT_CONFIGS.reader,
        stageContext(),
      ),
    ).rejects.toThrow(/did not finish/);
  });
  it("never records hidden thinking blocks", async () => {
    const { client } = clientWith([
      message([
        { type: "thinking", thinking: "PRIVATE_INTERNAL_TEXT", signature: "x" },
        { type: "text", text: JSON.stringify(READER) },
      ]),
    ]);
    const ctx = stageContext();
    const events: unknown[] = [];
    ctx.log = (kind, data) => events.push({ kind, data });
    await createClaudeAgents(client, async () => MEMORIES).reader(
      INPUT,
      DEFAULT_CONFIGS.reader,
      ctx,
    );
    expect(JSON.stringify(events)).not.toContain("PRIVATE_INTERNAL_TEXT");
  });
});
describe("Supabase data access boundaries (mocked database transport)", () => {
  it("always filters memory reads by the verified user identity", async () => {
    const query: any = {
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      order: vi.fn(() => query),
      limit: vi.fn(() => query),
      abortSignal: vi.fn(async () => ({ data: MEMORIES, error: null })),
    };
    const db = { from: vi.fn(() => query) } as unknown as MemoryClient;
    expect(await readUserMemories(db, "authenticated-user")).toEqual(MEMORIES);
    expect(query.eq).toHaveBeenCalledWith("user_id", "authenticated-user");
  });
  it("reads only the verified user's active rules from public.rules", async () => {
    const rows = MEMORIES.map((m) => ({ id: m.id, text: m.content, created_at: m.created_at }));
    const query: any = {
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      order: vi.fn(() => query),
      limit: vi.fn(() => query),
      abortSignal: vi.fn(async () => ({ data: rows, error: null })),
    };
    const db = { from: vi.fn(() => query) } as unknown as MemoryClient;
    expect(await readUserRules(db, "authenticated-user")).toEqual(
      MEMORIES.map((m) => ({ id: m.id, content: m.content, created_at: m.created_at })),
    );
    expect(db.from).toHaveBeenCalledWith("rules");
    expect(query.select).toHaveBeenCalledWith("id, text, created_at");
    expect(query.eq).toHaveBeenCalledWith("user_id", "authenticated-user");
    expect(query.eq).toHaveBeenCalledWith("active", true);
  });
  it("requires backend admin authorization", async () => {
    const query: any = {
      select: () => query,
      eq: vi.fn(() => query),
      abortSignal: () => query,
      maybeSingle: async () => ({ data: null, error: null }),
    };
    await expect(
      requireConfigAdmin({ from: () => query } as unknown as MemoryClient, "ordinary-user"),
    ).rejects.toThrow(/Only authorised/);
    expect(query.eq).toHaveBeenCalledWith("user_id", "ordinary-user");
  });
});
