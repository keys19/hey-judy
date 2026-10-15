// Hey Judy — one conversation turn: intake questions, a check, or an answer to
// a follow-up question. The three agents only judge; everything the person
// sees (colour, card, buttons) and everything saved is decided here, in code.
import type { AgentConfigs } from "./defaults";
import type { AgentDrivers, PipelineStore } from "./contracts";
import { runPipeline } from "./runner";
import {
  ALWAYS_RED_SIGNS,
  SCREENSHOT_PLACEHOLDER,
  redactText,
  type FriendshipContext,
  type ImageInput,
  type NameRule,
  type Sign,
} from "./judy";
import type { FinalRiskReport, PipelineRunResult, ReaderOutput, StageView } from "./schemas";

// ---------------------------------------------------------------------------
// What the frontend receives (also stored in messages.body)
// ---------------------------------------------------------------------------
export type Colour = "green" | "amber" | "red" | "grey";
export type CardSign = { sign: Sign | "pattern" | "rule"; label: string };
export type CardAction = { id: string; label: string };
export type ReplyCard = {
  colour: Colour;
  title: string;
  summary: string;
  explanation: string; // Judy's own 1–2 sentence reason
  signs: CardSign[]; // up to 3
  what_you_can_do: string; // 1–2 gentle sentences, never an order
  actions: { primary: CardAction; secondary: CardAction };
  crisis: boolean; // true → show the crisis screen (Samaritans 116 123)
  trusted_person_told: boolean; // crisis alert was sent to a trusted person
  check_id: string | null;
};
export type JudyQuestion = {
  source: "intake" | "clarify";
  id: string;
  text: string;
  options: string[];
  free_text: boolean;
};
// A Judy message, exactly as saved in public.messages (role 'judy').
export type JudyMessage =
  | { kind: "text"; body: { text: string } }
  | { kind: "question"; body: JudyQuestion & { card: ReplyCard | null } }
  | { kind: "result"; body: ReplyCard }
  | { kind: "error"; body: { text: string } };
export type TurnResult = {
  status: "question" | "result" | "text" | "error";
  colour: Colour | null;
  message: JudyMessage;
};

export type TurnInput =
  | { action: "start" }
  | { action: "answer"; text: string }
  | { action: "share"; text?: string; image?: ImageInput; images?: ImageInput[] };

// ---------------------------------------------------------------------------
// Fixed wording (from the PRD)
// ---------------------------------------------------------------------------
export const STATUS_COPY: Record<Colour, { title: string; summary: string }> = {
  grey: { title: "Not enough information", summary: "I need a bit more detail." },
  green: { title: "No clear warning signs", summary: "Looks OK, but not a guarantee." },
  amber: { title: "Be careful", summary: "Some signs to watch." },
  red: { title: "High risk — stop and get help", summary: "This may be a scam." },
};

export const SIGN_LABELS: Record<Sign, string> = {
  none: "",
  flattery: "Lots of flattery",
  money_request: "Money request",
  gift_or_purchase_request: "Asked you to buy something",
  secrecy: "Asked for secrecy",
  isolation: "Turning you against people who help you",
  pressure_urgency: "Rushing you",
  guilt_or_emotional_pressure: "Making you feel guilty",
  personal_info_request: "Asked for personal details",
  bank_or_code_request: "Asked for bank details or codes",
  unexpected_link: "Unexpected link",
  meet_up_request: "Wants to meet up",
  private_photo_request: "Asked for private photos",
  threat: "Threat",
  self_harm_urging: "Urged you to hurt yourself",
};

export const INTAKE_QUESTIONS: Omit<JudyQuestion, "source">[] = [
  {
    id: "how_met",
    text: "How did you meet this person?",
    options: ["Online – a game, app or social media", "In person", "Through friends or family"],
    free_text: true,
  },
  {
    id: "how_long",
    text: "How long have you known them?",
    options: ["Less than a month", "1 to 6 months", "More than 6 months"],
    free_text: true,
  },
];
export const MAX_FOLLOW_UPS = 2;
const GREETING =
  "Hi! I can help you check messages from this person. You decide what to do. First, two quick questions.";
