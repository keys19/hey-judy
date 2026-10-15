import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Camera,
  ClipboardPaste,
  MessageSquareText,
  Plus,
  Send,
  Sparkles,
  Phone,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Gate, useJudy } from "@/components/judy/session";
import {
  AppFrame,
  JudyBubble,
  Orb,
  PrimaryButton,
  SecondaryButton,
  StatusCard,
  UserBubble,
  cardSpeech,
  inputCls,
  speak,
} from "@/components/judy/ui";
import { BottomSheet } from "@/components/judy/BottomSheet";
import { BehindTheScenes } from "@/components/judy/BehindTheScenes";
import { shrinkScreenshot } from "@/components/judy/screenshot";
import { judyTurnFn } from "@/lib/judy.functions";
import {
  clockTime,
  db,
  errorText,
  listMessages,
  listThreads,
  saveUserResponse,
  shareAlert,
  type AgentLogRow,
  type StoredMessage,
  type Thread,
} from "@/lib/judy-db";
import type { CardAction, ReplyCard, TurnResult } from "@/lib/pipeline/judy-turn";
import type { ImageInput } from "@/lib/pipeline/judy";

export const Route = createFileRoute("/chat/$threadId")({
  validateSearch: (s: Record<string, unknown>): { start?: number } =>
    s["start"] === 1 || s["start"] === "1" ? { start: 1 } : {},
  head: () => ({ meta: [{ title: "Ask Judy · Hey Judy" }] }),
  component: () => (
    <Gate need="person">
      <ChatPage />
    </Gate>
  ),
});

type Busy = null | { checking: boolean; progress: string };
type ShareMode = "menu" | "screenshot" | "paste" | "describe";
type InfoSheet = null | "what_checked" | "check_carefully" | "who_could_i_ask";

const ERROR_TEXT = "Something went wrong. Your screenshot was not saved. Try again.";

