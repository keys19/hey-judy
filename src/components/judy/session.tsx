import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { getProfile, type Profile } from "@/lib/judy-db";
import { Orb } from "./ui";

type Ctx = {
  session: Session;
  userId: string;
  profile: Profile;
  refreshProfile: () => Promise<void>;
};
const SessionCtx = createContext<Ctx | null>(null);

export function useJudy(): Ctx {
  const c = useContext(SessionCtx);
  if (!c) throw new Error("useJudy must be used inside <Gate>");
  return c;
}

// Applies the person's display settings to the whole page.
function useDisplaySettings(profile: Profile | null) {
  useEffect(() => {
    const el = document.documentElement;
    el.classList.toggle("judy-larger", !!profile?.larger_text);
  }, [profile?.larger_text]);
}

/**
 * Wraps every signed-in screen.
 *  need="person": must be signed in and finished onboarding (carers go to /carer)
 *  need="onboarding": signed in, onboarding not finished yet
 *  need="any": just signed in
 */
export function Gate({
  need,
  children,
}: {
  need: "person" | "onboarding" | "any";
  children: ReactNode;
}) {
  const navigate = useNavigate();
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    supabase.auth.getSession().then(({ data }) => alive && setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => alive && setSession(s));
    return () => {
      alive = false;
      data.subscription.unsubscribe();
    };
  }, []);

  const refreshProfile = useCallback(async () => {
    if (!session) return;
    try {
      setProfile(await getProfile(session.user.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e));
    }
  }, [session]);

  useEffect(() => {
    if (session === null) void navigate({ to: "/welcome" });
    else if (session) void refreshProfile();
  }, [session, navigate, refreshProfile]);

  useEffect(() => {
    if (!profile) return;
    if (need === "person" && profile.role === "carer" && !profile.onboarding_done)
      void navigate({ to: "/carer" });
    else if (need === "person" && !profile.onboarding_done) void navigate({ to: "/onboarding" });
    else if (need === "onboarding" && profile.onboarding_done) void navigate({ to: "/" });
  }, [profile, need, navigate]);

  useDisplaySettings(profile);

  if (error)
    return (
      <div className="mx-auto max-w-md p-6 text-center">
        <p className="text-lg">Judy could not load your account.</p>
        <p className="mt-2 text-base text-muted-foreground">{error}</p>
        <button
          className="mt-4 min-h-11 rounded-full bg-primary px-6 text-white"
          onClick={() => window.location.reload()}
        >
          Try again
        </button>
      </div>
    );
  const blocked =
    !profile ||
    (need === "person" && !profile.onboarding_done) ||
    (need === "onboarding" && profile.onboarding_done);
  if (!session || blocked)
    return (
      <div className="flex min-h-dvh items-center justify-center bg-judy-canvas" aria-busy="true">
        <Orb mood="neutral" size={96} label="Judy is loading" />
      </div>
    );
  return (
    <SessionCtx.Provider value={{ session, userId: session.user.id, profile, refreshProfile }}>
      {children}
    </SessionCtx.Provider>
  );
}
