// @vitest-environment node
import { describe, expect, it } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import { createClaudeAgents } from "@/lib/pipeline/claude-agents";
import { DEFAULT_CONFIGS } from "@/lib/pipeline/defaults";
import { validateReader } from "@/lib/pipeline/validator";
import { ReaderOutputSchema } from "@/lib/pipeline/schemas";
import {
  redactText,
  redactReaderOutput,
  quoteMatches,
  SIGNS,
  ALWAYS_RED_SIGNS,
} from "@/lib/pipeline/judy";
import { READER, ANALYSIS, APPROVED, MEMORIES, clone, stageContext } from "./pipeline-fixtures";

function json(output: unknown) {
  return {
    id: "msg_mock",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-5-5",
    content: [{ type: "text", text: JSON.stringify(output) }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 20, output_tokens: 10 },
  };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Request = any;
function clientWith(responses: unknown[]) {
  const requests: Request[] = [];
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
const IMAGE = { media_type: "image/png" as const, data: "iVBORw0KGgo".repeat(20) };

describe("Hey Judy redaction (in code, not left to the model)", () => {
  it("removes phone numbers, emails, links, postcodes, sort codes and codes", () => {
    const out = redactText(
      "call 07700 900123 or +44 7700 900123, mail sam.k@gmail.com, see bit.ly/abc and https://x.co/y, I'm at SW1A 1AA, sort code 12-34-56, your code is 482913",
    );
    expect(out).not.toMatch(/07700|900123|gmail|bit\.ly|https|SW1A|12-34-56|482913/);
    expect(out).toContain("[number]");
    expect(out).toContain("[email]");
    expect(out).toContain("[link]");
    expect(out).toContain("[postcode]");
  });
  it("keeps money amounts, dates and ordinary words", () => {
    const s = "can you lend me £50 by 2026-10-14? or £1500 on Friday";
    expect(redactText(s)).toBe(s);
  });
  it("hides known names as [name], whole words only", () => {
    expect(redactText("Sam said hi to Samantha", ["Sam"])).toBe("[name] said hi to Samantha");
  });
  it("redacts free text in Reader output but never IDs or labels", () => {
    const r = clone(READER);
    r.facts[0]!.text = "them: asked to send money to 12345678901";
    const out = redactReaderOutput(r);
    expect(out.facts[0]!.text).toBe("them: asked to send money to [number]");
    expect(out.facts[0]!.id).toBe("f1");
    expect(out.facts[0]!.sign).toBe("money_request");
    expect(out.key_claims[0]!.fact_ids).toEqual(["f1"]);
  });
});

describe("quote checking with redacted names", () => {
  const original = "Sam: babe you're my best mate. lend me £50? don't tell Julie x";
  it("accepts exact quotes and quotes with [name] in place of a name", () => {
    expect(quoteMatches("lend me £50?", original)).toBe(true);
    expect(quoteMatches("don't tell [name] x", original)).toBe(true);
  });
  it("still rejects made-up quotes", () => {
    expect(quoteMatches("send me your bank code", original)).toBe(false);
    expect(quoteMatches("don't tell [name] or else", original)).toBe(false);
  });
  it("validateReader checks pasted text but not screenshot quotes", () => {
    const r = clone(READER);
    r.facts[0]!.quote = "words only visible in the image";
    expect(() => validateReader(r, "some pasted text")).toThrow(/quote/);
    expect(validateReader(r, "some pasted text", { fromScreenshot: true }).facts).toHaveLength(1);
  });
});

describe("Judy Reader schema", () => {
  it("has the always-red signs in the sign list", () => {
    for (const s of ALWAYS_RED_SIGNS) expect(SIGNS).toContain(s);
  });
  it("requires speaker, sign and readable", () => {
    const r = clone(READER) as unknown as Request;
    delete r.facts[0].sign;
    expect(ReaderOutputSchema.safeParse(r).success).toBe(false);
    const r2 = clone(READER) as unknown as Request;
    delete r2.readable;
    expect(ReaderOutputSchema.safeParse(r2).success).toBe(false);
    const r3 = clone(READER) as unknown as Request;
    r3.facts[0].sign = "totally_safe";
    expect(ReaderOutputSchema.safeParse(r3).success).toBe(false);
  });
});

describe("screenshots go to the Reader and Checker only (mocked HTTP)", () => {
  it("attaches the image to Reader and Checker requests, not the Analyzer, and redacts output", async () => {
    const leaky = clone(READER);
    leaky.facts[0]!.text = "them: sent their number 07700 900123";
    const { client, requests } = clientWith([json(leaky), json(APPROVED)]);
    const agents = createClaudeAgents(client, async () => MEMORIES, { image: IMAGE });
    const reader = (await agents.reader(
      "(screenshot)",
      DEFAULT_CONFIGS.reader,
      stageContext(),
    )) as Request;
    expect(reader.facts[0].text).toBe("them: sent their number [number]");
    await agents.checker(
      "(screenshot)",
      READER,
      ANALYSIS,
      MEMORIES,
      DEFAULT_CONFIGS.checker,
      stageContext(),
    );
    for (const req of requests) {
      const content = req["messages"][0].content;
      expect(Array.isArray(content)).toBe(true);
      expect(content[0]).toEqual({
        type: "image",
        source: { type: "base64", media_type: "image/png", data: IMAGE.data },
      });
    }
    expect(JSON.stringify(requests[0]!["messages"][0].content[1])).toContain("screenshot");
  });
  it("sends plain text content when there is no screenshot", async () => {
    const { client, requests } = clientWith([json(READER)]);
    await createClaudeAgents(client, async () => MEMORIES).reader(
      "hello",
      DEFAULT_CONFIGS.reader,
      stageContext(),
    );
    expect(typeof requests[0]!["messages"][0].content).toBe("string");
  });
  it("never writes the image into the trace", async () => {
    const { client } = clientWith([json(READER)]);
    const ctx = stageContext();
    const events: unknown[] = [];
    ctx.log = (kind, data) => events.push({ kind, data });
    await createClaudeAgents(client, async () => MEMORIES, { image: IMAGE }).reader(
      "(screenshot)",
      DEFAULT_CONFIGS.reader,
      ctx,
    );
    expect(JSON.stringify(events)).not.toContain(IMAGE.data);
  });
});

describe("several screenshots", () => {
  it("attaches every screenshot to the Reader, in order, before the text", async () => {
    const second = { media_type: "image/jpeg" as const, data: "QUJD".repeat(40) };
    const { client, requests } = clientWith([json(READER)]);
    await createClaudeAgents(client, async () => MEMORIES, { images: [IMAGE, second] }).reader(
      "(screenshot)",
      DEFAULT_CONFIGS.reader,
      stageContext(),
    );
    const content = requests[0]!["messages"][0].content as Request[];
    expect(content.map((c: Request) => c.type)).toEqual(["image", "image", "text"]);
    expect(content[1].source.data).toBe(second.data);
    expect(content[2].text).toContain('"screenshot_count":2');
  });
});

describe("Checker after a follow-up answer", () => {
  it("sees the person's answers and knows the screenshot is gone", async () => {
    const { client, requests } = clientWith([json(APPROVED)]);
    await createClaudeAgents(client, async () => MEMORIES, {
      followUps: [{ question: "Did they want money?", answer: "No, just sharing food" }],
    }).checker("(screenshot)", READER, ANALYSIS, MEMORIES, DEFAULT_CONFIGS.checker, stageContext());
    const body = String(requests[0]!["messages"][0].content);
    expect(body).toContain('"input_kind":"facts_only"');
    expect(body).toContain("No, just sharing food");
  });
});
