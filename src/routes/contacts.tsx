import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { toast } from "sonner";
import { Gate } from "@/components/judy/session";
import { AppFrame, Orb, StatusPill, inputCls } from "@/components/judy/ui";
import {
  errorText,
  latestCheckByThread,
  listThreads,
  type LastCheck,
  type Thread,
} from "@/lib/judy-db";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/contacts")({
  head: () => ({ meta: [{ title: "Contacts · Hey Judy" }] }),
  component: () => (
    <Gate need="person">
      <Contacts />
    </Gate>
  ),
});

const LETTERS = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ", "#"];
const letterOf = (name: string) => {
  const c = name.trim().charAt(0).toUpperCase();
  return c >= "A" && c <= "Z" ? c : "#";
};

// Everyone you've asked Judy about, A–Z, with a scrubbable letter index
// (from the Lovable design). Your chats stays sorted by most recent.
function Contacts() {
  const [threads, setThreads] = useState<Thread[] | null>(null);
  const [checks, setChecks] = useState<Record<string, LastCheck>>({});
  const [query, setQuery] = useState("");
  const [active, setActive] = useState<string | null>(null);
  const [scrubbing, setScrubbing] = useState(false);
  const indexRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    Promise.all([listThreads(), latestCheckByThread()])
      .then(([t, c]) => {
        setThreads(t);
        setChecks(c);
      })
      .catch((e) => {
        setThreads([]);
        toast.error("Could not load your contacts: " + errorText(e));
      });
  }, []);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = (threads ?? [])
      .filter((t) => !q || t.nickname.toLowerCase().includes(q))
      .sort((a, b) => a.nickname.localeCompare(b.nickname, "en", { sensitivity: "base" }));
    const map = new Map<string, Thread[]>();
    for (const t of list) {
      const l = letterOf(t.nickname);
      map.set(l, [...(map.get(l) ?? []), t]);
    }
    return LETTERS.filter((l) => map.has(l)).map((l) => ({ letter: l, people: map.get(l)! }));
  }, [threads, query]);
  const present = new Set(groups.map((g) => g.letter));

  const jumpTo = (letter: string) => {
    // Nearest letter that has people, at or after the one touched.
    const start = LETTERS.indexOf(letter);
    const target =
      LETTERS.slice(start).find((l) => present.has(l)) ??
      [...LETTERS.slice(0, start)].reverse().find((l) => present.has(l));
    if (!target) return;
    setActive(target);
    document
      .getElementById("letter-" + target)
      ?.scrollIntoView({ block: "start", behavior: scrubbing ? "auto" : "smooth" });
  };

  const letterAtY = (clientY: number) => {
    const el = indexRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const i = Math.floor(((clientY - r.top) / r.height) * LETTERS.length);
    return LETTERS[Math.max(0, Math.min(LETTERS.length - 1, i))] ?? null;
  };

  const endScrub = () => {
    setScrubbing(false);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setActive(null), 700);
  };

  return (
    <AppFrame tabs>
      <header className="flex items-center justify-between px-5 pb-3 pt-5">
        <h1 className="text-3xl font-bold">Contacts</h1>
        <Link
          to="/help"
          className="inline-flex min-h-11 items-center rounded-full bg-white px-4 text-base font-bold text-judy-primary shadow-sm hover:bg-judy-lilac"
        >
          Get help
        </Link>
      </header>
      <div className="px-5">
        <label className="relative block">
          <span className="sr-only">Search contacts</span>
          <Search
            size={20}
            aria-hidden="true"
            className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[#6B6F7E]"
          />
          <input
            type="search"
            className={inputCls + " rounded-full border-transparent bg-judy-lilac/70 pl-11"}
            placeholder="Search contacts"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </div>

      <div className="relative flex-1 pb-6 pl-5 pr-10 pt-2">
        {threads === null ? (
          <p className="pt-4 text-lg text-[#5E6272]">Loading…</p>
        ) : groups.length === 0 ? (
          <p className="mt-4 rounded-3xl bg-white p-5 text-lg shadow-sm">
            {threads.length === 0
              ? "No one yet. Go to Your chats and tap “Check someone new”."
              : `No one called “${query.trim()}”.`}
          </p>
        ) : (
          groups.map((g) => (
            <section
              key={g.letter}
              id={"letter-" + g.letter}
              aria-labelledby={"h-" + g.letter}
              className="scroll-mt-4"
            >
              <h2
                id={"h-" + g.letter}
                className={cn(
                  "pb-1 pt-4 text-lg font-bold",
                  active === g.letter ? "text-judy-primary" : "text-[#5E6272]",
                )}
              >
                {g.letter}
              </h2>
              <ul>
                {g.people.map((t) => {
                  const last = checks[t.id];
                  return (
                    <li
                      key={t.id}
                      className={cn(
                        "transition-opacity",
                        active && active !== g.letter && "opacity-40",
                      )}
                    >
                      <Link
                        to="/chat/$threadId"
                        params={{ threadId: t.id }}
                        search={{}}
                        className="flex min-h-16 items-center gap-4 rounded-2xl px-2 py-2 hover:bg-white focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-judy-primary/30"
                      >
                        <Orb
                          mood={last ? last.colour : "neutral"}
                          size={52}
                          animate={false}
                          label=""
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-lg font-bold">{t.nickname}</span>
                          {last ? (
                            <StatusPill colour={last.colour} className="mt-1 text-sm" />
                          ) : (
                            <span className="block text-base text-[#5E6272]">Not checked yet</span>
                          )}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))
        )}

        {/* A–Z index: tap or drag to jump */}
        {groups.length > 0 && (
          <div
            ref={indexRef}
            role="navigation"
            aria-label="Jump to letter"
            className="fixed right-1 top-1/2 z-30 flex -translate-y-1/2 touch-none select-none flex-col items-center py-1"
            style={{ right: "max(0.25rem, calc((100vw - 28rem) / 2 + 0.25rem))" }}
            onPointerDown={(e) => {
              (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
              indexRef.current?.setPointerCapture(e.pointerId);
              setScrubbing(true);
              const l = letterAtY(e.clientY);
              if (l) jumpTo(l);
            }}
            onPointerMove={(e) => {
              if (!scrubbing) return;
              const l = letterAtY(e.clientY);
              if (l && l !== active) jumpTo(l);
            }}
            onPointerUp={endScrub}
            onPointerCancel={endScrub}
          >
            {LETTERS.map((l) => (
              <button
                key={l}
                type="button"
                tabIndex={present.has(l) ? 0 : -1}
                aria-label={present.has(l) ? `Jump to ${l}` : `No contacts under ${l}`}
                onClick={() => jumpTo(l)}
                className={cn(
                  "flex h-[1.15rem] w-6 items-center justify-center rounded-full text-xs font-bold",
                  active === l
                    ? "bg-judy-primary text-white"
                    : present.has(l)
                      ? "text-judy-primary"
                      : "text-[#A6A6B2]",
                )}
              >
                {l}
              </button>
            ))}
          </div>
        )}

        {/* Big letter bubble while scrubbing */}
        {scrubbing && active && (
          <div
            aria-hidden="true"
            className="pointer-events-none fixed left-1/2 top-1/2 z-40 flex h-24 w-24 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-judy-primary text-5xl font-bold text-white shadow-lg"
          >
            {active}
          </div>
        )}
      </div>
    </AppFrame>
  );
}
