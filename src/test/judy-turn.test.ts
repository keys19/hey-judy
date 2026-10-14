// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_CONFIGS } from "@/lib/pipeline/defaults";
import { buildFriendship } from "@/lib/pipeline/judy";
import {
  judyTurn,
  noSafe,
  INTAKE_QUESTIONS,
  type JudyStore,
  type ThreadState,
  type TurnDeps,
} from "@/lib/pipeline/judy-turn";
import { READER, ANALYSIS, APPROVED, REJECTED, MEMORIES, clone } from "./pipeline-fixtures";

const T = "11111111-0000-4000-8000-000000000001";
let runCounter = 0;
const runId = () => `22222222-0000-4000-8000-${String(++runCounter).padStart(12, "0")}`;

function memoryStore(initial: Partial<ThreadState> & { nickname?: string } = {}) {
  const thread: ThreadState & { nickname: string; last_colour: string } = {
    id: T,
    kind: "person",
    nickname: "Sam",
    answers: {},
    tally: {},
    memory: [],
    pending: null,
    last_colour: "grey",
    ...initial,
  } as any;
  const db = {
    thread,
    messages: [] as { role: string; kind: string; body: any }[],
    runs: [] as { runId: string; inputText: string }[],
    checks: [] as any[],
    logs: [] as any[],
    alerts: [] as string[],
    stages: [] as any[],
  };
  const store: JudyStore = {
    getThread: async (id) => (id === T ? structuredClone(db.thread) : null),
    updateThread: async (_id, patch) => void Object.assign(db.thread, structuredClone(patch)),
    addMessage: async (_id, role, kind, body) =>
      void db.messages.push({ role, kind, body: structuredClone(body) }),
    loadFriendship: async () =>
      buildFriendship(
        db.thread as any,
        [{ first_name: "Julie", relationship: "support worker" }],
        db.checks.length,
        "Ben",
      ),
    hasTrustedPerson: async () => true,
    createRun: async (id, _t, inputText) => {
      if (db.runs.some((r) => r.runId === id)) throw new Error("duplicate run");
      db.runs.push({ runId: id, inputText });
    },
    pipelineStore: () => ({
      started: async () => {},
      stage: async (v) => void db.stages.push(v),
      finish: async () => {},
    }),
    insertCheck: async (row) => {
      db.checks.push(structuredClone(row));
      return "check-" + db.checks.length;
    },
    log: async (e) => void db.logs.push(e),
    shareAlert: async (_t, kind) => {
      db.alerts.push(kind);
      return 1;
    },
  };
  return { db, store };
}

function reader(facts: { text: string; sign: string; speaker?: string; quote?: string }[]) {
  const r = clone(READER);
  r.facts = facts.map((f, i) => ({
    id: `f${i + 1}`,
    text: f.text,
    type: "request",
    quote: f.quote ?? "Send £500 to this new account immediately.",
    speaker: (f.speaker ?? "them") as any,
    sign: f.sign as any,
  }));
  r.key_claims = [];
  return r;
}
const TEXT =
  "Sam: Send £500 to this new account immediately. Do not call your bank. Don't tell Julie.";

function deps(
  store: JudyStore,
  agents: { reader?: any; analysis?: any; checker?: any } = {},
): TurnDeps & { makeAgents: ReturnType<typeof vi.fn> } {
  const readerSpy = vi.fn(async () => agents.reader ?? clone(READER));
  const makeAgents = vi.fn(() => ({
    reader: readerSpy,
    analyzer: vi.fn(async () => ({
      output: agents.analysis ?? clone(ANALYSIS),
      memories: clone(MEMORIES),
    })),
    checker: vi.fn(async () => agents.checker ?? clone(APPROVED)),
  }));
  return {
    store,
    configs: DEFAULT_CONFIGS,
    makeAgents: Object.assign(makeAgents, { readerSpy }),
    now: () => new Date("2026-10-15T10:00:00Z"),
  };
}
const share = (text = TEXT) => ({ action: "share" as const, text });

