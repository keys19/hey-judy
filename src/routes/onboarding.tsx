import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Gate, useJudy } from "@/components/judy/session";
import {
  AppFrame,
  Orb,
  PrimaryButton,
  SecondaryButton,
  ToggleRow,
  inputCls,
} from "@/components/judy/ui";
import { RulePicker } from "@/components/judy/RulePicker";
import { errorText, updateProfile } from "@/lib/judy-db";

export const Route = createFileRoute("/onboarding")({
  head: () => ({ meta: [{ title: "Getting started · Hey Judy" }] }),
  component: () => (
    <Gate need="onboarding">
      <Onboarding />
    </Gate>
  ),
});

function Onboarding() {
  const { userId, profile, refreshProfile } = useJudy();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [name, setName] = useState(profile.first_name ?? "");
  const [adult, setAdult] = useState(!!profile.confirmed_adult_at);
  const [terms, setTerms] = useState(!!profile.accepted_terms_at);
  const [busy, setBusy] = useState(false);

  const save = async (patch: Parameters<typeof updateProfile>[1]) => {
    try {
      await updateProfile(userId, patch);
      await refreshProfile();
    } catch (e) {
      toast.error("Could not save: " + errorText(e));
      throw e;
    }
  };

  const steps = 3;
  return (
    <AppFrame className="px-6 py-8">
      <div className="mb-6 flex items-center gap-2" aria-label={`Step ${step + 1} of ${steps}`}>
        {Array.from({ length: steps }).map((_, i) => (
          <span
            key={i}
            className={
              "h-2 flex-1 rounded-full " + (i <= step ? "bg-judy-primary" : "bg-[#DCD5E2]")
            }
          />
        ))}
      </div>

      {step === 0 && (
        <form
          className="flex flex-1 flex-col"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!name.trim() || !adult || !terms) return;
            setBusy(true);
            try {
              const now = new Date().toISOString();
              await save({
                first_name: name.trim().slice(0, 40),
                confirmed_adult_at: profile.confirmed_adult_at ?? now,
                accepted_terms_at: profile.accepted_terms_at ?? now,
              });
              setStep(1);
            } catch {
              /* toast shown */
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="flex justify-center">
            <Orb size={110} />
          </div>
          <h1 className="mt-6 text-center text-3xl font-bold">Nice to meet you</h1>
          <label className="mt-6 block">
            <span className="mb-1 block text-lg font-bold">What should I call you?</span>
            <input
              className={inputCls}
              value={name}
              autoComplete="given-name"
              placeholder="Your first name"
              onChange={(e) => setName(e.target.value)}
              required
            />
          </label>
          <div className="mt-5 space-y-3">
            <ToggleRow label="I am 18 or older" checked={adult} onChange={setAdult} />
            <ToggleRow
              label="I understand Judy is an AI helper"
              hint="Judy can make mistakes and cannot promise someone is trustworthy. I decide what to do."
              checked={terms}
              onChange={setTerms}
            />
          </div>
          <div className="mt-auto space-y-3 pt-8">
            <PrimaryButton type="submit" disabled={busy || !name.trim() || !adult || !terms}>
              Next
            </PrimaryButton>
            <Link
              to="/carer"
              className="flex min-h-12 items-center justify-center text-lg font-bold text-judy-primary underline"
            >
              I'm here as someone's trusted person
            </Link>
          </div>
        </form>
      )}

      {step === 1 && (
        <div className="flex flex-1 flex-col">
          <h1 className="text-3xl font-bold">How should Judy look and sound?</h1>
          <p className="mt-2 text-lg text-[#3F4454]">You can change these any time in Settings.</p>
          <div className="mt-6 space-y-3">
            <ToggleRow
              label="Larger text"
              checked={profile.larger_text}
              onChange={(v) => void save({ larger_text: v }).catch(() => {})}
            />
            <ToggleRow
              label="Read answers aloud"
              hint="Judy reads each result out loud."
              checked={profile.read_aloud}
              onChange={(v) => void save({ read_aloud: v }).catch(() => {})}
            />
            <ToggleRow
              label="Simpler words"
              checked={profile.simpler_language}
              onChange={(v) => void save({ simpler_language: v }).catch(() => {})}
            />
            <ToggleRow
              label="Extra guidance"
              hint="Show more tips on each screen."
              checked={profile.extra_guidance}
              onChange={(v) => void save({ extra_guidance: v }).catch(() => {})}
            />
          </div>
          <div className="mt-auto space-y-3 pt-8">
            <PrimaryButton onClick={() => setStep(2)}>Next</PrimaryButton>
            <SecondaryButton onClick={() => setStep(0)}>Back</SecondaryButton>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="flex flex-1 flex-col">
          <h1 className="text-3xl font-bold">Your rules</h1>
          <p className="mt-2 text-lg text-[#3F4454]">
            Pick the rules you want to keep. Judy will tell you if a message goes against one of
            them. We ticked some good ones to start.
          </p>
          <div className="mt-6">
            <RulePicker userId={userId} seedDefaults />
          </div>
          <div className="mt-auto space-y-3 pt-8">
            <PrimaryButton
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await save({ onboarding_done: true });
                  void navigate({ to: "/" });
                } catch {
                  /* toast shown */
                } finally {
                  setBusy(false);
                }
              }}
            >
              I'm ready
            </PrimaryButton>
            <SecondaryButton onClick={() => setStep(1)}>Back</SecondaryButton>
          </div>
        </div>
      )}
    </AppFrame>
  );
}
