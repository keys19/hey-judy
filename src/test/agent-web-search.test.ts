// @vitest-environment node
import { describe, expect, it } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import { createClaudeAgents } from "@/lib/pipeline/claude-agents";
import { createWebSearchTool, MAX_WEB_SEARCHES } from "@/lib/pipeline/web-search";
import { DEFAULT_CONFIGS } from "@/lib/pipeline/defaults";
import { INPUT, READER, ANALYSIS, APPROVED, MEMORIES, stageContext } from "./pipeline-fixtures";

const URL = "https://example.org/scam-warning";
const message = (content: unknown[], stop_reason = "end_turn") => ({
  id: "msg_test",
  type: "message",
  role: "assistant",
  model: "claude-sonnet-5-5",
  content,
  stop_reason,
  stop_sequence: null,
  usage: { input_tokens: 20, output_tokens: 10 },
});
const json = (value: unknown) => message([{ type: "text", text: JSON.stringify(value) }]);
const call = (name: string, input: unknown = {}) =>
  message([{ type: "tool_use", id: "call_" + name, name, input }], "tool_use");
const nativeSearch = (stop = "end_turn") =>
  message(
    [
      {
        type: "server_tool_use",
        id: "search1",
        name: "web_search",
        input: { query: "friendship scam recent warnings" },
      },
      {
        type: "web_search_tool_result",
        tool_use_id: "search1",
        content: [
          {
            type: "web_search_result",
            url: URL,
            title: "Scam warning",
            page_age: "2026-10-01",
            encrypted_content: "PRIVATE_ENCRYPTED_SEARCH_STATE",
          },
        ],
      },
      {
        type: "text",
        text: "An official warning describes a similar money-request pattern.",
        citations: [
          {
            type: "web_search_result_location",
            url: URL,
            title: "Scam warning",
            cited_text: "A fake friend may ask for money.",
            encrypted_index: "PRIVATE_CITATION_STATE",
          },
        ],
      },
      { type: "thinking", thinking: "PRIVATE_THINKING", signature: "x" },
    ],
    stop,
  );
function clientWith(responses: unknown[]) {
  const requests: Record<string, unknown>[] = [];
  const client = new Anthropic({
    apiKey: "mock-key",
    maxRetries: 0,
    fetch: async (_url, init) => {
      requests.push(JSON.parse(String(init?.body)));
      if (!responses.length) throw new Error("Unexpected extra request");
      return new Response(JSON.stringify(responses.shift()), {
        headers: { "content-type": "application/json" },
      });
    },
  });
  return { client, requests };
}
const payload = (request: Record<string, unknown>) => {
  const messages = request["messages"] as { content: string | { type: string; text?: string }[] }[];
  const content = messages[0]!.content;
  const text =
    typeof content === "string" ? content : content.find((b) => b.type === "text")!.text!;
  return JSON.parse(text.slice(text.indexOf("\n") + 1));
};

