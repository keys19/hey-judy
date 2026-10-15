// Hey Judy — shared vocabulary and privacy helpers for the pipeline.

// Warning signs the Reader can tag on each fact. Keep in sync with the
// Reader manual (manuals/reader.md) and the frontend's sign labels.
export const SIGNS = [
  "none",
  "flattery", // over-the-top praise, "best friend" very fast
  "money_request", // borrow, lend, send, pay for something
  "gift_or_purchase_request", // gift cards, vouchers, buy something for them
  "secrecy", // "don't tell…", "keep this between us"
  "isolation", // turning them against family/support workers
  "pressure_urgency", // "now", "tonight", deadlines, repeated asking
  "guilt_or_emotional_pressure", // "if you cared you would…"
  "personal_info_request", // address, ID, documents, photos of ID
  "bank_or_code_request", // bank details, card, PIN, passwords, one-time codes
  "unexpected_link", // links or apps to install/click
  "meet_up_request", // asks to meet in person / come to their place
  "private_photo_request", // asks for intimate or private photos
  "threat", // threats, blackmail, "or else"
  "self_harm_urging", // encourages self-harm or suicide
] as const;
export type Sign = (typeof SIGNS)[number];

// These are always red in the colour rule, whatever the agents say.
export const ALWAYS_RED_SIGNS: readonly Sign[] = [
  "bank_or_code_request",
  "threat",
  "self_harm_urging",
];

export const SPEAKERS = ["them", "me", "unknown"] as const;

// Text stored for a run when the person only shared a screenshot. The image
// itself is never stored.
export const SCREENSHOT_PLACEHOLDER = "(The person shared a screenshot of the conversation.)";

export const IMAGE_MEDIA_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
export type ImageInput = { media_type: (typeof IMAGE_MEDIA_TYPES)[number]; data: string };
// ~4.5 MB image once decoded (Claude accepts up to 5 MB per image). The app
// shrinks screenshots before sending, so real ones are far smaller.
export const MAX_IMAGE_BASE64 = 6_000_000;
// Up to 4 screenshots per check (the app shrinks them so the request stays small).
export const MAX_IMAGES = 4;

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// A name to hide: a plain string becomes [name]; {name, as} becomes [as],
// e.g. {name: "Julie", as: "support worker"} -> [support worker].
export type NameRule = string | { name: string; as: string };

// Turns a relationship like "Support Worker!" into a safe placeholder word.
export function roleLabel(relationship: string | null | undefined): string {
  const cleaned = (relationship ?? "")
    .toLowerCase()
    .replace(/[^a-z ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 20)
    .trim();
  return cleaned || "trusted person";
}

// Deterministic redaction. Runs in code on everything the agents return,
// so contact details and known names never reach the database even if the
// model misses them.
export function redactText(input: string, namesToHide: NameRule[] = []): string {
  let s = input;
  s = s.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]");
  s = s.replace(
    /https?:\/\/\S+|www\.\S+|\b[a-z0-9-]+\.(?:com|net|org|co|uk|io|ly|me|app|link|xyz|info)(?:\/\S*)?\b/gi,
    "[link]",
  );
  s = s.replace(/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/g, "[postcode]");
  s = s.replace(/\b\d{2}-\d{2}-\d{2}\b(?!-)/g, "[number]"); // UK sort code
  // Phones, card and account numbers: runs of 9+ digits (spaces/dashes allowed).
  // Money (£500) and dates (2026-10-14, 8 digits) are left alone.
  s = s.replace(/(?<![£$€\d])\+?\d[\d\s-]{7,}\d/g, (m) =>
    m.replace(/\D/g, "").length >= 9 ? "[number]" : m,
  );
  s = s.replace(/(?<![£$€\d.,])\b\d{6,}\b/g, "[number]"); // one-time codes, PINs-as-codes
  // Longest names first, so "Sam Smith" is replaced before "Sam".
  const rules = namesToHide
    .map((r) => (typeof r === "string" ? { name: r, as: "name" } : r))
    .map((r) => ({ name: r.name.trim(), as: r.as }))
    .filter((r) => r.name.length >= 2)
    .sort((a, b) => b.name.length - a.name.length);
  for (const r of rules)
    s = s.replace(new RegExp("\\b" + escapeRegExp(r.name) + "\\b", "gi"), "[" + r.as + "]");
  return s;
}