const INTAKE_DONE =
  "Thank you. Now show me the conversation. Add screenshots, paste the messages or tell me what happened. You can do more than one.";
const ERROR_TEXT = "Something went wrong with this check. Please try again.";
const ERROR_TEXT_SCREENSHOT =
  "Something went wrong with this check. Your screenshots were not saved. Please try again.";

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
const firstSentences = (s: string, n = 2) =>
  (s.match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g) ?? [s]).slice(0, n).join("").trim();
// Judy never promises someone is "safe".
export const noSafe = (s: string) =>
  s.replace(/\bsafely\b/gi, "carefully").replace(/\bsafe\b/gi, "protected");
const capitalise = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);
const stripSpeaker = (s: string) => s.replace(/^(them|me|unknown)\s*:\s*/i, "");
export const shortDate = (d: Date) =>
  d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });

function stageOutput<T>(result: PipelineRunResult, stage: StageView["stage"]): T | null {
  const found = [...result.stages]
    .reverse()
    .find((s) => s.stage === stage && s.status === "completed");
  return (found?.output as T) ?? null;
}
// Signs said by the other person (or unknown) in this check, once each, in order.
export function theirSigns(reader: ReaderOutput): Sign[] {
  const out: Sign[] = [];
  for (const f of reader.facts)
    if (f.speaker !== "me" && f.sign !== "none" && !out.includes(f.sign)) out.push(f.sign);
  return out;
}

// ---------------------------------------------------------------------------
// The colour rule — plain code, not a prompt
// ---------------------------------------------------------------------------
export type ColourDecision = { colour: Colour; reason: string; crisis: boolean };
export function colourRule(report: FinalRiskReport, reader: ReaderOutput): ColourDecision {
  const signs = theirSigns(reader);
  const crisis = signs.includes("self_harm_urging");
  const alwaysRed = signs.filter((s) => ALWAYS_RED_SIGNS.includes(s));
  if (alwaysRed.length)
    return { colour: "red", reason: "always-red sign: " + alwaysRed.join(", "), crisis };
  if (report.triggered_boundaries.length && report.risk_level !== "none")
    return {
      colour: report.risk_level === "low" || report.risk_level === "medium" ? "amber" : "red",
      reason: "rule broken + risk " + report.risk_level,
      crisis,
    };
  const byLevel: Record<FinalRiskReport["risk_level"], Colour> = {
    none: "green",
    low: "green",
    medium: "amber",
    high: "red",
    critical: "red",
  };
  return { colour: byLevel[report.risk_level], reason: "risk " + report.risk_level, crisis };
}