function ChatPage() {
  const { threadId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const { profile } = useJudy();
  const turn = useServerFn(judyTurnFn);

  const [thread, setThread] = useState<Thread | null>(null);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [messages, setMessages] = useState<StoredMessage[] | null>(null);
  const [localUser, setLocalUser] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<Busy>(null);
  const [judgeLines, setJudgeLines] = useState<AgentLogRow[]>([]);
  const [text, setText] = useState("");
  const [share, setShare] = useState<ShareMode | null>(null);
  const [info, setInfo] = useState<InfoSheet>(null);
  const [consent, setConsent] = useState<ReplyCard | null>(null);
  const [crisis, setCrisis] = useState<ReplyCard | null>(null);
  const started = useRef(false);
  const endRef = useRef<HTMLDivElement>(null);

  const reload = useCallback(async () => {
    const m = await listMessages(threadId);
    setMessages(m);
    return m;
  }, [threadId]);

  // ---- run one turn with live progress ----
  const runTurn = useCallback(
    async (
      action: "start" | "answer" | "share",
      opts: { text?: string; image?: ImageInput; label?: string } = {},
    ) => {
      const runId = crypto.randomUUID();
      const lastQ = [...(messages ?? [])].reverse().find((m) => m.role === "judy");
      const checking =
        action === "share" || (lastQ?.kind === "question" && lastQ.body.source === "clarify");
      setFailed(false);
      setLocalUser(action === "start" ? null : (opts.label ?? opts.text ?? null));
      setBusy({ checking, progress: checking ? "Reading the messages…" : "" });

      const channel = db
        .channel("run-" + runId)
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "agent_log", filter: `run_id=eq.${runId}` },
          (payload) => {
            const row = payload.new as AgentLogRow;
            if (row.audience === "user") setBusy((b) => (b ? { ...b, progress: row.note } : b));
            else setJudgeLines((ls) => [...ls, row]);
          },
        );
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, 2500);
        channel.subscribe((status) => {
          if (status === "SUBSCRIBED" || status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            clearTimeout(t);
            resolve();
          }
        });
      });

      try {
        const result = (await turn({
          data: {
            threadId,
            runId,
            action,
            ...(opts.text?.trim() ? { text: opts.text.trim() } : {}),
            ...(opts.image ? { image: opts.image } : {}),
          },
        })) as TurnResult;
        await reload();
        setLocalUser(null);
        if (result.message.kind === "result") {
          const card = result.message.body;
          if (card.crisis) setCrisis(card);
          if (profile.read_aloud) speak(cardSpeech(card));
        } else if (profile.read_aloud && result.message.kind === "question") {
          speak(result.message.body.text);
        }
      } catch (e) {
        console.error(e);
        await reload().catch(() => {});
        setLocalUser(null);
        setFailed(true);
        toast.error(errorText(e).slice(0, 200));
      } finally {
        setBusy(null);
        void db.removeChannel(channel);
      }
    },
    [messages, threadId, turn, reload, profile.read_aloud],
  );

  // ---- load ----
  useEffect(() => {
    started.current = false;
    setMessages(null);
    setJudgeLines([]);
    (async () => {
      const [{ data, error }, all] = await Promise.all([
        db
          .from("threads")
          .select("id, nickname, last_colour, last_used_at, created_at, kind, pending")
          .eq("id", threadId)
          .maybeSingle(),
        listThreads(),
      ]);
      if (error) throw error;
      if (!data) {
        toast.error("That chat was not found.");
        void navigate({ to: "/" });
        return;
      }
      setThread(data as Thread);
      setThreads(all);
      await reload();
    })().catch((e) => toast.error("Could not load this chat: " + errorText(e)));
  }, [threadId, navigate, reload]);

  // New friend: Judy starts with the 3 questions.
  useEffect(() => {
    if (messages && messages.length === 0 && !started.current && !busy) {
      started.current = true;
      void runTurn("start");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, busy, localUser, failed]);

  const lastJudy = useMemo(
    () => [...(messages ?? [])].reverse().find((m) => m.role === "judy") ?? null,
    [messages],
  );
  const openQuestion = lastJudy?.kind === "question" ? lastJudy.body : null;
  const intakeOpen = openQuestion?.source === "intake";

  const send = () => {
    const t = text.trim();
    if (!t || busy) return;
    setText("");
    if (openQuestion) void runTurn("answer", { text: t });
    else void runTurn("share", { text: t });
  };

  // ---- card buttons ----
  const onAction = (card: ReplyCard) => (a: CardAction) => {
    void saveUserResponse(card.check_id, a.id);
    switch (a.id) {
      case "done":
      case "check_first":
        toast.success("Saved. I'm here if you need me.");
        break;
      case "what_checked":
      case "check_carefully":
      case "who_could_i_ask":
        setInfo(a.id);
        break;
      case "ask_someone":
      case "ask_trusted_person":
        setConsent(card);
        break;
      case "try_again":
        setShare("screenshot");
        break;
      case "describe":
        setShare("describe");
        break;
      default:
        break;
    }
  };

  const doShareAlert = async (card: ReplyCard) => {
    const kind = card.colour === "red" ? "red" : "amber";
    try {
      const n = await shareAlert(threadId, kind);
      setConsent(null);
      if (n > 0) toast.success("Your trusted person has been told. They will check in with you.");
      else {
        toast("You haven't added a trusted person yet.", {
          action: { label: "Add one", onClick: () => void navigate({ to: "/trusted" }) },
        });
        setInfo("who_could_i_ask");
      }
    } catch (e) {
      toast.error("Could not send the alert: " + errorText(e));
    }
  };

  if (!thread || messages === null)
    return (
      <AppFrame className="items-center justify-center">
        <Orb mood="thinking" size={90} label="Loading chat" />
      </AppFrame>
    );

  const latestResultId = [...messages].reverse().find((m) => m.kind === "result")?.id;

  return (
    <AppFrame className="h-dvh">
      {/* Header: Ask Judy about [name ▾] */}
      <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-[#E3DCE8] bg-judy-canvas/95 px-3 py-2 backdrop-blur">
        <Link
          to="/"
          aria-label="Back to my chats"
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full hover:bg-white"
        >
          <ArrowLeft size={24} />
        </Link>
        <label className="flex min-w-0 flex-1 items-center gap-1 text-lg">
          <span className="shrink-0 font-bold">Ask Judy about</span>
          <select
            aria-label="Choose who to ask about"
            className="min-h-11 min-w-0 flex-1 truncate rounded-xl border-0 bg-transparent font-bold text-judy-primary focus:ring-4 focus:ring-judy-primary/30"
            value={threadId}
            onChange={(e) =>
              void navigate({
                to: "/chat/$threadId",
                params: { threadId: e.target.value },
                search: {},
              })
            }
          >
            {threads.map((t) => (
              <option key={t.id} value={t.id}>
                {t.nickname}
              </option>
            ))}
          </select>
        </label>
        <BehindTheScenes threadId={threadId} live={judgeLines} />
      </header>

      {/* Messages */}
      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-5" aria-live="polite">
        {messages.map((m) => (
          <MessageView
            key={m.id}
            m={m}
            isLatestQuestion={lastJudy?.id === m.id && m.kind === "question" && !busy}
            onOption={(o) => void runTurn("answer", { text: o })}
            onAction={m.kind === "result" ? onAction(m.body) : undefined}
            showActions={m.kind === "result" && m.id === latestResultId}
          />
        ))}
        {localUser && <UserBubble>{localUser}</UserBubble>}
        {busy && (busy.checking ? <Checking progress={busy.progress} /> : <Typing />)}
        {failed && !busy && (
          <JudyBubble>
            <p>{ERROR_TEXT}</p>
            <button
              type="button"
              className="mt-2 min-h-11 font-bold text-judy-primary underline"
              onClick={() => setShare("menu")}
            >
              Try again
            </button>
          </JudyBubble>
        )}
        <div ref={endRef} />
      </div>

      {/* Quick actions + composer */}
      <div className="sticky bottom-0 border-t border-[#E3DCE8] bg-judy-canvas px-3 pb-[max(env(safe-area-inset-bottom),12px)] pt-2">
        {!openQuestion && !busy && (
          <div className="mb-2 flex gap-2 overflow-x-auto pb-1">
            <QuickAction
              icon={<Camera size={18} />}
              label="Add screenshot"
              onClick={() => setShare("screenshot")}
            />
            <QuickAction
              icon={<ClipboardPaste size={18} />}
              label="Paste message"
              onClick={() => setShare("paste")}
            />
            <QuickAction
              icon={<MessageSquareText size={18} />}
              label="Describe what happened"
              onClick={() => setShare("describe")}
            />
          </div>
        )}
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          {!intakeOpen && (
            <button
              type="button"
              aria-label="Share something to check"
              disabled={!!busy}
              onClick={() => setShare("menu")}
              className="inline-flex min-h-12 min-w-12 items-center justify-center rounded-full bg-white text-judy-primary shadow-sm disabled:opacity-50"
            >
              <Plus size={26} />
            </button>
          )}
          <label htmlFor="composer" className="sr-only">
            {openQuestion ? "Your answer" : "Message to check"}
          </label>
          <textarea
            id="composer"
            rows={1}
            value={text}
            disabled={!!busy}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder={openQuestion ? "Type your answer…" : "Type or paste here…"}
            className={inputCls + " max-h-36 min-h-12 resize-none rounded-3xl"}
          />
          <button
            type="submit"
            aria-label="Send"
            disabled={!!busy || !text.trim()}
            className="inline-flex min-h-12 min-w-12 items-center justify-center rounded-full bg-judy-primary text-white disabled:opacity-40"
          >
            <Send size={22} />
          </button>
        </form>
      </div>

      <ShareSheet
        mode={share}
        setMode={setShare}
        onSubmit={(t, image) => {
          setShare(null);
          void runTurn("share", {
            ...(t ? { text: t } : {}),
            ...(image ? { image } : {}),
            label: image ? (t ? `📷 Screenshot · ${t}` : "📷 Screenshot") : t,
          });
        }}
      />

      <BottomSheet
        open={!!consent}
        onOpenChange={(v) => !v && setConsent(null)}
        title="Share this safety alert with your trusted person?"
        description="They will see that there may be a risk. They will not see the exact message or contact name. You can still choose what to share."
      >
        <div className="space-y-3">
          <PrimaryButton onClick={() => consent && void doShareAlert(consent)}>
            Share alert
          </PrimaryButton>
          <SecondaryButton onClick={() => setConsent(null)}>Not now</SecondaryButton>
        </div>
      </BottomSheet>

      <InfoSheets which={info} onClose={() => setInfo(null)} />
      {crisis && <CrisisScreen card={crisis} onClose={() => setCrisis(null)} />}
    </AppFrame>
  );
}

// ---------------------------------------------------------------------------
function MessageView({
  m,
  isLatestQuestion,
  onOption,
  onAction,
  showActions,
}: {
  m: StoredMessage;
  isLatestQuestion: boolean;
  onOption: (o: string) => void;
  onAction: ((a: CardAction) => void) | undefined;
  showActions: boolean;
}) {
  if (m.role === "user") {
    if (m.kind === "shared")
      return (
        <UserBubble time={clockTime(m.created_at)}>
          {m.body.screenshot && <span className="block font-bold">📷 Screenshot shared</span>}
          {m.body.text && <span className="block whitespace-pre-wrap">{m.body.text}</span>}
        </UserBubble>
      );
    return <UserBubble time={clockTime(m.created_at)}>{m.body.text}</UserBubble>;
  }
  switch (m.kind) {
    case "text":
      return <JudyBubble speakText={m.body.text}>{m.body.text}</JudyBubble>;
    case "error":
      return (
        <JudyBubble>
          <p>{m.body.text}</p>
        </JudyBubble>
      );
    case "result":
      return (
        <div className="pl-11">
          <StatusCard card={m.body} onAction={onAction} compact={!showActions} />
        </div>
      );
    case "question":
      return (
        <div className="space-y-3">
          {m.body.card && (
            <div className="pl-11">
              <StatusCard card={m.body.card} compact />
            </div>
          )}
          <JudyBubble speakText={m.body.text}>
            <p className="font-bold">{m.body.text}</p>
          </JudyBubble>
          {isLatestQuestion && m.body.options.length > 0 && (
            <div className="flex flex-col gap-2 pl-11" role="group" aria-label="Choose an answer">
              {m.body.options.map((o) => (
                <button
                  key={o}
                  type="button"
                  onClick={() => onOption(o)}
                  className="min-h-12 rounded-2xl border-2 border-judy-primary bg-white px-4 py-2 text-left text-lg font-bold text-judy-primary hover:bg-judy-lilac focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-judy-primary/30"
                >
                  {o}
                </button>
              ))}
              {m.body.free_text && (
                <p className="text-base text-[#5E6272]">Or type your own answer below.</p>
              )}
            </div>
          )}
        </div>
      );
  }
}

function QuickAction({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full border-2 border-judy-primary/40 bg-white px-4 text-base font-bold text-judy-primary hover:bg-judy-lilac"
    >
      {icon}
      {label}
    </button>
  );
}

function Typing() {
  return (
    <div className="flex items-center gap-2" role="status" aria-label="Judy is typing">
      <Orb mood="thinking" size={36} animate={false} label="Judy" />
      <div className="flex gap-1 rounded-3xl bg-white px-4 py-4">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="judy-dot h-2.5 w-2.5 rounded-full bg-[#8E8E99]"
            style={{ animationDelay: `${i * 0.2}s` }}
          />
        ))}
      </div>
    </div>
  );
}

