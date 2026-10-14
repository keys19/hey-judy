import type { AgentConfigs } from "./defaults";
import type { AgentDrivers, PipelineStore, StageContext } from "./contracts";
import {
  type AnalysisOutput,
  type CheckerOutput,
  type Memory,
  type PipelineRunResult,
  type ReaderOutput,
  type StageName,
  type StageView,
} from "./schemas";
import {
  validateReader,
  validateAnalysis,
  validateChecker,
  buildFinalReport,
  validateFinalReport,
} from "./validator";

export const PIPELINE_TIMEOUT_MS = 240_000;
export const STAGE_TIMEOUT_MS = 90_000;
export type PipelineOptions = {
  agents: AgentDrivers;
  store?: PipelineStore;
  runId?: string | null;
  timeoutMs?: number;
  stageTimeoutMs?: number;
};
function errorText(error: unknown) {
  let message = error instanceof Error ? error.message : String(error);
  const key = process.env["ANTHROPIC_API_KEY"];
  if (key) message = message.split(key).join("[redacted]");
  return message;
}
export async function runPipeline(
  input: string,
  configs: AgentConfigs,
  options: PipelineOptions,
): Promise<PipelineRunResult> {
  const start = Date.now();
  const stages: StageView[] = [];
  const warnings: string[] = [];
  const overall = new AbortController();
  const overallTimer = setTimeout(
    () => overall.abort(new Error("Pipeline exceeded its total timeout.")),
    options.timeoutMs ?? PIPELINE_TIMEOUT_MS,
  );
  const persist = async (action: () => Promise<void>) => {
    try {
      await action();
    } catch (error) {
      warnings.push("Persistence: " + errorText(error));
    }
  };
  async function stage<T>(
    name: StageName,
    attempt: number,
    run: (ctx: StageContext) => Promise<T>,
    check: (value: T) => void,
  ): Promise<T> {
    const stageStart = Date.now();
    const controller = new AbortController();
    const signal = AbortSignal.any([overall.signal, controller.signal]);
    const timer = setTimeout(
      () => controller.abort(new Error(name + " exceeded its stage timeout.")),
      options.stageTimeoutMs ?? STAGE_TIMEOUT_MS,
    );
    const view: StageView = {
      stage: name,
      attempt,
      status: "running",
      trace: [],
      model: name === "validator" ? undefined : configs[name].model,
      config_version: name === "validator" ? null : configs[name].version,
    };
    const ctx: StageContext = {
      signal,
      usage: { input: 0, output: 0, tools: 0 },
      log: (kind, data) => {
        if (!signal.aborted)
          view.trace.push({
            t: Date.now() - stageStart,
            kind,
            data: JSON.parse(JSON.stringify(data)),
          });
      },
    };
    ctx.log("configuration", {
      model: view.model ?? null,
      version: view.config_version ?? "built-in-v1",
    });
    let onAbort: () => void = () => {};
    try {
      signal.throwIfAborted();
      await persist(async () => {
        await options.store?.started(view);
      });
      const aborted = new Promise<never>((_, reject) => {
        onAbort = () => reject(signal.reason ?? new Error("Execution aborted."));
        signal.addEventListener("abort", onAbort, { once: true });
        if (signal.aborted) onAbort();
      });
      const value = await Promise.race([Promise.resolve().then(() => run(ctx)), aborted]);
      signal.throwIfAborted();
      view.output = name === "analyzer" ? (value as { output: unknown }).output : value;
      check(value);
      view.status = "completed";
      view.validation = { ok: true, errors: [] };
      return value;
    } catch (error) {
      const message = errorText(error);
      view.status = "failed";
      view.error = message;
      view.validation = { ok: false, errors: [message] };
      throw new Error(name + " #" + attempt + ": " + message);
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      view.duration_ms = Date.now() - stageStart;
      view.tokens_in = ctx.usage.input;
      view.tokens_out = ctx.usage.output;
      view.tool_calls = ctx.usage.tools;
      stages.push(view);
      await persist(async () => {
        await options.store?.stage(view);
      });
    }
  }
  let result: PipelineRunResult;
  try {
    if (!input.trim() || input.length > 4000)
      throw new Error("Input must contain 1–4000 characters.");
    const readerRaw = await stage(
      "reader",
      1,
      (ctx) => options.agents.reader(input, configs.reader, ctx),
      (value) => {
        validateReader(value, input);
      },
    );
    const reader = validateReader(readerRaw, input);
    let analysis: AnalysisOutput;
    let checker: CheckerOutput;
    let memories: Memory[] = [];
    let feedback: CheckerOutput | undefined;
    for (let attempt = 1; attempt <= 2; attempt++) {
      const analyzed = await stage(
        "analyzer",
        attempt,
        (ctx) => options.agents.analyzer(input, reader, configs.analyzer, ctx, feedback),
        (value) => {
          validateAnalysis(value.output, reader, value.memories);
        },
      );
      analysis = validateAnalysis(analyzed.output, reader, analyzed.memories);
      memories = analyzed.memories;
      checker = (await stage(
        "checker",
        attempt,
        (ctx) => options.agents.checker(input, reader, analysis, memories, configs.checker, ctx),
        (value) => {
          validateChecker(value);
        },
      )) as CheckerOutput;
      if (checker.decision !== "needs_revision" || attempt === 2) break;
      feedback = checker;
    }
    if (checker!.decision !== "approved") {
      const reason =
        checker!.decision === "rejected"
          ? "Checker rejected this assessment."
          : "Review required after the single allowed revision.";
      try {
        await stage(
          "validator",
          1,
          async () => ({ ok: false, errors: [reason] }),
          () => {
            throw new Error(reason);
          },
        );
      } catch {
        /* The deterministic publication gate failed as expected. */
      }
      const last = stages.at(-1)!;
      result = {
        runId: options.runId ?? null,
        status: "needs_review",
        stages,
        validation: last.validation,
        error: reason,
        warnings,
        durationMs: Date.now() - start,
      };
    } else {
      const finalReport = await stage(
        "validator",
        1,
        async () => {
          const report = buildFinalReport(reader, analysis!, checker!, {
            reader: configs.reader.model,
            analyzer: configs.analyzer.model,
            checker: configs.checker.model,
          });
          const validation = validateFinalReport(report, reader, checker!, memories);
          if (!validation.ok) throw new Error(validation.errors.join("; "));
          return validation.report;
        },
        () => {},
      );
      result = {
        runId: options.runId ?? null,
        status: "completed",
        stages,
        finalReport,
        validation: { ok: true, errors: [] },
        warnings,
        durationMs: Date.now() - start,
      };
    }
  } catch (error) {
    const message = errorText(error);
    result = {
      runId: options.runId ?? null,
      status: "failed",
      stages,
      error: message,
      validation: { ok: false, errors: [message] },
      warnings,
      durationMs: Date.now() - start,
    };
  } finally {
    clearTimeout(overallTimer);
  }
  await persist(async () => {
    await options.store?.finish(result);
  });
  return result;
}
