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

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Deterministic redaction. Runs in code on everything the Reader returns,
// so contact details never reach the database even if the model misses them.
export function redactText(input: string, namesToHide: string[] = []): string {
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
  for (const name of namesToHide) {
    const n = name.trim();
    if (n.length >= 2) s = s.replace(new RegExp("\\b" + escapeRegExp(n) + "\\b", "gi"), "[name]");
  }
  return s;
}

// Fields that are identifiers or fixed labels, never free text.
const NON_TEXT_KEYS = new Set(["id", "type", "sign", "speaker", "fact_ids", "readable"]);

// Applies redactText to every free-text string in a Reader result.
export function redactReaderOutput<T>(value: T, namesToHide: string[] = []): T {
  const walk = (v: unknown, key?: string): unknown => {
    if (typeof v === "string")
      return key && NON_TEXT_KEYS.has(key) ? v : redactText(v, namesToHide);
    if (Array.isArray(v)) return key && NON_TEXT_KEYS.has(key) ? v : v.map((x) => walk(x));
    if (v && typeof v === "object")
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, k)]));
    return v;
  };
  return walk(value) as T;
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