function Checking({ progress }: { progress: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-col items-center rounded-3xl bg-white px-6 py-8 text-center shadow-sm"
    >
      <Orb mood="thinking" size={110} label="Judy is checking" />
      <div className="mt-5 flex gap-1.5" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="judy-dot h-3 w-3 rounded-full bg-judy-primary"
            style={{ animationDelay: `${i * 0.2}s` }}
          />
        ))}
      </div>
      <p className="mt-4 text-xl font-bold">{progress || "Checking…"}</p>
      <p className="mt-1 text-base text-[#5E6272]">This can take about 30 seconds.</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
function ShareSheet({
  mode,
  setMode,
  onSubmit,
}: {
  mode: ShareMode | null;
  setMode: (m: ShareMode | null) => void;
  onSubmit: (text: string, image: ImageInput | null) => void;
}) {
  const [text, setText] = useState("");
  const [image, setImage] = useState<ImageInput | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (mode === null) {
      setText("");
      setImage(null);
      setPreview(null);
      setErr(null);
    }
  }, [mode]);

  const title =
    mode === "screenshot"
      ? "Add a screenshot"
      : mode === "paste"
        ? "Paste a message"
        : mode === "describe"
          ? "Describe what happened"
          : "What would you like to share?";

  return (
    <BottomSheet open={mode !== null} onOpenChange={(v) => !v && setMode(null)} title={title}>
      {mode === "menu" && (
        <div className="space-y-3">
          <MenuItem
            icon={<Camera />}
            label="Add screenshot"
            onClick={() => setMode("screenshot")}
          />
          <MenuItem
            icon={<ClipboardPaste />}
            label="Paste a message"
            onClick={() => setMode("paste")}
          />
          <MenuItem
            icon={<MessageSquareText />}
            label="Describe what happened"
            onClick={() => setMode("describe")}
          />
          <details className="rounded-2xl bg-judy-canvas p-4 text-lg">
            <summary className="min-h-11 cursor-pointer font-bold text-judy-primary">
              How do I take a screenshot?
            </summary>
            <ul className="mt-2 list-disc space-y-1 pl-6">
              <li>iPhone: press the side button and volume up together.</li>
              <li>Android: press power and volume down together.</li>
              <li>Computer: Windows key + Shift + S, or Cmd + Shift + 4 on a Mac.</li>
            </ul>
          </details>
        </div>
      )}

      {mode === "screenshot" && (
        <div className="space-y-4">
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="sr-only"
            aria-label="Choose a screenshot"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              setErr(null);
              shrinkScreenshot(f)
                .then((img) => {
                  setImage(img);
                  setPreview("data:image/jpeg;base64," + img.data);
                })
                .catch((x) => setErr(errorText(x)));
            }}
          />
          {preview ? (
            <div className="relative">
              <img
                src={preview}
                alt="Your screenshot"
                className="max-h-72 w-full rounded-2xl object-contain bg-judy-canvas"
              />
              <button
                type="button"
                aria-label="Remove screenshot"
                onClick={() => {
                  setImage(null);
                  setPreview(null);
                }}
                className="absolute right-2 top-2 inline-flex min-h-11 min-w-11 items-center justify-center rounded-full bg-white/90"
              >
                <X />
              </button>
            </div>
          ) : (
            <SecondaryButton onClick={() => fileRef.current?.click()}>
              <Camera size={22} /> Choose a screenshot
            </SecondaryButton>
          )}
          {err && <p className="text-lg text-judy-red">{err}</p>}
          <label className="block">
            <span className="mb-1 block text-lg font-bold">Anything to add? (optional)</span>
            <textarea
              className={inputCls}
              rows={2}
              value={text}
              maxLength={1000}
              onChange={(e) => setText(e.target.value)}
            />
          </label>
          <p className="text-base text-[#5E6272]">
            Your screenshot is never saved. Names and numbers are hidden before Judy reads it.
          </p>
          <PrimaryButton disabled={!image} onClick={() => onSubmit(text.trim(), image)}>
            Check with Judy
          </PrimaryButton>
        </div>
      )}

      {(mode === "paste" || mode === "describe") && (
        <div className="space-y-4">
          <label className="block">
            <span className="mb-1 block text-lg font-bold">
              {mode === "paste" ? "Paste the message here" : "Tell Judy what happened"}
            </span>
            <textarea
              className={inputCls}
              rows={6}
              autoFocus
              maxLength={4000}
              value={text}
              placeholder={
                mode === "paste"
                  ? "For example: Hey, can you lend me £50 tonight? Don't tell your support worker."
                  : "For example: They asked me for money again and said it was urgent."
              }
              onChange={(e) => setText(e.target.value)}
            />
          </label>
          <PrimaryButton disabled={!text.trim()} onClick={() => onSubmit(text.trim(), null)}>
            Check with Judy
          </PrimaryButton>
        </div>
      )}
    </BottomSheet>
  );
}

