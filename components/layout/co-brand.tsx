import Image from "next/image";

import { PRODUCT_NAME, TENANT } from "@/lib/brand";

import { ProductMark } from "./product-logo";

type CoBrandProps = {
  /** `light` for white surfaces (the app header), `dark` for the login card. */
  tone?: "light" | "dark";
  className?: string;
};

/** "Product / customer" lockup: whose tool it is, and whose workspace you are in. */
export function CoBrand({ tone = "light", className = "" }: CoBrandProps) {
  const isDark = tone === "dark";

  return (
    <div className={`flex min-w-0 items-center gap-2.5 sm:gap-3 ${className}`}>
      <span className={`flex shrink-0 items-center gap-2 ${isDark ? "text-white" : "text-stone-900"}`}>
        <ProductMark className="h-[22px] w-[22px]" />
        <span className="text-[15px] font-semibold tracking-[-0.025em]">
          {PRODUCT_NAME}
        </span>
      </span>
      <svg
        viewBox="0 0 12 24"
        aria-hidden="true"
        className={`h-6 w-3 shrink-0 ${isDark ? "text-white/30" : "text-stone-300"}`}
      >
        <path d="M9 3 3 21" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
      </svg>
      <Image
        src={TENANT.logoSrc}
        alt={TENANT.name}
        width={TENANT.logoWidth}
        height={TENANT.logoHeight}
        priority
        className={`h-[22px] w-auto min-w-0 ${isDark ? "brightness-0 invert" : "opacity-90"}`}
      />
    </div>
  );
}
