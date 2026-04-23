import { ReactNode } from "react";

import { ToolPlaceholder } from "@/components/dashboard/tool-placeholder";

type SectionPageProps = {
  title: string;
  placeholderText?: string;
  children?: ReactNode;
};

export function SectionPage({ title, placeholderText, children }: SectionPageProps) {
  void title;

  return (
    <section className="flex min-h-[calc(100vh-4rem)] w-full items-center justify-center bg-[#f5f3f0] px-6 py-10">
      <div className="mx-auto flex w-full max-w-5xl flex-col text-left text-slate-800">
        {placeholderText ? (
          <div className="w-full">
            <ToolPlaceholder className="border-slate-300 bg-slate-50 text-slate-600">
              <p className="text-center text-lg font-medium text-slate-500">
                {placeholderText}
              </p>
            </ToolPlaceholder>
          </div>
        ) : null}
        {children ? <div className="flex w-full justify-center">{children}</div> : null}
      </div>
    </section>
  );
}
