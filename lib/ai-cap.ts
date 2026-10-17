/** AI redraws allowed per calendar month (Stockholm time) for the whole firm. */
export const DEFAULT_AI_MONTHLY_CAP = 1000;

export function aiMonthlyCap(setting = process.env.AI_MONTHLY_CAP): number {
  const cap = Number(setting);
  return Number.isInteger(cap) && cap >= 0 ? cap : DEFAULT_AI_MONTHLY_CAP;
}

export function isAiCapReached(usedThisMonth: number, cap: number) {
  return usedThisMonth >= cap;
}

export const AI_CAP_MESSAGE =
  "Månadens AI-kvot är slut. Tomma planritningar och skanningar fungerar som vanligt; be superadmin höja kvoten.";