// ---------------------------------------------------------------------------
// The card the person sees
// ---------------------------------------------------------------------------
type Note = { date: string; note: string; sign?: string };
export function buildCard(args: {
  colour: Colour;
  crisis: boolean;
  report: FinalRiskReport | null;
  reader: ReaderOutput | null;
  friendship: FriendshipContext | null;
  notes: Note[];
  hasTrustedPerson: boolean;
  trustedPersonTold?: boolean;
  checkId?: string | null;
  override?: { summary?: string; explanation?: string; what_you_can_do?: string };
}): ReplyCard {
  const { colour, report, reader } = args;
  const copy = STATUS_COPY[colour];
  const signs: CardSign[] = [];
  if (reader && report) {
    const current = theirSigns(reader);
    // 1. Always-red signs first.
    for (const s of current)
      if (ALWAYS_RED_SIGNS.includes(s)) signs.push({ sign: s, label: SIGN_LABELS[s] });
    // 2. The person's own rule that was broken.
    const rule = report.triggered_boundaries[0];
    if (rule) signs.push({ sign: "rule", label: "Goes against: " + rule.rule });
    // 3. The pattern: a sign that has happened before in this friendship.
    const tally = args.friendship?.sign_tally ?? {};
    const repeat = current.find((s) => (tally[s] ?? 0) > 0);
    if (repeat) {
      const earlier = [...args.notes].reverse().find((n) => n.sign === repeat);
      signs.push({
        sign: "pattern",
        label: earlier
          ? capitalise(stripSpeaker(earlier.note)) + (earlier.date ? " (" + earlier.date + ")" : "")
          : SIGN_LABELS[repeat] + " – this has happened before",
      });
    }
    // 4. The rest of today's signs.
    for (const s of current)
      if (!ALWAYS_RED_SIGNS.includes(s)) signs.push({ sign: s, label: SIGN_LABELS[s] });
  }
  const actions: Record<Colour, ReplyCard["actions"]> = {
    green: {
      primary: { id: "done", label: "Done" },
      secondary: { id: "what_checked", label: "What did Judy check?" },
    },
    amber: {
      primary: { id: "check_carefully", label: "Check safely" },
      secondary: { id: "ask_someone", label: "Ask someone I trust" },
    },
    red: {
      primary: args.hasTrustedPerson
        ? { id: "ask_trusted_person", label: "Ask my trusted person" }
        : { id: "who_could_i_ask", label: "Who could I ask?" },
      secondary: { id: "check_first", label: "I'll check first" },
    },
    grey: {
      primary: { id: "try_again", label: "Try another screenshot" },
      secondary: { id: "describe", label: "Describe what happened" },
    },
  };
  return {
    colour,
    title: copy.title,
    summary: args.override?.summary ?? copy.summary,
    explanation: noSafe(
      args.override?.explanation ?? (report ? firstSentences(report.summary) : ""),
    ),
    signs: signs.slice(0, 3),
    what_you_can_do: noSafe(
      args.override?.what_you_can_do ??
        (report
          ? firstSentences(report.recommendation)
          : "You can try again, or ask someone you trust."),
    ),
    actions: actions[colour],
    crisis: args.crisis,
    trusted_person_told: args.trustedPersonTold === true,
    check_id: args.checkId ?? null,
  };
}

// ---------------------------------------------------------------------------
// Updating Judy's memory of the friendship after a finished check
// ---------------------------------------------------------------------------
export function updatedMemory(
  thread: { tally: unknown; memory: unknown },
  reader: ReaderOutput,
  now: Date,
): { tally: Record<string, number>; memory: Note[] } {
  const tally: Record<string, number> = {};
  const oldTally =
    thread.tally && typeof thread.tally === "object"
      ? (thread.tally as Record<string, unknown>)
      : {};
  for (const [k, v] of Object.entries(oldTally)) if (typeof v === "number") tally[k] = v;
  const memory: Note[] = Array.isArray(thread.memory) ? [...(thread.memory as Note[])] : [];
  for (const sign of theirSigns(reader)) {
    tally[sign] = (tally[sign] ?? 0) + 1;
    const fact = reader.facts.find((f) => f.sign === sign && f.speaker !== "me");
    if (fact) memory.push({ date: shortDate(now), note: stripSpeaker(fact.text), sign });
  }
  return { tally, memory: memory.slice(-30) };
}

// ---------------------------------------------------------------------------
// Storage the turn needs (Supabase in the app, in-memory in tests)
// ---------------------------------------------------------------------------
export type ThreadState = {
  id: string;
  kind: string;
  answers: Record<string, unknown>;
  tally: unknown;
  memory: unknown;
  pending: Pending | null;
};
export type Pending =
  | { type: "intake"; question_id: string }
  | {
      type: "clarify";
      question: string;
      input_text: string;
      reader: ReaderOutput;
      follow_ups: { question: string; answer: string }[];
    };
