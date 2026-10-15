import { useEffect, useState } from "react";
import { Cpu } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { db, type AgentLogRow } from "@/lib/judy-db";

const AGENT_STYLE: Record<string, string> = {
  reader: "bg-[#EFE6F3] text-[#6B3A7D]",
  analyzer: "bg-[#E6EEF8] text-[#2D4F7A]",
  checker: "bg-[#E8F3DA] text-[#3D5E14]",
  validator: "bg-[#ECEDF1] text-[#3A4458]",
  judy: "bg-[#FFF1E0] text-[#80501A]",
};

// The judges' view: every agent step for this chat, live. Hidden by default.
export function BehindTheScenes({ threadId, live }: { threadId: string; live: AgentLogRow[] }) {
  const [open, setOpen] = useState(false);
  const [history, setHistory] = useState<AgentLogRow[]>([]);

  useEffect(() => {
    if (!open) return;
    db.from("agent_log")
      .select("id, run_id, agent, note, detail, audience, created_at")
      .eq("thread_id", threadId)
      .eq("audience", "judge")
      .order("id", { ascending: false })
      .limit(120)
      .then(({ data }) => setHistory(((data ?? []) as AgentLogRow[]).reverse()));
  }, [open, threadId, live.length]);

  const rows = [...history];
  for (const l of live) if (!rows.some((r) => r.id === l.id)) rows.push(l);
  const runs: { runId: string; rows: AgentLogRow[] }[] = [];
  for (const r of rows) {
    const last = runs[runs.length - 1];
    if (last && last.runId === r.run_id) last.rows.push(r);
    else runs.push({ runId: r.run_id, rows: [r] });
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Behind the scenes: see what each AI agent did"
        title="Behind the scenes"
        className="relative inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-[#5E6272] hover:bg-white"
      >
        <Cpu size={22} />
        {live.length > 0 && (
          <span
            className="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full bg-judy-primary"
            aria-hidden="true"
          />
        )}
      </button>
      <SheetContent side="right" className="w-full overflow-y-auto bg-[#F7F6F9] p-0 sm:max-w-lg">
        <div className="sticky top-0 z-10 border-b bg-white px-5 py-4">
          <SheetTitle className="text-xl font-bold">Behind the scenes</SheetTitle>
          <SheetDescription className="text-sm text-[#5E6272]">
            Reader → Analyzer (tool: get_user_memories) → Checker → code decides the colour. Live
            from agent_log.
          </SheetDescription>
        </div>
        <div className="space-y-6 p-5">
          {runs.length === 0 && (
            <p className="text-base text-[#5E6272]">
              No agent steps yet. Share something to check.
            </p>
          )}
          {runs.map((run, i) => (
            <section key={run.runId + i} className="space-y-2">
              <h3 className="font-mono text-xs uppercase tracking-wide text-[#8C8F9C]">
                Run {run.runId.slice(0, 8)} ·{" "}
                {new Date(run.rows[0]!.created_at).toLocaleTimeString("en-GB")}
              </h3>
              <ol className="space-y-2 border-l-2 border-[#D9CFE1] pl-4">
                {run.rows.map((r) => (
                  <li key={r.id} className="rounded-xl bg-white p-3 shadow-sm">
                    <div className="flex items-center gap-2">
                      <span
                        className={
                          "rounded-md px-2 py-0.5 font-mono text-xs font-bold " +
                          (AGENT_STYLE[r.agent.toLowerCase()] ?? AGENT_STYLE["validator"])
                        }
                      >
                        {r.agent}
                      </span>
                      <span className="ml-auto font-mono text-[11px] text-[#8C8F9C]">
                        {new Date(r.created_at).toLocaleTimeString("en-GB")}
                      </span>
                    </div>
                    <p className="mt-1.5 text-sm text-[#1D2433]">{r.note}</p>
                    {r.detail != null && (
                      <details className="mt-1">
                        <summary className="cursor-pointer text-xs font-bold text-judy-primary">
                          Details
                        </summary>
                        <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-[#F4F3F6] p-2 font-mono text-[11px] text-[#3A4458]">
                          {JSON.stringify(r.detail, null, 2)}
                        </pre>
                      </details>
                    )}
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
