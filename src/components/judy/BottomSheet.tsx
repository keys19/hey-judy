import type { ReactNode } from "react";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";

export function BottomSheet({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="mx-auto max-h-[90dvh] max-w-md overflow-y-auto rounded-t-3xl border-0 bg-white px-6 pb-8 pt-4 text-judy-ink [&>button]:right-4 [&>button]:top-4 [&>button]:min-h-11 [&>button]:min-w-11 [&>button>svg]:h-6 [&>button>svg]:w-6"
      >
        <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-[#D9D3DE]" aria-hidden="true" />
        <SheetTitle className="pr-10 text-2xl font-bold text-judy-ink">{title}</SheetTitle>
        {description ? (
          <SheetDescription className="mt-2 text-lg text-[#3F4454]">{description}</SheetDescription>
        ) : (
          <SheetDescription className="sr-only">{title}</SheetDescription>
        )}
        <div className="mt-5">{children}</div>
      </SheetContent>
    </Sheet>
  );
}
