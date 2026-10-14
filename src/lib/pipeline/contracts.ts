import type { AgentConfig } from "./defaults";
import type {
  AnalysisOutput,
  CheckerOutput,
  Memory,
  ReaderOutput,
  StageView,
  PipelineRunResult,
} from "./schemas";
export type StageContext = {
  signal: AbortSignal;
  log: (kind: string, data: Record<string, unknown>) => void;
  usage: { input: number; output: number; tools: number };
};
export type AnalyzerResult = { output: unknown; memories: Memory[] };
export interface AgentDrivers {
  reader(input: string, config: AgentConfig, context: StageContext): Promise<unknown>;
  analyzer(
    input: string,
    reader: ReaderOutput,
    config: AgentConfig,
    context: StageContext,
    feedback?: CheckerOutput,
  ): Promise<AnalyzerResult>;
  checker(
    input: string,
    reader: ReaderOutput,
    analysis: AnalysisOutput,
    memories: Memory[],
    config: AgentConfig,
    context: StageContext,
  ): Promise<unknown>;
}
export interface PipelineStore {
  started(stage: StageView): Promise<void>;
  stage(stage: StageView): Promise<void>;
  finish(result: PipelineRunResult): Promise<void>;
}
