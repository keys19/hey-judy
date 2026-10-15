import { createFileRoute } from "@tanstack/react-router";
import { EyeOff, Lock, Save, UserCheck } from "lucide-react";
import type { ReactNode } from "react";
import { Gate } from "@/components/judy/session";
import { AppFrame, PageHeader } from "@/components/judy/ui";

export const Route = createFileRoute("/privacy")({
  head: () => ({ meta: [{ title: "Privacy and data · Hey Judy" }] }),
  component: () => (
    <Gate need="person">
      <Privacy />
    </Gate>
  ),
});

function Privacy() {
  return (
    <AppFrame>
      <PageHeader title="Privacy and data" back />
      <div className="space-y-3 px-5 pb-10 pt-2">
        <Item icon={<Lock />} title="Never saved">
          Your screenshots. They are only used for the check, then thrown away.
        </Item>
        <Item icon={<EyeOff />} title="Hidden before the AI reads it">
          The names of your trusted people and the person you're asking about, phone numbers,
          emails, links, addresses and codes.
        </Item>
        <Item icon={<Save />} title="Saved for you">
          The nicknames you choose, your answers to Judy's questions, Judy's results, and pasted
          text with names removed. This lets Judy notice patterns over time.
        </Item>
        <Item icon={<UserCheck />} title="Your trusted person">
          Only ever sees a colour, “Chat 1” and the time, and only if you choose to share.
        </Item>
        <p className="px-1 pt-2 text-base text-[#5E6272]">
          You can delete a chat any time: open it, tap Menu, then Relationship history.
        </p>
      </div>
    </AppFrame>
  );
}

function Item({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <section className="flex gap-4 rounded-3xl bg-white p-4 shadow-sm">
      <span
        aria-hidden="true"
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-judy-lilac text-judy-primary [&>svg]:h-5 [&>svg]:w-5"
      >
        {icon}
      </span>
      <div>
        <h2 className="text-lg font-bold">{title}</h2>
        <p className="text-lg text-[#3F4454]">{children}</p>
      </div>
    </section>
  );
}
