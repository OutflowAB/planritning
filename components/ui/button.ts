export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

const base =
  "inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-lg font-medium transition disabled:cursor-not-allowed disabled:opacity-50";

const variants: Record<ButtonVariant, string> = {
  primary:
    "bg-primary text-primary-fg shadow-[0_1px_2px_rgba(28,25,23,0.2),inset_0_1px_0_rgba(255,255,255,0.08)] hover:bg-primary-hover active:translate-y-px",
  secondary:
    "border border-stone-200 bg-white text-stone-800 shadow-[0_1px_2px_rgba(28,25,23,0.05)] hover:border-stone-300 hover:bg-stone-50",
  ghost: "text-stone-600 hover:bg-stone-100 hover:text-stone-900",
  danger:
    "border border-red-200 bg-white text-red-700 shadow-[0_1px_2px_rgba(28,25,23,0.05)] hover:border-red-300 hover:bg-red-50",
};

const sizes: Record<ButtonSize, string> = {
  sm: "h-7 gap-1.5 px-2.5 text-xs",
  md: "h-8 gap-1.5 px-3 text-[13px]",
  lg: "h-10 gap-2 px-4 text-sm",
};

/**
 * Class names for a button or a link styled as one. A function rather than a component so it
 * drops into the existing markup — buttons, `Link`s and `label`s alike — without rewrapping.
 */
export function buttonClass(
  variant: ButtonVariant = "secondary",
  size: ButtonSize = "md",
  extra = "",
): string {
  return `${base} ${variants[variant]} ${sizes[size]} ${extra}`.trim();
}

/** Square icon-only button. Pair it with an `aria-label`. */
export function iconButtonClass(variant: ButtonVariant = "secondary", extra = ""): string {
  return `${base} ${variants[variant]} h-8 w-8 ${extra}`.trim();
}
