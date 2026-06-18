import { StartsidaConverterSlot } from "@/components/dashboard/startsida-converter-host";
import { SectionPage } from "@/components/dashboard/section-page";

export default function StartsidaPage() {
  return (
    <SectionPage title="Startsida">
      <StartsidaConverterSlot />
    </SectionPage>
  );
}
