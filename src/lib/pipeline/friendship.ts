import type { SupabaseClient } from "@supabase/supabase-js";
import { buildFriendship, type FriendshipContext, type NameRule } from "./judy";

// Loads Judy's memory of one friendship (a thread) for the signed-in user,
// plus the names to hide (the friend's nickname, trusted people, the user).
// Runs under the user's own session, so row-level security applies.
export async function loadFriendship(
  supabase: SupabaseClient,
  userId: string,
  threadId: string,
): Promise<{ friendship: FriendshipContext; namesToHide: NameRule[] }> {
  const timeout = () => AbortSignal.timeout(10_000);
  const [thread, supporters, profile, checks] = await Promise.all([
    supabase
      .from("threads")
      .select("nickname, answers, tally, memory, last_colour")
      .eq("id", threadId)
      .eq("user_id", userId)
      .abortSignal(timeout())
      .maybeSingle(),
    supabase
      .from("supporters")
      .select("first_name, relationship")
      .eq("user_id", userId)
      .neq("invite_status", "removed")
      .abortSignal(timeout()),
    supabase
      .from("profiles")
      .select("first_name")
      .eq("id", userId)
      .abortSignal(timeout())
      .maybeSingle(),
    supabase
      .from("checks")
      .select("id", { count: "exact", head: true })
      .eq("thread_id", threadId)
      .abortSignal(timeout()),
  ]);
  if (thread.error) throw new Error("Friend could not be loaded: " + thread.error.message);
  if (!thread.data) throw new Error("Friend not found.");
  if (supporters.error)
    throw new Error("Trusted people could not be loaded: " + supporters.error.message);
  return buildFriendship(
    thread.data as Parameters<typeof buildFriendship>[0],
    (supporters.data ?? []) as Parameters<typeof buildFriendship>[1],
    checks.count ?? 0,
    (profile.data as { first_name?: string | null } | null)?.first_name ?? null,
  );
}
