import { planPriceOre, stockholmRange } from "@/lib/billing";

/**
 * What the developer account sees: what the firm is billed, how many AI redraws it used, an
 * estimate of what those cost, and what is stored. Figures come from the database already summed
 * per month and realtor (dev_usage, dev_storage); this lays them out.
 */

export type UsageRow = { month: string; owner_id: string; plans: number; billed_ore: number; generations: number };
export type StorageRow = { owner_id: string; images: number; bytes: number };
export type ProfileName = { id: string; display_name: string; role: string };

export type UsageSettings = {
  planPriceSek: number;
  /** An estimate: an AI redraw is billed by OpenAI in dollars and varies with retries. */
  aiCostPerGenerationSek: number;
  aiMonthlyCap: number;
};

export type MonthUsage = {
  month: string;
  plans: number;
  billedSek: number;
  generations: number;
  aiCostSek: number;
  /** Billed minus the estimated AI cost. */
  marginSek: number;
};

export type RealtorUsage = {
  userId: string;
  displayName: string;
  plans: number;
  billedSek: number;
  generations: number;
  aiCostSek: number;
  images: number;
  storageMb: number;
};

export type DevUsage = {
  months: MonthUsage[];
  /** The realtors' figures for the current month, biggest spender first. */
  realtors: RealtorUsage[];
  totals: { realtors: number; images: number; storageMb: number };
  settings: UsageSettings;
};

export const DEFAULT_AI_COST_PER_GENERATION_SEK = 4;
export const USAGE_MONTHS = 6;

export function aiCostPerGenerationSek(setting = process.env.AI_COST_PER_GENERATION_SEK): number {
  const sek = Number(setting ?? DEFAULT_AI_COST_PER_GENERATION_SEK);
  return Number.isFinite(sek) && sek >= 0 ? sek : DEFAULT_AI_COST_PER_GENERATION_SEK;
}

/** "2026-10": the Stockholm calendar month an instant falls in. */
export function stockholmMonthKey(instant: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Stockholm", year: "numeric", month: "2-digit" }).formatToParts(instant);
  const value = (type: string) => parts.find((part) => part.type === type)?.value;
  return `${value("year")}-${value("month")}`;
}

/** The month keys shown, newest first, with the instant the oldest one starts (for the query). */
export function usageMonths(now = new Date(), count = USAGE_MONTHS): { keys: string[]; since: Date } {
  const keys = Array.from({ length: count }, (_, back) => stockholmMonthKey(stockholmRange("month", -back, now).from));
  return { keys, since: stockholmRange("month", -(count - 1), now).from };
}

const round = (value: number) => Math.round(value * 100) / 100;

export function buildDevUsage(input: {
  rows: UsageRow[];
  storage: StorageRow[];
  profiles: ProfileName[];
  settings: UsageSettings;
  now?: Date;
}): DevUsage {
  const { rows, storage, profiles, settings } = input;
  const { keys } = usageMonths(input.now);
  const cost = (generations: number) => round(generations * settings.aiCostPerGenerationSek);

  const months = keys.map((month): MonthUsage => {
    const inMonth = rows.filter((row) => row.month === month);
    const plans = inMonth.reduce((sum, row) => sum + Number(row.plans), 0);
    const billedSek = inMonth.reduce((sum, row) => sum + Number(row.billed_ore), 0) / 100;
    const generations = inMonth.reduce((sum, row) => sum + Number(row.generations), 0);
    return { month, plans, billedSek, generations, aiCostSek: cost(generations), marginSek: round(billedSek - cost(generations)) };
  });

  const stored = new Map(storage.map((row) => [row.owner_id, row]));
  const realtorProfiles = profiles.filter((profile) => profile.role === "user");
  const current = rows.filter((row) => row.month === keys[0]);
  const realtors = realtorProfiles
    .map((profile): RealtorUsage => {
      const mine = current.filter((row) => row.owner_id === profile.id);
      const generations = mine.reduce((sum, row) => sum + Number(row.generations), 0);
      const files = stored.get(profile.id);
      return {
        userId: profile.id,
        displayName: profile.display_name,
        plans: mine.reduce((sum, row) => sum + Number(row.plans), 0),
        billedSek: mine.reduce((sum, row) => sum + Number(row.billed_ore), 0) / 100,
        generations,
        aiCostSek: cost(generations),
        images: Number(files?.images ?? 0),
        storageMb: round(Number(files?.bytes ?? 0) / 1_048_576),
      };
    })
    .sort((a, b) => b.billedSek - a.billedSek || b.generations - a.generations || a.displayName.localeCompare(b.displayName, "sv"));

  return {
    months,
    realtors,
    totals: {
      realtors: realtorProfiles.length,
      images: storage.reduce((sum, row) => sum + Number(row.images), 0),
      storageMb: round(storage.reduce((sum, row) => sum + Number(row.bytes), 0) / 1_048_576),
    },
    settings,
  };
}

export function usageSettings(): UsageSettings {
  const cap = Number(process.env.AI_MONTHLY_CAP);
  return {
    planPriceSek: planPriceOre() / 100,
    aiCostPerGenerationSek: aiCostPerGenerationSek(),
    aiMonthlyCap: Number.isInteger(cap) && cap >= 0 ? cap : 1000,
  };
}
