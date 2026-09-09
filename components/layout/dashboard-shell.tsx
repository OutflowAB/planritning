"use client";

import Link from "next/link";
import Image from "next/image";
import {
  ArrowRightStartOnRectangleIcon,
  ArrowUpTrayIcon,
  Bars3Icon,
  BuildingOffice2Icon,
  CreditCardIcon,
  Squares2X2Icon,
} from "@heroicons/react/24/outline";
import { usePathname, useRouter } from "next/navigation";
import { ComponentType, ReactNode, SVGProps, useCallback, useEffect, useMemo, useState } from "react";

import { setAuthenticated } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

type DashboardShellProps = {
  children: ReactNode;
  variant?: "default" | "admin";
};

type SidebarIcon = ComponentType<SVGProps<SVGSVGElement>>;

const defaultSidebarItems = [
  { label: "Startsida", href: "/startsida", icon: Squares2X2Icon },
  { label: "Planritningar", href: "/planritningar", icon: BuildingOffice2Icon },
  { label: "Uppladdningar", href: "/uppladdningar", icon: ArrowUpTrayIcon },
] as const satisfies ReadonlyArray<{ label: string; href: string; icon: SidebarIcon }>;

const adminSidebarItems = [
  { label: "Dashboard", href: "/admin/dashboard", icon: Squares2X2Icon },
  { label: "Planritningar", href: "/admin/planritningar", icon: BuildingOffice2Icon },
  { label: "Uppladdningar", href: "/admin/uppladdningar", icon: ArrowUpTrayIcon },
] as const satisfies ReadonlyArray<{ label: string; href: string; icon: SidebarIcon }>;

const billingItem = {
  label: "Fakturering",
  href: "/fakturering",
  icon: CreditCardIcon,
} as const satisfies { label: string; href: string; icon: SidebarIcon };

const adminBillingItem = {
  label: "Fakturering",
  href: "/admin/fakturering",
  icon: CreditCardIcon,
} as const satisfies { label: string; href: string; icon: SidebarIcon };

const IMAGE_GENERATION_COST_SEK = 50;
const UPLOADS_TABLE = "uploaded_images";
const GENERATED_UPLOADS_PREFIX = "generated/";
const GENERATION_EVENTS_EVENT = "generation_events";
const LEGACY_GENERATION_EVENT = "generation-updated";
const GENERATION_COUNT_CACHE_KEY = "generation-count-cache-v1";

/**
 * Each section has its own layout, so the shell remounts on every navigation. Starting the
 * counter at zero made the sidebar flash "0" and then jump to the real figure every single
 * time. Caching the last known count per month keeps the number stable across navigations
 * while it revalidates behind the scenes.
 */
function readCachedGenerationCount(monthKey: string): number | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.sessionStorage.getItem(GENERATION_COUNT_CACHE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as { monthKey?: string; count?: number };
    return parsed.monthKey === monthKey && typeof parsed.count === "number"
      ? parsed.count
      : null;
  } catch {
    return null;
  }
}

function writeCachedGenerationCount(monthKey: string, count: number) {
  if (typeof window === "undefined") {
    return;
  }

  window.sessionStorage.setItem(
    GENERATION_COUNT_CACHE_KEY,
    JSON.stringify({ monthKey, count }),
  );
}

function currentMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${now.getMonth()}`;
}

export function DashboardShell({ children, variant = "default" }: DashboardShellProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [imageGenerationCount, setImageGenerationCount] = useState<number | null>(null);
  const currentMonthLabel = useMemo(
    () =>
      new Date().toLocaleDateString("sv-SE", {
        month: "long",
        timeZone: "UTC",
      }),
    [],
  );

  const imageGenerationTotalCost = (imageGenerationCount ?? 0) * IMAGE_GENERATION_COST_SEK;
  const sidebarItems = variant === "admin" ? adminSidebarItems : defaultSidebarItems;
  const activeBillingItem = variant === "admin" ? adminBillingItem : billingItem;
  // Fakturering hör hemma i sidomenyn på desktop; på mobil ryms bara det man faktiskt
  // navigerar mellan, och tre poster får plats utan sidoscroll.
  const mobileNavItems = sidebarItems;
  const loadGenerationStats = useCallback(async () => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const monthEnd = new Date(
      now.getFullYear(),
      now.getMonth() + 1,
      1,
    ).toISOString();

    const { count, error } = await supabase
      .from(UPLOADS_TABLE)
      .select("id", { count: "exact", head: true })
      .like("file_path", `${GENERATED_UPLOADS_PREFIX}%`)
      .gte("created_at", monthStart)
      .lt("created_at", monthEnd);

    if (error) {
      return;
    }

    setImageGenerationCount(count ?? 0);
    writeCachedGenerationCount(currentMonthKey(), count ?? 0);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      // Paint the last known figure first so the sidebar does not flash a placeholder on
      // every navigation, then let the query overwrite it.
      const cached = readCachedGenerationCount(currentMonthKey());
      if (cached !== null) {
        setImageGenerationCount((previous) => previous ?? cached);
      }

      void loadGenerationStats();
    }, 0);

    function handleGenerationUpdated() {
      void loadGenerationStats();
    }

    window.addEventListener(GENERATION_EVENTS_EVENT, handleGenerationUpdated);
    window.addEventListener(LEGACY_GENERATION_EVENT, handleGenerationUpdated);

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener(GENERATION_EVENTS_EVENT, handleGenerationUpdated);
      window.removeEventListener(LEGACY_GENERATION_EVENT, handleGenerationUpdated);
    };
  }, [loadGenerationStats]);

  async function handleLogout() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // Ignore network errors and still clear local auth.
    }

    setAuthenticated(false);
    router.replace("/login");
  }

  function isActivePath(href: string) {
    const exactMatchPaths =
      variant === "admin"
        ? ["/admin/dashboard"]
        : ["/startsida"];

    if (exactMatchPaths.includes(href)) {
      return pathname === href;
    }

    return pathname === href || pathname.startsWith(`${href}/`);
  }

  return (
    <div className="flex min-h-screen flex-col pt-16">
      <header className="fixed inset-x-0 top-0 z-50 border-b border-white/10 bg-[#3f3f3f] text-white">
        <div className="flex h-16 w-full items-center justify-between px-4 md:px-6">
          <div className="flex items-center gap-6">
            <button
              type="button"
              onClick={() => setIsSidebarOpen((prev) => !prev)}
              className="hidden items-center justify-center rounded-none px-2 py-1 text-white/90 transition hover:bg-white/10 hover:text-white md:inline-flex"
              aria-label={isSidebarOpen ? "Dölj sidomeny" : "Visa sidomeny"}
            >
              <Bars3Icon className="h-[22px] w-[22px]" />
            </button>
          </div>

          <Image
            src="/sm-logo.svg"
            alt="SM-Planritning"
            width={200}
            height={42}
            priority
            className="h-9 w-auto brightness-0 invert md:h-10"
          />

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleLogout}
              className="inline-flex items-center gap-2 rounded-none px-3 py-2 text-xs font-medium text-white transition hover:bg-white/10"
            >
              <ArrowRightStartOnRectangleIcon className="h-[14px] w-[14px]" aria-hidden="true" />
              Logga ut
            </button>
          </div>
        </div>
      </header>
      <div className="flex w-full flex-1 min-h-0">
        <aside
          className={`sticky top-16 hidden h-[calc(100dvh-4rem)] overflow-hidden border-r bg-[#1f1f1f] text-white transition-[width,padding,opacity,border-color] duration-300 ease-in-out md:flex md:flex-col ${
            isSidebarOpen
              ? "w-64 border-white/10 p-4 opacity-100"
              : "w-0 border-transparent p-0 opacity-0"
          }`}
          aria-label="Huvudnavigering"
        >
          <div
            className={`flex h-full min-w-64 flex-col overflow-hidden pt-3 transition-opacity duration-200 ${
              isSidebarOpen ? "opacity-100" : "pointer-events-none opacity-0"
            }`}
          >
            {sidebarItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`inline-flex w-full items-center gap-2 rounded-none px-3 py-4 text-left text-sm font-medium transition ${
                  isActivePath(item.href)
                    ? "bg-white/20 text-white"
                    : "text-white/85 hover:bg-white/10 hover:text-white"
                }`}
              >
                <item.icon className="h-4 w-4" aria-hidden="true" />
                <span>{item.label}</span>
              </Link>
            ))}

            <Link
              href={activeBillingItem.href}
              className={`mt-auto inline-flex w-full items-center gap-2 rounded-none px-3 py-4 text-left text-sm font-medium transition ${
                isActivePath(activeBillingItem.href)
                  ? "bg-white/20 text-white"
                  : "text-white/85 hover:bg-white/10 hover:text-white"
              }`}
            >
              <activeBillingItem.icon className="h-4 w-4" aria-hidden="true" />
              <span>{activeBillingItem.label}</span>
            </Link>

            <section className="mt-2 mb-2 border-t border-white/20 pt-4">
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/75">
                Krediter ({currentMonthLabel})
              </h3>
              <p className="mt-3 text-sm text-white/80">
                Bildgenereringar:{" "}
                <span className="font-semibold text-white/95">
                  {imageGenerationCount ?? "–"}
                </span>
              </p>
              <p className="mt-1 text-sm text-white/80">
                Kostnad:{" "}
                <span className="font-semibold text-white/95">
                  {imageGenerationTotalCost} kr
                </span>
              </p>
            </section>
          </div>
        </aside>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <main className="flex min-h-0 w-full min-w-0 flex-1 flex-col pb-[calc(4.5rem+env(safe-area-inset-bottom))] md:pb-0">
            {children}
          </main>
        </div>
      </div>

      <nav
        className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-[#1f1f1f] text-white md:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        aria-label="Mobilnavigering"
      >
        <div className="flex items-stretch px-1 py-1">
          {mobileNavItems.map((item) => {
            const isActive = isActivePath(item.href);

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`inline-flex flex-1 basis-0 flex-col items-center justify-center gap-1 rounded-sm px-2 py-2 text-center text-[11px] font-medium leading-tight transition ${
                  isActive ? "bg-white/20 text-white" : "text-white/80 hover:bg-white/10 hover:text-white"
                }`}
              >
                <item.icon className="h-4 w-4" aria-hidden="true" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
