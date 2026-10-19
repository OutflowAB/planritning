"use client";

import {
  ArchiveBoxIcon,
  ArrowUpTrayIcon,
  BanknotesIcon,
  CheckBadgeIcon,
  DocumentArrowDownIcon,
  SparklesIcon,
} from "@heroicons/react/24/outline";
import Link from "next/link";
import { ComponentType, SVGProps, useEffect, useState } from "react";

import type { ImageListItem } from "@/app/api/images/route";
import { GENERATION_UPDATED_EVENT, LIBRARY_UPDATED_EVENT } from "@/lib/app-events";
import { formatDateTime } from "@/lib/format-date";
import { imageDisplayName } from "@/lib/image-naming";
import { imageUrl } from "@/lib/image-url";

const SEK_PER_GENERATION = 50;
const sekFormat = new Intl.NumberFormat("sv-SE");

function greetingFor(hour: number) {
  if (hour < 5) return "God natt";
  if (hour < 10) return "God morgon";
  if (hour < 13) return "God förmiddag";
  if (hour < 18) return "God eftermiddag";
  return "God kväll";
}

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const response = await fetch(url, { credentials: "same-origin" });
    return response.ok ? ((await response.json()) as T) : null;
  } catch {
    return null;
  }
}

type Overview = { monthCount: number | null; archiveCount: number | null; recent: ImageListItem[] | null };

/** One fetch shared by every part of the overview that asks at the same moment. */
let pendingOverview: Promise<Overview> | null = null;
function fetchOverview(): Promise<Overview> {
  pendingOverview ??= (async () => {
    const now = new Date();
    const month = new URLSearchParams({
      kind: "generated",
      count: "1",
      from: new Date(now.getFullYear(), now.getMonth(), 1).toISOString(),
      to: new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString(),
    });
    const [monthResult, archiveResult, recentResult] = await Promise.all([
      getJson<{ count: number }>(`/api/images?${month.toString()}`),
      getJson<{ count: number }>("/api/images?kind=generated&saved=1&count=1"),
      getJson<{ items: ImageListItem[] }>("/api/images?kind=generated&saved=1&limit=4"),
    ]);
    return {
      monthCount: monthResult?.count ?? null,
      archiveCount: archiveResult?.count ?? null,
      recent: recentResult?.items ?? [],
    };
  })().finally(() => {
    window.setTimeout(() => {
      pendingOverview = null;
    }, 500);
  });
  return pendingOverview;
}

/** This month's count, the archive size and the newest plans; refreshed when a plan is made. */
function useOverview() {
  const [overview, setOverview] = useState<Overview>({ monthCount: null, archiveCount: null, recent: null });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const next = await fetchOverview();
      if (!cancelled) {
        setOverview(next);
      }
    }
    void load();
    window.addEventListener(GENERATION_UPDATED_EVENT, load);
    window.addEventListener(LIBRARY_UPDATED_EVENT, load);
    return () => {
      cancelled = true;
      window.removeEventListener(GENERATION_UPDATED_EVENT, load);
      window.removeEventListener(LIBRARY_UPDATED_EVENT, load);
    };
  }, []);

  return overview;
}

export function StartsidaGreeting({ tenantName }: { tenantName: string }) {
  const [greeting, setGreeting] = useState<string | null>(null);
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setGreeting(greetingFor(new Date().getHours())));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  return (
    <header className="mb-5 md:mb-6">
      <p className="mb-1 text-xs font-medium text-stone-500">{tenantName}</p>
      <h1 className="min-h-[1.75rem] text-xl font-semibold tracking-[-0.02em] text-stone-900 md:text-[22px]">
        {greeting ? `${greeting}!` : " "}
      </h1>
      <p className="mt-1 max-w-2xl text-[13px] leading-5 text-stone-500">
        Ladda upp en gammal ritning eller klistra in en Polycam-länk, så ritas den om i er stil.
      </p>
    </header>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  hint,
  href,
}: {
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  label: string;
  value: string | null;
  hint: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="group flex min-w-0 items-center gap-3 rounded-xl border border-stone-200 bg-white px-3 py-2.5 shadow-[0_1px_2px_rgba(28,25,23,0.04)] transition hover:border-stone-300 hover:shadow-[0_6px_20px_-10px_rgba(28,25,23,0.2)] sm:px-3.5 sm:py-3"
    >
      <span className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary sm:flex">
        <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[11px] font-medium text-stone-500">{label}</span>
        <span className="block text-lg font-semibold leading-6 tracking-tight text-stone-900 tabular-nums">
          {value ?? <span className="inline-block h-4 w-10 animate-pulse rounded bg-stone-100 align-middle" />}
        </span>
        <span className="hidden truncate text-[11px] text-stone-400 sm:block">{hint}</span>
      </span>
    </Link>
  );
}

