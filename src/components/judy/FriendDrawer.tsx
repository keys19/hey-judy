import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import {
  createThread,
  errorText,
  latestCheckByThread,
  type LastCheck,
  type Thread,
} from "@/lib/judy-db";
import { PersonRowContent } from "./PersonRow";
import { PrimaryButton, inputCls } from "./ui";
import { useJudy } from "./session";

// "Friend list" drawer (from the Lovable design): switch who you're asking
// about, or add someone new, without leaving the chat.
export function FriendDrawer({
  open,
  onOpenChange,
  threads,
  currentId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  threads: Thread[];
  currentId: string;
}) {
  const { userId } = useJudy();
  const navigate = useNavigate();
  const [checks, setChecks] = useState<Record<string, LastCheck>>({});
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open) return;
    setAdding(false);
    setQuery("");
    latestCheckByThread()
      .then(setChecks)
      .catch(() => setChecks({}));
  }, [open]);

  const go = (id: string) => {
    onOpenChange(false);
    if (id !== currentId)
      void navigate({ to: "/chat/$threadId", params: { threadId: id }, search: {} });
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-[88%] max-w-sm overflow-y-auto border-0 bg-judy-canvas p-5 text-judy-ink [&>button]:min-h-11 [&>button]:min-w-11 [&>button>svg]:h-6 [&>button>svg]:w-6"
      >
        <SheetTitle className="pr-10 text-2xl font-bold text-judy-ink">People</SheetTitle>
        <SheetDescription className="text-base text-[#5E6272]">
          Who do you want to ask Judy about?
        </SheetDescription>
        {threads.length > 3 && (
          <label className="relative mt-4 block">
            <span className="sr-only">Search for a person</span>
            <Search
              size={20}
              aria-hidden="true"
              className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[#6B6F7E]"
            />
            <input
              type="search"
              className={inputCls + " rounded-full pl-11"}
              placeholder="Search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
        )}
        <ul className="mt-5 space-y-3">
          {threads
            .filter(
              (t) => !query.trim() || t.nickname.toLowerCase().includes(query.trim().toLowerCase()),
            )
            .map((t) => {
              const selected = t.id === currentId;
              return (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => go(t.id)}
                    aria-current={selected ? "true" : undefined}
                    className={
                      "flex min-h-16 w-full items-center gap-3 rounded-2xl px-3 py-3 text-left shadow-sm focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-judy-primary/30 " +
                      (selected ? "border-2 border-judy-primary bg-judy-lilac" : "bg-white")
                    }
                  >
                    <PersonRowContent
                      nickname={t.nickname}
                      last={checks[t.id]}
                      selected={selected}
                    />
                  </button>
                </li>
              );
            })}
        </ul>
        {adding ? (
          <form
            className="mt-5 space-y-3 rounded-2xl bg-white p-4"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!name.trim()) return;
              setBusy(true);
              try {
                const t = await createThread(userId, name);
                setName("");
                go(t.id);
              } catch (err) {
                toast.error("Could not add them: " + errorText(err));
              } finally {
                setBusy(false);
              }
            }}
          >
            <label className="block">
              <span className="mb-1 block text-lg font-bold">Their name or nickname</span>
              <input
                className={inputCls}
                autoFocus
                maxLength={40}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <PrimaryButton type="submit" disabled={busy || !name.trim()}>
              Start
            </PrimaryButton>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="mt-5 flex min-h-12 w-full items-center justify-center gap-2 rounded-full border-2 border-judy-primary bg-white text-lg font-bold text-judy-primary hover:bg-judy-lilac"
          >
            <Plus size={20} aria-hidden="true" /> Check someone new
          </button>
        )}
      </SheetContent>
    </Sheet>
  );
}
