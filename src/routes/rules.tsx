import { createFileRoute } from "@tanstack/react-router";
import { Gate, useJudy } from "@/components/judy/session";
import { AppFrame, PageHeader } from "@/components/judy/ui";
import { RulePicker } from "@/components/judy/RulePicker";

export const Route = createFileRoute("/rules")({
  head: () => ({ meta: [{ title: "My Rules · Hey Judy" }] }),
  component: () => (
    <Gate need="person">
      <Rules />
    </Gate>
  ),
});

function Rules() {
  const { userId } = useJudy();
  return (
    <AppFrame tabs>
      <PageHeader title="My Rules" />
      <p className="px-5 text-lg text-[#3F4454]">
        These are your rules. Judy checks every message against the ones you tick. Changes save
        straight away.
      </p>
      <div className="px-5 py-5">
        <RulePicker userId={userId} />
      </div>
    </AppFrame>
  );
}
