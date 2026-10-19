"use client";

import Link from "next/link";
import {
  ArrowRightStartOnRectangleIcon,
  ArrowUpTrayIcon,
  BuildingOffice2Icon,
  ChevronUpDownIcon,
  CreditCardIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  Squares2X2Icon,
  ViewfinderCircleIcon,
} from "@heroicons/react/24/outline";
import { usePathname, useRouter } from "next/navigation";
import {
  ComponentType,
  ReactNode,
  SVGProps,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { apiJson } from "@/lib/api-client";
import { GENERATION_UPDATED_EVENT } from "@/lib/app-events";
import { getStoredRole, setAuthenticated } from "@/lib/auth";
import { TENANT } from "@/lib/brand";
import { CoBrand } from "@/components/layout/co-brand";
import { CommandPalette, useCommandPaletteShortcut } from "@/components/layout/command-palette";
import { ThemeQuickSwitch } from "@/components/layout/theme-switcher";

type DashboardShellProps = {
  children: ReactNode;
  variant?: "default" | "admin";
};

type SidebarIcon = ComponentType<SVGProps<SVGSVGElement>>;
type NavItem = { label: string; href: string; icon: SidebarIcon };

const defaultSidebarItems = [
  { label: "Startsida", href: "/startsida", icon: Squares2X2Icon },
  { label: "Planritningar", href: "/planritningar", icon: BuildingOffice2Icon },
  { label: "Uppladdningar", href: "/uppladdningar", icon: ArrowUpTrayIcon },
  { label: "Skannare", href: "/skannare", icon: ViewfinderCircleIcon },
] as const satisfies ReadonlyArray<NavItem>;

const adminSidebarItems = [
  { label: "Dashboard", href: "/admin/dashboard", icon: Squares2X2Icon },
  { label: "Planritningar", href: "/admin/planritningar", icon: BuildingOffice2Icon },
  { label: "Uppladdningar", href: "/admin/uppladdningar", icon: ArrowUpTrayIcon },
  { label: "Skannare", href: "/admin/skannare", icon: ViewfinderCircleIcon },
] as const satisfies ReadonlyArray<NavItem>;

const billingItem = {
  label: "Fakturering",
  href: "/fakturering",
  icon: CreditCardIcon,
} as const satisfies NavItem;

const adminBillingItem = {
  label: "Fakturering",
  href: "/admin/fakturering",
  icon: CreditCardIcon,
} as const satisfies NavItem;

const IMAGE_GENERATION_COST_SEK = 50;
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

/** "SkandiaMäklarna" → "SM": the capitals, or the first letter when there are none. */
function tenantInitials(name: string) {
  const capitals = name.match(/\p{Lu}/gu) ?? [];
  return (capitals.length > 0 ? capitals.slice(0, 2).join("") : name.slice(0, 1)).toUpperCase();
}

const sekFormat = new Intl.NumberFormat("sv-SE");

export function DashboardShell({ children, variant = "default" }: DashboardShellProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPaletteOpen, setIsPaletteOpen] = useState(false);
  const shortcutLabel = useCommandPaletteShortcut(() => setIsPaletteOpen(true));
  const newPlanHref = variant === "admin" ? "/admin/dashboard" : "/startsida";
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
  const sidebarItems: ReadonlyArray<NavItem> =
    variant === "admin" ? adminSidebarItems : defaultSidebarItems;
  const activeBillingItem = variant === "admin" ? adminBillingItem : billingItem;
  const mobileNavItems: ReadonlyArray<NavItem> = [...sidebarItems, activeBillingItem];
  const loadGenerationStats = useCallback(async () => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const monthEnd = new Date(
      now.getFullYear(),
      now.getMonth() + 1,
      1,
    ).toISOString();

    let count = 0;
    try {
      const params = new URLSearchParams({ kind: "generated", count: "1", from: monthStart, to: monthEnd });
      ({ count } = await apiJson<{ count: number }>(`/api/images?${params.toString()}`));
    } catch {
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

    window.addEventListener(GENERATION_UPDATED_EVENT, handleGenerationUpdated);

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener(GENERATION_UPDATED_EVENT, handleGenerationUpdated);
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
    <div className="flex min-h-screen flex-col pt-12">
      <header className="fixed inset-x-0 top-0 z-50 border-b border-stone-200/80 bg-white/85 backdrop-blur-md">
        <div className="grid h-12 w-full grid-cols-[1fr_auto_1fr] items-center gap-3 px-3 md:px-4">
          <div className="flex min-w-0 items-center">
            <button
              type="button"
              onClick={() => setIsPaletteOpen(true)}
              className="group flex h-8 items-center gap-2 rounded-lg px-2 text-[13px] text-stone-500 transition hover:bg-stone-100 hover:text-stone-800 md:w-56 md:border md:border-stone-200 md:bg-white md:px-2.5 md:shadow-[0_1px_2px_rgba(28,25,23,0.04)] md:hover:border-stone-300 md:hover:bg-white"
              aria-label="Sök och snabbkommandon"
            >
              <MagnifyingGlassIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="hidden flex-1 text-left md:inline">Sök planritningar…</span>
              <kbd className="hidden rounded border border-stone-200 bg-stone-50 px-1.5 font-sans text-[10px] font-medium text-stone-500 md:inline">
                {shortcutLabel}
              </kbd>
            </button>
          </div>

          <Link
            href={sidebarItems[0].href}
            aria-label="Till startsidan"
            className="min-w-0 rounded-md"
          >
            <CoBrand />
          </Link>

          <div className="flex min-w-0 items-center justify-end gap-2">
            <AccountMenu variant={variant} onLogout={handleLogout} />
          </div>
        </div>
      </header>

      <div className="flex w-full flex-1 min-h-0">
        <aside
          className="sticky top-12 hidden h-[calc(100dvh-3rem)] w-56 shrink-0 flex-col border-r border-sidebar-border bg-sidebar px-2.5 pb-2.5 pt-3 md:flex"
          aria-label="Huvudnavigering"
        >
          <Link
            href={newPlanHref}
            className="mb-4 flex h-8 items-center justify-center gap-1.5 rounded-lg bg-primary text-[13px] font-medium text-primary-fg shadow-[0_1px_2px_rgba(0,0,0,0.2),inset_0_1px_0_rgba(255,255,255,0.1)] transition hover:bg-primary-hover"
          >
            <PlusIcon className="h-4 w-4" aria-hidden="true" />
            Ny planritning
          </Link>
          <p className="px-2.5 pb-1.5 text-[10px] font-medium uppercase tracking-[0.1em] text-sidebar-muted">
            Arbetsyta
          </p>
          <nav className="flex flex-col gap-0.5">
            {sidebarItems.map((item) => (
              <SidebarLink key={item.href} item={item} isActive={isActivePath(item.href)} />
            ))}
          </nav>

          <div className="mt-auto flex flex-col gap-2">
            <SidebarLink item={activeBillingItem} isActive={isActivePath(activeBillingItem.href)} />

            <section className="rounded-xl border border-sidebar-border bg-sidebar-card p-3">
              <h3 className="text-[11px] font-medium text-sidebar-muted">
                Användning i {currentMonthLabel}
              </h3>
              <p className="mt-1.5 text-xl font-semibold tracking-tight text-sidebar-strong tabular-nums">
                {imageGenerationCount ?? "–"}
                <span className="ml-1.5 text-xs font-normal text-sidebar-fg">planritningar</span>
              </p>
              <p className="mt-0.5 text-[11px] text-sidebar-fg tabular-nums">
                {sekFormat.format(imageGenerationTotalCost)} kr hittills · {IMAGE_GENERATION_COST_SEK} kr/st
              </p>
            </section>
          </div>
        </aside>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <main className="flex min-h-0 w-full min-w-0 flex-1 flex-col pb-[calc(4.25rem+env(safe-area-inset-bottom))] md:pb-0">
            {children}
          </main>
        </div>
      </div>

      {process.env.NODE_ENV !== "production" ? <ThemeQuickSwitch /> : null}

      <CommandPalette
        open={isPaletteOpen}
        onClose={() => setIsPaletteOpen(false)}
        navItems={[...sidebarItems, activeBillingItem]}
        libraryHref={variant === "admin" ? "/admin/planritningar" : "/planritningar"}
        newPlanHref={newPlanHref}
      />

      <nav
        className="fixed inset-x-0 bottom-0 z-40 border-t border-stone-200 bg-white/95 backdrop-blur-md md:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        aria-label="Mobilnavigering"
      >
        <div className="flex items-stretch px-1 pt-1">
          {mobileNavItems.map((item) => {
            const isActive = isActivePath(item.href);

            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive ? "page" : undefined}
                className={`inline-flex flex-1 basis-0 flex-col items-center justify-center gap-1 px-1 py-2 text-center text-[11px] font-medium leading-tight transition ${
                  isActive ? "text-stone-900" : "text-stone-500 hover:text-stone-800"
                }`}
              >
                <item.icon
                  className={`h-5 w-5 ${isActive ? "text-accent" : ""}`}
                  aria-hidden="true"
                />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

function SidebarLink({ item, isActive }: { item: NavItem; isActive: boolean }) {
  return (
    <Link
      href={item.href}
      aria-current={isActive ? "page" : undefined}
      className={`group relative flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium transition ${
        isActive
          ? "bg-sidebar-active text-sidebar-strong shadow-[0_1px_2px_rgba(0,0,0,0.06)] ring-1 ring-sidebar-border"
          : "text-sidebar-fg hover:bg-sidebar-hover hover:text-sidebar-strong"
      }`}
    >
      <item.icon
        className={`h-4 w-4 shrink-0 ${
          isActive ? "text-sidebar-icon" : "text-sidebar-muted group-hover:text-sidebar-fg"
        }`}
        aria-hidden="true"
      />
      <span>{item.label}</span>
    </Link>
  );
}

function AccountMenu({
  variant,
  onLogout,
}: {
  variant: "default" | "admin";
  onLogout: () => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [role, setRole] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function handlePointerDown(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen]);

  const roleLabel =
    variant === "admin" || role === "admin" ? "Administratör" : "Medlem";

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        onClick={() => {
          setRole(getStoredRole());
          setIsOpen((open) => !open);
        }}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label="Kontomeny"
        className="flex items-center gap-1.5 rounded-full p-0.5 pr-1.5 transition hover:bg-stone-100"
      >
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-[11px] font-semibold tracking-wide text-white">
          {tenantInitials(TENANT.name)}
        </span>
        <ChevronUpDownIcon className="hidden h-4 w-4 text-stone-400 sm:block" aria-hidden="true" />
      </button>

      {isOpen ? (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-2 w-60 overflow-hidden rounded-xl border border-stone-200 bg-white p-1 shadow-[0_12px_32px_-8px_rgba(28,25,23,0.18)]"
        >
          <div className="px-3 pb-2.5 pt-2">
            <p className="text-sm font-semibold text-stone-900">{TENANT.name}</p>
            <p className="text-xs text-stone-500">{roleLabel}</p>
          </div>
          <div className="my-1 h-px bg-stone-100" />
          <button
            type="button"
            role="menuitem"
            onClick={onLogout}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-stone-700 transition hover:bg-stone-100 hover:text-stone-900"
          >
            <ArrowRightStartOnRectangleIcon className="h-4 w-4 text-stone-400" aria-hidden="true" />
            Logga ut
          </button>
        </div>
      ) : null}
    </div>
  );
}
