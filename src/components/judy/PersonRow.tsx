import { Check } from "lucide-react";
import { timeAgo, type LastCheck } from "@/lib/judy-db";
import { Orb, StatusPill } from "./ui";

// One person you've asked Judy about (Lovable layout): Judy's face in their
// last colour, name, one line about the last check, a status pill, and when.
export function PersonRowContent({
  nickname,
  last,
  selected = false,
}: {
  nickname: string;
  last: LastCheck | undefined;
  selected?: boolean;
}) {
  return (
    <>
      <Orb mood={last ? last.colour : "neutral"} size={52} animate={false} label="" />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className="truncate text-lg font-bold">{nickname}</span>
          {last && (
            <span className="shrink-0 text-sm text-[#5E6272]">{timeAgo(last.created_at)}</span>
          )}
        </span>
        {last ? (
          <>
            {last.summary && (
              <span className="block truncate text-base text-[#5E6272]">{last.summary}</span>
            )}
            <StatusPill colour={last.colour} className="mt-1.5 text-sm" />
          </>
        ) : (
          <span className="block text-base text-[#5E6272]">Not checked yet</span>
        )}
      </span>
      {selected && <Check aria-label="Selected" className="shrink-0 text-judy-primary" />}
    </>
  );
}
