import { createFileRoute, Link } from "@tanstack/react-router";
import { Phone } from "lucide-react";
import { Gate } from "@/components/judy/session";
import { AppFrame, PageHeader } from "@/components/judy/ui";

export const Route = createFileRoute("/help")({
  head: () => ({ meta: [{ title: "Get help · Hey Judy" }] }),
  component: () => (
    <Gate need="person">
      <Help />
    </Gate>
  ),
});

const LINES = [
  {
    name: "In danger right now",
    detail: "Call the police or an ambulance",
    tel: "999",
    show: "999",
  },
  {
    name: "Samaritans",
    detail: "Free, any time, day or night. Talk about anything.",
    tel: "116123",
    show: "116 123",
  },
  {
    name: "Citizens Advice",
    detail: "Help with money, scams and what to do next.",
    tel: "08082231133",
    show: "0808 223 1133",
  },
  {
    name: "Action Fraud",
    detail: "Report a scam or fraud.",
    tel: "03001232040",
    show: "0300 123 2040",
  },
];

function Help() {
  return (
    <AppFrame tabs>
      <PageHeader title="Get help" back />
      <div className="space-y-3 px-5 pb-8 pt-2">
        <p className="text-lg text-[#3F4454]">
          You don't have to be sure something is wrong to ask for help.
        </p>
        {LINES.map((l) => (
          <a
            key={l.tel}
            href={`tel:${l.tel}`}
            className="flex min-h-16 items-center gap-4 rounded-3xl bg-white px-4 py-4 shadow-sm hover:bg-judy-lilac"
          >
            <span
              aria-hidden="true"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-judy-lilac text-judy-primary"
            >
              <Phone size={20} />
            </span>
            <span className="flex-1">
              <span className="block text-lg font-bold">{l.name}</span>
              <span className="block text-base text-[#5E6272]">{l.detail}</span>
              <span className="mt-1 block text-xl font-bold text-judy-primary">{l.show}</span>
            </span>
          </a>
        ))}
        <Link
          to="/trusted"
          className="flex min-h-14 items-center justify-center rounded-full border-2 border-judy-primary bg-white text-lg font-bold text-judy-primary"
        >
          Talk to your trusted person
        </Link>
      </div>
    </AppFrame>
  );
}
