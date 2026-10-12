import type { InitialGeneration } from "./execution";
import type { TeamOutcome } from "./team/contract";

// Page-local observations only. Never persisted or reconstructed from server clocks.
export type GenerationProgress = {
  record: InitialGeneration;
  startedAt: number;
  lastProgressAt: number;
  endedAt?: number;
  waiting: "trial" | "connection" | "team";
  modification: boolean;
  outcome?: TeamOutcome;
  reason?: string;
  html?: string;
  saved?: boolean;
  preview?: "loading" | "loaded" | "failed" | "blocked";
};
export const generationStages = ["整理需求", "编写应用", "代码审查", "准备预览"] as const;

export function generationFacts(progress: GenerationProgress) {
  const team = progress.record.team;
  let requirements = false, codeHash: string | undefined, iteration = 0;
  let assigned: string | undefined, repair = 0;
  for (const delivery of team?.deliveries ?? []) {
    // The transport has validated live deliveries. Historical/absent facts stay unknown.
    try {
      const value = JSON.parse(delivery.content);
      if (delivery.role === "Mike" && value.command === "assign") {
        assigned = value.to;
        if (assigned === "Engineer" && iteration) repair = iteration;
      } else if (delivery.role === "Requirements" && value.requirements?.length) {
        requirements = true; assigned = undefined;
      } else if (delivery.role === "Engineer") {
        codeHash = value.codeHash; iteration = value.iteration; assigned = undefined;
        repair = Math.max(repair, iteration - 1);
      } else if (delivery.role === "Reviewer") assigned = undefined;
    } catch { /* Unknown facts do not advance stages. */ }
  }
  const call = team?.calls.findLast(call => call.status === "started");
  const repairing = assigned === "Engineer" && iteration > 0;
  const code = !!codeHash && team?.codeHash === codeHash && !repairing;
  const reviewed = code && team?.review?.codeHash === codeHash;
  const actor = call?.actor === "Mike" ? assigned : call?.actor ?? assigned;
  const stage = progress.html ? 3 : repairing || actor === "Engineer" ? 1 : code || actor === "Reviewer" ? 2 : requirements ? 1 : 0;
  return { stage, completed: [requirements, code, reviewed, progress.preview === "loaded"], repair, repairing,
    modelWaiting: !!call && progress.endedAt === undefined, coordinating: call?.actor === "Mike", actor };
}
