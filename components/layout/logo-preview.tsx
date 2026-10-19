import Image from "next/image";
import { CSSProperties } from "react";

import { TENANT } from "@/lib/brand";

import { LOGO_OPTIONS } from "./product-logo";

/** On dark, tiled marks turn white with dark lines; open marks simply turn white. */
const ON_DARK = { "--mark-ink": "#1c1917" } as CSSProperties;

/** Development only: the logo ideas side by side, large, in the header, on dark and tiny. */
export function LogoPreview() {
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-dashed border-stone-300 bg-white px-4 py-3">
        <span className="text-xs font-medium text-stone-500">Hyllning till, inte kopia av:</span>
        {/* eslint-disable-next-line @next/next/no-img-element -- development-only reference to our sister site's logo */}
        <img src="https://www.hantverkskollen.se/assets/logos/logo-green.svg" alt="Hantverkskollen" className="h-7 w-auto" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {LOGO_OPTIONS.map(({ id, name, description, Mark, wordmark, lockup: Lockup }) => (
          <article key={id} className="flex flex-col overflow-hidden rounded-xl border border-stone-200 bg-white">
            <div className="grid h-40 grid-cols-2">
              <div className="flex items-center justify-center bg-stone-50">
                <Mark className="h-20 w-20 text-stone-900" />
              </div>
              <div className="flex items-center justify-center bg-stone-900" style={ON_DARK}>
                <Mark className="h-20 w-20 text-white" />
              </div>
            </div>

            <div className="space-y-2 border-t border-stone-100 p-3">
              <div className="flex h-11 items-center justify-center gap-2.5 rounded-lg border border-stone-200 bg-white">
                {Lockup ? (
                  <Lockup className="h-[26px] w-auto text-stone-900" />
                ) : (
                  <>
                    <Mark className="h-[22px] w-[22px] text-stone-900" />
                    <span className="text-[15px] font-semibold tracking-[-0.025em] text-stone-900">{wordmark}</span>
                </>
              )}
              <svg viewBox="0 0 12 24" className="h-6 w-3 text-stone-300" aria-hidden="true">
                <path d="M9 3 3 21" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
              </svg>
              <Image
                src={TENANT.logoSrc}
                alt={TENANT.name}
                width={TENANT.logoWidth}
                height={TENANT.logoHeight}
                className="h-[20px] w-auto opacity-90"
              />
            </div>
            <div className="flex h-11 items-center justify-center gap-2.5 rounded-lg bg-stone-900" style={ON_DARK}>
              {Lockup ? (
                <Lockup className="h-[26px] w-auto text-white" />
              ) : (
                <>
                  <Mark className="h-[22px] w-[22px] text-white" />
                  <span className="text-[15px] font-semibold tracking-[-0.025em] text-white">{wordmark}</span>
                </>
              )}
            </div>
            <div className="flex items-center gap-3 px-1 pt-1 text-[11px] text-stone-500">
              <Mark className="h-4 w-4 text-stone-900" />
              <Mark className="h-6 w-6 text-stone-900" />
              <Mark className="h-8 w-8 text-stone-900" />
              <span>Favicon och appikon</span>
            </div>
          </div>

          <div className="mt-auto border-t border-stone-100 px-3 py-2.5">
            <p className="text-sm font-semibold text-stone-900">{name}</p>
            <p className="text-xs leading-4 text-stone-500">{description}</p>
          </div>
        </article>
      ))}
    </div>
    </>
  );
}