export interface JudyStore {
  getThread(threadId: string): Promise<ThreadState | null>;
  updateThread(threadId: string, patch: Record<string, unknown>): Promise<void>;
  addMessage(threadId: string, role: "user" | "judy", kind: string, body: unknown): Promise<void>;
  loadFriendship(
    threadId: string,
  ): Promise<{ friendship: FriendshipContext; namesToHide: NameRule[] }>;
  hasTrustedPerson(): Promise<boolean>;
  createRun(runId: string, threadId: string, inputText: string): Promise<void>;
  pipelineStore(runId: string): PipelineStore;
  insertCheck(row: {
    threadId: string;
    colour: Colour;
    analyst: unknown;
    reply: ReplyCard;
    runId: string;
  }): Promise<string>;
  log(entry: {
    runId: string;
    threadId: string;
    agent: string;
    note: string;
    audience: "judge" | "user";
    detail?: unknown;
  }): Promise<void>;
  shareAlert(threadId: string, kind: "amber" | "red" | "crisis"): Promise<number>;
}
export type TurnDeps = {
  store: JudyStore;
  configs: AgentConfigs;
  makeAgents: (options: {
    images?: ImageInput[];
    friendship: FriendshipContext;
    namesToHide: NameRule[];
    canAskQuestion: boolean;
    followUps: { question: string; answer: string }[];
  }) => AgentDrivers;
  now?: () => Date;
};

// ---------------------------------------------------------------------------
// The turn itself
// ---------------------------------------------------------------------------
const USER_PROGRESS: Partial<Record<StageView["stage"], string>> = {
  reader: "Reading the messages…",
  analyzer: "Thinking about this friendship and your rules…",
  checker: "Double-checking…",
};
function judgeNote(view: StageView): { note: string; detail: unknown } {
  const head = `${view.stage} #${view.attempt}: ${view.status} in ${view.duration_ms ?? 0} ms`;
  const o = view.output as Record<string, unknown> | undefined;
  if (view.status !== "completed" || !o)
    return { note: head + (view.error ? " – " + view.error : ""), detail: null };
  if (view.stage === "reader") {
    const r = o as unknown as ReaderOutput;
    return {
      note: `${head} – ${r.facts.length} facts; signs: ${theirSigns(r).join(", ") || "none"}`,
      detail: {
        facts: r.facts.map((f) => ({ id: f.id, text: f.text, sign: f.sign })),
        readable: r.readable,
      },
    };
  }
  if (view.stage === "analyzer")
    return {
      note: `${head} – risk ${String(o["risk_level"])} (${String(o["risk_score"])}), rules broken: ${
        Array.isArray(o["triggered_boundaries"]) ? o["triggered_boundaries"].length : 0
      }`,
      detail: { summary: o["summary"], triggered: o["triggered_boundaries"] },
    };
  if (view.stage === "checker")
    return { note: `${head} – ${String(o["decision"])}`, detail: { feedback: o["feedback"] } };
  return { note: head, detail: null };
}

async function ask(
  store: JudyStore,
  threadId: string,
  q: Omit<JudyQuestion, "source">,
  source: JudyQuestion["source"],
  card: ReplyCard | null,
  pending: Pending,
): Promise<TurnResult> {
  const message: JudyMessage = { kind: "question", body: { ...q, source, card } };
  await store.addMessage(threadId, "judy", message.kind, message.body);
  await store.updateThread(threadId, { pending, last_used_at: new Date().toISOString() });
  return { status: "question", colour: card?.colour ?? null, message };
}

function nextIntake(answers: Record<string, unknown>) {
  return INTAKE_QUESTIONS.find((q) => typeof answers[q.id] !== "string");
}

