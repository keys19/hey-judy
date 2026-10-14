import {
  ReaderOutputSchema,
  AnalysisOutputSchema,
  CheckerOutputSchema,
  FinalRiskReportSchema,
  type ReaderOutput,
  type AnalysisOutput,
  type CheckerOutput,
  type FinalRiskReport,
  type Memory,
} from "./schemas";

export function validateReader(raw: unknown, original: string): ReaderOutput {
  const output = ReaderOutputSchema.parse(raw);
  const ids = new Set<string>();
  for (const fact of output.facts) {
    if (ids.has(fact.id)) throw new Error("Duplicate Reader fact id: " + fact.id);
    ids.add(fact.id);
    if (!original.includes(fact.quote))
      throw new Error("Reader quote does not exist in the original input: " + fact.id);
  }
  for (const claim of output.key_claims) {
    if (claim.fact_ids.some((id) => !ids.has(id)))
      throw new Error("Reader claim cites an unknown fact.");
  }
  return output;
}

export function validateAnalysis(
  raw: unknown,
  reader: ReaderOutput,
  memories: Memory[],
): AnalysisOutput {
  const output = AnalysisOutputSchema.parse(raw);
  const ids = new Set(reader.facts.map((f) => f.id));
  for (const evidence of output.evidence) {
    if (!ids.has(evidence.fact_id))
      throw new Error("Analysis cites unknown fact: " + evidence.fact_id);
  }
  if (output.risk_level !== "none" && !output.evidence.some((e) => e.is_risk_indicator)) {
    throw new Error("A non-zero risk assessment requires a supported risk indicator.");
  }
  const bands = {
    none: [0, 0],
    low: [1, 24],
    medium: [25, 59],
    high: [60, 84],
    critical: [85, 100],
  } as const;
  const [min, max] = bands[output.risk_level];
  if (output.risk_score < min || output.risk_score > max)
    throw new Error("Risk score does not match the risk level band.");
  for (const boundary of output.triggered_boundaries) {
    const memory = memories.find((m) => m.id === boundary.memory_id);
    if (!memory || memory.content !== boundary.rule)
      throw new Error("Boundary must cite an exact, actually retrieved user rule.");
    if (
      boundary.fact_ids.some(
        (id) =>
          !ids.has(id) || !output.evidence.some((e) => e.fact_id === id && e.is_risk_indicator),
      )
    ) {
      throw new Error("Boundary conflict requires supported risk evidence references.");
    }
  }
  if (output.triggered_boundaries.length && output.risk_score < 60)
    throw new Error("A reported hard-boundary conflict must have high or critical risk.");
  if (!reader.facts.length && !output.uncertainty.length)
    throw new Error("Missing facts must be represented as uncertainty.");
  return output;
}

export function validateChecker(raw: unknown): CheckerOutput {
  const output = CheckerOutputSchema.parse(raw);
  if (
    output.decision === "approved" &&
    (output.unsupported_claims.length ||
      output.overlooked_evidence.length ||
      output.inconsistencies.length ||
      output.inappropriate_risk_level)
  )
    throw new Error("Checker cannot approve while reporting unresolved issues.");
  return output;
}

export function buildFinalReport(
  reader: ReaderOutput,
  analysis: AnalysisOutput,
  checker: CheckerOutput,
  models: { reader: string; analyzer: string; checker: string },
): FinalRiskReport {
  if (checker.decision !== "approved")
    throw new Error("Unapproved analysis cannot become a final report.");
  return {
    ...analysis,
    status: "approved",
    input_summary:
      reader.facts
        .map((f) => f.text)
        .join(" | ")
        .slice(0, 4000) || "No verifiable facts extracted.",
    channel: reader.channel,
    checker_feedback: checker.feedback,
    models,
    generated_at: new Date().toISOString(),
  };
}
export function validateFinalReport(
  report: unknown,
  reader: ReaderOutput,
  checker: CheckerOutput,
  memories: Memory[],
) {
  try {
    validateChecker(checker);
    if (checker.decision !== "approved")
      throw new Error("Checker has not approved this assessment.");
    const parsed = FinalRiskReportSchema.parse(report);
    const {
      status: _status,
      input_summary: _summary,
      channel: _channel,
      checker_feedback: _feedback,
      models: _models,
      generated_at: _date,
      ...analysis
    } = parsed;
    validateAnalysis(analysis, reader, memories);
    return { ok: true as const, report: parsed, errors: [] as string[] };
  } catch (error) {
    return { ok: false as const, errors: [error instanceof Error ? error.message : String(error)] };
  }
}
