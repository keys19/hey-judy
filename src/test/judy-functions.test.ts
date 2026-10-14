// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CONFIGS } from "@/lib/pipeline/defaults";

const mocks = vi.hoisted(() => ({
  judyTurn: vi.fn(),
  createLiveAgents: vi.fn(),
  readUserRules: vi.fn(),
  loadConfigs: vi.fn(),
}));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    let validate = (d: unknown) => d;
    const b: any = {
      middleware: () => b,
      inputValidator: (v: typeof validate) => ((validate = v), b),
      handler: (fn: (ctx: any) => unknown) => (ctx: any) =>
        fn({ ...ctx, data: validate(ctx.data) }),
    };
    return b;
  },
}));
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));
vi.mock("@/lib/pipeline/judy-turn", () => ({ judyTurn: mocks.judyTurn }));
vi.mock("@/lib/pipeline/claude-agents", () => ({ createLiveAgents: mocks.createLiveAgents }));
vi.mock("@/lib/memory-tools", () => ({ readUserRules: mocks.readUserRules }));
vi.mock("@/lib/pipeline/repository", () => ({
  loadConfigs: mocks.loadConfigs,
  createPipelineStore: vi.fn(() => ({ started: vi.fn(), stage: vi.fn(), finish: vi.fn() })),
}));
import { judyTurnFn, JudyTurnInputSchema, toTurnInput } from "@/lib/judy.functions";
import { createJudyStore } from "@/lib/pipeline/judy-store";

const ids = {
  threadId: "11111111-0000-4000-8000-000000000001",
  runId: "22222222-0000-4000-8000-000000000001",
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.loadConfigs.mockResolvedValue(DEFAULT_CONFIGS);
  mocks.judyTurn.mockResolvedValue({
    status: "text",
    colour: null,
    message: { kind: "text", body: { text: "hi" } },
  });
});

describe("judyTurnFn input", () => {
  it("accepts start, answer and share (text and/or screenshot)", () => {
    const image = { media_type: "image/jpeg", data: "A".repeat(200) };
    expect(toTurnInput(JudyTurnInputSchema.parse({ ...ids, action: "start" }))).toEqual({
      action: "start",
    });
    expect(
      toTurnInput(JudyTurnInputSchema.parse({ ...ids, action: "answer", text: "2 weeks" })),
    ).toEqual({
      action: "answer",
      text: "2 weeks",
    });
    expect(toTurnInput(JudyTurnInputSchema.parse({ ...ids, action: "share", image }))).toEqual({
      action: "share",
      image,
    });
  });
  it("rejects empty answers/shares, bad ids, unknown actions and non-base64 images", () => {
    const bad = [
      { ...ids, action: "answer", text: "  " },
      { ...ids, action: "share" },
      { ...ids, threadId: "nope", action: "start" },
      { ...ids, action: "delete_everything" },
      {
        ...ids,
        action: "share",
        image: { media_type: "image/png", data: "data:image/png;base64," + "A".repeat(200) },
      },
      { ...ids, action: "start", extra: 1 },
    ];
    for (const b of bad) expect(JudyTurnInputSchema.safeParse(b).success).toBe(false);
  });
  it("runs judyTurn as the signed-in user, with live agents reading that user's rules", async () => {
    const supabase = { tag: "user-scoped client" };
    const invoke = judyTurnFn as unknown as (ctx: unknown) => Promise<unknown>;
    await invoke({
      data: { ...ids, action: "share", text: "hello" },
      context: { userId: "u1", supabase },
    });
    const [deps, args] = mocks.judyTurn.mock.calls[0]!;
    expect(args).toEqual({ ...ids, input: { action: "share", text: "hello" } });
    expect(deps.configs).toBe(DEFAULT_CONFIGS);
    deps.makeAgents({ canAskQuestion: true });
    expect(mocks.createLiveAgents).toHaveBeenCalledWith(expect.any(Function), {
      canAskQuestion: true,
    });
    await mocks.createLiveAgents.mock.calls[0]![0](new AbortController().signal);
    expect(mocks.readUserRules).toHaveBeenCalledWith(supabase, "u1", expect.anything());
  });
});

describe("Supabase store for judyTurn", () => {
  function fakeDb(results: Record<string, any> = {}) {
    const calls: any[] = [];
    const chain = (table: string) => {
      const q: any = {};
      for (const m of ["select", "eq", "update", "insert", "neq"])
        q[m] = (...a: any[]) => (calls.push({ table, m, a }), q);
      q.abortSignal = () => q;
      q.maybeSingle = async () => results[table] ?? { data: null, error: null };
      q.single = async () => results[table] ?? { data: { id: "check-1" }, error: null };
      q.then = (res: any) => res(results[table] ?? { data: null, error: null, count: 0 });
      return q;
    };
    const db: any = {
      from: (t: string) => chain(t),
      rpc: (name: string, args: any) => {
        calls.push({ rpc: name, args });
        const r: any = {
          abortSignal: () => r,
          then: (res: any) => res(results["rpc"] ?? { data: 2, error: null }),
        };
        return r;
      },
    };
    return { db, calls };
  }
  it("always scopes threads to the user and creates runs with the browser's runId", async () => {
    const { db, calls } = fakeDb();
    const store = createJudyStore(db, "u1");
    expect(await store.getThread("t1")).toBeNull();
    await store.createRun("r1", "t1", "[name]: hi");
    expect(calls).toContainEqual({ table: "threads", m: "eq", a: ["user_id", "u1"] });
    expect(calls).toContainEqual({
      table: "pipeline_runs",
      m: "insert",
      a: [
        {
          id: "r1",
          user_id: "u1",
          thread_id: "t1",
          input_text: "[name]: hi",
          status: "running",
          validation: { execution: "active" },
        },
      ],
    });
  });
  it("a failed log line never breaks a check; share_alert is called with the right arguments", async () => {
    const { db, calls } = fakeDb({ agent_log: { error: { message: "boom" } } });
    const store = createJudyStore(db, "u1");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(
      store.log({ runId: "r1", threadId: "t1", agent: "reader", note: "x", audience: "user" }),
    ).resolves.toBeUndefined();
    expect(await store.shareAlert("t1", "crisis")).toBe(2);
    expect(calls).toContainEqual({
      rpc: "share_alert",
      args: { p_thread_id: "t1", p_kind: "crisis" },
    });
    warn.mockRestore();
  });
  it("database errors on important writes are reported, not swallowed", async () => {
    const { db } = fakeDb({ messages: { error: { message: "denied" } } });
    await expect(createJudyStore(db, "u1").addMessage("t1", "user", "shared", {})).rejects.toThrow(
      /Could not save the message: denied/,
    );
  });
});
