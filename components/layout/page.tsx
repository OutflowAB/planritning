import { ReactNode } from "react";

type PageProps = {
  children: ReactNode;
  /** `wide` for galleries, `narrow` for single-task pages like the converter. */
  width?: "narrow" | "default" | "wide";
  className?: string;
};

const widths = {
  narrow: "max-w-3xl",
  default: "max-w-5xl",
  wide: "max-w-7xl",
} as const;

/** The content column every section sits in: top-aligned, on the canvas, one gutter. */
export function Page({ children, width = "default", className = "" }: PageProps) {
  return (
    <section className={`w-full px-4 pb-10 pt-5 sm:px-6 md:pt-8 lg:px-8 ${className}`}>
      <div className={`mx-auto w-full ${widths[width]}`}>{children}</div>
    </section>
  );
}

type PageHeaderProps = {
  title: string;
  description?: ReactNode;
  /** Buttons on the right; they wrap below the title on narrow screens. */
  actions?: ReactNode;
  /** Small line above the title, e.g. a count or status. */
  eyebrow?: ReactNode;
};

export function PageHeader({ title, description, actions, eyebrow }: PageHeaderProps) {
  return (
    <header className="mb-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-3 md:mb-6">
      <div className="min-w-0">
        {eyebrow ? <div className="mb-1 text-xs font-medium text-stone-500">{eyebrow}</div> : null}
        <h1 className="text-xl font-semibold tracking-[-0.02em] text-stone-900 md:text-[22px]">
          {title}
        </h1>
        {description ? (
          <p className="mt-1 max-w-2xl text-[13px] leading-5 text-stone-500">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
