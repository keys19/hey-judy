import type { SupabaseClient } from "@supabase/supabase-js";
import type { JudyStore, ThreadState } from "./judy-turn";
import { createPipelineStore } from "./repository";
import { loadFriendship } from "./friendship";

const timeout = () => AbortSignal.timeout(10_000);

// The real storage for judyTurn: Hey Judy's tables in Supabase, always used
// with the signed-in user's own session, so row-level security applies.
export function createJudyStore(db: SupabaseClient, userId: string): JudyStore {
  const must = (error: { message: string } | null, what: string) => {
    if (error) throw new Error(what + ": " + error.message);
  };
  return {
    async getThread(threadId) {
      const { data, error } = await db
        .from("threads")
        .select("id, kind, answers, tally, memory, pending")
        .eq("id", threadId)
        .eq("user_id", userId)
        .abortSignal(timeout())
        .maybeSingle();
      must(error, "Could not load this chat");
      if (!data) return null;
      const row = data as Record<string, unknown>;
      return {
        id: String(row["id"]),
        kind: String(row["kind"]),
        answers:
          row["answers"] && typeof row["answers"] === "object"
            ? (row["answers"] as Record<string, unknown>)
            : {},
        tally: row["tally"],
        memory: row["memory"],
        pending: (row["pending"] as ThreadState["pending"]) ?? null,
      };
    },
    async updateThread(threadId, patch) {
      const { error } = await db
        .from("threads")
        .update(patch)
        .eq("id", threadId)
        .eq("user_id", userId)
        .abortSignal(timeout());
      must(error, "Could not update this chat");
    },
    async addMessage(threadId, role, kind, body) {
      const { error } = await db
        .from("messages")
        .insert({ thread_id: threadId, role, kind, body })
        .abortSignal(timeout());
      must(error, "Could not save the message");
    },
    loadFriendship: (threadId) => loadFriendship(db, userId, threadId),
    async hasTrustedPerson() {
      const { count, error } = await db
        .from("supporters")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("invite_status", "active")
        .abortSignal(timeout());
      must(error, "Could not check trusted people");
      return (count ?? 0) > 0;
    },
    async createRun(runId, threadId, inputText) {
      // A duplicate runId fails here, so the same check can never run twice.
      const { error } = await db
        .from("pipeline_runs")
        .insert({
          id: runId,
          user_id: userId,
          thread_id: threadId,
          input_text: inputText,
          status: "running",
          validation: { execution: "active" },
        })
        .abortSignal(timeout());
      must(error, "Could not start the check");
    },
    pipelineStore: (runId) => createPipelineStore(db, userId, runId),
    async insertCheck(row) {
      const { data, error } = await db
        .from("checks")
        .insert({
          thread_id: row.threadId,
          colour: row.colour,
          analyst: row.analyst,
          reply: row.reply,
          pipeline_run_id: row.runId,
        })
        .select("id")
        .abortSignal(timeout())
        .single();
      must(error, "Could not save the result");
      return String((data as { id: string }).id);
    },
    async log(e) {
      // The live panels are nice-to-have: a failed log line never breaks a check.
      const { error } = await db
        .from("agent_log")
        .insert({
          run_id: e.runId,
          user_id: userId,
          thread_id: e.threadId,
          agent: e.agent,
          note: e.note,
          audience: e.audience,
          detail: e.detail ?? null,
        })
        .abortSignal(timeout());
      if (error) console.warn("[judy] agent_log insert failed:", error.message);
    },
    async shareAlert(threadId, kind) {
      const { data, error } = await db
        .rpc("share_alert", { p_thread_id: threadId, p_kind: kind })
        .abortSignal(timeout());
      if (error) {
        console.warn("[judy] share_alert failed:", error.message);
        return 0;
      }
      return typeof data === "number" ? data : 0;
    },
  };
}
