import { Check } from "lucide-react";
import type { Colour } from "@/lib/pipeline/judy-turn";
import { timeAgo } from "@/lib/judy-db";
import { Orb, StatusPill } from "./ui";

// One person you've asked Judy about: Judy's face in their last colour,
// their nickname, a status pill and when it was last checked.
export function PersonRowContent({
  nickname,
  last,
  selected = false,
}: {
  nickname: string;
  last: { colour: Colour; created_at: string } | undefined;
  selected?: boolean;
}) {
  return (
    <>
      <Orb mood={last ? last.colour : "neutral"} size={48} animate={false} label="" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-lg font-bold">{nickname}</span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
          {last ? (
            <>
              <StatusPill colour={last.colour} className="text-sm" />
              <span className="text-sm text-[#5E6272]">{timeAgo(last.created_at)}</span>
            </>
          ) : (
            <span className="text-base text-[#5E6272]">Not checked yet</span>
          )}
        </span>
      </span>
      {selected && <Check aria-label="Selected" className="text-judy-primary" />}
    </>
  );
}