function MenuItem({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-16 w-full items-center gap-4 rounded-2xl bg-judy-canvas px-4 text-left text-lg font-bold hover:bg-judy-lilac focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-judy-primary/30"
    >
      <span
        className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-judy-primary"
        aria-hidden="true"
      >
        {icon}
      </span>
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
function InfoSheets({ which, onClose }: { which: InfoSheet; onClose: () => void }) {
  const content: Record<Exclude<InfoSheet, null>, { title: string; body: React.ReactNode }> = {
    what_checked: {
      title: "What did Judy check?",
      body: (
        <p className="text-lg">
          Judy read the messages, checked your rules and what happened before with this person. A
          second AI then double-checked the answer. Judy can still make mistakes.
        </p>
      ),
    },
    check_carefully: {
      title: "How to check carefully",
      body: (
        <ul className="list-disc space-y-2 pl-6 text-lg">
          <li>Don't rush. A real friend will wait.</li>
          <li>Check who they are using a number or account you already know.</li>
          <li>Never share codes, passwords, bank details or your PIN.</li>
          <li>Talk to someone you trust before sending money or gifts.</li>
        </ul>
      ),
    },
    who_could_i_ask: {
      title: "Who could I ask?",
      body: (
        <ul className="list-disc space-y-2 pl-6 text-lg">
          <li>A family member or friend you know in person</li>
          <li>Your support worker or carer</li>
          <li>Your GP</li>
          <li>
            Citizens Advice:{" "}
            <a className="font-bold text-judy-primary underline" href="tel:08082231133">
              0808 223 1133
            </a>
          </li>
          <li>
            Report a scam to Action Fraud:{" "}
            <a className="font-bold text-judy-primary underline" href="tel:03001232040">
              0300 123 2040
            </a>
          </li>
        </ul>
      ),
    },
  };
  const c = which ? content[which] : null;
  return (
    <BottomSheet open={!!c} onOpenChange={(v) => !v && onClose()} title={c?.title ?? ""}>
      <div className="space-y-5">
        {c?.body}
        {which === "who_could_i_ask" && (
          <Link to="/trusted" className="block text-lg font-bold text-judy-primary underline">
            Add a trusted person in Judy
          </Link>
        )}
        <PrimaryButton arrow={false} onClick={onClose}>
          OK
        </PrimaryButton>
      </div>
    </BottomSheet>
  );
}

function CrisisScreen({ card, onClose }: { card: ReplyCard; onClose: () => void }) {
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="crisis-h"
      className="fixed inset-0 z-[60] flex flex-col overflow-y-auto bg-[#B8401F] px-6 py-10 text-white"
    >
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col">
        <Sparkles size={40} aria-hidden="true" />
        <h1 id="crisis-h" className="mt-4 text-3xl font-bold">
          You are not alone. Please talk to someone now.
        </h1>
        <p className="mt-3 text-xl">
          {card.explanation || "This message is very worrying. You deserve support."}
        </p>
        <a
          href="tel:116123"
          className="mt-8 flex min-h-16 items-center justify-center gap-3 rounded-full bg-white text-xl font-bold text-[#8F2F15]"
        >
          <Phone /> Call Samaritans: 116 123
        </a>
        <p className="mt-2 text-center text-lg">Free, any time, day or night.</p>
        <a
          href="tel:999"
          className="mt-5 flex min-h-14 items-center justify-center rounded-full border-2 border-white text-xl font-bold"
        >
          In danger now? Call 999
        </a>
        {card.trusted_person_told && (
          <p className="mt-6 rounded-2xl bg-white/15 p-4 text-lg">
            Your trusted person has been told.
          </p>
        )}
        <button type="button" onClick={onClose} className="mt-auto min-h-12 pt-8 text-lg underline">
          Back to the chat
        </button>
      </div>
    </div>
  );
}
