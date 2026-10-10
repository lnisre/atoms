export type Account = { id: string; email: string };
export type LoginIntent =
  | { id: string; kind: "generate"; requirement: string }
  | { id: string; kind: "save-example"; templateId: "tip-calculator" };

// Page-memory only. Taking clears before invoking async work, so repeated auth
// callbacks cannot repeat a paid action. The consumer reuses id for server dedupe.
export class PendingLoginAction {
  private intent: LoginIntent | null = null;
  set(intent: LoginIntent) { this.intent ??= intent; }
  take(): LoginIntent | null { const intent = this.intent; this.intent = null; return intent; }
  clear() { this.intent = null; }
}
