// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CONFIGS } from "@/lib/pipeline/defaults";
import { INPUT, fakeAgents } from "./pipeline-fixtures";
const mocks = vi.hoisted(() => ({
  loadConfigs: vi.fn(),
  createPipelineStore: vi.fn(),
  createLiveAgents: vi.fn(),
  loadFriendship: vi.fn(),
}));
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
vi.mock("@/lib/pipeline/repository", () => ({
  loadConfigs: mocks.loadConfigs,
  createPipelineStore: mocks.createPipelineStore,
  requireConfigAdmin: vi.fn(),
}));
vi.mock("@/lib/pipeline/claude-agents", () => ({ createLiveAgents: mocks.createLiveAgents }));
vi.mock("@/lib/pipeline/friendship", () => ({ loadFriendship: mocks.loadFriendship }));
import { runPipelineFn } from "@/lib/pipeline.functions";
const RUN_ID = "22222222-2222-4222-8222-222222222222";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.loadConfigs.mockResolvedValue(DEFAULT_CONFIGS);
  mocks.createPipelineStore.mockReturnValue({
    started: async () => {},
    stage: async () => {},
    finish: async () => {},
  });
});
function database(pending: unknown, claimed: unknown) {
  let update = false;
  const query: any = {
    select: () => query,
    eq: vi.fn(() => query),
    abortSignal: () => query,
    update: () => {
      update = true;
      return query;
    },
    maybeSingle: async () => ({ data: update ? claimed : pending, error: null }),
  };
  return { client: { from: () => query }, query };
}
describe("authenticated execution endpoint with mocked services", () => {
  it("reloads authorised configs instead of trusting prompts in a user-editable run record", async () => {
    const agents = fakeAgents();
    agents.reader = vi.fn(agents.reader);
    mocks.createLiveAgents.mockReturnValue(agents);
    const { client, query } = database(
      {
        input_text: INPUT,
        validation: {
          execution: "pending",
          configs: { reader: { system_prompt: "EVIL OVERRIDE" } },
        },
      },
      { id: RUN_ID },
    );
    const invoke = runPipelineFn as unknown as (ctx: unknown) => Promise<string>;
    const result = JSON.parse(
      await invoke({
        data: { runId: RUN_ID },
        context: { userId: "verified-user", supabase: client },
      }),
    );
    expect(result.status).toBe("completed");
    expect(agents.reader).toHaveBeenCalledWith(INPUT, DEFAULT_CONFIGS.reader, expect.anything());
    expect(query.eq).toHaveBeenCalledWith("user_id", "verified-user");
    expect(query.eq).toHaveBeenCalledWith("validation->>execution", "pending");
  });
  it("does not execute a run that another request already claimed", async () => {
    const { client } = database({ input_text: INPUT, validation: { execution: "pending" } }, null);
    const invoke = runPipelineFn as unknown as (ctx: unknown) => Promise<string>;
    await expect(
      invoke({ data: { runId: RUN_ID }, context: { userId: "verified-user", supabase: client } }),
    ).rejects.toThrow(/already been claimed/);
    expect(mocks.createLiveAgents).not.toHaveBeenCalled();
  });
  it("refuses a screenshot run if the screenshot did not arrive", async () => {
    const { SCREENSHOT_PLACEHOLDER } = await import("@/lib/pipeline/judy");
    const { client } = database(
      { input_text: SCREENSHOT_PLACEHOLDER, validation: { execution: "pending" } },
      { id: RUN_ID },
    );
    const invoke = runPipelineFn as unknown as (ctx: unknown) => Promise<string>;
    await expect(
      invoke({ data: { runId: RUN_ID }, context: { userId: "verified-user", supabase: client } }),
    ).rejects.toThrow(/screenshot is missing/);
    expect(mocks.createLiveAgents).not.toHaveBeenCalled();
  });
  it("passes a screenshot to the agents and marks the run as from a screenshot", async () => {
    const { SCREENSHOT_PLACEHOLDER } = await import("@/lib/pipeline/judy");
    const agents = fakeAgents();
    mocks.createLiveAgents.mockReturnValue(agents);
    const { client } = database(
      { input_text: SCREENSHOT_PLACEHOLDER, validation: { execution: "pending" } },
      { id: RUN_ID },
    );
    const image = { media_type: "image/jpeg", data: "A".repeat(200) };
    const invoke = runPipelineFn as unknown as (ctx: unknown) => Promise<string>;
    const result = JSON.parse(
      await invoke({
        data: { runId: RUN_ID, image },
        context: { userId: "verified-user", supabase: client },
      }),
    );
    // Fixture quotes are not in the placeholder text, so this only passes
    // because screenshot quotes are verified by the Checker, not by text match.
    expect(result.status).toBe("completed");
    expect(mocks.createLiveAgents).toHaveBeenCalledWith(expect.any(Function), { image });
  });
  it("rejects screenshots that are not plain base64 images", async () => {
    const invoke = runPipelineFn as unknown as (ctx: unknown) => Promise<string>;
    const { client } = database(null, null);
    await expect(
      Promise.resolve().then(() =>
        invoke({
          data: { runId: RUN_ID, image: { media_type: "image/svg+xml", data: "A".repeat(200) } },
          context: { userId: "verified-user", supabase: client },
        }),
      ),
    ).rejects.toThrow();
    await expect(
      Promise.resolve().then(() =>
        invoke({
          data: {
            runId: RUN_ID,
            image: { media_type: "image/png", data: "data:image/png;base64," + "A".repeat(200) },
          },
          context: { userId: "verified-user", supabase: client },
        }),
      ),
    ).rejects.toThrow(/base64/);
    expect(mocks.createLiveAgents).not.toHaveBeenCalled();
  });
  it("loads the friendship memory for a run about a friend and passes it to the agents", async () => {
    const agents = fakeAgents();
    mocks.createLiveAgents.mockReturnValue(agents);
    const memory = {
      friendship: {
        intake: { how_met: "online" },
        sign_tally: {},
        notes: [],
        previous_colour: "grey",
        checks_so_far: 0,
        people_who_help_me: [],
      },
      namesToHide: ["Sam"],
    };
    mocks.loadFriendship.mockResolvedValue(memory);
    const THREAD_ID = "33333333-3333-4333-8333-333333333333";
    const { client } = database(
      { input_text: INPUT, validation: { execution: "pending" }, thread_id: THREAD_ID },
      { id: RUN_ID },
    );
    const invoke = runPipelineFn as unknown as (ctx: unknown) => Promise<string>;
    const result = JSON.parse(
      await invoke({
        data: { runId: RUN_ID },
        context: { userId: "verified-user", supabase: client },
      }),
    );
    expect(result.status).toBe("completed");
    expect(mocks.loadFriendship).toHaveBeenCalledWith(client, "verified-user", THREAD_ID);
    expect(mocks.createLiveAgents).toHaveBeenCalledWith(expect.any(Function), memory);
  });
  it("does not load any friendship for a one-off check", async () => {
    mocks.createLiveAgents.mockReturnValue(fakeAgents());
    const { client } = database(
      { input_text: INPUT, validation: { execution: "pending" } },
      { id: RUN_ID },
    );
    const invoke = runPipelineFn as unknown as (ctx: unknown) => Promise<string>;
    await invoke({
      data: { runId: RUN_ID },
      context: { userId: "verified-user", supabase: client },
    });
    expect(mocks.loadFriendship).not.toHaveBeenCalled();
    expect(mocks.createLiveAgents).toHaveBeenCalledWith(expect.any(Function), {});
  });
  it("does not execute a missing or foreign user's run", async () => {
    const { client } = database(null, null);
    const invoke = runPipelineFn as unknown as (ctx: unknown) => Promise<string>;
    await expect(
      invoke({ data: { runId: RUN_ID }, context: { userId: "verified-user", supabase: client } }),
    ).rejects.toThrow(/not found or not owned/);
    expect(mocks.createLiveAgents).not.toHaveBeenCalled();
  });
});
