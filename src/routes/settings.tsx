import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import {
  ChevronRight,
  HeartHandshake,
  LifeBuoy,
  Lock,
  LogOut,
  Moon,
  ShieldCheck,
  Sun,
  Monitor,
  Users,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Gate, useJudy } from "@/components/judy/session";
import { AppFrame, PageHeader, ToggleRow, boundariesTitle } from "@/components/judy/ui";
import { getTheme, setTheme, type ThemeChoice } from "@/components/judy/theme";
import { db, errorText, updateProfile, type Profile } from "@/lib/judy-db";
import { cn } from "@/lib/utils";

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
  const [ruleCount, setRuleCount] = useState<number | null>(null);
  const [theme, setThemeState] = useState<ThemeChoice>("system");

  useEffect(() => {
    setThemeState(getTheme());
    db.from("rules")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("active", true)
      .then(({ count }) => setRuleCount(count ?? 0));
  }, [userId]);

  const set = (patch: Partial<Profile>) =>
    updateProfile(userId, patch)
      .then(refreshProfile)
      .catch((e) => toast.error("Could not save: " + errorText(e)));

  return (
    <AppFrame tabs>
      <PageHeader title="Settings" />
      <div className="space-y-8 px-5 pb-8 pt-3">
        <nav aria-label="Settings" className="space-y-3">
          <Row
            to="/rules"
            icon={<ShieldCheck />}
            label={boundariesTitle(profile.first_name)}
            hint={ruleCount === null ? undefined : `${ruleCount} on`}
          />
          <Row to="/trusted" icon={<Users />} label="Trusted people" />
          <Row to="/carer" icon={<HeartHandshake />} label="I'm someone's trusted person" />
          <Row to="/privacy" icon={<Lock />} label="Privacy and data" />
          <Row to="/help" icon={<LifeBuoy />} label="Get help" />
        </nav>

        <section aria-labelledby="display-h" className="space-y-3">
          <h2 id="display-h" className="text-xl font-bold">
            Display and reading
          </h2>
          <div
            role="radiogroup"
            aria-label="Colour theme"
            className="grid grid-cols-3 gap-1 rounded-2xl bg-white p-1 shadow-sm"
          >
            {(
              [
                ["light", "Light", Sun],
                ["dark", "Dark", Moon],
                ["system", "Like my phone", Monitor],
              ] as const
            ).map(([v, label, Icon]) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={theme === v}
                onClick={() => {
                  setTheme(v);
                  setThemeState(v);
                }}
                className={cn(
                  "flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-xl text-sm font-bold",
                  theme === v ? "bg-judy-primary text-white" : "text-[#5E6272]",
                )}
              >
                <Icon size={20} aria-hidden="true" />
                {label}
              </button>
            ))}
          </div>
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

function Row({
  to,
  icon,
  label,
  hint,
}: {
  to: "/rules" | "/trusted" | "/carer" | "/privacy" | "/help";
  icon: ReactNode;
  label: string;
  hint?: string | undefined;
}) {
  return (
    <Link
      to={to}
      className="flex min-h-16 items-center gap-4 rounded-3xl bg-white px-4 py-3 shadow-sm hover:bg-judy-lilac focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-judy-primary/30"
    >
      <span
        className="flex h-11 w-11 items-center justify-center rounded-full bg-judy-lilac text-judy-primary [&>svg]:h-5 [&>svg]:w-5"
        aria-hidden="true"
      >
        {icon}
      </span>
      <span className="flex-1">
        <span className="block text-lg font-bold">{label}</span>
        {hint && <span className="block text-base text-[#5E6272]">{hint}</span>}
      </span>
      <ChevronRight aria-hidden="true" className="text-[#8C8F9C]" />
    </Link>
  );
}
