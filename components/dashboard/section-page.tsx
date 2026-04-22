import { ToolPlaceholder } from "@/components/dashboard/tool-placeholder";

type SectionPageProps = {
  title: string;
  placeholderText: string;
};

export function SectionPage({ title, placeholderText }: SectionPageProps) {
  void title;

  return (
    <section className="flex min-h-[calc(100vh-4rem)] w-full items-center justify-center bg-[#f5f3f0] px-6 py-10">
      <div className="mx-auto flex w-full max-w-5xl flex-col items-center text-center text-slate-800">
        <div className="w-full">
          <ToolPlaceholder className="border-slate-300 bg-slate-50 text-slate-600">
            <p className="text-center text-lg font-medium text-slate-500">
              {placeholderText}
            </p>
          </ToolPlaceholder>
        </div>
      </div>
    </section>
  );
}
