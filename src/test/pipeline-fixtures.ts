import type { ReaderOutput, AnalysisOutput, CheckerOutput, Memory } from "@/lib/pipeline/schemas";
import type { AgentDrivers, StageContext } from "@/lib/pipeline/contracts";
export const INPUT = "Send £500 to this new account immediately. Do not call your bank.";
export const MEMORIES: Memory[] = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    content: "Never transfer money to an unfamiliar account.",
    created_at: "2026-10-14T12:00:00Z",
  },
];
export const READER: ReaderOutput = {
  channel: "unknown",
  participants: ["unknown sender"],
  facts: [
    {
      id: "f1",
      type: "request",
      text: "The sender requests an immediate transfer.",
      quote: "Send £500 to this new account immediately.",
      speaker: "them",
      sign: "money_request",
    },
  ],
  key_claims: [
    {
      id: "c1",
      text: "The sender asks for £500.",
      attributed_to: "unknown sender",
      fact_ids: ["f1"],
    },
  ],
  unresolved: ["The sender's identity is not verified."],
  readable: true,
};
export const ANALYSIS: AnalysisOutput = {
  risk_level: "high",
  risk_score: 75,
  summary: "The unverified request conflicts with a saved boundary.",
  evidence: [
    {
      fact_id: "f1",
      finding: "The message requests an urgent transfer to a new account.",
      is_risk_indicator: true,
    },
  ],
  risk_indicators: ["Urgency", "Unfamiliar recipient"],
  uncertainty: ["Identity and account ownership are unverified."],
  triggered_boundaries: [
    {
      memory_id: MEMORIES[0]!.id,
      rule: MEMORIES[0]!.content,
      relevance: "A transfer to a new account is requested.",
      fact_ids: ["f1"],
    },
  ],
  recommendation: "Pause and verify using a trusted contact channel.",
  question_for_user: null,
};
export const APPROVED: CheckerOutput = {
  decision: "approved",
  unsupported_claims: [],
  overlooked_evidence: [],
  inconsistencies: [],
  inappropriate_risk_level: false,
  feedback: "The assessment is proportionate to the cited evidence and preserves uncertainty.",
};
export const REVISE: CheckerOutput = {
  ...APPROVED,
  decision: "needs_revision",
  feedback: "Clarify that the identity is unverified.",
};
export const REJECTED: CheckerOutput = {
  ...APPROVED,
  decision: "rejected",
  feedback: "The evidence does not support this conclusion.",
};
export const clone = <T>(v: T): T => structuredClone(v);
export function fakeAgents(): AgentDrivers {
  return {
    reader: async () => clone(READER),
    analyzer: async () => ({ output: clone(ANALYSIS), memories: clone(MEMORIES) }),
    checker: async () => clone(APPROVED),
  };
}
export function stageContext(): StageContext {
  return {
    signal: new AbortController().signal,
    log: () => {},
    usage: { input: 0, output: 0, tools: 0 },
  };
}
