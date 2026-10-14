import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CONFIGS } from "@/lib/pipeline/defaults";
import { buildFinalReport } from "@/lib/pipeline/validator";
import { INPUT, READER, ANALYSIS, APPROVED } from "./pipeline-fixtures";
const calls = vi.hoisted(() => ({
  getAgentConfigs: vi.fn(),
  isAgentAdmin: vi.fn(),
  saveAgentConfig: vi.fn(),
  startPipelineFn: vi.fn(),
  runPipelineFn: vi.fn(),
  getPipelineRun: vi.fn(),
  getPipelineRuns: vi.fn(),
  getThreadsFn: vi.fn(),
}));
vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn }));
vi.mock("@/lib/pipeline.functions", () => calls);
import { PipelineTest } from "@/components/pipeline/PipelineTest";
beforeEach(() => {
  vi.clearAllMocks();
  calls.getAgentConfigs.mockResolvedValue(structuredClone(DEFAULT_CONFIGS));
  calls.isAgentAdmin.mockResolvedValue({ isAdmin: true });
  calls.getPipelineRuns.mockResolvedValue([]);
  calls.getThreadsFn.mockResolvedValue([]);
  calls.saveAgentConfig.mockResolvedValue({ ok: true, version: 1 });
  calls.startPipelineFn.mockResolvedValue({ runId: "22222222-2222-4222-8222-222222222222" });
  calls.getPipelineRun.mockResolvedValue(
    JSON.stringify({
      run: {
        status: "running",
        validation: { progress: { stage: "reader", attempt: 1, status: "running" } },
      },
      stages: [],
    }),
  );
});
afterEach(cleanup);
describe("pipeline interface with mocked server responses", () => {
  it("loads independent Markdown configuration tabs and saves the chosen agent", async () => {
    render(<PipelineTest />);
    const tab = await screen.findByRole("tab", { name: "Analyzer" });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Save Reader configuration" })).toBeEnabled(),
    );
    fireEvent.click(tab);
    fireEvent.change(screen.getByLabelText("System Prompt"), {
      target: { value: "My Analyzer prompt." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Analyzer configuration" }));
    await waitFor(() =>
      expect(calls.saveAgentConfig).toHaveBeenCalledWith({
        data: expect.objectContaining({
          agent_name: "analyzer",
          system_prompt: "My Analyzer prompt.",
        }),
      }),
    );
    expect(await screen.findByText("Analyzer saved as version 1.")).toBeInTheDocument();
  });
  it("keeps configuration read-only for non-admin users", async () => {
    calls.isAgentAdmin.mockResolvedValue({ isAdmin: false });
    render(<PipelineTest />);
    expect(await screen.findByText(/Read only — an admin role/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save Reader configuration" })).toBeDisabled();
    expect(screen.getByLabelText("System Prompt")).toHaveAttribute("readonly");
  });
  it("runs the sequential endpoint and displays only an approved, validated report", async () => {
    const finalReport = buildFinalReport(READER, ANALYSIS, APPROVED, {
      reader: "test",
      analyzer: "test",
      checker: "test",
    });
    calls.runPipelineFn.mockResolvedValue(
      JSON.stringify({
        status: "completed",
        stages: [],
        warnings: [],
        finalReport,
        validation: { ok: true, errors: [] },
        durationMs: 10,
      }),
    );
    render(<PipelineTest />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Save Reader configuration" })).toBeEnabled(),
    );
    fireEvent.change(screen.getByLabelText("Suspicious message or conversation"), {
      target: { value: INPUT },
    });
    fireEvent.click(screen.getByRole("button", { name: "Run entire pipeline" }));
    expect(await screen.findByText("Approved risk assessment")).toBeInTheDocument();
    expect(calls.startPipelineFn).toHaveBeenCalledWith({ data: { message: INPUT } });
    expect(calls.runPipelineFn).toHaveBeenCalledWith({
      data: { runId: "22222222-2222-4222-8222-222222222222" },
    });
  });
  it("never displays an approved report for a rejected run even if the server response includes one", async () => {
    calls.runPipelineFn.mockResolvedValue(
      JSON.stringify({
        status: "needs_review",
        stages: [],
        warnings: [],
        finalReport: { status: "approved" },
        validation: { ok: false, errors: [] },
        durationMs: 10,
      }),
    );
    render(<PipelineTest />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Save Reader configuration" })).toBeEnabled(),
    );
    fireEvent.change(screen.getByLabelText("Suspicious message or conversation"), {
      target: { value: INPUT },
    });
    fireEvent.click(screen.getByRole("button", { name: "Run entire pipeline" }));
    expect(
      await screen.findByText("Review required or rejected — no approved report."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Approved risk assessment")).not.toBeInTheDocument();
  });
});
