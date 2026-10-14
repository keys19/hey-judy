import { z } from "zod";
import { SIGNS, SPEAKERS } from "./judy";

const text = z.string().trim().min(1).max(4000);
const factId = z.string().regex(/^f[1-9][0-9]*$/);
export const RiskLevelSchema = z.enum(["none", "low", "medium", "high", "critical"]);
export const ReaderOutputSchema = z
  .object({
    channel: text,
    participants: z.array(text).max(30),
    facts: z
      .array(
        z
          .object({
            id: factId,
            text,
            type: z.enum([
              "statement",
              "request",
              "identity",
              "amount",
              "deadline",
              "contact",
              "other",
            ]),
            quote: text.describe(
              "An exact, contiguous quote from the input supporting this fact, with any person's name replaced by [name].",
            ),
            speaker: z
              .enum(SPEAKERS)
              .describe("Who said it: 'them' (the other person), 'me' (the user) or 'unknown'."),
            sign: z
              .enum(SIGNS)
              .describe("The single best-matching warning sign for this fact, or 'none'."),
          })
          .strict(),
      )
      .max(40),
    key_claims: z
      .array(
        z
          .object({ id: text, text, attributed_to: text, fact_ids: z.array(factId).min(1) })
          .strict(),
      )
      .max(30),
    unresolved: z.array(text).max(30),
    readable: z
      .boolean()
      .describe(
        "false if the screenshot or text is too unclear to read reliably; then facts may be empty.",
      ),
  })
  .strict();
export const AnalysisEvidenceSchema = z
  .object({ fact_id: factId, finding: text, is_risk_indicator: z.boolean() })
  .strict();
export const BoundarySchema = z
  .object({
    memory_id: z.string().uuid(),
    rule: text,
    relevance: text,
    fact_ids: z.array(factId).min(1),
  })
  .strict();
export const AnalysisOutputSchema = z
  .object({
    risk_level: RiskLevelSchema,
    risk_score: z.number().int().min(0).max(100),
    summary: text,
    evidence: z.array(AnalysisEvidenceSchema).max(50),
    risk_indicators: z.array(text).max(30),
    uncertainty: z.array(text).max(30),
    triggered_boundaries: z.array(BoundarySchema).max(100),
    recommendation: text,
    // Hey Judy: one follow-up question, only when its answer would change the
    // colour and can_ask_question is true. Otherwise null.
    question_for_user: z
      .object({
        text: text.describe("One short, plain question for the person."),
        options: z.array(text).max(3).describe("Up to 3 short tap answers."),
      })
      .strict()
      .nullable(),
  })
  .strict();
export const CheckerOutputSchema = z
  .object({
    decision: z.enum(["approved", "needs_revision", "rejected"]),
    unsupported_claims: z.array(text).max(30),
    overlooked_evidence: z.array(text).max(30),
    inconsistencies: z.array(text).max(30),
    inappropriate_risk_level: z.boolean(),
    feedback: text,
  })
  .strict();
export const FinalRiskReportSchema = AnalysisOutputSchema.extend({
  status: z.literal("approved"),
  input_summary: text,
  channel: text,
  checker_feedback: text,
  models: z.object({ reader: text, analyzer: text, checker: text }).strict(),
  generated_at: z.string().datetime(),
}).strict();
export const MemorySchema = z.object({
  id: z.string().uuid(),
  content: text,
  created_at: z.string(),
});
export type Memory = z.infer<typeof MemorySchema>;
export type ReaderOutput = z.infer<typeof ReaderOutputSchema>;
export type AnalysisOutput = z.infer<typeof AnalysisOutputSchema>;
export type CheckerOutput = z.infer<typeof CheckerOutputSchema>;
export type FinalRiskReport = z.infer<typeof FinalRiskReportSchema>;
export type AgentName = "reader" | "analyzer" | "checker";
export const STAGE_ORDER = ["reader", "analyzer", "checker", "validator"] as const;
export type StageName = (typeof STAGE_ORDER)[number];
export type StageStatus = "running" | "completed" | "failed";
export type ValidationResult = { ok: boolean; errors: string[] };
export type TraceEvent = { t: number; kind: string; data: Record<string, unknown> };
export type StageView = {
  stage: StageName;
  attempt: number;
  status: StageStatus;
  trace: TraceEvent[];
  model?: string | undefined;
  output?: unknown;
  validation?: ValidationResult | undefined;
  tokens_in?: number | undefined;
  tokens_out?: number | undefined;
  tool_calls?: number | undefined;
  duration_ms?: number | undefined;
  error?: string | undefined;
  config_version?: number | null | undefined;
};
export type PipelineRunResult = {
  runId: string | null;
  status: "completed" | "needs_review" | "failed";
  stages: StageView[];
  finalReport?: FinalRiskReport | undefined;
  validation?: ValidationResult | undefined;
  error?: string | undefined;
  warnings: string[];
  durationMs: number;
};
