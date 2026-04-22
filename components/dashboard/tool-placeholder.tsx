import { ReactNode } from "react";

type ToolPlaceholderProps = {
  children?: ReactNode;
  className?: string;
};

export function ToolPlaceholder({ children, className }: ToolPlaceholderProps) {
  return (
    <section
      className={`flex h-full min-h-[360px] w-full max-w-5xl items-center justify-center rounded-xl border border-white/35 bg-black/20 p-8 text-white backdrop-blur-sm ${className ?? ""}`}
    >
      {children ?? (
        <p className="text-center text-lg font-medium text-white/90">
          Verktyget laddas här
        </p>
      )}
    </section>
  );
}
