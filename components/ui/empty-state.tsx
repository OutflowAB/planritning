import { ReactNode } from "react";

type EmptyStateProps = {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
};

/** What a list shows before it has anything in it: what goes here, and how to add the first. */
export function EmptyState({ title, description, action, icon }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-stone-300 bg-white/60 px-6 py-16 text-center">
      <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-white text-stone-500 shadow-[0_1px_2px_rgba(28,25,23,0.06)] ring-1 ring-stone-200">
        {icon ?? (
          <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6" aria-hidden="true">
            <path d="M4 4h16v16H4z" stroke="currentColor" strokeWidth="1.5" />
            <path d="M4 13h7v7" stroke="currentColor" strokeWidth="1.5" />
            <path d="M14 4v3.5a3.5 3.5 0 0 0 3.5 3.5H20" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        )}
      </div>
      <h2 className="text-base font-semibold text-stone-900">{title}</h2>
      {description ? (
        <p className="mt-1.5 max-w-sm text-sm leading-6 text-stone-500">{description}</p>
      ) : null}
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}