describe("intake: Judy's three questions", () => {
  it("greets, asks the questions one by one, saves answers, then invites a share", async () => {
    const { db, store } = memoryStore();
    const d = deps(store);
    let r = await judyTurn(d, { threadId: T, runId: runId(), input: { action: "start" } });
    expect(r.status).toBe("question");
    expect(db.messages[0]!.kind).toBe("text");
    expect((r.message.body as any).id).toBe("how_met");
    expect((r.message.body as any).options).toHaveLength(3);
    for (const a of ["Online – a game, app or social media", "2 weeks", "No, that's all"])
      r = await judyTurn(d, { threadId: T, runId: runId(), input: { action: "answer", text: a } });
    expect(r.status).toBe("text");
    expect(db.thread.answers).toEqual({
      how_met: "Online – a game, app or social media",
      how_long: "2 weeks",
      anything_else: "No, that's all",
    });
    expect(db.thread.pending).toBeNull();
    expect(d.makeAgents).not.toHaveBeenCalled(); // no AI needed for intake
    expect(INTAKE_QUESTIONS).toHaveLength(3);
  });
});

describe("a check", () => {
  it("red when a rule is broken: card, memory, check and logs are all saved, with no names", async () => {
    const { db, store } = memoryStore({ tally: { money_request: 1 } });
    db.thread.memory = [{ date: "Wed 8 Oct", note: "asked to borrow £20", sign: "money_request" }];
    const r = await judyTurn(
      deps(store, {
        reader: reader([{ text: "them: asked for £500 now", sign: "money_request" }]),
      }),
      {
        threadId: T,
        runId: runId(),
        input: share(),
      },
    );
    expect(r.status).toBe("result");
    expect(r.colour).toBe("red");
    const card = r.message.body as any;
    expect(card.title).toBe("High risk — stop and get help");
    expect(card.signs.map((s: any) => s.sign)).toEqual(["rule", "pattern", "money_request"]);
    expect(card.signs[0].label).toBe("Goes against: " + MEMORIES[0]!.content);
    expect(card.signs[1].label).toBe("Asked to borrow £20 (Wed 8 Oct)");
    expect(card.actions.primary.label).toBe("Ask my trusted person");
    expect(card.check_id).toBe("check-1");
    expect(db.checks).toHaveLength(1);
    expect(db.thread.tally).toEqual({ money_request: 2 });
    expect((db.thread.memory as any[]).at(-1)).toEqual({
      date: "Thu 15 Oct",
      note: "asked for £500 now",
      sign: "money_request",
    });
    expect((db.thread as any).last_colour).toBe("red");
    expect((db.thread as any).followup_due_at).toBe("2026-10-16T10:00:00.000Z");
    // What was saved never contains the names, and never the raw text.
    expect(db.runs[0]!.inputText).toBe(
      "[name]: Send £500 to this new account immediately. Do not call your bank. Don't tell [support worker].",
    );
    const everything = JSON.stringify({ ...db, thread: { ...db.thread, nickname: "" } });
    expect(everything).not.toMatch(/Sam|Julie/);
    // Live log: friendly progress lines and judge lines.
    expect(db.logs.filter((l) => l.audience === "user").map((l) => l.note)).toEqual([
      "Reading the messages…",
      "Thinking about this friendship and your rules…",
      "Double-checking…",
      "Done.",
    ]);
    expect(
      db.logs.some((l) => l.audience === "judge" && /colour_rule|red/.test(l.agent + l.note)),
    ).toBe(true);
  });
  it("always red for bank codes, even if the Analyzer says low", async () => {
    const { store } = memoryStore();
    const low = { ...clone(ANALYSIS), risk_level: "low", risk_score: 10, triggered_boundaries: [] };
    const r = await judyTurn(
      deps(store, {
        reader: reader([{ text: "them: asked for the code", sign: "bank_or_code_request" }]),
        analysis: low,
      }),
      { threadId: T, runId: runId(), input: share() },
    );
    expect(r.colour).toBe("red");
    expect((r.message.body as any).signs[0].sign).toBe("bank_or_code_request");
  });
  it("crisis: self-harm urging is red, flags the crisis screen and alerts the trusted person", async () => {
    const { db, store } = memoryStore();
    const r = await judyTurn(
      deps(store, {
        reader: reader([{ text: "them: told me to hurt myself", sign: "self_harm_urging" }]),
      }),
      { threadId: T, runId: runId(), input: share() },
    );
    expect(r.colour).toBe("red");
    expect((r.message.body as any).crisis).toBe(true);
    expect((r.message.body as any).trusted_person_told).toBe(true);
    expect(db.alerts).toEqual(["crisis"]);
  });
  it("green for low risk with no rule broken; no follow-up scheduled; never says 'safe'", async () => {
    const { db, store } = memoryStore();
    const low = {
      ...clone(ANALYSIS),
      risk_level: "low",
      risk_score: 5,
      triggered_boundaries: [],
      recommendation: "This looks safe. Keep chatting safely.",
    };
    const r = await judyTurn(
      deps(store, { reader: reader([{ text: "them: said hi", sign: "flattery" }]), analysis: low }),
      { threadId: T, runId: runId(), input: share() },
    );
    expect(r.colour).toBe("green");
    expect((r.message.body as any).what_you_can_do).not.toMatch(/\bsafe/i);
    expect((db.thread as any).followup_due_at).toBeNull();
    expect(noSafe("safe and safely")).toBe("protected and carefully");
  });
  it("grey with a question, then the answer re-checks the same facts without the screenshot", async () => {
    const { db, store } = memoryStore();
    const asking = {
      ...clone(ANALYSIS),
      risk_level: "medium",
      risk_score: 40,
      triggered_boundaries: [],
      question_for_user: {
        text: "What did they ask you to do?",
        options: ["Send money", "Open a link"],
      },
    };
    const d = deps(store, { analysis: asking });
    const image = { media_type: "image/png" as const, data: "A".repeat(200) };
    let r = await judyTurn(d, { threadId: T, runId: runId(), input: { action: "share", image } });
    expect(r.status).toBe("question");
    expect((r.message.body as any).card.colour).toBe("grey");
    expect(db.thread.pending).toMatchObject({
      type: "clarify",
      question: "What did they ask you to do?",
    });
    expect(JSON.stringify(db)).not.toContain("A".repeat(200)); // screenshot never stored
    expect(d.makeAgents).toHaveBeenLastCalledWith(
      expect.objectContaining({ image, canAskQuestion: true, followUps: [] }),
    );
    // Answer → re-run (Analyzer may ask once more), then a third answer forces a verdict.
    r = await judyTurn(d, {
      threadId: T,
      runId: runId(),
      input: { action: "answer", text: "Send money" },
    });
    expect(r.status).toBe("question");
    // The screenshot was read once; the answer re-uses those facts.
    expect((d.makeAgents as any).readerSpy).toHaveBeenCalledTimes(1);
    r = await judyTurn(d, {
      threadId: T,
      runId: runId(),
      input: { action: "answer", text: "£50" },
    });
    expect(d.makeAgents).toHaveBeenLastCalledWith(
      expect.objectContaining({
        canAskQuestion: false,
        followUps: [
          { question: "What did they ask you to do?", answer: "Send money" },
          { question: "What did they ask you to do?", answer: "£50" },
        ],
      }),
    );
    expect(r.status).toBe("result");
    expect(r.colour).toBe("amber");
    expect(db.thread.pending).toBeNull();
  });
  it("unreadable screenshot → grey 'try a clearer screenshot', nothing learned", async () => {
    const { db, store } = memoryStore();
    const blurry = { ...reader([]), readable: false, unresolved: ["Too blurry"] };
    const nothing = {
      ...clone(ANALYSIS),
      risk_level: "none",
      risk_score: 0,
      evidence: [],
      triggered_boundaries: [],
      uncertainty: ["Unreadable"],
    };
    const r = await judyTurn(deps(store, { reader: blurry, analysis: nothing }), {
      threadId: T,
      runId: runId(),
      input: { action: "share", image: { media_type: "image/png", data: "A".repeat(200) } },
    });
    expect(r.colour).toBe("grey");
    expect((r.message.body as any).summary).toMatch(/clearer screenshot/);
    expect(db.checks).toHaveLength(0);
    expect(db.thread.tally).toEqual({});
  });
  it("if the Checker rejects, the person gets the safe grey fallback, never a wrong answer", async () => {
    const { db, store } = memoryStore();
    const r = await judyTurn(deps(store, { checker: clone(REJECTED) }), {
      threadId: T,
      runId: runId(),
      input: share(),
    });
    expect(r.status).toBe("error");
    expect(r.colour).toBe("grey");
    expect(db.checks).toHaveLength(0);
    expect(db.thread.tally).toEqual({});
  });
  it("refuses empty shares, unknown friends and 'Talk to Judy' threads", async () => {
    const { store } = memoryStore();
    await expect(
      judyTurn(deps(store), { threadId: T, runId: runId(), input: { action: "share", text: " " } }),
    ).rejects.toThrow(/screenshot/);
    await expect(
      judyTurn(deps(store), { threadId: "nope", runId: runId(), input: share() }),
    ).rejects.toThrow(/not found/);
    const general = memoryStore({ kind: "general" });
    await expect(
      judyTurn(deps(general.store), { threadId: T, runId: runId(), input: share() }),
    ).rejects.toThrow(/only for chats/);
  });
});
