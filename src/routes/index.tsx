import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { toast } from "sonner";
import { Gate, useJudy } from "@/components/judy/session";
import { AppFrame, Orb, PrimaryButton, displayName, inputCls } from "@/components/judy/ui";
import { BottomSheet } from "@/components/judy/BottomSheet";
import { PersonRowContent } from "@/components/judy/PersonRow";
import { MenuButton } from "@/components/judy/MenuSheet";
import {
  createThread,
  errorText,
  latestCheckByThread,
  listThreads,
  type LastCheck,
  type Thread,
} from "@/lib/judy-db";

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
  const [checks, setChecks] = useState<Record<string, LastCheck>>({});
  const [adding, setAdding] = useState(false);
  const [nickname, setNickname] = useState("");
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");

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

  const name = displayName(profile.first_name);
  const hello = name ? `Hi ${name}` : "Hi there";
  const q = query.trim().toLowerCase();
  const shown = (threads ?? []).filter((t) => !q || t.nickname.toLowerCase().includes(q));

  return (
    <AppFrame tabs className="px-5">
      <div className="flex justify-end pt-3">
        <MenuButton />
      </div>
      <section className="flex flex-col items-center text-center">
        <Orb size={128} />
        <h1 className="mt-4 text-3xl font-bold">{hello}</h1>
        <p className="mt-2 text-xl font-bold text-judy-ink">
          Not sure about a message?{" "}
          <span className="whitespace-nowrap text-judy-primary">Ask Judy.</span>
        </p>
        <p className="mt-1 text-lg text-[#5E6272]">Judy advises. You decide.</p>
        <div className="mt-5 w-full">
          <PrimaryButton onClick={() => setAdding(true)}>Check someone new</PrimaryButton>
        </div>
      </section>

      <WhatJudyIs open={threads !== null && threads.length === 0} />

      <section className="mt-8" aria-labelledby="chats-h">
        <h2 id="chats-h" className="mb-3 text-xl font-bold">
          Your chats
        </h2>
        {threads && threads.length > 0 && (
          <label className="relative mb-3 block">
            <span className="sr-only">Search for a person</span>
            <Search
              size={20}
              aria-hidden="true"
              className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[#6B6F7E]"
            />
            <input
              type="search"
              className={inputCls + " rounded-full pl-11"}
              placeholder="Search for a person"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
        )}
        {threads === null ? (
          <p className="text-lg text-[#5E6272]">Loading…</p>
        ) : threads.length === 0 ? (
          <p className="rounded-3xl bg-white p-5 text-lg text-[#3F4454] shadow-sm">
            No one yet. Tap “Check someone new” to start.
          </p>
        ) : shown.length === 0 ? (
          <p className="rounded-3xl bg-white p-5 text-lg text-[#3F4454] shadow-sm" role="status">
            No one called “{query.trim()}”.
          </p>
        ) : (
          <ul className="space-y-3 pb-4">
            {shown.map((t) => (
              <li key={t.id}>
                <Link
                  to="/chat/$threadId"
                  params={{ threadId: t.id }}
                  search={{}}
                  className="flex min-h-20 items-center gap-4 rounded-3xl bg-white px-4 py-4 shadow-[0_8px_24px_rgb(61_53_67/0.08)] transition hover:bg-judy-lilac focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-judy-primary/30"
                >
                  <PersonRowContent nickname={t.nickname} last={checks[t.id]} />
                </Link>
              </li>
            ))}
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

// What Judy is and isn't, said plainly. Open for new users, folded later.
function WhatJudyIs({ open }: { open: boolean }) {
  const is = [
    "An AI helper that spots warning signs",
    "Remembers what happened with each person",
    "Here before you decide what to do",
  ];
  const isNot = [
    "A person",
    "Able to promise someone is trustworthy",
    "Going to tell you what to do. You decide.",
  ];
  return (
    <details
      open={open}
      className="group mt-6 rounded-3xl bg-white p-4 shadow-sm [&_summary::-webkit-details-marker]:hidden"
    >
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between text-lg font-bold">
        What Judy is and isn't
        <ChevronDown
          size={20}
          aria-hidden="true"
          className="text-judy-primary transition group-open:rotate-180"
        />
      </summary>
      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        <ul className="space-y-2" aria-label="Judy is">
          {is.map((t) => (
            <li key={t} className="flex items-start gap-3 text-lg">
              <span
                aria-hidden="true"
                className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-judy-green"
              >
                <Check size={16} strokeWidth={3} color="#1D2433" />
              </span>
              {t}
            </li>
          ))}
        </ul>
        <ul className="space-y-2" aria-label="Judy is not">
          {isNot.map((t) => (
            <li key={t} className="flex items-start gap-3 text-lg">
              <span
                aria-hidden="true"
                className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#E3DCE8]"
              >
                <X size={16} strokeWidth={3} color="#1D2433" />
              </span>
              <span>
                <span className="sr-only">Not </span>
                {t}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}
