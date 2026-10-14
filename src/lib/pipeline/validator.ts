import { FinalRiskReportSchema, type CheckerOutput, type FinalRiskReport, type ReaderOutput } from "./schemas";

export type ValidationResult = { ok: boolean; errors: string[] };

/**
 * Assembles the final report from validated stage outputs.
 * Pure TypeScript — no model call.
 */
export function buildFinalReport(
  reader: ReaderOutput,
  analysis: import("./schemas").AnalysisOutput,
  checker: CheckerOutput,
  models: { reader: string; analyzer: string; checker: string },
): FinalRiskReport {
  const claims = reader.key_claims.map((c) => c.text);
  const facts = reader.facts.map((f) => f.text);
  return {
    status: "approved",
    input_summary: (claims.length ? claims : facts).join(" | "),
    channel: reader.channel,
    risk_level: analysis.risk_level,
    risk_score: analysis.risk_score,
    summary: analysis.summary,
    evidence: analysis.evidence,
    triggered_boundaries: analysis.triggered_boundaries,
    uncertainty: analysis.uncertainty,
    recommendation: analysis.recommendation,
    checker_feedback: checker.feedback,
    models,
    generated_at: new Date().toISOString(),
  };
}

/**
 * Programmatic final validation (runs in TypeScript, never via another LLM call):
 * 1. Checker must have approved the analysis.
 * 2. The report must satisfy FinalRiskReportSchema.
 * 3. Every evidence reference must point to a real Reader fact id.
 * 4. Business constraints: risk score in range, boundaries cite saved rules.
 */
export function validateFinalReport(
  report: unknown,
  reader: ReaderOutput,
  checker: CheckerOutput,
): { ok: true; report: FinalRiskReport } | { ok: false; errors: string[] } {
  const errors: string[] = [];

  if (checker.decision !== "approved") {
    errors.push(`Checker decision is "${checker.decision}", not "approved" — the report cannot be published.`);
  }

  const parsed = FinalRiskReportSchema.safeParse(report);
  if (!parsed.success) {
    errors.push(
      `Final report failed schema validation: ${parsed.error.issues
        .slice(0, 5)
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}`,
    );
    return { ok: false, errors };
  }

  const finalReport = parsed.data;
  const factIds = new Set(reader.facts.map((f) => f.id));
  for (const e of finalReport.evidence) {
    if (!factIds.has(e.fact_id)) {
      errors.push(`Evidence references unknown fact id "${e.fact_id}".`);
    }
  }
  if (finalReport.risk_score < 0 || finalReport.risk_score > 100) {
    errors.push(`risk_score ${finalReport.risk_score} is outside 0-100.`);
  }
  for (const b of finalReport.triggered_boundaries) {
    if (!b.memory_id.trim() || !b.rule.trim()) {
      errors.push("Triggered boundaries must cite a saved rule (memory_id and rule are required).");
      break;
    }
  }
  if (finalReport.evidence.length === 0 && finalReport.risk_level !== "none") {
    errors.push(`A "${finalReport.risk_level}" risk assessment requires at least one evidence reference.`);
  }

  return errors.length ? { ok: false, errors } : { ok: true, report: finalReport };
}
