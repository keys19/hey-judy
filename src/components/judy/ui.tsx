// Hey Judy design kit: orb, status colours, bubbles, cards, buttons, layout.
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import {
  AlertOctagon,
  AlertTriangle,
  ArrowRight,
  BadgePoundSterling,
  Check,
  Circle,
  Clock,
  CreditCard,
  Heart,
  History,
  HelpCircle,
  Lightbulb,
  Link2,
  Lock,
  MapPin,
  MessageCircle,
  Settings,
  Shield,
  ShieldCheck,
  UserX,
  Volume2,
  Camera,
  Gift,
  Frown,
  IdCard,
} from "lucide-react";
import type { CardAction, Colour, ReplyCard } from "@/lib/pipeline/judy-turn";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Colours and status wording
// ---------------------------------------------------------------------------
export const HEX: Record<Colour, string> = {
  green: "#A5D75B",
  amber: "#FBA64C",
  red: "#DA5532",
  grey: "#8E8E99",
};
export const STATUS: Record<Colour, { title: string; word: string; Icon: typeof Check }> = {
  green: { title: "No clear warning signs", word: "No clear signs", Icon: Check },
  amber: { title: "Be careful", word: "Be careful", Icon: AlertTriangle },
  red: { title: "High risk — stop and get help", word: "High risk", Icon: AlertOctagon },
  grey: { title: "Not enough information", word: "Need more detail", Icon: HelpCircle },
};

export function StatusCircle({ colour, size = 44 }: { colour: Colour; size?: number }) {
  const { Icon } = STATUS[colour];
  return (
    <span
      aria-hidden="true"
      className="inline-flex shrink-0 items-center justify-center rounded-full"
      style={{ width: size, height: size, background: HEX[colour] }}
    >
      <Icon size={size * 0.5} strokeWidth={2.6} color={colour === "red" ? "#FFFFFF" : "#1D2433"} />
    </span>
  );
}

