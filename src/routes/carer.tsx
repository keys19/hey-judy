import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, LogOut } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Gate, useJudy } from "@/components/judy/session";
import { AppFrame, PrimaryButton, StatusCircle, inputCls } from "@/components/judy/ui";
import { db, errorText, timeAgo, type CarerAlert } from "@/lib/judy-db";
import type { Colour } from "@/lib/pipeline/judy-turn";

export const Route = createFileRoute("/carer")({
  head: () => ({ meta: [{ title: "Trusted person · Hey Judy" }] }),
  component: () => (
    <Gate need="any">
      <Carer />
    </Gate>
  ),
});

const KIND: Record<CarerAlert["kind"], { colour: Colour; title: string }> = {
  amber: { colour: "amber", title: "Be careful" },
  red: { colour: "red", title: "High risk" },
  crisis: { colour: "red", title: "Urgent — please contact them now" },
};

function Carer() {
  const { profile, refreshProfile } = useJudy();
  const navigate = useNavigate();
  const [alerts, setAlerts] = useState<CarerAlert[] | null>(null);
  const [tab, setTab] = useState<"alerts" | "overview">("alerts");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await db.rpc("carer_overview");
    if (error) {
      toast.error("Could not load alerts: " + error.message);
      setAlerts([]);
      return;
    }
    setAlerts((data ?? []) as CarerAlert[]);
  }, []);

  useEffect(() => {
    void load();
    const ch = db
      .channel("carer-alerts")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "supporter_alerts" },
        () => void load(),
      )
      .subscribe();
    return () => {
      void db.removeChannel(ch);
    };
  }, [load]);

  const accept = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { data, error } = await db.rpc("accept_invite", { p_code: code.trim() });
      if (error) throw error;
      toast.success(`You're now ${String(data)}'s trusted person.`);
      setCode("");
      await refreshProfile();
      await load();
    } catch (err) {
      // The database explains what went wrong in plain words, e.g.
      // "You cannot be your own trusted person." or "That code did not work…".
      toast.error(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const ack = async (a: CarerAlert) => {
    const { error } = await db.rpc("ack_alert", { p_alert_id: a.alert_id });
    if (error) {
      toast.error("Could not save: " + error.message);
      return;
    }
    toast.success("Thanks for checking in.");
    void load();
  };

  const shown = (alerts ?? []).filter((a) => (tab === "alerts" ? !a.acknowledged : true));
  const people = Array.from(new Set((alerts ?? []).map((a) => a.person_name ?? "Someone")));

  return (
    <AppFrame>
      <header className="flex items-center gap-2 px-3 pt-4">
        {profile.onboarding_done ? (
          <Link
            to="/settings"
            aria-label="Back"
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full hover:bg-white"
          >
            <ArrowLeft size={24} />
          </Link>
        ) : (
          <span className="w-2" />
        )}
        <h1 className="flex-1 text-2xl font-bold">Trusted person</h1>
        {!profile.onboarding_done && (
          <button
            type="button"
            aria-label="Sign out"
            onClick={async () => {
              await supabase.auth.signOut();
              void navigate({ to: "/welcome" });
            }}
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full hover:bg-white"
          >
            <LogOut size={22} />
          </button>
        )}
      </header>

      <div className="space-y-6 px-5 pb-10 pt-3">
        <p className="text-lg text-[#3F4454]">
          You'll only see a colour, a label like “Chat 1” and the time. Never their messages or who
          they were talking to.
        </p>

        <div
          role="tablist"
          aria-label="Alerts view"
          className="flex rounded-full bg-white p-1 shadow-sm"
        >
          {(["alerts", "overview"] as const).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={
                "min-h-11 flex-1 rounded-full text-lg font-bold " +
                (tab === t ? "bg-judy-primary text-white" : "text-[#5E6272]")
              }
            >
              {t === "alerts" ? "Alerts" : "Overview"}
            </button>
          ))}
        </div>

        {alerts === null ? (
          <p className="text-lg text-[#5E6272]">Loading…</p>
        ) : shown.length === 0 ? (
          <p className="rounded-2xl bg-white p-4 text-lg">
            {tab === "alerts" ? "No alerts right now." : "No alerts yet."}
          </p>
        ) : (
          <ul className="space-y-3">
            {shown.map((a) => {
              const k = KIND[a.kind];
              return (
                <li key={a.alert_id} className="rounded-3xl bg-white p-5 shadow-sm">
                  <div className="flex items-start gap-3">
                    <StatusCircle colour={k.colour} size={48} />
                    <div className="flex-1">
                      <p className="text-xl font-bold">
                        {a.chat_label} · {k.title}
                      </p>
                      <p className="text-base text-[#5E6272]">
                        {a.person_name ?? "Someone you support"} · {timeAgo(a.last_sent_at)}
                        {a.acknowledged ? " · You checked in" : ""}
                      </p>
                    </div>
                  </div>
                  {!a.acknowledged && (
                    <>
                      <p className="mt-3 text-lg">Someone you support might need help.</p>
                      <PrimaryButton className="mt-4" arrow={false} onClick={() => void ack(a)}>
                        I've checked in
                      </PrimaryButton>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {tab === "overview" && people.length > 0 && (
          <p className="text-base text-[#5E6272]">You support: {people.join(", ")}.</p>
        )}

        <form onSubmit={accept} className="space-y-3 rounded-3xl bg-white p-5 shadow-sm">
          <h2 className="text-xl font-bold">Got a code?</h2>
          <p className="text-lg text-[#3F4454]">
            Type the 6-letter code from the person you support.
          </p>
          <label className="sr-only" htmlFor="invite">
            Invite code
          </label>
          <input
            id="invite"
            className={inputCls + " text-center font-mono text-2xl uppercase tracking-[0.3em]"}
            maxLength={6}
            value={code}
            autoCapitalize="characters"
            onChange={(e) => setCode(e.target.value.toUpperCase())}
          />
          <PrimaryButton type="submit" disabled={busy || code.trim().length !== 6}>
            Connect
          </PrimaryButton>
        </form>
      </div>
    </AppFrame>
  );
}
