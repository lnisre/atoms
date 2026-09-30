import type { GenerationResult } from "./generation";

export type ExecutionEvent = {
  taskId: string;
  source: "server" | "browser";
  sequence: number;
  stepId: string;
  label: string;
  status: "started" | "completed" | "failed";
  at: string;
  detail: string;
};
export type InitialGeneration = {
  taskId: string;
  startedAt: string;
  assistantReply: string | null;
  events: ExecutionEvent[];
};
export type GenerationEvent =
  | { type: "step"; event: ExecutionEvent }
  | { type: "result"; taskId: string; result: GenerationResult; assistantReply: string | null }
  | { type: "error"; taskId: string; error: string };

// Each executor owns its sequence and clock; array order is observation order,
// not a claim that server and browser wall clocks are synchronized.
export function createRecorder(taskId: string, source: ExecutionEvent["source"], emit: (event: ExecutionEvent) => void) {
  let sequence = 0;
  return (stepId: string, label: string, status: ExecutionEvent["status"], detail: string) => {
    emit({ taskId, source, sequence: ++sequence, stepId, label, status, detail, at: new Date().toISOString() });
  };
}
export type RecordStep = ReturnType<typeof createRecorder>;
