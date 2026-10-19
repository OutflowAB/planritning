import { StartsidaConverterSlot } from "@/components/dashboard/startsida-converter-host";
import {
  StartsidaAside,
  StartsidaGreeting,
  StartsidaStats,
} from "@/components/dashboard/startsida-overview";
import { Page } from "@/components/layout/page";
import { TENANT } from "@/lib/brand";

export default function StartsidaPage() {
  return (
    <Page width="wide">
      <StartsidaGreeting tenantName={TENANT.name} />
      <StartsidaStats />
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <StartsidaConverterSlot />
        <StartsidaAside />
      </div>
    </Page>
  );
}
