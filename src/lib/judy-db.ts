// Browser-side access to the Hey Judy tables. Every query runs as the signed-in
// person under row-level security. The generated Supabase types only cover the
// pipeline tables, so the Hey Judy rows are typed by hand here.
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { Colour, ReplyCard, JudyQuestion } from "@/lib/pipeline/judy-turn";

export const db = supabase as unknown as SupabaseClient;

export type Profile = {
  id: string;
  first_name: string | null;
  larger_text: boolean;
  read_aloud: boolean;
  simpler_language: boolean;
  fewer_visuals: boolean;
  extra_guidance: boolean;
  confirmed_adult_at: string | null;
  accepted_terms_at: string | null;
  onboarding_done: boolean;
  role: "person" | "carer";
};

export type Thread = {
  id: string;
  nickname: string;
  last_colour: Colour;
  last_used_at: string;
  created_at: string;
  kind: "person" | "general";
  pending: unknown;
};

export type RuleTemplate = { code: string; text: string; default_on: boolean; sort: number };
export type Rule = { id: string; code: string; text: string; active: boolean };

export type Supporter = {
  id: string;
  first_name: string;
  relationship: string | null;
  invite_status: "invited" | "active" | "removed";
  invite_code: string | null;
  crisis_alerts: boolean;
  created_at: string;
};

export type CarerAlert = {
  alert_id: string;
  supporter_id: string;
  person_name: string | null;
  kind: "amber" | "red" | "crisis";
  chat_label: string;
  acknowledged: boolean;
  reminders_sent: number;
  created_at: string;
  last_sent_at: string;
};

export type StoredMessage =
  | {
      id: string;
      role: "user";
      kind: "shared";
      body: { text: string | null; screenshot: boolean; screenshots?: number };
      created_at: string;
    }
  | { id: string; role: "user"; kind: "answer"; body: { text: string }; created_at: string }
  | { id: string; role: "judy"; kind: "text"; body: { text: string }; created_at: string }
  | {
      id: string;
      role: "judy";
      kind: "question";
      body: JudyQuestion & { card: ReplyCard | null };
      created_at: string;
    }
  | { id: string; role: "judy"; kind: "result"; body: ReplyCard; created_at: string }
  | { id: string; role: "judy"; kind: "error"; body: { text: string }; created_at: string };

export type AgentLogRow = {
  id: number;
  run_id: string;
  agent: string;
  note: string;
  detail: unknown;
  audience: "judge" | "user";
  created_at: string;
};

export function errorText(e: unknown): string {
  if (e && typeof e === "object" && "message" in e)
    return String((e as { message: unknown }).message);
  return String(e);
}

export async function getProfile(userId: string): Promise<Profile> {
  const { data, error } = await db.from("profiles").select("*").eq("id", userId).maybeSingle();
  if (error) throw error;
  if (data) return data as Profile;
  // The sign-up trigger normally creates this row; make sure it exists.
  const { data: made, error: e2 } = await db
    .from("profiles")
    .upsert({ id: userId }, { onConflict: "id" })
    .select("*")
    .single();
  if (e2) throw e2;
  return made as Profile;
}

export async function updateProfile(userId: string, patch: Partial<Profile>) {
  const { error } = await db.from("profiles").update(patch).eq("id", userId);
  if (error) throw error;
}

export async function listThreads(): Promise<Thread[]> {
  const { data, error } = await db
    .from("threads")
    .select("id, nickname, last_colour, last_used_at, created_at, kind, pending")
    .eq("kind", "person")
    .order("last_used_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Thread[];
}

export async function createThread(userId: string, nickname: string): Promise<Thread> {
  const { data, error } = await db
    .from("threads")
    .insert({ user_id: userId, nickname: nickname.trim().slice(0, 40) })
    .select("id, nickname, last_colour, last_used_at, created_at, kind, pending")
    .single();
  if (error) throw error;
  return data as Thread;
}

export async function latestCheckByThread(): Promise<
  Record<string, { colour: Colour; created_at: string }>
> {
  const { data, error } = await db
    .from("checks")
    .select("thread_id, colour, created_at")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  const out: Record<string, { colour: Colour; created_at: string }> = {};
  for (const r of (data ?? []) as { thread_id: string; colour: Colour; created_at: string }[])
    if (!out[r.thread_id]) out[r.thread_id] = { colour: r.colour, created_at: r.created_at };
  return out;
}

export async function listMessages(threadId: string): Promise<StoredMessage[]> {
  const { data, error } = await db
    .from("messages")
    .select("id, role, kind, body, created_at")
    .eq("thread_id", threadId)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  if (error) throw error;
  return (data ?? []) as StoredMessage[];
}

export async function saveUserResponse(checkId: string | null, response: string) {
  if (!checkId) return;
  const { error } = await db.from("checks").update({ user_response: response }).eq("id", checkId);
  if (error) console.warn("Could not save your choice:", error.message);
}

export async function shareAlert(
  threadId: string,
  kind: "amber" | "red" | "crisis",
): Promise<number> {
  const { data, error } = await db.rpc("share_alert", { p_thread_id: threadId, p_kind: kind });
  if (error) throw error;
  return Number(data ?? 0);
}

export function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "Just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

export function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}
