import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Camera, ChevronDown, CircleHelp, Plus, Send, X } from "lucide-react";
import { toast } from "sonner";
import { Gate, useJudy } from "@/components/judy/session";
import {
  AppFrame,
  JudyBubble,
  Orb,
  PrimaryButton,
  SecondaryButton,
  StatusCard,
  StatusPill,
  UserBubble,
  cardSpeech,
  inputCls,
  speak,
} from "@/components/judy/ui";
import { BottomSheet } from "@/components/judy/BottomSheet";
import { BehindTheScenes } from "@/components/judy/BehindTheScenes";
import { FriendDrawer } from "@/components/judy/FriendDrawer";
import { MenuButton } from "@/components/judy/MenuSheet";
import { CrisisScreen, InfoSheets, type InfoSheet } from "@/components/judy/ChatSheets";
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
import { MAX_IMAGES, type ImageInput } from "@/lib/pipeline/judy";

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
type Shot = { id: string; img: ImageInput; url: string };
type LocalUser = { text: string | null; urls: string[] };

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
  const [localUser, setLocalUser] = useState<LocalUser | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<Busy>(null);
  const [judgeLines, setJudgeLines] = useState<AgentLogRow[]>([]);
  const [text, setText] = useState("");
  const [shots, setShots] = useState<Shot[]>([]);
  // Screenshots stay only in this browser tab so you can see what you sent.
  // They are never saved anywhere.
  const [sessionShots, setSessionShots] = useState<Record<string, string[]>>({});
  const [info, setInfo] = useState<InfoSheet>(null);
  const [consent, setConsent] = useState<ReplyCard | null>(null);
  const [crisis, setCrisis] = useState<ReplyCard | null>(null);
  const [drawer, setDrawer] = useState(false);
  const started = useRef(false);
  const endRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  const addFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const room = MAX_IMAGES - shots.length;
    if (room <= 0) {
      toast("You can add up to " + MAX_IMAGES + " screenshots.");
      return;
    }
    const picked = Array.from(files).slice(0, room);
    if (files.length > room) toast("Only the first " + MAX_IMAGES + " screenshots were added.");
    try {
      const made = await Promise.all(
        picked.map(async (f) => {
          const img = await shrinkScreenshot(f, picked.length + shots.length > 1 ? 1280 : 1600);
          return { id: crypto.randomUUID(), img, url: "data:image/jpeg;base64," + img.data };
        }),
      );
      setShots((s) => [...s, ...made].slice(0, MAX_IMAGES));
    } catch (e) {
      toast.error(errorText(e));
    }
  };

  const reload = useCallback(async () => {
    const m = await listMessages(threadId);
    setMessages(m);
    return m;
  }, [threadId]);

  // ---- run one turn with live progress ----
  const runTurn = useCallback(
    async (
      action: "start" | "answer" | "share",
      opts: { text?: string; images?: ImageInput[]; urls?: string[] } = {},
    ) => {
      const runId = crypto.randomUUID();
      const lastQ = [...(messages ?? [])].reverse().find((m) => m.role === "judy");
      const checking =
        action === "share" || (lastQ?.kind === "question" && lastQ.body.source === "clarify");
      setFailed(false);
      setLocalUser(
        action === "start" ? null : { text: opts.text?.trim() || null, urls: opts.urls ?? [] },
      );
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
            ...(opts.images?.length ? { images: opts.images } : {}),
          },
        })) as TurnResult;
        const fresh = await reload();
        if (opts.urls?.length) {
          const mine = [...fresh].reverse().find((m) => m.role === "user" && m.kind === "shared");
          if (mine) setSessionShots((m) => ({ ...m, [mine.id]: opts.urls! }));
        }
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

  const canAttach = !openQuestion;
  const send = () => {
    const t = text.trim();
    if (busy) return;
    if (openQuestion) {
      if (!t) return;
      setText("");
      void runTurn("answer", { text: t });
      return;
    }
    if (!t && !shots.length) return;
    const images = shots.map((x) => x.img);
    const urls = shots.map((x) => x.url);
    setText("");
    setShots([]);
    void runTurn("share", { ...(t ? { text: t } : {}), images, urls });
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
        fileRef.current?.click();
        break;
      case "describe":
        composerRef.current?.focus();
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

  const latestColour =
    ([...messages].reverse().find((m) => m.kind === "result")?.body as ReplyCard | undefined)
      ?.colour ?? null;
  const latestResultId = [...messages].reverse().find((m) => m.kind === "result")?.id;

  return (
    <AppFrame className="h-dvh">
      {/* Header: Ask Judy about [name ▾] */}
      <header className="sticky top-0 z-30 border-b border-[#E3DCE8] bg-judy-canvas/95 px-3 pb-3 pt-2 backdrop-blur">
        <div className="flex items-center justify-between gap-2">
          <Link
            to="/"
            aria-label="Back to my chats"
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full hover:bg-white"
          >
            <ArrowLeft size={24} />
          </Link>
          <div className="flex items-center gap-1">
            <BehindTheScenes threadId={threadId} live={judgeLines} />
            <MenuButton thread={{ id: threadId, nickname: thread.nickname }} />
          </div>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 px-2">
          <h1 className="shrink-0 text-2xl font-bold">Ask Judy about</h1>
          <button
            type="button"
            onClick={() => setDrawer(true)}
            aria-label={`${thread.nickname}. Change who you are asking about`}
            className="inline-flex min-h-11 min-w-0 max-w-full items-center gap-1 rounded-full border-2 border-judy-primary/40 bg-white px-4 text-lg font-bold text-judy-primary"
          >
            <span className="truncate">{thread.nickname}</span>
            <ChevronDown size={18} aria-hidden="true" />
          </button>
        </div>
        <div className="mt-1.5 px-2">
          {latestColour ? (
            <StatusPill colour={latestColour} className="text-sm" />
          ) : (
            <span className="text-base text-[#5E6272]">Not checked yet</span>
          )}
        </div>
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
            urls={sessionShots[m.id]}
          />
        ))}
        {localUser && (
          <UserBubble>
            <SharedContent
              text={localUser.text}
              urls={localUser.urls}
              count={localUser.urls.length}
            />
          </UserBubble>
        )}
        {busy && (busy.checking ? <Checking progress={busy.progress} /> : <Typing />)}
        {failed && !busy && (
          <JudyBubble>
            <p>{ERROR_TEXT}</p>
            <button
              type="button"
              className="mt-2 min-h-11 font-bold text-judy-primary underline"
              onClick={() => composerRef.current?.focus()}
            >
              Try again
            </button>
          </JudyBubble>
        )}
        <div ref={endRef} />
      </div>

      {/* Composer: screenshots and/or text, sent together */}
      <div className="sticky bottom-0 border-t border-[#E3DCE8] bg-judy-canvas px-3 pb-[max(env(safe-area-inset-bottom),12px)] pt-2">
        <input
          ref={fileRef}
          type="file"
          multiple
          accept="image/png,image/jpeg,image/webp,image/gif"
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => {
            void addFiles(e.target.files);
            e.target.value = "";
          }}
        />
        {canAttach && !busy && shots.length === 0 && (
          <div className="mb-2 flex gap-2 overflow-x-auto pb-1">
            <QuickAction
              icon={<Camera size={18} />}
              label="Add screenshots"
              onClick={() => fileRef.current?.click()}
            />
            <QuickAction
              icon={<CircleHelp size={18} />}
              label="How do I take a screenshot?"
              onClick={() => setInfo("how_screenshot")}
            />
          </div>
        )}
        {shots.length > 0 && (
          <div className="mb-2">
            <ul className="flex gap-2 overflow-x-auto pb-1" aria-label="Screenshots to send">
              {shots.map((x, i) => (
                <li key={x.id} className="relative shrink-0">
                  <img
                    src={x.url}
                    alt={`Screenshot ${i + 1}`}
                    className="h-24 w-16 rounded-xl border-2 border-white object-cover shadow-sm"
                  />
                  <button
                    type="button"
                    aria-label={`Remove screenshot ${i + 1}`}
                    onClick={() => setShots((s) => s.filter((y) => y.id !== x.id))}
                    className="absolute -right-2 -top-2 inline-flex h-8 w-8 items-center justify-center rounded-full bg-judy-ink text-white shadow"
                  >
                    <X size={16} />
                  </button>
                </li>
              ))}
              {shots.length < MAX_IMAGES && (
                <li className="shrink-0">
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    aria-label="Add another screenshot"
                    className="inline-flex h-24 w-16 items-center justify-center rounded-xl border-2 border-dashed border-judy-primary/50 text-judy-primary"
                  >
                    <Plus size={24} />
                  </button>
                </li>
              )}
            </ul>
            <p className="mt-1 text-sm text-[#5E6272]">
              Add a note below if you like, then send. Screenshots are never saved.
            </p>
          </div>
        )}
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          {canAttach && (
            <button
              type="button"
              aria-label="Add screenshots"
              disabled={!!busy || shots.length >= MAX_IMAGES}
              onClick={() => fileRef.current?.click()}
              className="inline-flex min-h-12 min-w-12 items-center justify-center rounded-full bg-white text-judy-primary shadow-sm disabled:opacity-50"
            >
              <Plus size={26} />
            </button>
          )}
          <label htmlFor="composer" className="sr-only">
            {openQuestion ? "Your answer" : "Paste the messages or describe what happened"}
          </label>
          <textarea
            id="composer"
            ref={composerRef}
            rows={Math.min(5, Math.max(1, text.split("\n").length))}
            value={text}
            disabled={!!busy}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder={openQuestion ? "Type your answer…" : "Paste or describe…"}
            className={inputCls + " max-h-40 min-h-12 resize-none rounded-3xl"}
          />
          <button
            type="submit"
            aria-label={shots.length ? "Send to Judy to check" : "Send"}
            disabled={!!busy || (!text.trim() && (openQuestion ? true : shots.length === 0))}
            className="inline-flex min-h-12 min-w-12 items-center justify-center rounded-full bg-judy-primary text-white disabled:opacity-40"
          >
            <Send size={22} />
          </button>
        </form>
      </div>

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

      <FriendDrawer open={drawer} onOpenChange={setDrawer} threads={threads} currentId={threadId} />
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
  urls,
}: {
  m: StoredMessage;
  isLatestQuestion: boolean;
  onOption: (o: string) => void;
  onAction: ((a: CardAction) => void) | undefined;
  showActions: boolean;
  urls: string[] | undefined;
}) {
  if (m.role === "user") {
    if (m.kind === "shared")
      return (
        <UserBubble time={clockTime(m.created_at)}>
          <SharedContent
            text={m.body.text}
            urls={urls ?? []}
            count={m.body.screenshots ?? (m.body.screenshot ? 1 : 0)}
          />
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

// What the person shared: screenshot thumbnails (this session only) and/or text.
function SharedContent({
  text,
  urls,
  count,
}: {
  text: string | null;
  urls: string[];
  count: number;
}) {
  return (
    <>
      {urls.length > 0 ? (
        <span className="mb-1 flex flex-wrap gap-1.5">
          {urls.map((u, i) => (
            <img
              key={i}
              src={u}
              alt={`Screenshot ${i + 1} you shared`}
              className="h-28 w-auto max-w-[45%] rounded-lg object-cover"
            />
          ))}
        </span>
      ) : count > 0 ? (
        <span className="block font-bold">
          📷 {count === 1 ? "1 screenshot" : `${count} screenshots`} shared (not saved)
        </span>
      ) : null}
      {text && <span className="block whitespace-pre-wrap">{text}</span>}
    </>
  );
}
