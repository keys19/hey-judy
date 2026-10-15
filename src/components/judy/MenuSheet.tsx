import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { History, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { db, errorText } from "@/lib/judy-db";
import type { Colour, ReplyCard } from "@/lib/pipeline/judy-turn";
import { BottomSheet } from "./BottomSheet";
import { PrimaryButton, SecondaryButton, StatusPill } from "./ui";

// "Relationship history" for the person you're asking about: your answers,
// every past check, and deleting the chat. Opened from the chat header.
export function HistoryButton({ thread }: { thread: { id: string; nickname: string } }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Relationship history with ${thread.nickname}`}
        className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-white px-3 text-base font-bold text-judy-ink shadow-sm hover:bg-judy-lilac"
      >
        <History size={20} aria-hidden="true" /> History
      </button>
      <HistorySheet open={open} onClose={() => setOpen(false)} thread={thread} />
    </>
  );
}

type CheckRow = { id: string; colour: Colour; created_at: string; reply: ReplyCard };
const ANSWER_LABELS: Record<string, string> = {
  how_met: "How you met",
  how_long: "How long you've known them",
  anything_else: "Anything else",
};

function HistorySheet({
  open,
  onClose,
  thread,
}: {
  open: boolean;
  onClose: () => void;
  thread: { id: string; nickname: string };
}) {
  const navigate = useNavigate();
  const [rows, setRows] = useState<CheckRow[] | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState(false);

  useEffect(() => {
    if (!open) return;
    setConfirm(false);
    Promise.all([
      db
        .from("checks")
        .select("id, colour, created_at, reply")
        .eq("thread_id", thread.id)
        .order("created_at", { ascending: false }),
      db.from("threads").select("answers").eq("id", thread.id).maybeSingle(),
    ])
      .then(([c, t]) => {
        setRows((c.data ?? []) as CheckRow[]);
        setAnswers(
          ((t.data as { answers?: Record<string, string> } | null)?.answers ?? {}) as Record<
            string,
            string
          >,
        );
      })
      .catch(() => setRows([]));
  }, [open, thread.id]);

  const remove = async () => {
    const { error } = await db.from("threads").delete().eq("id", thread.id);
    if (error) {
      toast.error("Could not delete: " + errorText(error));
      return;
    }
    toast.success("Chat deleted.");
    onClose();
    void navigate({ to: "/" });
  };

  return (
    <BottomSheet
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title={`Relationship history — ${thread.nickname}`}
    >
      <div className="space-y-5">
        {Object.keys(answers).length > 0 && (
          <dl className="space-y-2 rounded-2xl bg-judy-canvas p-4">
            {Object.entries(answers).map(([k, v]) => (
              <div key={k}>
                <dt className="text-base font-bold text-[#5E6272]">{ANSWER_LABELS[k] ?? k}</dt>
                <dd className="text-lg">{v}</dd>
              </div>
            ))}
          </dl>
        )}
        {rows === null ? (
          <p className="text-lg text-[#5E6272]">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-lg">No checks yet.</p>
        ) : (
          <ol className="space-y-3">
            {rows.map((r) => (
              <li key={r.id} className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-[#E3DCE8]">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusPill colour={r.colour} className="text-sm" />
                  <span className="text-base text-[#5E6272]">
                    {new Date(r.created_at).toLocaleDateString("en-GB", {
                      weekday: "short",
                      day: "numeric",
                      month: "short",
                    })}
                  </span>
                </div>
                {r.reply?.explanation && <p className="mt-2 text-lg">{r.reply.explanation}</p>}
                {r.reply?.signs?.length > 0 && (
                  <ul className="mt-2 list-disc pl-6 text-base text-[#3F4454]">
                    {r.reply.signs.map((s, i) => (
                      <li key={i}>{s.label}</li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ol>
        )}
        {confirm ? (
          <div className="space-y-3 rounded-2xl bg-[#FDEDE8] p-4">
            <p className="text-lg">
              Delete everything about {thread.nickname}? This can't be undone.
            </p>
            <PrimaryButton arrow={false} className="bg-[#B8401F]" onClick={() => void remove()}>
              Yes, delete
            </PrimaryButton>
            <SecondaryButton onClick={() => setConfirm(false)}>Keep it</SecondaryButton>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirm(true)}
            className="inline-flex min-h-11 items-center gap-2 text-lg font-bold text-[#9A2E12] underline"
          >
            <Trash2 size={18} aria-hidden="true" /> Delete this chat
          </button>
        )}
      </div>
    </BottomSheet>
  );
}
