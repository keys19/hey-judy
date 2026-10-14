// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CONFIGS } from "@/lib/pipeline/defaults";
import { INPUT, fakeAgents } from "./pipeline-fixtures";
const mocks = vi.hoisted(() => ({
  loadConfigs: vi.fn(),
  createPipelineStore: vi.fn(),
  createLiveAgents: vi.fn(),
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
  it("does not execute a missing or foreign user's run", async () => {
    const { client } = database(null, null);
    const invoke = runPipelineFn as unknown as (ctx: unknown) => Promise<string>;
    await expect(
      invoke({ data: { runId: RUN_ID }, context: { userId: "verified-user", supabase: client } }),
    ).rejects.toThrow(/not found or not owned/);
    expect(mocks.createLiveAgents).not.toHaveBeenCalled();
  });
});