describe("web research through the actual SDK with mocked HTTP", () => {
  it("lets Analyzer and Checker search while preserving strict JSON, shared sources and follow-up answers", async () => {
    const { client, requests } = clientWith([
      call("get_user_memories"),
      call("web_search", { query: "friendship scam recent warnings" }),
      nativeSearch(),
      json(ANALYSIS),
      call("web_search", { query: "verify recent friendship scam warning" }),
      nativeSearch(),
      json(APPROVED),
    ]);
    const followUps = [
      { question: "Have you met Sam?", answer: "I have never met Sam in person." },
      { question: "How much did they ask for?", answer: "£500" },
    ];
    const agents = createClaudeAgents(client, async () => MEMORIES, {
      followUps,
      namesToHide: ["Sam"],
    });
    const aCtx = stageContext(),
      cCtx = stageContext();
    const analyzed = await agents.analyzer(INPUT, READER, DEFAULT_CONFIGS.analyzer, aCtx);
    expect(analyzed.output).toEqual(ANALYSIS);
    expect(
      await agents.checker(
        INPUT,
        READER,
        ANALYSIS,
        analyzed.memories,
        DEFAULT_CONFIGS.checker,
        cCtx,
      ),
    ).toEqual(APPROVED);
    const checkerInput = payload(requests[4]!);
    expect(checkerInput.follow_up_answers).toEqual([
      { question: "Have you met [name]?", answer: "I have never met [name] in person." },
      { question: "How much did they ask for?", answer: "£500" },
    ]);
    expect(checkerInput.follow_up_answers).toEqual(payload(requests[0]!).follow_up_answers);
    expect(checkerInput.analyzer_web_research[0]).toMatchObject({
      status: "ok",
      sources: [{ url: URL, page_age: "2026-10-01" }],
    });
    for (const index of [2, 5]) {
      expect(requests[index]!["tools"]).toEqual([
        { type: "web_search_20250305", name: "web_search", max_uses: 1 },
      ]);
      expect(requests[index]).not.toHaveProperty("output_config");
    }
    expect(requests[5]!["model"]).toBe(DEFAULT_CONFIGS.checker.model);
    for (const index of [0, 1, 3, 4, 6])
      expect(requests[index]).toHaveProperty("output_config.format.type", "json_schema");
    expect(aCtx.usage.tools).toBe(2);
    expect(cCtx.usage.tools).toBe(1);
    expect(JSON.stringify(checkerInput)).not.toMatch(
      /PRIVATE_ENCRYPTED|PRIVATE_CITATION|PRIVATE_THINKING/,
    );
  });
  it("resumes a native paused turn with original encrypted search state", async () => {
    const { client, requests } = clientWith([
      nativeSearch("pause_turn"),
      message([{ type: "text", text: "A warning was found." }]),
    ]);
    const tool = createWebSearchTool(client, DEFAULT_CONFIGS.analyzer, stageContext());
    const result = JSON.parse(String(await tool.run({ query: "friendship scam warnings" })));
    expect(result.status).toBe("ok");
    expect(JSON.stringify(requests[1]!["messages"])).toContain("PRIVATE_ENCRYPTED_SEARCH_STATE");
    expect(JSON.stringify(result)).not.toContain("PRIVATE_ENCRYPTED_SEARCH_STATE");
  });
  it("reports native search failures as unavailable without losing the personal-rule assessment", async () => {
    const failed = message([
      {
        type: "web_search_tool_result",
        tool_use_id: "search1",
        content: { type: "web_search_tool_result_error", error_code: "unavailable" },
      },
    ]);
    const { client } = clientWith([
      call("get_user_memories"),
      call("web_search", { query: "recent scams" }),
      failed,
      json(ANALYSIS),
    ]);
    const result = await createClaudeAgents(client, async () => MEMORIES).analyzer(
      INPUT,
      READER,
      DEFAULT_CONFIGS.analyzer,
      stageContext(),
    );
    expect(result.memories).toEqual(MEMORIES);
    expect(result.output).toEqual(ANALYSIS);
  });
  it("never treats a response without an actual search result as successful research", async () => {
    const { client } = clientWith([
      message([{ type: "text", text: "I know this without searching." }]),
    ]);
    const tool = createWebSearchTool(client, DEFAULT_CONFIGS.checker, stageContext());
    expect(JSON.parse(String(await tool.run({ query: "recent scam reports" })))).toMatchObject({
      status: "unavailable",
      sources: [],
    });
  });
  it("bounds searches and redacts known names and contact details before sending a query", async () => {
    const { client, requests } = clientWith(
      Array.from({ length: MAX_WEB_SEARCHES }, () => nativeSearch()),
    );
    const ctx = stageContext();
    const tool = createWebSearchTool(client, DEFAULT_CONFIGS.analyzer, ctx, ["Sam"]);
    for (let i = 0; i < MAX_WEB_SEARCHES; i++)
      await tool.run({ query: "Sam scam sam@example.com 07123456789" });
    const limited = JSON.parse(String(await tool.run({ query: "one more search" })));
    expect(limited.status).toBe("limit_reached");
    expect(requests).toHaveLength(MAX_WEB_SEARCHES);
    expect(JSON.stringify(requests)).not.toMatch(/Sam|sam@example|07123456789/);
    expect(() => tool.parse({ query: "recent scams", user_id: "other" })).toThrow();
  });
  it("keeps genuine results when a later native search exceeds the request budget", async () => {
    const response = nativeSearch();
    response.content.push({
      type: "web_search_tool_result",
      tool_use_id: "over_budget",
      content: { type: "web_search_tool_result_error", error_code: "max_uses_exceeded" },
    });
    const { client } = clientWith([response]);
    const tool = createWebSearchTool(client, DEFAULT_CONFIGS.analyzer, stageContext());
    const result = JSON.parse(String(await tool.run({ query: "recent scam warnings" })));
    expect(result.status).toBe("ok");
    expect(result.sources[0].url).toBe(URL);
    expect(result.summary).toContain("Search limit reached");
  });
  it("propagates cancellation instead of reporting a cancelled search as available", async () => {
    const { client, requests } = clientWith([]);
    const ctx = stageContext();
    const controller = new AbortController();
    controller.abort(new Error("cancelled"));
    ctx.signal = controller.signal;
    await expect(
      createWebSearchTool(client, DEFAULT_CONFIGS.checker, ctx).run({ query: "recent scams" }),
    ).rejects.toThrow("cancelled");
    expect(requests).toHaveLength(0);
  });
});