// Applies redactText to every free-text string inside a value, skipping
// identifier/label fields listed in keepKeys.
export function redactDeep<T>(value: T, namesToHide: NameRule[], keepKeys: Set<string>): T {
  const walk = (v: unknown, key?: string): unknown => {
    if (key && keepKeys.has(key)) return v;
    if (typeof v === "string") return redactText(v, namesToHide);
    if (Array.isArray(v)) return v.map((x) => walk(x));
    if (v && typeof v === "object")
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, k)]));
    return v;
  };
  return walk(value) as T;
}

// Fields that are identifiers or fixed labels, never free text.
const READER_KEEP = new Set(["id", "type", "sign", "speaker", "fact_ids", "readable"]);
// The Analyzer's/Checker's IDs, scores, enums and the exact rule text (which
// the Validator compares to the saved rule) are never rewritten.
export const AGENT_OUTPUT_KEEP = new Set([
  "fact_id",
  "fact_ids",
  "memory_id",
  "rule",
  "risk_level",
  "risk_score",
  "is_risk_indicator",
  "decision",
  "inappropriate_risk_level",
]);

// Applies redactText to every free-text string in a Reader result.
export function redactReaderOutput<T>(value: T, namesToHide: NameRule[] = []): T {
  return redactDeep(value, namesToHide, READER_KEEP);
}

// What the Analyzer and Checker know about this friendship (Judy's memory).
// Never contains the friend's nickname or anyone's name.
export type FriendshipContext = {
  intake: Record<string, string>;
  sign_tally: Record<string, number>;
  notes: { date: string; note: string }[];
  previous_colour: string;
  checks_so_far: number;
  people_who_help_me: string[];
};

type ThreadRow = {
  nickname: string;
  answers: unknown;
  tally: unknown;
  memory: unknown;
  last_colour: string;
};
type SupporterRow = { first_name: string; relationship: string | null };

// Builds the friendship context plus the list of names to hide everywhere.
export function buildFriendship(
  thread: ThreadRow,
  supporters: SupporterRow[],
  checksSoFar: number,
  myFirstName?: string | null,
): { friendship: FriendshipContext; namesToHide: NameRule[] } {
  const namesToHide: NameRule[] = [thread.nickname];
  for (const s of supporters)
    namesToHide.push({ name: s.first_name, as: roleLabel(s.relationship) });
  if (myFirstName) namesToHide.push({ name: myFirstName, as: "me" });
  const asRecord = (v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  const intake: Record<string, string> = {};
  for (const [k, v] of Object.entries(asRecord(thread.answers)))
    if (typeof v === "string" && v.trim()) intake[k] = redactText(v, namesToHide).slice(0, 500);
  const sign_tally: Record<string, number> = {};
  for (const [k, v] of Object.entries(asRecord(thread.tally)))
    if (typeof v === "number" && v > 0) sign_tally[k] = v;
  const notes = (Array.isArray(thread.memory) ? thread.memory : [])
    .map((n) => asRecord(n))
    .filter((n) => typeof n["note"] === "string")
    .slice(-20)
    .map((n) => ({
      date: typeof n["date"] === "string" ? n["date"] : "",
      note: redactText(String(n["note"]), namesToHide).slice(0, 300),
    }));
  const people_who_help_me = [...new Set(supporters.map((s) => roleLabel(s.relationship)))];
  return {
    friendship: {
      intake,
      sign_tally,
      notes,
      previous_colour: thread.last_colour,
      checks_so_far: checksSoFar,
      people_who_help_me,
    },
    namesToHide,
  };
}

// Does a (possibly redacted) quote come from the original text? Placeholders
// like [name], [number] or [link] may stand for any short piece of text.
export function quoteMatches(quote: string, original: string): boolean {
  const q = quote.trim();
  if (!q) return false;
  if (original.includes(q)) return true;
  const parts = q.split(/\[[a-z ]{1,20}\]/i).map(escapeRegExp);
  if (parts.length === 1) return false;
  const pattern = parts.join("[\\s\\S]{1,80}?");
  return new RegExp(pattern).test(original) || new RegExp(pattern).test(redactText(original));
}
