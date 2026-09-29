export const MAX_REQUIREMENT_LENGTH = 4000;
export const MAX_HTML_LENGTH = 500_000;
export const MAX_CONTEXT_LENGTH = 32_000;
export const MAX_REQUEST_LENGTH = 3_300_000;
export const GENERATION_TIMEOUT_MS = 120_000;
export const CLIENT_TIMEOUT_MS = 135_000;

export type GenerationResult = {
  html: string;
  model: string;
  durationMs: number;
  generatedAt: string;
};
