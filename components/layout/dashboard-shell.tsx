"use client";

import Link from "next/link";
import Image from "next/image";
import {
  ArrowRightStartOnRectangleIcon,
  ArrowUpTrayIcon,
  Bars3Icon,
  BookOpenIcon,
  Cog6ToothIcon,
  CreditCardIcon,
  Squares2X2Icon,
  WrenchScrewdriverIcon,
} from "@heroicons/react/24/outline";
import { usePathname, useRouter } from "next/navigation";
import { ComponentType, ReactNode, SVGProps, useCallback, useEffect, useMemo, useState } from "react";

import { setAuthenticated } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

type DashboardShellProps = {
  children: ReactNode;
};

type SidebarIcon = ComponentType<SVGProps<SVGSVGElement>>;

const sidebarItems = [
  { label: "Konvertera", href: "/dashboard", icon: Squares2X2Icon },
  { label: "Verktyg", href: "/dashboard/historik", icon: WrenchScrewdriverIcon },
  { label: "Bibliotek", href: "/dashboard/bibliotek", icon: BookOpenIcon },
  { label: "Uppladdningar", href: "/dashboard/uppladdningar", icon: ArrowUpTrayIcon },
  { label: "Fakturering", href: "/dashboard/fakturering", icon: CreditCardIcon },
] as const satisfies ReadonlyArray<{ label: string; href: string; icon: SidebarIcon }>;

const settingsItem = {
  label: "Inställningar",
  href: "/dashboard/installningar",
  icon: Cog6ToothIcon,
} as const satisfies { label: string; href: string; icon: SidebarIcon };

const IMAGE_GENERATION_COST_SEK = 80;
const GENERATIONS_TABLE = "generation_events";

export function DashboardShell({ children }: DashboardShellProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [imageGenerationCount, setImageGenerationCount] = useState(0);
  const currentMonthLabel = useMemo(
    () =>
      new Date().toLocaleDateString("sv-SE", {
        month: "long",
        timeZone: "UTC",
      }),
    [],
  );

  const imageGenerationTotalCost = imageGenerationCount * IMAGE_GENERATION_COST_SEK;
  const mobileNavItems = [...sidebarItems, settingsItem] as const;

  const loadGenerationStats = useCallback(async () => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const monthEnd = new Date(
      now.getFullYear(),
      now.getMonth() + 1,
      1,
    ).toISOString();

    const { count, error } = await supabase
      .from(GENERATIONS_TABLE)
      .select("id", { count: "exact", head: true })
      .gte("created_at", monthStart)
      .lt("created_at", monthEnd);

    if (error) {
      return;
    }

    setImageGenerationCount(count ?? 0);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadGenerationStats();
    }, 0);

    function handleGenerationUpdated() {
      void loadGenerationStats();
    }

    window.addEventListener("generation-updated", handleGenerationUpdated);

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("generation-updated", handleGenerationUpdated);
    };
  }, [loadGenerationStats]);

  function handleLogout() {
    setAuthenticated(false);
    router.replace("/login");
  }

  function isActivePath(href: string) {
    if (href === "/dashboard") {
      return pathname === href;
    }

    return pathname === href || pathname.startsWith(`${href}/`);
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-white/10 bg-[#3f3f3f] text-white">
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
      <div className="flex w-full flex-1">
        <aside
          className={`hidden h-[calc(100dvh-4rem)] overflow-hidden border-r bg-[#1f1f1f] text-white transition-[width,padding,opacity,border-color] duration-300 ease-in-out md:flex md:flex-col ${
            isSidebarOpen
              ? "w-64 border-white/10 p-4 opacity-100"
              : "w-0 border-transparent p-0 opacity-0"
          }`}
          aria-label="Huvudnavigering"
        >
          <div
            className={`flex h-full min-w-64 flex-col overflow-y-auto pt-3 transition-opacity duration-200 ${
              isSidebarOpen ? "opacity-100" : "pointer-events-none opacity-0"
            }`}
          >
            {sidebarItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`inline-flex w-full items-center gap-2 rounded-none px-3 py-4 text-left text-sm font-medium transition ${
                  pathname === item.href
                    ? "bg-white/20 text-white"
                    : "text-white/85 hover:bg-white/10 hover:text-white"
                }`}
              >
                <item.icon className="h-4 w-4" aria-hidden="true" />
                <span>{item.label}</span>
              </Link>
            ))}

            <Link
              href={settingsItem.href}
              className={`mt-auto inline-flex w-full items-center gap-2 rounded-none px-3 py-4 text-left text-sm font-medium transition ${
                pathname === settingsItem.href
                  ? "bg-white/20 text-white"
                  : "text-white/85 hover:bg-white/10 hover:text-white"
              }`}
            >
              <settingsItem.icon className="h-4 w-4" aria-hidden="true" />
              <span>{settingsItem.label}</span>
            </Link>

            <section className="mt-2 mb-2 border-t border-white/20 pt-4">
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/75">
                Krediter ({currentMonthLabel})
              </h3>
              <p className="mt-3 text-sm text-white/80">
                Bildgenereringar:{" "}
                <span className="font-semibold text-white/95">
                  {imageGenerationCount}
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

        <div className="flex flex-1 flex-col">
          <section className="border-b border-slate-200 bg-white px-4 py-3 text-slate-700 md:hidden">
            <h3 className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              Krediter ({currentMonthLabel})
            </h3>
            <p className="mt-2 text-sm">
              Bildgenereringar: <span className="font-semibold">{imageGenerationCount}</span>
            </p>
            <p className="text-sm">
              Kostnad: <span className="font-semibold">{imageGenerationTotalCost} kr</span>
            </p>
          </section>

          <main className="flex flex-1 pb-[calc(4.5rem+env(safe-area-inset-bottom))] md:pb-0">
            {children}
          </main>
        </div>
      </div>

      <nav
        className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-[#1f1f1f] text-white md:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        aria-label="Mobilnavigering"
      >
        <div className="flex items-stretch overflow-x-auto px-1 py-1">
          {mobileNavItems.map((item) => {
            const isActive = isActivePath(item.href);

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`inline-flex min-w-[88px] flex-1 flex-col items-center justify-center gap-1 rounded-sm px-3 py-2 text-[11px] font-medium transition ${
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
