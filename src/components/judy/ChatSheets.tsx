import { Link } from "@tanstack/react-router";
import { Phone, Sparkles } from "lucide-react";
import type { ReplyCard } from "@/lib/pipeline/judy-turn";
import { BottomSheet } from "./BottomSheet";
import { PrimaryButton } from "./ui";

export type InfoSheet =
  null | "what_checked" | "check_carefully" | "who_could_i_ask" | "how_screenshot";

export function InfoSheets({ which, onClose }: { which: InfoSheet; onClose: () => void }) {
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
    how_screenshot: {
      title: "How do I take a screenshot?",
      body: (
        <ul className="list-disc space-y-2 pl-6 text-lg">
          <li>iPhone: press the side button and volume up together.</li>
          <li>Android: press power and volume down together.</li>
          <li>Computer: Windows key + Shift + S, or Cmd + Shift + 4 on a Mac.</li>
          <li>You can add up to 4 screenshots if the chat is long.</li>
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

export function CrisisScreen({ card, onClose }: { card: ReplyCard; onClose: () => void }) {
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
