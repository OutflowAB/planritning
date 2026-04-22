import { FloorplanWidgetFrame } from "@/components/dashboard/floorplan-widget-frame";
import { ToolPlaceholder } from "@/components/dashboard/tool-placeholder";

export default function DashboardPage() {
  return (
    <section className="flex min-h-[calc(100vh-4rem)] w-full items-center justify-center bg-[#f5f3f0] px-6 py-10">
      <div className="mx-auto flex w-full max-w-5xl flex-col items-center text-center text-slate-800">
        <div className="w-full">
          <ToolPlaceholder className="border-slate-300 bg-slate-50 text-slate-600">
            <div className="w-full max-w-[980px] text-left">
              <h2 className="text-center text-xl font-semibold text-[#3d3a36]">
                Konvertera planritning
              </h2>
              <p className="mt-1 text-center text-sm text-[#6a6258]">
                Floor Plan Converter är nu inbäddad direkt i den här ytan.
              </p>
              <FloorplanWidgetFrame className="mt-6" />
            </div>
          </ToolPlaceholder>
        </div>
      </div>
    </section>
  );
}
