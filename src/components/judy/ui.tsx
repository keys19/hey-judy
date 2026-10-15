// Hey Judy design kit: orb, status colours, bubbles, cards, buttons, layout.
import { Link, useCanGoBack, useRouter } from "@tanstack/react-router";
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
  Users,
  LifeBuoy,
  ChevronLeft,
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
  green: { title: "No clear warning signs", word: "No clear warning signs", Icon: Check },
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
const ORB: Record<Mood, { img: string; word: string }> = {
  neutral: { img: "purple", word: "ready" },
  thinking: { img: "grey", word: "thinking" },
  grey: { img: "grey", word: "needs more detail" },
  green: { img: "green", word: "reassured" },
  amber: { img: "amber", word: "cautious" },
  red: { img: "red", word: "serious" },
};
// Judy's face (art from the Lovable design). Decorative unless a label is given.
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
  return (
    <img
      src={`/assets/judy/judy_${o.img}.png`}
      alt={label ?? `Judy, ${o.word}`}
      width={size}
      height={size}
      draggable={false}
      className={cn("shrink-0 select-none object-contain", animate && "judy-breathe")}
      style={{ width: size, height: size }}
    />
  );
}

// Status pill: icon + words on a tinted background (never colour alone).
const PILL: Record<Colour, string> = {
  green: "bg-[#F0F7E5] text-[#326427] border-[#A5D75B]",
  amber: "bg-[#FFF3E5] text-[#7A4708] border-[#FBA64C]",
  red: "bg-[#FDEDE8] text-[#9A2E12] border-[#DA5532]",
  grey: "bg-[#F0F0F6] text-[#4A4B5E] border-[#B7BCCB]",
};
const TINT: Record<Colour, string> = {
  green: "bg-[#F0F7E5]",
  amber: "bg-[#FFF3E5]",
  red: "bg-[#FDEDE8]",
  grey: "bg-[#F0F0F6]",
};
export function StatusPill({ colour, className }: { colour: Colour; className?: string }) {
  const { Icon, word } = STATUS[colour];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-base font-bold",
        PILL[colour],
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="inline-flex h-5 w-5 items-center justify-center rounded-full"
        style={{ background: HEX[colour] }}
      >
        <Icon size={12} strokeWidth={3} color={colour === "red" ? "#FFFFFF" : "#1D2433"} />
      </span>
      {word}
    </span>
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
      className="overflow-hidden rounded-3xl border-2 bg-white shadow-sm"
      style={{ borderColor: HEX[c] }}
    >
      <div className={cn("flex items-center gap-3 px-4 py-4", TINT[c])}>
        <Orb mood={c} size={60} animate={false} label={`Judy, ${STATUS[c].word}`} />
        <div className="min-w-0 flex-1">
          <h3 className="flex items-start gap-2 text-xl font-bold leading-snug text-judy-ink">
            <StatusCircle colour={c} size={26} />
            <span>{card.title}</span>
          </h3>
          <p className="text-lg text-[#4A4F5E]">{card.summary}</p>
        </div>
        <ReadAloud text={cardSpeech(card)} />
      </div>
      <div className="space-y-4 px-5 pb-5 pt-4">
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
          "mx-auto flex min-h-dvh w-full max-w-md flex-col pt-[env(safe-area-inset-top)]",
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
  { to: "/", label: "Your chats", Icon: MessageCircle },
  { to: "/trusted", label: "Supporters", Icon: Users },
  { to: "/help", label: "Get help", Icon: LifeBuoy },
  { to: "/settings", label: "Settings", Icon: Settings },
] as const;
export function TabBar() {
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-[#E3DCE8] bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur"
    >
      <ul className="mx-auto flex max-w-md">
        {TABS.map(({ to, label, Icon }) => (
          <li key={to} className="flex-1">
            <Link
              to={to}
              activeOptions={{ exact: true }}
              className="mx-1 my-1.5 flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-2xl text-sm font-bold text-[#5E6272] data-[status=active]:bg-judy-lilac data-[status=active]:text-judy-primary"
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

// Back to where you came from, or home if there's nowhere to go back to.
export function BackButton({ label = "Back" }: { label?: string }) {
  const router = useRouter();
  const canGoBack = useCanGoBack();
  return (
    <button
      type="button"
      onClick={() => (canGoBack ? router.history.back() : void router.navigate({ to: "/" }))}
      className="inline-flex min-h-11 items-center gap-1 rounded-full bg-white px-4 text-base font-bold text-judy-primary shadow-sm hover:bg-judy-lilac"
    >
      <ChevronLeft size={20} aria-hidden="true" /> {label}
    </button>
  );
}

export function PageHeader({
  title,
  back = false,
  right,
}: {
  title: string;
  back?: boolean;
  right?: ReactNode;
}) {
  return (
    <header className="px-5 pb-2 pt-4">
      {(back || right) && (
        <div className="mb-3 flex items-center justify-between">
          {back ? <BackButton /> : <span />}
          {right}
        </div>
      )}
      <h1 className="text-3xl font-bold text-judy-ink">{title}</h1>
    </header>
  );
}

// "Annie's boundaries" (or "Your boundaries" if we don't know their name).
export function displayName(n: string | null | undefined) {
  const t = (n ?? "").trim();
  return t ? t[0]!.toUpperCase() + t.slice(1) : "";
}
export function boundariesTitle(n: string | null | undefined) {
  const d = displayName(n);
  return d ? `${d}'s boundaries` : "Your boundaries";
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
