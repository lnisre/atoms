// One workbench session owns this copy. It never enters project-store.
export type TrialData = {
  projectId: string;
  state: unknown;
  hasData: boolean;
};
