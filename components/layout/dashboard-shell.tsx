"use client";

import Link from "next/link";
import Image from "next/image";
import {
  FileText,
  History,
  LayoutDashboard,
  Library,
  LogOut,
  Menu,
  ReceiptText,
  Settings,
  Upload,
} from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { ReactNode, useCallback, useEffect, useState } from "react";

import { setAuthenticated } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

type DashboardShellProps = {
  children: ReactNode;
};

const sidebarItems = [
  { label: "Konvertera", href: "/dashboard", icon: LayoutDashboard },
  { label: "Bibliotek", href: "/dashboard/bibliotek", icon: Library },
  { label: "Uppladdningar", href: "/dashboard/uppladdningar", icon: Upload },
  { label: "Fakturering", href: "/dashboard/fakturering", icon: ReceiptText },
  { label: "Verktyg", href: "/dashboard/historik", icon: History },
  { label: "Skapa planritning", href: "/dashboard/rapporter", icon: FileText },
] as const;

const settingsItem = {
  label: "Inställningar",
  href: "/dashboard/installningar",
  icon: Settings,
} as const;

const IMAGE_GENERATION_COST_SEK = 80;
const GENERATIONS_TABLE = "generation_events";
const currentMonthLabel = new Date().toLocaleDateString("sv-SE", {
  month: "long",
});

export function DashboardShell({ children }: DashboardShellProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [imageGenerationCount, setImageGenerationCount] = useState(0);

  const imageGenerationTotalCost = imageGenerationCount * IMAGE_GENERATION_COST_SEK;

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

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-white/10 bg-[#3f3f3f] text-white">
        <div className="flex h-16 w-full items-center justify-between px-6">
          <div className="flex items-center gap-6">
            <button
              type="button"
              onClick={() => setIsSidebarOpen((prev) => !prev)}
              className="inline-flex items-center justify-center rounded-md p-1 text-white/90 transition hover:bg-white/10 hover:text-white"
              aria-label={isSidebarOpen ? "Dölj sidomeny" : "Visa sidomeny"}
            >
              <Menu size={22} />
            </button>
          </div>

          <Image
            src="/sm-logo.svg"
            alt="SM-Planritning"
            width={200}
            height={42}
            priority
            className="h-10 w-auto brightness-0 invert"
          />

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleLogout}
              className="inline-flex items-center gap-2 rounded-md px-3 py-2 text-xs font-medium text-white transition hover:bg-white/10"
            >
              <LogOut size={14} aria-hidden="true" />
              Logga ut
            </button>
          </div>
        </div>
      </header>
      <div className="flex w-full flex-1">
        <aside
          className={`hidden overflow-hidden border-r bg-[#1f1f1f] text-white transition-[width,padding,opacity,border-color] duration-300 ease-in-out md:flex md:flex-col ${
            isSidebarOpen
              ? "w-64 border-white/10 p-4 opacity-100"
              : "w-0 border-transparent p-0 opacity-0"
          }`}
        >
          <nav
            className={`flex h-full min-w-64 flex-col space-y-1 transition-opacity duration-200 ${
              isSidebarOpen ? "opacity-100" : "pointer-events-none opacity-0"
            }`}
          >
            {sidebarItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`inline-flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm font-medium transition ${
                  pathname === item.href
                    ? "bg-white/20 text-white"
                    : "text-white/85 hover:bg-white/10 hover:text-white"
                }`}
              >
                <item.icon size={16} aria-hidden="true" />
                <span>{item.label}</span>
              </Link>
            ))}

            <Link
              href={settingsItem.href}
              className={`mt-auto inline-flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm font-medium transition ${
                pathname === settingsItem.href
                  ? "bg-white/20 text-white"
                  : "text-white/85 hover:bg-white/10 hover:text-white"
              }`}
            >
              <settingsItem.icon size={16} aria-hidden="true" />
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
          </nav>
        </aside>

        <main className="flex flex-1">{children}</main>
      </div>
    </div>
  );
}
