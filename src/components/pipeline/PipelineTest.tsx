import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  DEFAULT_CONFIGS,
  AGENT_LABELS,
  MODEL_OPTIONS,
  type AgentConfigs,
} from "@/lib/pipeline/defaults";
import {
  FinalRiskReportSchema,
  STAGE_ORDER,
  type AgentName,
  type PipelineRunResult,
  type StageView,
} from "@/lib/pipeline/schemas";
import {
  getAgentConfigs,
  isAgentAdmin,
  saveAgentConfig,
  startPipelineFn,
  runPipelineFn,
  getPipelineRun,
  getPipelineRuns,
} from "@/lib/pipeline.functions";
import type { ImageInput } from "@/lib/pipeline/judy";

// Shrinks a screenshot to at most 1600px on its longest side and re-encodes it
// as JPEG, so uploads are small and fast. Returns base64 without the prefix.
async function shrinkScreenshot(file: File): Promise<ImageInput> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("not an image"));
      el.src = url;
    });
    const scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas unavailable");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
    return { media_type: "image/jpeg", data: dataUrl.slice(dataUrl.indexOf(",") + 1) };
  } finally {
    URL.revokeObjectURL(url);
  }
}
type RunItem = {
  id: string;
  status: string;
  created_at: string;
  duration_ms: number | null;
  error: string | null;
};
type SavedRun = {
  run: {
    id: string;
    status: string;
    final_report: unknown;
    validation: {
      ok?: boolean;
      errors?: string[];
      progress?: { stage: string; attempt: number; status: string };
    } | null;
    error: string | null;
    duration_ms: number | null;
  };
  stages: StageView[];
};
export function PipelineTest() {
  const load = useServerFn(getAgentConfigs),
    checkAdmin = useServerFn(isAgentAdmin),
    save = useServerFn(saveAgentConfig);
  const start = useServerFn(startPipelineFn),
    execute = useServerFn(runPipelineFn),
    getRun = useServerFn(getPipelineRun),
    listRuns = useServerFn(getPipelineRuns);
  const [configs, setConfigs] = useState<AgentConfigs>(() => structuredClone(DEFAULT_CONFIGS));
  const [agent, setAgent] = useState<AgentName>("reader");
  const [isAdmin, setIsAdmin] = useState(false),
    [configReady, setConfigReady] = useState(false),
    [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState(""),
    [error, setError] = useState("");
  const [message, setMessage] = useState("");
  // Hey Judy: optional screenshot, shrunk in the browser, never stored.
  const [image, setImage] = useState<ImageInput | null>(null);
  const [imageName, setImageName] = useState("");
  const [busy, setBusy] = useState(false),
    [runId, setRunId] = useState<string | null>(null);
  const [result, setResult] = useState<PipelineRunResult | null>(null),
    [snapshot, setSnapshot] = useState<SavedRun | null>(null);
  const [history, setHistory] = useState<RunItem[]>([]);
  const refreshHistory = useCallback(async () => {
    try {
      setHistory(await listRuns());
    } catch (e) {
      setError(String(e));
    }
  }, [listRuns]);
  useEffect(() => {
    let mounted = true;
    Promise.all([load(), checkAdmin()])
      .then(([saved, auth]) => {
        if (mounted) {
          setConfigs(saved);
          setIsAdmin(auth.isAdmin);
          setConfigReady(true);
        }
      })
      .catch((e) => {
        if (mounted) setError(String(e));
      });
    void refreshHistory();
    return () => {
      mounted = false;
    };
  }, [load, checkAdmin, refreshHistory]);
  useEffect(() => {
    if (!runId || !busy) return;
    let mounted = true,
      inFlight = false;
    const poll = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const data = JSON.parse(await getRun({ data: { runId } })) as SavedRun;
        if (mounted) setSnapshot(data);
      } catch {
        /* Keep the last confirmed server state; don't invent progress. */
      } finally {
        inFlight = false;
      }
    };
    void poll();
    const timer = setInterval(() => {
      void poll();
    }, 1500);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, [runId, busy, getRun]);
  const update = (field: "system_prompt" | "skills_manual" | "model", value: string) =>
    setConfigs((c) => ({ ...c, [agent]: { ...c[agent], [field]: value } }));
  const saveConfig = async () => {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const saved = await save({
        data: {
          agent_name: agent,
          system_prompt: configs[agent].system_prompt,
          skills_manual: configs[agent].skills_manual,
          model: configs[agent].model as (typeof MODEL_OPTIONS)[number],
        },
      });
      setConfigs(await load());
      setNotice(AGENT_LABELS[agent] + " saved as version " + saved.version + ".");
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };
  const run = async () => {
    setBusy(true);
    setResult(null);
    setSnapshot(null);
    setError("");
    setNotice("");
    setRunId(null);
    try {
      const { runId: id } = await start({
        data: image ? { message, screenshot: true } : { message },
      });
      setRunId(id);
      setResult(
        JSON.parse(
          await execute({ data: image ? { runId: id, image } : { runId: id } }),
        ) as PipelineRunResult,
      );
    } catch (e) {
      setError(
        "Pipeline request failed: " + String(e) + ". Saved stages remain available in run history.",
      );
    } finally {
      setBusy(false);
      void refreshHistory();
    }
  };
  const inspect = async (id: string) => {
    setRunId(id);
    setResult(null);
    setSnapshot(null);
    setError("");
    try {
      setSnapshot(JSON.parse(await getRun({ data: { runId: id } })) as SavedRun);
    } catch (e) {
      setError(String(e));
    }
  };
  const stages = result?.stages ?? snapshot?.stages ?? [];
  const status = result?.status ?? snapshot?.run.status;
  const validation = result?.validation ?? snapshot?.run.validation;
  const finalCandidate = result?.finalReport ?? snapshot?.run.final_report;
  const final =
    status === "completed" && validation?.ok
      ? FinalRiskReportSchema.safeParse(finalCandidate)
      : null;
  const progress = busy ? snapshot?.run.validation?.progress : undefined;
  return (
    <section className="m-4 space-y-5 rounded-lg border p-4" aria-label="Three-Agent Pipeline Test">
      <div>
        <h2 className="text-lg font-semibold">Three-Agent Pipeline Test</h2>
        <p className="text-sm text-muted-foreground">
          Reader → Analyzer → Checker → Validator. At most one revision. Only reviewed and validated
          reports are published.
        </p>
      </div>
      {error && (
        <p role="alert" className="rounded bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm">
          {notice}
        </p>
      )}
      <fieldset className="space-y-3 rounded border p-3" disabled={busy}>
        <legend className="px-1 font-semibold">A. User Input</legend>
        <label className="block text-sm" htmlFor="pipeline-input">
          Suspicious message or conversation
        </label>
        <Textarea
          id="pipeline-input"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          maxLength={4000}
          rows={5}
          placeholder="Paste the message you want the agents to examine."
        />
        <label className="block text-sm" htmlFor="pipeline-screenshot">
          Or add a screenshot (optional)
        </label>
        <input
          id="pipeline-screenshot"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) {
              setImage(null);
              setImageName("");
              return;
            }
            shrinkScreenshot(file)
              .then((img) => {
                setImage(img);
                setImageName(file.name);
              })
              .catch((err) => setError("Could not read that image: " + String(err)));
          }}
        />
        {image && (
          <p className="text-xs text-muted-foreground">
            Screenshot ready: {imageName}{" "}
            <button
              type="button"
              className="underline"
              onClick={() => {
                setImage(null);
                setImageName("");
              }}
            >
              remove
            </button>
          </p>
        )}
        <Button
          onClick={() => void run()}
          disabled={busy || saving || !configReady || (!message.trim() && !image)}
        >
          {busy ? "Pipeline running…" : "Run entire pipeline"}
        </Button>
        <p className="text-xs text-muted-foreground">
          Uses saved configurations. Save edits below before running. Model requests use your API
          credits.
        </p>
      </fieldset>
      <fieldset className="space-y-3 rounded border p-3" disabled={busy || saving || !configReady}>
        <legend className="px-1 font-semibold">B. Agent Configuration</legend>
        <div role="tablist" aria-label="Agent configuration" className="flex gap-2">
          {(Object.keys(AGENT_LABELS) as AgentName[]).map((name) => (
            <button
              key={name}
              type="button"
              role="tab"
              aria-selected={agent === name}
              onClick={() => setAgent(name)}
              className={
                "rounded border px-3 py-2 text-sm " +
                (agent === name ? "bg-muted font-semibold" : "")
              }
            >
              {AGENT_LABELS[name]}
            </button>
          ))}
        </div>
        <div role="tabpanel" aria-label={AGENT_LABELS[agent]} className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Saved version: {configs[agent].version ?? "built-in default"}.{" "}
            {isAdmin
              ? "Developer editing enabled."
              : "Read only — an admin role is required to save."}
          </p>
          <label className="block text-sm">
            Model
            <select
              aria-label="Agent model"
              className="mt-1 block w-full rounded border bg-background p-2"
              value={configs[agent].model}
              onChange={(e) => update("model", e.target.value)}
              disabled={!isAdmin}
            >
              {MODEL_OPTIONS.map((model) => (
                <option key={model}>{model}</option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            System Prompt
            <Textarea
              value={configs[agent].system_prompt}
              onChange={(e) => update("system_prompt", e.target.value)}
              rows={4}
              maxLength={8000}
              readOnly={!isAdmin}
            />
          </label>
          <label className="block text-sm">
            Skills / Operating Manual (Markdown)
            <Textarea
              value={configs[agent].skills_manual}
              onChange={(e) => update("skills_manual", e.target.value)}
              rows={7}
              maxLength={8000}
              readOnly={!isAdmin}
            />
          </label>
          <Button onClick={() => void saveConfig()} disabled={!isAdmin || saving}>
            {saving ? "Saving…" : "Save " + AGENT_LABELS[agent] + " configuration"}
          </Button>
        </div>
      </fieldset>
      <section className="space-y-3">
        <h3 className="font-semibold">C. Pipeline Execution Trace</h3>
        {runId && (
          <p className="break-all font-mono text-xs">
            Run: {runId} · {status ?? (busy ? "starting" : "unknown")}
          </p>
        )}
        {busy && (
          <p role="status" className="text-sm">
            {progress
              ? "Running " + progress.stage + " (attempt " + progress.attempt + ")"
              : "Waiting for the next confirmed server status…"}{" "}
            Completed-stage output appears as each stage finishes.
          </p>
        )}
        {!runId && <p className="text-sm text-muted-foreground">No pipeline run selected.</p>}
        <div className="flex flex-wrap gap-2 text-xs">
          {STAGE_ORDER.map((name) => (
            <span key={name} className="rounded border px-2 py-1">
              {name}:{" "}
              {progress?.stage === name
                ? "running"
                : ([...stages].reverse().find((s) => s.stage === name)?.status ?? "not run")}
            </span>
          ))}
        </div>
        {stages.map((stage, index) => (
          <details key={index} open={stage.status === "failed"} className="rounded border p-3">
            <summary className="cursor-pointer text-sm font-medium">
              {index + 1}. {stage.stage} #{stage.attempt} · {stage.status} ·{" "}
              {stage.duration_ms ?? 0} ms
            </summary>
            <p className="my-2 font-mono text-xs">
              Model: {stage.model ?? "TypeScript / Zod"} · Tokens: {stage.tokens_in ?? 0}/
              {stage.tokens_out ?? 0} · Tool executions: {stage.tool_calls ?? 0}
            </p>
            {stage.error && <p className="text-sm text-destructive">{stage.error}</p>}
            <JsonBlock label="Structured output" value={stage.output ?? null} />
            <JsonBlock label="Validation" value={stage.validation ?? null} />
            <details>
              <summary className="cursor-pointer text-sm">
                Actual model and tool events ({stage.trace.length})
              </summary>
              <p className="my-1 text-xs text-muted-foreground">
                Requests, validated arguments, real results and response summaries only. No hidden
                chain-of-thought.
              </p>
              <JsonBlock label="Execution events" value={stage.trace} />
            </details>
          </details>
        ))}
      </section>
      <section className="space-y-2">
        <h3 className="font-semibold">D. Final Report</h3>
        {final?.success ? (
          <JsonBlock label="Approved risk assessment" value={final.data} />
        ) : (
          <p className="text-sm">
            {status === "needs_review"
              ? "Review required or rejected — no approved report."
              : status === "failed"
                ? "Execution failed — no approved report."
                : "A final report appears only after Checker approval and deterministic validation."}
          </p>
        )}
        {(result?.error ?? snapshot?.run.error) && (
          <p role="alert" className="text-sm text-destructive">
            {result?.error ?? snapshot?.run.error}
          </p>
        )}
        {!!result?.warnings.length && (
          <JsonBlock label="Persistence warnings" value={result.warnings} />
        )}
      </section>
      <details>
        <summary className="cursor-pointer text-sm font-semibold">Recent saved runs</summary>
        <Button size="sm" variant="outline" onClick={() => void refreshHistory()} disabled={busy}>
          Refresh history
        </Button>
        <ul className="mt-2 space-y-1">
          {history.map((item) => (
            <li key={item.id}>
              <button
                disabled={busy}
                onClick={() => void inspect(item.id)}
                className="text-left text-xs underline"
              >
                {new Date(item.created_at).toLocaleString()} · {item.status} ·{" "}
                {item.duration_ms ?? 0} ms
              </button>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
function JsonBlock({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="my-2">
      <h4 className="mb-1 text-xs font-semibold">{label}</h4>
      <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded bg-muted p-3 text-xs">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}