// ---------------------------------------------------------------------------
// The orb (Judy). Colour + face change with mood; never replaces status words.
// ---------------------------------------------------------------------------
export type Mood = "neutral" | "thinking" | Colour;
const ORB: Record<Mood, { a: string; b: string; word: string }> = {
  neutral: { a: "#E9DAF0", b: "#B98BCB", word: "ready" },
  thinking: { a: "#E6E6EC", b: "#A9A9B6", word: "thinking" },
  grey: { a: "#E6E6EC", b: "#A9A9B6", word: "needs more detail" },
  green: { a: "#E4F4CC", b: "#A5D75B", word: "reassured" },
  amber: { a: "#FFE6C8", b: "#FBA64C", word: "cautious" },
  red: { a: "#F7D0C5", b: "#DA5532", word: "serious" },
};
export function Orb({
  mood = "neutral",
  size = 120,
  label,
  animate = true,
}: {
  mood?: Mood;
  size?: number;
  label?: string;
  animate?: boolean;
}) {
  const o = ORB[mood];
  const mouth =
    mood === "red" || mood === "amber"
      ? "M38 66 Q50 60 62 66"
      : mood === "thinking" || mood === "grey"
        ? "M40 64 L60 64"
        : "M36 60 Q50 72 64 60";
  return (
    <div
      role="img"
      aria-label={label ?? `Judy, ${o.word}`}
      className={cn("relative shrink-0", animate && "judy-breathe")}
      style={{ width: size, height: size }}
    >
      <div
        className="absolute inset-0 rounded-full blur-xl"
        style={{ background: o.b, opacity: 0.45 }}
      />
      <svg viewBox="0 0 100 100" className="relative h-full w-full" aria-hidden="true">
        <defs>
          <radialGradient id={`orb-${mood}`} cx="38%" cy="32%" r="75%">
            <stop offset="0%" stopColor="#FFFFFF" />
            <stop offset="35%" stopColor={o.a} />
            <stop offset="100%" stopColor={o.b} />
          </radialGradient>
        </defs>
        <circle cx="50" cy="50" r="46" fill={`url(#orb-${mood})`} />
        <ellipse cx="38" cy="46" rx="4" ry={mood === "thinking" ? 2 : 5} fill="#1D2433" />
        <ellipse cx="62" cy="46" rx="4" ry={mood === "thinking" ? 2 : 5} fill="#1D2433" />
        <path d={mouth} stroke="#1D2433" strokeWidth="3.5" strokeLinecap="round" fill="none" />
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------
export const btnPrimary =
  "inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-judy-primary px-6 text-lg font-bold text-white shadow-sm transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-judy-primary/40 disabled:opacity-50";
export const btnSecondary =
  "inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full border-2 border-judy-primary bg-white px-6 text-lg font-bold text-judy-primary transition hover:bg-judy-lilac focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-judy-primary/40 disabled:opacity-50";
export const inputCls =
  "min-h-12 w-full rounded-2xl border-2 border-[#D9CFE1] bg-white px-4 py-3 text-lg text-judy-ink placeholder:text-[#6B6F7E] focus:border-judy-primary focus:outline-none focus:ring-4 focus:ring-judy-primary/20";

export function PrimaryButton(
  props: React.ButtonHTMLAttributes<HTMLButtonElement> & { arrow?: boolean },
) {
  const { arrow = true, className, children, ...rest } = props;
  return (
    <button type="button" className={cn(btnPrimary, className)} {...rest}>
      {children}
      {arrow && <ArrowRight size={20} aria-hidden="true" />}
    </button>
  );
}
export function SecondaryButton(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { className, ...rest } = props;
  return <button type="button" className={cn(btnSecondary, className)} {...rest} />;
}

// ---------------------------------------------------------------------------
// Read aloud
// ---------------------------------------------------------------------------
export function speak(text: string) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 0.92;
  u.lang = "en-GB";
  window.speechSynthesis.speak(u);
}
export function ReadAloud({ text }: { text: string }) {
  return (
    <button
      type="button"
      onClick={() => speak(text)}
      className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-judy-primary hover:bg-judy-lilac focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-judy-primary/30"
      aria-label="Read aloud"
      title="Read aloud"
    >
      <Volume2 size={22} aria-hidden="true" />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Chat bubbles
// ---------------------------------------------------------------------------
export function JudyBubble({ children, speakText }: { children: ReactNode; speakText?: string }) {
  return (
    <div className="flex items-end gap-2">
      <Orb mood="neutral" size={36} animate={false} label="Judy" />
      <div className="max-w-[85%] rounded-3xl rounded-bl-md bg-white px-4 py-3 text-lg text-judy-ink shadow-sm">
        {children}
        {speakText && (
          <div className="-mb-2 -mr-2 flex justify-end">
            <ReadAloud text={speakText} />
          </div>
        )}
      </div>
    </div>
  );
}
export function UserBubble({ children, time }: { children: ReactNode; time?: string }) {
  return (
    <div className="flex flex-col items-end">
      <div className="max-w-[85%] rounded-3xl rounded-br-md bg-judy-lilac px-4 py-3 text-lg text-judy-ink">
        {children}
      </div>
      {time && <span className="mt-1 text-sm text-[#5E6272]">{time}</span>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Signs
// ---------------------------------------------------------------------------
const SIGN_ICON: Record<string, typeof Check> = {
  money_request: BadgePoundSterling,
  gift_or_purchase_request: Gift,
  secrecy: Lock,
  pressure_urgency: Clock,
  flattery: Heart,
  isolation: UserX,
  bank_or_code_request: CreditCard,
  unexpected_link: Link2,
  threat: AlertOctagon,
  self_harm_urging: AlertOctagon,
  guilt_or_emotional_pressure: Frown,
  personal_info_request: IdCard,
  meet_up_request: MapPin,
  private_photo_request: Camera,
  rule: Shield,
  pattern: History,
};
export function SignIcon({ sign }: { sign: string }) {
  const Icon = SIGN_ICON[sign] ?? Circle;
  return (
    <span
      aria-hidden="true"
      className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-judy-lilac"
    >
      <Icon size={20} color="#1D2433" strokeWidth={2.2} />
    </span>
  );
}

// ---------------------------------------------------------------------------
// Status card (grey / green / amber / red result)
// ---------------------------------------------------------------------------
export function cardSpeech(card: ReplyCard) {
  return [
    card.title + ".",
    card.summary,
    card.explanation,
    ...card.signs.map((s) => s.label + "."),
    card.what_you_can_do,
  ].join(" ");
}
export function StatusCard({
  card,
  onAction,
  compact = false,
}: {
  card: ReplyCard;
  onAction?: ((a: CardAction) => void) | undefined;
  compact?: boolean;
}) {
  const c = card.colour;
  return (
    <section
      aria-label={`Result: ${card.title}`}
      className="overflow-hidden rounded-3xl bg-white shadow-sm"
      style={{ borderTop: `8px solid ${HEX[c]}` }}
    >
      <div className="flex items-start gap-3 p-5 pb-3">
        <StatusCircle colour={c} size={52} />
        <div className="min-w-0 flex-1">
          <h3 className="text-xl font-bold leading-snug text-judy-ink">{card.title}</h3>
          <p className="text-lg text-[#4A4F5E]">{card.summary}</p>
        </div>
        <ReadAloud text={cardSpeech(card)} />
      </div>
      <div className="space-y-4 px-5 pb-5">
        {card.explanation && <p className="text-lg text-judy-ink">{card.explanation}</p>}
        {card.signs.length > 0 && (
          <div>
            <h4 className="mb-2 text-base font-bold uppercase tracking-wide text-[#5E6272]">
              What I noticed
            </h4>
            <ul className="space-y-2">
              {card.signs.map((s, i) => (
                <li key={i} className="flex items-center gap-3 text-lg text-judy-ink">
                  <SignIcon sign={s.sign} />
                  <span>{s.label}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {card.what_you_can_do && (
          <div className="flex gap-3 rounded-2xl bg-judy-canvas p-4">
            <Lightbulb size={24} className="mt-0.5 shrink-0 text-judy-primary" aria-hidden="true" />
            <div>
              <h4 className="text-base font-bold text-judy-ink">What you can do</h4>
              <p className="text-lg text-judy-ink">{card.what_you_can_do}</p>
            </div>
          </div>
        )}
        {c === "green" && (
          <p className="text-base text-[#5E6272]">
            This check cannot guarantee someone is trustworthy.
          </p>
        )}
        {!compact && onAction && (
          <div className="space-y-3 pt-1">
            <PrimaryButton onClick={() => onAction(card.actions.primary)}>
              {card.actions.primary.label}
            </PrimaryButton>
            <SecondaryButton onClick={() => onAction(card.actions.secondary)}>
              {card.actions.secondary.label}
            </SecondaryButton>
          </div>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------
export function AppFrame({
  children,
  tabs = false,
  className,
}: {
  children: ReactNode;
  tabs?: boolean;
  className?: string;
}) {
  return (
    <div className="min-h-dvh bg-judy-canvas text-judy-ink">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:p-2"
      >
        Skip to content
      </a>
      <main
        id="main"
        className={cn(
          "mx-auto flex min-h-dvh w-full max-w-md flex-col",
          tabs && "pb-24",
          className,
        )}
      >
        {children}
      </main>
      {tabs && <TabBar />}
    </div>
  );
}

const TABS = [
  { to: "/", label: "My Chats", Icon: MessageCircle },
  { to: "/rules", label: "My Rules", Icon: ShieldCheck },
  { to: "/settings", label: "Settings", Icon: Settings },
] as const;
export function TabBar() {
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-[#E3DCE8] bg-white/95 backdrop-blur"
    >
      <ul className="mx-auto flex max-w-md">
        {TABS.map(({ to, label, Icon }) => (
          <li key={to} className="flex-1">
            <Link
              to={to}
              activeOptions={{ exact: true }}
              className="flex min-h-16 flex-col items-center justify-center gap-1 text-base font-bold text-[#5E6272] data-[status=active]:text-judy-primary"
            >
              <Icon size={24} aria-hidden="true" />
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function PageHeader({ title, back }: { title: string; back?: ReactNode }) {
  return (
    <header className="flex items-center gap-2 px-4 pb-2 pt-6">
      {back}
      <h1 className="text-2xl font-bold text-judy-ink">{title}</h1>
    </header>
  );
}

// Plain toggle row (large target)
export function ToggleRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex min-h-14 cursor-pointer items-center gap-4 rounded-2xl bg-white px-4 py-3 shadow-sm">
      <span className="flex-1">
        <span className="block text-lg font-bold text-judy-ink">{label}</span>
        {hint && <span className="block text-base text-[#5E6272]">{hint}</span>}
      </span>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="peer sr-only"
      />
      <span
        aria-hidden="true"
        className="relative h-8 w-14 shrink-0 rounded-full bg-[#C9C9D2] transition peer-checked:bg-judy-primary peer-focus-visible:ring-4 peer-focus-visible:ring-judy-primary/30 after:absolute after:left-1 after:top-1 after:h-6 after:w-6 after:rounded-full after:bg-white after:shadow after:transition peer-checked:after:translate-x-6"
      />
    </label>
  );
}
