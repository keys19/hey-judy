import { z } from "zod";

export type TraceEvent = {
  t: number; // ms since stage start
  kind:
    | "model_request"
    | "model_response"
    | "tool_call"
    | "tool_run_start"
    | "tool_result"
    | "tool_error"
    | "structured_format_request"
    | "final"
    | "error";
  data: { [k: string]: any };
};

export const STAGE_ORDER = ["reader", "analyzer", "checker", "validator"] as const;
export type StageName = (typeof STAGE_ORDER)[number];
export type StageStatus = "completed" | "failed";

export type StageView = {
  stage: StageName;
  attempt: number;
  status: StageStatus;
  model?: string;
  output?: unknown;
  trace: TraceEvent[];
  validation?: { ok: boolean; errors: string[] };
  tokens_in?: number;
  tokens_out?: number;
  tool_calls?: number;
  duration_ms?: number;
  error?: string;
};

export type PipelineRunResult = {
  runId: string | null;
  status: "completed" | "needs_review" | "failed";
  stages: StageView[];
  finalReport?: FinalRiskReport;
  validation?: { ok: boolean; errors: string[] };
  error?: string;
  durationMs: number;
};

// ---------- Stage output schemas (deliberately loose: limits are enforced
// programmatically in validator.ts, never as schema bounds) ----------

export const ReaderFactSchema = z.object({
  id: z.string(),
  text: z.string(),
  type: z.string(),
});

export const ReaderOutputSchema = z.object({
  channel: z.string(),
  participants: z.array(z.string()),
  facts: z.array(ReaderFactSchema),
  key_claims: z.array(
    z.object({
      id: z.string(),
      text: z.string(),
      attributed_to: z.string(),
    }),
  ),
  unresolved: z.array(z.string()),
});
export type ReaderOutput = z.infer<typeof ReaderOutputSchema>;

export const AnalysisEvidenceSchema = z.object({
  fact_id: z.string(),
  finding: z.string(),
  is_risk_indicator: z.boolean(),
});

export const BoundarySchema = z.object({
  memory_id: z.string(),
  rule: z.string(),
  relevance: z.string(),
});

export const AnalysisOutputSchema = z.object({
  risk_level: z.enum(["none", "low", "medium", "high", "critical"]),
  risk_score: z.number(),
  summary: z.string(),
  evidence: z.array(AnalysisEvidenceSchema),
  risk_indicators: z.array(z.string()),
  uncertainty: z.array(z.string()),
  triggered_boundaries: z.array(BoundarySchema),
  recommendation: z.string(),
});
export type AnalysisOutput = z.infer<typeof AnalysisOutputSchema>;

export const CheckerOutputSchema = z.object({
  decision: z.enum(["approved", "needs_revision", "rejected"]),
  unsupported_claims: z.array(z.string()),
  overlooked_evidence: z.array(z.string()),
  inconsistencies: z.array(z.string()),
  inappropriate_risk_level: z.boolean(),
  feedback: z.string(),
});
export type CheckerOutput = z.infer<typeof CheckerOutputSchema>;

export const FinalRiskReportSchema = z.object({
  status: z.literal("approved"),
  input_summary: z.string(),
  channel: z.string(),
  risk_level: z.enum(["none", "low", "medium", "high", "critical"]),
  risk_score: z.number(),
  summary: z.string(),
  evidence: z.array(AnalysisEvidenceSchema),
  triggered_boundaries: z.array(BoundarySchema),
  uncertainty: z.array(z.string()),
  recommendation: z.string(),
  checker_feedback: z.string(),
  models: z.object({
    reader: z.string(),
    analyzer: z.string(),
    checker: z.string(),
  }),
  generated_at: z.string(),
});
export type FinalRiskReport = z.infer<typeof FinalRiskReportSchema>;
