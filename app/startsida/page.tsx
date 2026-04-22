import { RecentUploadsStrip } from "@/components/dashboard/recent-uploads-strip";
import { SectionPage } from "@/components/dashboard/section-page";

export default function StartsidaPage() {
  return (
    <SectionPage
      title="Startsida"
      placeholderText="Välkommen. Använd menyn för att öppna bibliotek, uppladdningar eller övriga verktyg."
    >
      <RecentUploadsStrip />
    </SectionPage>
  );
}