export async function judyTurn(
  deps: TurnDeps,
  args: { threadId: string; runId: string; input: TurnInput },
): Promise<TurnResult> {
  const { store } = deps;
  const now = deps.now?.() ?? new Date();
  const thread = await store.getThread(args.threadId);
  if (!thread) throw new Error("Friend not found.");
  if (thread.kind !== "person") throw new Error("Checks are only for chats about a person.");
  const input = args.input;

  // ---- Intake: Judy's three questions about a new friend ----
  if (input.action === "start") {
    const q = nextIntake(thread.answers);
    if (!q) {
      const message: JudyMessage = { kind: "text", body: { text: INTAKE_DONE } };
      await store.addMessage(args.threadId, "judy", "text", message.body);
      return { status: "text", colour: null, message };
    }
    if (q.id === INTAKE_QUESTIONS[0]!.id)
      await store.addMessage(args.threadId, "judy", "text", { text: GREETING });
    return ask(store, args.threadId, q, "intake", null, { type: "intake", question_id: q.id });
  }
  if (input.action === "answer" && thread.pending?.type === "intake") {
    const answer = input.text.trim().slice(0, 500);
    if (!answer) throw new Error("Please type or choose an answer.");
    await store.addMessage(args.threadId, "user", "answer", { text: answer });
    const answers = { ...thread.answers, [thread.pending.question_id]: answer };
    await store.updateThread(args.threadId, { answers, pending: null });
    const q = nextIntake(answers);
    if (q)
      return ask(store, args.threadId, q, "intake", null, { type: "intake", question_id: q.id });
    const message: JudyMessage = { kind: "text", body: { text: INTAKE_DONE } };
    await store.addMessage(args.threadId, "judy", "text", message.body);
    return { status: "text", colour: null, message };
  }

  // ---- A check, or an answer to a follow-up question ----
  const memory = await store.loadFriendship(args.threadId);
  const names = memory.namesToHide;
  let inputText: string;
  let images: ImageInput[] = [];
  let storedReader: ReaderOutput | null = null;
  let followUps: { question: string; answer: string }[] = [];

  if (input.action === "answer" && thread.pending?.type === "clarify") {
    const answer = input.text.trim().slice(0, 500);
    if (!answer) throw new Error("Please type or choose an answer.");
    await store.addMessage(args.threadId, "user", "answer", { text: answer });
    storedReader = thread.pending.reader;
    inputText = thread.pending.input_text;
    followUps = [
      ...thread.pending.follow_ups,
      { question: thread.pending.question, answer: redactText(answer, names) },
    ];
  } else {
    // A share (or a free-text answer with nothing pending, treated as a share).
    const text = (input.text ?? "").trim().slice(0, 4000);
    if (input.action === "share")
      images = input.images?.length ? input.images : input.image ? [input.image] : [];
    if (!text && !images.length)
      throw new Error("Add a screenshot, paste a message or describe what happened.");
    // Names are removed before anything is saved; the screenshot is never saved.
    inputText = text ? redactText(text, names) : SCREENSHOT_PLACEHOLDER;
    await store.addMessage(args.threadId, "user", "shared", {
      text: text ? inputText : null,
      screenshot: images.length > 0,
      screenshots: images.length,
    });
  }

  await store.createRun(args.runId, args.threadId, inputText);
  const log = (agent: string, note: string, audience: "judge" | "user", detail?: unknown) =>
    store.log({ runId: args.runId, threadId: args.threadId, agent, note, audience, detail });
  const baseStore = store.pipelineStore(args.runId);
  const loggingStore: PipelineStore = {
    started: async (view) => {
      await baseStore.started(view);
      const line = USER_PROGRESS[view.stage];
      if (line && !(view.stage === "reader" && storedReader)) await log(view.stage, line, "user");
    },
    stage: async (view) => {
      await baseStore.stage(view);
      const { note, detail } = judgeNote(view);
      await log(view.stage, note, "judge", detail);
    },
    finish: (r) => baseStore.finish(r),
  };

  const canAskQuestion = followUps.length < MAX_FOLLOW_UPS;
  const agents = deps.makeAgents({
    ...(images.length ? { images } : {}),
    friendship: memory.friendship,
    namesToHide: names,
    canAskQuestion,
    followUps,
  });
  if (storedReader) {
    const facts = storedReader;
    agents.reader = async () => facts; // re-use the facts; the screenshot is gone
  }
  const result = await runPipeline(inputText, deps.configs, {
    runId: args.runId,
    store: loggingStore,
    agents,
    fromScreenshot: images.length > 0 || !!storedReader,
  });

  const reader = stageOutput<ReaderOutput>(result, "reader");
  const hasTrustedPerson = await store.hasTrustedPerson();
  const notes = Array.isArray(thread.memory) ? (thread.memory as Note[]) : [];

  // Grey: the check failed or wasn't approved → safe fallback, nothing learned.
  if (result.status !== "completed" || !result.finalReport || !reader) {
    if (reader && !reader.readable) {
      const card = buildCard({
        colour: "grey",
        crisis: false,
        report: null,
        reader: null,
        friendship: memory.friendship,
        notes,
        hasTrustedPerson,
        override: {
          summary: "I can't read this one. Could you try a clearer screenshot?",
          explanation: "",
          what_you_can_do:
            "You can add a clearer screenshot, paste the message, or tell me what happened.",
        },
      });
      return finishGrey(store, args.threadId, card, log, "unreadable");
    }
    await log(
      "colour_rule",
      "grey – check did not finish: " + (result.error ?? result.status),
      "judge",
    );
    const message: JudyMessage = {
      kind: "error",
      body: { text: images.length ? ERROR_TEXT_SCREENSHOT : ERROR_TEXT },
    };
    await store.addMessage(args.threadId, "judy", "error", message.body);
    await store.updateThread(args.threadId, { pending: null, last_used_at: now.toISOString() });
    await log("done", "Done.", "user");
    return { status: "error", colour: "grey", message };
  }
  const report = result.finalReport;

  if (!reader.readable) {
    const card = buildCard({
      colour: "grey",
      crisis: false,
      report: null,
      reader: null,
      friendship: memory.friendship,
      notes,
      hasTrustedPerson,
      override: {
        summary: "I can't read this one. Could you try a clearer screenshot?",
        explanation: "",
        what_you_can_do:
          "You can add a clearer screenshot, paste the message, or tell me what happened.",
      },
    });
    return finishGrey(store, args.threadId, card, log, "unreadable");
  }

  // Grey with a question: the answer would change the colour.
  const decision = colourRule(report, reader);
  if (report.question_for_user && canAskQuestion && decision.colour !== "red") {
    const card = buildCard({
      colour: "grey",
      crisis: false,
      report,
      reader,
      friendship: memory.friendship,
      notes,
      hasTrustedPerson,
    });
    await log("colour_rule", "grey – Judy asks one more question", "judge");
    await log("done", "Judy has a question for you.", "user");
    return ask(
      store,
      args.threadId,
      {
        id: "clarify_" + (followUps.length + 1),
        text: noSafe(report.question_for_user.text),
        options: report.question_for_user.options,
        free_text: true,
      },
      "clarify",
      card,
      {
        type: "clarify",
        question: report.question_for_user.text,
        input_text: inputText,
        reader,
        follow_ups: followUps,
      },
    );
  }

  // A finished verdict.
  await log("colour_rule", `${decision.colour} – ${decision.reason}`, "judge");
  let told = 0;
  if (decision.crisis) told = await store.shareAlert(args.threadId, "crisis");
  const draft = buildCard({
    colour: decision.colour,
    crisis: decision.crisis,
    report,
    reader,
    friendship: memory.friendship,
    notes,
    hasTrustedPerson,
    trustedPersonTold: told > 0,
  });
  const checkId = await store.insertCheck({
    threadId: args.threadId,
    colour: decision.colour,
    analyst: report,
    reply: draft,
    runId: args.runId,
  });
  const card = { ...draft, check_id: checkId };
  const mem = updatedMemory(thread, reader, now);
  await store.updateThread(args.threadId, {
    tally: mem.tally,
    memory: mem.memory,
    last_colour: decision.colour,
    pending: null,
    last_used_at: now.toISOString(),
    followup_due_at:
      decision.colour === "amber" || decision.colour === "red"
        ? new Date(now.getTime() + 24 * 3600 * 1000).toISOString()
        : null,
  });
  const message: JudyMessage = { kind: "result", body: card };
  await store.addMessage(args.threadId, "judy", "result", card);
  await log("done", "Done.", "user");
  return { status: "result", colour: decision.colour, message };
}

async function finishGrey(
  store: JudyStore,
  threadId: string,
  card: ReplyCard,
  log: (agent: string, note: string, audience: "judge" | "user") => Promise<void>,
  why: string,
): Promise<TurnResult> {
  await log("colour_rule", "grey – " + why, "judge");
  const message: JudyMessage = { kind: "result", body: card };
  await store.addMessage(threadId, "judy", "result", card);
  await store.updateThread(threadId, { pending: null, last_used_at: new Date().toISOString() });
  await log("done", "Done.", "user");
  return { status: "result", colour: "grey", message };
}
