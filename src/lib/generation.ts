export const MAX_REQUIREMENT_LENGTH = 4000;
export const GENERATION_TIMEOUT_MS = 120_000;
export const CLIENT_TIMEOUT_MS = 135_000;

export type GenerationResult = {
  html: string;
  model: string;
  durationMs: number;
  generatedAt: string;
};
