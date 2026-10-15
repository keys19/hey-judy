import { createFileRoute } from "@tanstack/react-router";
import { Gate, useJudy } from "@/components/judy/session";
import { AppFrame, PageHeader, boundariesTitle } from "@/components/judy/ui";
import { RulePicker } from "@/components/judy/RulePicker";

export const Route = createFileRoute("/rules")({
  head: () => ({ meta: [{ title: "Boundaries · Hey Judy" }] }),
  component: () => (
    <Gate need="person">
      <Rules />
    </Gate>
  ),
});

function Rules() {
  const { userId, profile } = useJudy();
  return (
    <AppFrame tabs>
      <PageHeader title={boundariesTitle(profile.first_name)} back />
      <p className="px-5 text-lg text-[#3F4454]">
        Boundaries are your own lines that others shouldn't push you to cross. Judy tells you when a
        message goes against one. Changes save straight away.
      </p>
      <div className="px-5 py-5">
        <RulePicker userId={userId} />
      </div>
    </AppFrame>
  );
}
