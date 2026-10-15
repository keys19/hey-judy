import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { loadConfigs } from "./pipeline/repository";
import { IMAGE_MEDIA_TYPES, MAX_IMAGES, MAX_IMAGE_BASE64 } from "./pipeline/judy";
import type { TurnInput, TurnResult } from "./pipeline/judy-turn";

// The one call the Hey Judy app makes for everything in a chat with Judy.
//   action "start"  – Judy begins (asks the 3 intake questions for a new friend)
//   action "answer" – the person answers Judy's question (text = their answer)
//   action "share"  – the person shares text and/or a screenshot to check
// runId is a new UUID made by the browser, so it can subscribe to agent_log
// for this run (live progress) before calling.
const ImageSchema = z
  .object({
    media_type: z.enum(IMAGE_MEDIA_TYPES),
    data: z
      .string()
      .min(100)
      .max(MAX_IMAGE_BASE64)
      .regex(/^[A-Za-z0-9+/]+={0,2}$/, "Screenshot must be plain base64."),
  })
  .strict();

export const JudyTurnInputSchema = z
  .object({
    threadId: z.string().uuid(),
    runId: z.string().uuid(),
    action: z.enum(["start", "answer", "share"]),
    text: z.string().max(4000).optional(),
    image: ImageSchema.optional(),
    images: z.array(ImageSchema).min(1).max(MAX_IMAGES).optional(),
  })
  .strict()
  .refine((d) => d.action !== "answer" || !!d.text?.trim(), {
    message: "An answer needs some text.",
  })
  .refine((d) => d.action !== "share" || !!d.text?.trim() || !!d.image || !!d.images?.length, {
    message: "Add a screenshot, paste a message or describe what happened.",
  });
export type JudyTurnInput = z.infer<typeof JudyTurnInputSchema>;

export function toTurnInput(d: JudyTurnInput): TurnInput {
  if (d.action === "start") return { action: "start" };
  if (d.action === "answer") return { action: "answer", text: d.text ?? "" };
  return {
    action: "share",
    ...(d.text?.trim() ? { text: d.text } : {}),
    ...(d.images?.length || d.image
      ? { images: [...(d.image ? [d.image] : []), ...(d.images ?? [])].slice(0, MAX_IMAGES) }
      : {}),
  };
}

export const judyTurnFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => JudyTurnInputSchema.parse(data))
  .handler(async ({ data, context }): Promise<TurnResult> => {
    const db = context.supabase as unknown as SupabaseClient;
    const userId = context.userId;
    const { judyTurn } = await import("./pipeline/judy-turn");
    const { createJudyStore } = await import("./pipeline/judy-store");
    const { createLiveAgents } = await import("./pipeline/claude-agents");
    const { readUserRules } = await import("./memory-tools");
    const configs = await loadConfigs(context.supabase);
    return judyTurn(
      {
        store: createJudyStore(db, userId),
        configs,
        makeAgents: (options) =>
          createLiveAgents((signal) => readUserRules(db, userId, signal), options),
      },
      { threadId: data.threadId, runId: data.runId, input: toTurnInput(data) },
    );
  });
