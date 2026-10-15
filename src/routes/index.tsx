import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { Gate, useJudy } from "@/components/judy/session";
import { AppFrame, Orb, PrimaryButton, STATUS, StatusCircle, inputCls } from "@/components/judy/ui";
import { BottomSheet } from "@/components/judy/BottomSheet";
import {
  createThread,
  errorText,
  latestCheckByThread,
  listThreads,
  timeAgo,
  type Thread,
} from "@/lib/judy-db";
import type { Colour } from "@/lib/pipeline/judy-turn";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Hey Judy" },
      { name: "description", content: "Not sure about a message? Ask Judy." },
    ],
  }),
  component: () => (
    <Gate need="person">
      <Home />
    </Gate>
  ),
});

function Home() {
  const { userId, profile } = useJudy();
  const navigate = useNavigate();
  const [threads, setThreads] = useState<Thread[] | null>(null);
  const [checks, setChecks] = useState<Record<string, { colour: Colour; created_at: string }>>({});
  const [adding, setAdding] = useState(false);
  const [nickname, setNickname] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([listThreads(), latestCheckByThread()])
      .then(([t, c]) => {
        setThreads(t);
        setChecks(c);
      })
      .catch((e) => {
        setThreads([]);
        toast.error("Could not load your chats: " + errorText(e));
      });
  }, []);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nickname.trim()) return;
    setBusy(true);
    try {
      const t = await createThread(userId, nickname);
      void navigate({ to: "/chat/$threadId", params: { threadId: t.id }, search: { start: 1 } });
    } catch (err) {
      toast.error("Could not add them: " + errorText(err));
      setBusy(false);
    }
  };

  const hello = profile.first_name ? `Hi ${profile.first_name}` : "Hi there";

  return (
    <AppFrame tabs className="px-5 pt-8">
      <section className="flex flex-col items-center text-center">
        <Orb size={140} />
        <h1 className="mt-6 text-3xl font-bold">{hello}</h1>
        <p className="mt-2 text-xl text-[#3F4454]">Not sure about a message? Ask Judy.</p>
        <div className="mt-6 w-full">
          <PrimaryButton onClick={() => setAdding(true)}>Check someone new</PrimaryButton>
        </div>
      </section>

      <section className="mt-10" aria-labelledby="chats-h">
        <h2 id="chats-h" className="mb-3 text-xl font-bold">
          People you've asked about
        </h2>
        {threads === null ? (
          <p className="text-lg text-[#5E6272]">Loading…</p>
        ) : threads.length === 0 ? (
          <p className="rounded-2xl bg-white p-4 text-lg text-[#3F4454]">
            No one yet. Tap “Check someone new” to start.
          </p>
        ) : (
          <ul className="space-y-3">
            {threads.map((t) => {
              const last = checks[t.id];
              return (
                <li key={t.id}>
                  <Link
                    to="/chat/$threadId"
                    params={{ threadId: t.id }}
                    search={{ start: 0 }}
                    className="flex min-h-16 items-center gap-4 rounded-2xl bg-white px-4 py-3 shadow-sm transition hover:shadow focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-judy-primary/30"
                  >
                    {last ? (
                      <StatusCircle colour={last.colour} size={40} />
                    ) : (
                      <span
                        aria-hidden="true"
                        className="flex h-10 w-10 items-center justify-center rounded-full bg-judy-lilac text-lg font-bold text-judy-primary"
                      >
                        {t.nickname.slice(0, 1).toUpperCase()}
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-lg font-bold">{t.nickname}</span>
                      <span className="block text-base text-[#5E6272]">
                        {last
                          ? `${STATUS[last.colour].word} · ${timeAgo(last.created_at)}`
                          : "Not checked yet"}
                      </span>
                    </span>
                    <ChevronRight aria-hidden="true" className="text-[#8C8F9C]" />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <BottomSheet
        open={adding}
        onOpenChange={setAdding}
        title="Who do you want to check?"
        description="Use a nickname. Judy keeps it private and never shares it."
      >
        <form onSubmit={add} className="space-y-4">
          <label className="block">
            <span className="mb-1 block text-lg font-bold">Their name or nickname</span>
            <input
              className={inputCls}
              autoFocus
              maxLength={40}
              placeholder="For example: Alex from the game"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
            />
          </label>
          <PrimaryButton type="submit" disabled={busy || !nickname.trim()}>
            {busy ? "Adding…" : "Start"}
          </PrimaryButton>
        </form>
      </BottomSheet>
    </AppFrame>
  );
}
