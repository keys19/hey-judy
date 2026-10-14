// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import { createClaudeAgents } from "@/lib/pipeline/claude-agents";
import { DEFAULT_CONFIGS } from "@/lib/pipeline/defaults";
import { validateReader, validateAnalysis } from "@/lib/pipeline/validator";
import { buildFriendship, redactText, roleLabel } from "@/lib/pipeline/judy";
import { READER, ANALYSIS, APPROVED, MEMORIES, clone, stageContext } from "./pipeline-fixtures";

const message = (content: unknown[], stop_reason = "end_turn") => ({
  id: "msg_mock",
  type: "message",
  role: "assistant",
  model: "claude-sonnet-5-5",
  content,
  stop_reason,
  stop_sequence: null,
  usage: { input_tokens: 20, output_tokens: 10 },
});
const json = (o: unknown) => message([{ type: "text", text: JSON.stringify(o) }]);
const toolCall = () =>
  message([{ type: "tool_use", id: "t1", name: "get_user_memories", input: {} }], "tool_use");
function clientWith(responses: unknown[]) {
  const requests: any[] = [];
  const client = new Anthropic({
    apiKey: "mock-key-not-real",
    maxRetries: 0,
    fetch: async (_url, init) => {
      requests.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify(responses.shift()), {
        headers: { "content-type": "application/json" },
      });
    },
  });
  return { client, requests };
}

const THREAD = {
  nickname: "Sam",
  answers: { how_met: "Sam added me on an online game", how_long: "2 weeks", junk: 5 },
  tally: { flattery: 2, money_request: 1, bogus: "x" },
  memory: Array.from({ length: 25 }, (_, i) => ({ date: `day ${i}`, note: `note ${i} from Sam` })),
  last_colour: "amber",
};
const SUPPORTERS = [
  { first_name: "Julie", relationship: "Support Worker" },
  { first_name: "Mo", relationship: "" },
];

describe("friendship memory (built in code)", () => {
  const { friendship, namesToHide } = buildFriendship(THREAD, SUPPORTERS, 3, "Ben");
  it("hides the friend, trusted people (as their role) and the user", () => {
    expect(redactText("Sam said don't tell Julie or Mo, Ben", namesToHide)).toBe(
      "[name] said don't tell [support worker] or [trusted person], [me]",
    );
  });
  it("keeps intake answers and notes, without names, and only the last 20 notes", () => {
    expect(friendship.intake).toEqual({
      how_met: "[name] added me on an online game",
      how_long: "2 weeks",
    });
    expect(friendship.notes).toHaveLength(20);
    expect(friendship.notes.at(-1)).toEqual({ date: "day 24", note: "note 24 from [name]" });
    expect(JSON.stringify(friendship)).not.toMatch(/Sam|Julie|\bMo\b|Ben/);
  });
  it("keeps only real sign counts, the previous colour and trusted roles", () => {
    expect(friendship.sign_tally).toEqual({ flattery: 2, money_request: 1 });
    expect(friendship.previous_colour).toBe("amber");
    expect(friendship.checks_so_far).toBe(3);
    expect(friendship.people_who_help_me).toEqual(["support worker", "trusted person"]);
  });
  it("turns any relationship into a safe placeholder word", () => {
    expect(roleLabel("Sister-in-law")).toBe("sister in law");
    expect(roleLabel(null)).toBe("trusted person");
    expect(roleLabel("My very very long relationship description")).toHaveLength(20);
  });
  it("lets a quote with a role placeholder pass the Reader quote check", () => {
    const r = clone(READER);
    r.facts[0]!.quote = "don't tell [support worker], keep it between us";
    expect(() =>
      validateReader(r, "Sam: lend me £50? don't tell Julie, keep it between us x"),
    ).not.toThrow();
  });
});

describe("Analyzer and Checker with friendship memory (mocked HTTP)", () => {
  const { friendship, namesToHide } = buildFriendship(THREAD, SUPPORTERS, 3, "Ben");
  it("Analyzer gets cleaned facts + memory but never the raw chat; names are removed from its output", async () => {
    const leaky = clone(ANALYSIS);
    leaky.summary = "Sam asked for money again and wants it kept from Julie.";
    const { client, requests } = clientWith([toolCall(), json(leaky)]);
    const result = await createClaudeAgents(client, async () => MEMORIES, {
      friendship,
      namesToHide,
    }).analyzer("RAW CHAT with Sam", READER, DEFAULT_CONFIGS.analyzer, stageContext());
    const sent = String(requests[0].messages[0].content);
    expect(sent).not.toContain("RAW CHAT");
    expect(sent).not.toContain("original_input");
    expect(sent).toContain('"friendship":{');
    expect(sent).toContain("online game");
    const out = result.output as typeof ANALYSIS;
    expect(out.summary).toBe(
      "[name] asked for money again and wants it kept from [support worker].",
    );
    // The exact rule text is kept, so the Validator still accepts it.
    expect(validateAnalysis(out, READER, MEMORIES).triggered_boundaries[0]!.rule).toBe(
      MEMORIES[0]!.content,
    );
  });
  it("Checker gets the memory too, and names are removed from its feedback", async () => {
    const leaky = { ...APPROVED, feedback: "Good. Sam's request and Julie are handled." };
    const { client, requests } = clientWith([json(leaky)]);
    const out = (await createClaudeAgents(client, async () => MEMORIES, {
      friendship,
      namesToHide,
    }).checker("chat", READER, ANALYSIS, MEMORIES, DEFAULT_CONFIGS.checker, stageContext())) as any;
    expect(String(requests[0].messages[0].content)).toContain('"friendship":{');
    expect(out.feedback).toBe("Good. [name]'s request and [support worker] are handled.");
    expect(out.decision).toBe("approved");
  });
  it("one-off checks (no friend) send friendship: null", async () => {
    const { client, requests } = clientWith([toolCall(), json(ANALYSIS)]);
    await createClaudeAgents(client, async () => MEMORIES).analyzer(
      "x",
      READER,
      DEFAULT_CONFIGS.analyzer,
      stageContext(),
    );
    expect(String(requests[0].messages[0].content)).toContain('"friendship":null');
  });
  it("Reader never sees known names in pasted text: they arrive as roles", async () => {
    const { client, requests } = clientWith([json(READER)]);
    await createClaudeAgents(client, async () => MEMORIES, { friendship, namesToHide }).reader(
      "Sam: lend me £50? don't tell Julie x",
      DEFAULT_CONFIGS.reader,
      stageContext(),
    );
    const sent = String(requests[0].messages[0].content);
    expect(sent).not.toMatch(/Sam|Julie/);
    expect(sent).toContain("[name]: lend me £50? don't tell [support worker] x");
  });
  it("for screenshots the Reader is told who is who", async () => {
    const { client, requests } = clientWith([json(READER)]);
    await createClaudeAgents(client, async () => MEMORIES, {
      friendship,
      namesToHide,
      image: { media_type: "image/png", data: "iVBORw0KGgo".repeat(20) },
    }).reader("(screenshot)", DEFAULT_CONFIGS.reader, stageContext());
    const text = String(requests[0].messages[0].content[1].text);
    expect(text).toContain('{"name":"Julie","write_as":"[support worker]"}');
    expect(text).toContain('{"name":"Sam","write_as":"[name]"}');
  });
});
