import { Suspense } from "react";

import { StartsidaConverter } from "@/components/dashboard/startsida-converter";
import { SectionPage } from "@/components/dashboard/section-page";

export default function StartsidaPage() {
  return (
    <SectionPage title="Startsida">
      <Suspense fallback={<p className="text-sm text-[#6a6258]">Laddar konverterare...</p>}>
        <StartsidaConverter />
      </Suspense>
    </SectionPage>
  );
}
