export interface Remediation {
  id: string;
  findingId: string;
  runId: string;
  title: string;
  whatHappened: string;
  whyItMatters: string;
  howToFix: string[];
  fixPrompt: string;
}