export function StartsidaStats() {
  const { monthCount, archiveCount } = useOverview();
  const monthName = new Date().toLocaleDateString("sv-SE", { month: "long" });

  return (
    <div className="mb-5 grid grid-cols-3 gap-2 sm:gap-3 md:mb-6">
      <Stat
        icon={SparklesIcon}
        label={`Planritningar i ${monthName}`}
        value={monthCount === null ? null : String(monthCount)}
        hint="Genererade den här månaden"
        href="/fakturering"
      />
      <Stat
        icon={BanknotesIcon}
        label="Kostnad hittills"
        value={monthCount === null ? null : `${sekFormat.format(monthCount * SEK_PER_GENERATION)} kr`}
        hint={`${SEK_PER_GENERATION} kr per planritning`}
        href="/fakturering"
      />
      <Stat
        icon={ArchiveBoxIcon}
        label="I arkivet"
        value={archiveCount === null ? null : String(archiveCount)}
        hint="Sparade planritningar"
        href="/planritningar"
      />
    </div>
  );
}

const STEPS = [
  {
    icon: ArrowUpTrayIcon,
    title: "Ladda upp",
    text: "En bild av en gammal ritning, eller en länk till en Polycam-skanning.",
  },
  {
    icon: CheckBadgeIcon,
    title: "Granska",
    text: "Jämför före och efter. Godkänn, eller neka och beskriv vad som ska ändras.",
  },
  {
    icon: DocumentArrowDownIcon,
    title: "Använd",
    text: "Ladda ner som PDF, JPG eller SVG, eller lägg till rumsnamn i redigeraren.",
  },
];

export function StartsidaAside() {
  const { recent } = useOverview();

  return (
    <aside className="space-y-4">
      <section className="rounded-xl border border-stone-200 bg-white p-4 shadow-[0_1px_2px_rgba(28,25,23,0.04)]">
        <h2 className="text-[13px] font-semibold text-stone-900">Så fungerar det</h2>
        <ol className="mt-3 space-y-3">
          {STEPS.map((step, index) => (
            <li key={step.title} className="flex gap-3">
              <span className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                <step.icon className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="absolute -right-1 -top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-white text-[9px] font-semibold text-stone-500 ring-1 ring-stone-200">
                  {index + 1}
                </span>
              </span>
              <span className="min-w-0">
                <span className="block text-[13px] font-medium text-stone-900">{step.title}</span>
                <span className="block text-xs leading-[1.125rem] text-stone-500">{step.text}</span>
              </span>
            </li>
          ))}
        </ol>
      </section>

      <section className="rounded-xl border border-stone-200 bg-white p-4 shadow-[0_1px_2px_rgba(28,25,23,0.04)]">
        <div className="flex items-baseline justify-between">
          <h2 className="text-[13px] font-semibold text-stone-900">Senaste planritningar</h2>
          <Link href="/planritningar" className="text-xs font-medium text-stone-500 hover:text-stone-900">
            Visa alla
          </Link>
        </div>
        {recent === null ? (
          <div className="mt-3 space-y-2">
            {[0, 1, 2].map((index) => (
              <div key={index} className="h-10 animate-pulse rounded-lg bg-stone-100" />
            ))}
          </div>
        ) : recent.length === 0 ? (
          <p className="mt-3 text-xs text-stone-500">Dina färdiga planritningar hamnar här.</p>
        ) : (
          <ul className="mt-2 -mx-1.5">
            {recent.map((plan) => (
              <li key={plan.id}>
                <Link
                  href={`/planritningar?previewImageId=${plan.id}`}
                  className="flex items-center gap-3 rounded-lg px-1.5 py-1.5 transition hover:bg-stone-50"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- tiny pre-sized thumbnail from our own API */}
                  <img
                    src={imageUrl(plan.id, "thumb", plan.version)}
                    alt=""
                    className="h-10 w-8 shrink-0 rounded-[3px] bg-stone-100 object-cover ring-1 ring-stone-200"
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-medium text-stone-900">
                      {plan.label ?? imageDisplayName(plan.id)}
                    </span>
                    <span className="block truncate text-[11px] text-stone-500 tabular-nums">
                      {formatDateTime(plan.created_at)}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </aside>
  );
}
