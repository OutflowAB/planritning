import { FloorplanConverter } from "@/components/dashboard/floorplan-converter";

export default function DashboardPage() {
  return (
    <section className="flex min-h-[calc(100vh-4rem)] w-full items-center justify-center bg-[#f5f3f0] px-6 py-10">
      <div className="mx-auto flex w-full max-w-5xl flex-col items-center text-center text-slate-800">
        <div className="w-full">
          <FloorplanConverter />
        </div>
      </div>
    </section>
  );
}
