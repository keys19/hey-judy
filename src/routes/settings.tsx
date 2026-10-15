import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ChevronRight, HeartHandshake, LogOut, Users, Wrench } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Gate, useJudy } from "@/components/judy/session";
import { AppFrame, PageHeader, ToggleRow } from "@/components/judy/ui";
import { errorText, updateProfile, type Profile } from "@/lib/judy-db";

export const Route = createFileRoute("/settings")({
  head: () => ({ meta: [{ title: "Settings · Hey Judy" }] }),
  component: () => (
    <Gate need="person">
      <SettingsPage />
    </Gate>
  ),
});

function SettingsPage() {
  const { userId, profile, refreshProfile, session } = useJudy();
  const navigate = useNavigate();
  const set = (patch: Partial<Profile>) =>
    updateProfile(userId, patch)
      .then(refreshProfile)
      .catch((e) => toast.error("Could not save: " + errorText(e)));

  return (
    <AppFrame tabs>
      <PageHeader title="Settings" />
      <div className="space-y-8 px-5 pb-8 pt-3">
        <section aria-labelledby="people-h" className="space-y-3">
          <h2 id="people-h" className="text-xl font-bold">
            People who help me
          </h2>
          <NavRow
            to="/trusted"
            icon={<Users />}
            label="My trusted people"
            hint="They can get an alert if you choose."
          />
          <NavRow
            to="/carer"
            icon={<HeartHandshake />}
            label="I'm a trusted person"
            hint="See alerts from someone you support."
          />
        </section>

        <section aria-labelledby="display-h" className="space-y-3">
          <h2 id="display-h" className="text-xl font-bold">
            How Judy looks and sounds
          </h2>
          <ToggleRow
            label="Larger text"
            checked={profile.larger_text}
            onChange={(v) => void set({ larger_text: v })}
          />
          <ToggleRow
            label="Read answers aloud"
            checked={profile.read_aloud}
            onChange={(v) => void set({ read_aloud: v })}
          />
          <ToggleRow
            label="Simpler words"
            checked={profile.simpler_language}
            onChange={(v) => void set({ simpler_language: v })}
          />
          <ToggleRow
            label="Extra guidance"
            checked={profile.extra_guidance}
            onChange={(v) => void set({ extra_guidance: v })}
          />
        </section>

        <section aria-labelledby="acc-h" className="space-y-3">
          <h2 id="acc-h" className="text-xl font-bold">
            Account
          </h2>
          <p className="rounded-2xl bg-white px-4 py-3 text-lg">
            Signed in as <strong className="break-all">{session.user.email}</strong>
          </p>
          <button
            type="button"
            onClick={async () => {
              await supabase.auth.signOut();
              void navigate({ to: "/welcome" });
            }}
            className="flex min-h-14 w-full items-center gap-3 rounded-2xl bg-white px-4 text-lg font-bold text-judy-red shadow-sm"
          >
            <LogOut aria-hidden="true" /> Sign out
          </button>
          <p className="text-base text-[#5E6272]">
            Judy is an AI helper, not a person. It can make mistakes. Your screenshots are never
            saved.
          </p>
          <Link
            to="/dev"
            className="inline-flex min-h-11 items-center gap-2 text-base text-[#5E6272] underline"
          >
            <Wrench size={16} aria-hidden="true" /> Developer tests
          </Link>
        </section>
      </div>
    </AppFrame>
  );
}

function NavRow({
  to,
  icon,
  label,
  hint,
}: {
  to: "/trusted" | "/carer";
  icon: React.ReactNode;
  label: string;
  hint: string;
}) {
  return (
    <Link
      to={to}
      className="flex min-h-16 items-center gap-4 rounded-2xl bg-white px-4 py-3 shadow-sm focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-judy-primary/30"
    >
      <span
        className="flex h-11 w-11 items-center justify-center rounded-full bg-judy-lilac text-judy-primary"
        aria-hidden="true"
      >
        {icon}
      </span>
      <span className="flex-1">
        <span className="block text-lg font-bold">{label}</span>
        <span className="block text-base text-[#5E6272]">{hint}</span>
      </span>
      <ChevronRight aria-hidden="true" className="text-[#8C8F9C]" />
    </Link>
  );
}
