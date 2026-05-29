import { Suspense } from "react";

import { FloorplanEnhancer } from "@/components/dashboard/floorplan-enhancer";
import { SectionPage } from "@/components/dashboard/section-page";

export default function StartsidaPage() {
  return (
    <SectionPage title="Startsida">
      <Suspense fallback={<p className="text-sm text-[#6a6258]">Laddar konverterare...</p>}>
        <FloorplanEnhancer />
      </Suspense>
    </SectionPage>
  );
}
