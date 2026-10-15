import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Gate, useJudy } from "@/components/judy/session";
import { AppFrame, PrimaryButton, ToggleRow, inputCls } from "@/components/judy/ui";
import { db, errorText, type Supporter } from "@/lib/judy-db";

export const Route = createFileRoute("/trusted")({
  head: () => ({ meta: [{ title: "My trusted people · Hey Judy" }] }),
  component: () => (
    <Gate need="person">
      <Trusted />
    </Gate>
  ),
});

const RELATIONSHIPS = ["Family member", "Support worker", "Carer", "Friend", "Other"];

function Trusted() {
  const { userId } = useJudy();
  const [list, setList] = useState<Supporter[] | null>(null);
  const [name, setName] = useState("");
  const [rel, setRel] = useState(RELATIONSHIPS[0]!);
  const [crisis, setCrisis] = useState(true);
  const [busy, setBusy] = useState(false);
  const [justAdded, setJustAdded] = useState<Supporter | null>(null);

  const load = () =>
    db
      .from("supporters")
      .select("id, first_name, relationship, invite_status, invite_code, crisis_alerts, created_at")
      .eq("user_id", userId)
      .neq("invite_status", "removed")
      .order("created_at")
      .then(({ data, error }) => {
        if (error) toast.error("Could not load: " + error.message);
        setList((data ?? []) as Supporter[]);
      });

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      const { data, error } = await db
        .from("supporters")
        .insert({
          user_id: userId,
          first_name: name.trim().slice(0, 40),
          relationship: rel.toLowerCase(),
          crisis_alerts: crisis,
        })
        .select(
          "id, first_name, relationship, invite_status, invite_code, crisis_alerts, created_at",
        )
        .single();
      if (error) throw error;
      setJustAdded(data as Supporter);
      setName("");
      void load();
    } catch (err) {
      toast.error("Could not add them: " + errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (s: Supporter) => {
    const { error } = await db
      .from("supporters")
      .update({ invite_status: "removed" })
      .eq("id", s.id);
    if (error) {
      toast.error("Could not remove: " + error.message);
      return;
    }
    toast.success(`${s.first_name} removed.`);
    void load();
  };

  return (
    <AppFrame>
      <header className="flex items-center gap-2 px-3 pt-4">
        <Link
          to="/settings"
          aria-label="Back to settings"
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full hover:bg-white"
        >
          <ArrowLeft size={24} />
        </Link>
        <h1 className="text-2xl font-bold">My trusted people</h1>
      </header>
      <div className="space-y-6 px-5 pb-10 pt-3">
        <p className="text-lg text-[#3F4454]">
          A trusted person can get an alert when you choose to share one. They only see a colour and
          “Chat 1”, never your messages or who you were talking to.
        </p>

        {justAdded?.invite_code && (
          <section className="rounded-3xl bg-white p-5 text-center shadow-sm" aria-live="polite">
            <p className="text-lg">Give {justAdded.first_name} this code:</p>
            <p className="my-3 font-mono text-4xl font-bold tracking-[0.3em] text-judy-primary">
              {justAdded.invite_code}
            </p>
            <p className="text-base text-[#3F4454]">
              They open Hey Judy, sign in, go to Settings → “I'm a trusted person” and type the
              code.
            </p>
          </section>
        )}

        <section aria-labelledby="list-h" className="space-y-3">
          <h2 id="list-h" className="text-xl font-bold">
            People
          </h2>
          {list === null ? (
            <p className="text-lg text-[#5E6272]">Loading…</p>
          ) : list.length === 0 ? (
            <p className="rounded-2xl bg-white p-4 text-lg">No one yet.</p>
          ) : (
            <ul className="space-y-3">
              {list.map((s) => (
                <li
                  key={s.id}
                  className="flex items-center gap-3 rounded-2xl bg-white px-4 py-3 shadow-sm"
                >
                  <span className="flex-1">
                    <span className="block text-lg font-bold">{s.first_name}</span>
                    <span className="block text-base text-[#5E6272]">
                      {s.relationship ?? "Trusted person"} ·{" "}
                      {s.invite_status === "active"
                        ? "Connected"
                        : `Waiting · code ${s.invite_code ?? ""}`}
                      {s.crisis_alerts ? " · gets urgent alerts" : ""}
                    </span>
                  </span>
                  <button
                    type="button"
                    aria-label={`Remove ${s.first_name}`}
                    onClick={() => void remove(s)}
                    className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-[#5E6272] hover:bg-judy-canvas"
                  >
                    <Trash2 size={22} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <form
          onSubmit={add}
          className="space-y-3 rounded-3xl bg-white p-5 shadow-sm"
          aria-labelledby="add-h"
        >
          <h2 id="add-h" className="text-xl font-bold">
            Add a trusted person
          </h2>
          <label className="block">
            <span className="mb-1 block text-lg font-bold">Their first name</span>
            <input
              className={inputCls}
              value={name}
              maxLength={40}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-lg font-bold">Who are they to you?</span>
            <select className={inputCls} value={rel} onChange={(e) => setRel(e.target.value)}>
              {RELATIONSHIPS.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </label>
          <ToggleRow
            label="Tell them straight away if it's urgent"
            hint="Only if a message tells you to hurt yourself."
            checked={crisis}
            onChange={setCrisis}
          />
          <PrimaryButton type="submit" disabled={busy || !name.trim()}>
            {busy ? "Adding…" : "Add and get a code"}
          </PrimaryButton>
          <p className="text-base text-[#5E6272]">
            Judy also hides this person's name in your chats, so the AI never sees it.
          </p>
        </form>
      </div>
    </AppFrame>
  );
}
