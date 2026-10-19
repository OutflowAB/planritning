"use client";

import {
  ArrowRightIcon,
  MagnifyingGlassIcon,
  PlusIcon,
} from "@heroicons/react/24/outline";
import { useRouter } from "next/navigation";
import {
  ComponentType,
  KeyboardEvent,
  SVGProps,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import type { ImageListItem } from "@/app/api/images/route";
import { formatDateTime } from "@/lib/format-date";
import { imageDisplayName } from "@/lib/image-naming";
import { imageUrl } from "@/lib/image-url";
import { searchable } from "@/lib/search-text";

type NavItem = { label: string; href: string; icon: ComponentType<SVGProps<SVGSVGElement>> };

type CommandPaletteProps = {
  open: boolean;
  onClose: () => void;
  navItems: ReadonlyArray<NavItem>;
  libraryHref: string;
  newPlanHref: string;
};

type Command =
  | { kind: "nav"; id: string; label: string; href: string; icon: NavItem["icon"]; hint?: string }
  | { kind: "plan"; id: string; plan: ImageListItem };

const MAX_PLAN_RESULTS = 8;

/** The library, fetched once per page load when the palette first opens. */
let plansPromise: Promise<ImageListItem[]> | null = null;
function loadPlans() {
  plansPromise ??= fetch("/api/images?kind=generated&saved=1", { credentials: "same-origin" })
    .then((response) => (response.ok ? (response.json() as Promise<{ items: ImageListItem[] }>) : { items: [] }))
    .then(({ items }) => items)
    .catch(() => {
      plansPromise = null;
      return [];
    });
  return plansPromise;
}

/**
 * Opens the palette on ⌘K / Ctrl+K anywhere, and on "/" when not typing in a field. Returns
 * the shortcut as it should be shown on this platform.
 */
const subscribeToNothing = () => () => {};

export function useCommandPaletteShortcut(onOpen: () => void) {
  // Rendered as ⌘K on the server; the browser knows whether it is a Mac.
  const label = useSyncExternalStore(
    subscribeToNothing,
    () => (/Mac|iPhone|iPad/.test(navigator.platform) ? "⌘K" : "Ctrl K"),
    () => "⌘K",
  );
  const onOpenRef = useRef(onOpen);
  useEffect(() => {
    onOpenRef.current = onOpen;
  });

  useEffect(() => {
    function handleKeyDown(event: globalThis.KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const isTyping =
        target?.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target?.tagName ?? "");
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        onOpenRef.current();
      } else if (event.key === "/" && !isTyping && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        onOpenRef.current();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return label;
}

/** Jump to any page, start a new plan, or find a plan by address — from anywhere. */
export function CommandPalette({ open, onClose, navItems, libraryHref, newPlanHref }: CommandPaletteProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [plans, setPlans] = useState<ImageListItem[] | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    let cancelled = false;
    void loadPlans().then((items) => {
      if (!cancelled) setPlans(items);
    });
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
    };
  }, [open]);

  const commands = useMemo<Command[]>(() => {
    const needle = searchable(query.trim());
    const navCommands: Command[] = [
      { kind: "nav" as const, id: "new", label: "Ny planritning", href: newPlanHref, icon: PlusIcon, hint: "Ladda upp eller Polycam" },
      ...navItems.map((item) => ({ kind: "nav" as const, id: item.href, label: item.label, href: item.href, icon: item.icon })),
    ].filter((command) => command.kind === "nav" && (!needle || searchable(command.label).includes(needle)));

    const planCommands: Command[] = (plans ?? [])
      .filter(
        (plan) =>
          !needle ||
          searchable(`${plan.label ?? ""} ${imageDisplayName(plan.id)} ${plan.id} ${formatDateTime(plan.created_at)}`).includes(
            needle,
          ),
      )
      .slice(0, needle ? MAX_PLAN_RESULTS : 5)
      .map((plan) => ({ kind: "plan" as const, id: `plan-${plan.id}`, plan }));

    return [...navCommands, ...planCommands];
  }, [query, plans, navItems, newPlanHref]);

  const safeIndex = Math.min(activeIndex, Math.max(0, commands.length - 1));

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${safeIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [safeIndex]);

  if (!open) {
    return null;
  }

  function close() {
    setQuery("");
    setActiveIndex(0);
    onClose();
  }

  function run(command: Command | undefined) {
    if (!command) return;
    close();
    if (command.kind === "nav") {
      router.push(command.href);
    } else {
      router.push(`${libraryHref}?previewImageId=${command.plan.id}`);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((safeIndex + 1) % Math.max(1, commands.length));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((safeIndex - 1 + commands.length) % Math.max(1, commands.length));
    } else if (event.key === "Enter") {
      event.preventDefault();
      run(commands[safeIndex]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  }

  const firstPlanIndex = commands.findIndex((command) => command.kind === "plan");

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center px-4 pt-[12vh]" role="presentation">
      <div className="absolute inset-0 bg-stone-900/25 backdrop-blur-[2px]" onClick={close} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Sök och snabbkommandon"
        className="relative w-full max-w-lg overflow-hidden rounded-xl border border-stone-200 bg-white shadow-[0_24px_64px_-16px_rgba(28,25,23,0.35)]"
      >
        <div className="flex items-center gap-2.5 border-b border-stone-100 px-3.5">
          <MagnifyingGlassIcon className="h-4 w-4 shrink-0 text-stone-400" aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder="Sök adress, bildnummer eller sida…"
            aria-label="Sök"
            aria-activedescendant={commands[safeIndex] ? `cmd-${commands[safeIndex].id}` : undefined}
            className="h-11 w-full bg-transparent text-sm text-stone-900 outline-none placeholder:text-stone-400 focus-visible:outline-none"
          />
          <kbd className="rounded border border-stone-200 bg-stone-50 px-1.5 text-[10px] font-medium text-stone-500">esc</kbd>
        </div>

        <div ref={listRef} role="listbox" className="max-h-[52vh] overflow-y-auto p-1.5">
          {commands.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-stone-500">
              {plans === null ? "Hämtar planritningar…" : "Inga träffar."}
            </p>
          ) : null}
          {commands.map((command, index) => {
            const isActive = index === safeIndex;
            const heading =
              index === 0 && command.kind === "nav"
                ? "Gå till"
                : index === firstPlanIndex
                  ? query.trim()
                    ? "Planritningar"
                    : "Senaste planritningar"
                  : null;
            return (
              <div key={command.id}>
                {heading ? (
                  <p className="px-2.5 pb-1 pt-2 text-[10px] font-medium uppercase tracking-[0.1em] text-stone-400">
                    {heading}
                  </p>
                ) : null}
                <button
                  id={`cmd-${command.id}`}
                  type="button"
                  role="option"
                  aria-selected={isActive}
                  data-index={index}
                  onMouseMove={() => setActiveIndex(index)}
                  onClick={() => run(command)}
                  className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors ${
                    isActive ? "bg-stone-100 text-stone-900" : "text-stone-700"
                  }`}
                >
                  {command.kind === "nav" ? (
                    <>
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-stone-200 bg-white text-stone-500">
                        <command.icon className="h-3.5 w-3.5" aria-hidden="true" />
                      </span>
                      <span className="flex-1 font-medium">{command.label}</span>
                      {command.hint ? <span className="text-xs text-stone-400">{command.hint}</span> : null}
                    </>
                  ) : (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element -- tiny pre-sized thumbnail from our own API */}
                      <img
                        src={imageUrl(command.plan.id, "thumb", command.plan.version)}
                        alt=""
                        className="h-9 w-7 shrink-0 rounded-[3px] bg-stone-100 object-cover ring-1 ring-stone-200"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">
                          {command.plan.label ?? imageDisplayName(command.plan.id)}
                        </span>
                        <span className="block truncate text-xs text-stone-500">
                          {command.plan.label ? `${imageDisplayName(command.plan.id)} · ` : ""}
                          {formatDateTime(command.plan.created_at)}
                        </span>
                      </span>
                    </>
                  )}
                  {isActive ? <ArrowRightIcon className="h-3.5 w-3.5 shrink-0 text-stone-400" aria-hidden="true" /> : null}
                </button>
              </div>
            );
          })}
        </div>

        <div className="flex items-center gap-3 border-t border-stone-100 bg-stone-50/70 px-3.5 py-2 text-[11px] text-stone-500">
          <span>
            <kbd className="font-sans">↑↓</kbd> välj
          </span>
          <span>
            <kbd className="font-sans">↵</kbd> öppna
          </span>
          <span className="ml-auto">
            Tips: tryck <kbd className="font-sans">/</kbd> var som helst för att söka
          </span>
        </div>
      </div>
    </div>
  );
}
