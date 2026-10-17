import { StartsidaConverterSlot } from "@/components/dashboard/startsida-converter-host";
import { UploadPicker } from "@/components/dashboard/upload-picker";

/**
 * The converter and the realtor's uploads to pick from. Converted plans, once approved, are
 * under Planritningar.
 */
export default function KonverterarePage() {
  return (
    <section className="flex w-full flex-col items-center gap-6 bg-[#f5f3f0] px-4 py-6 sm:px-6 sm:py-10">
      <div className="flex w-full max-w-5xl justify-center">
        <StartsidaConverterSlot />
      </div>
      <div className="flex w-full max-w-5xl flex-col gap-6">
        <UploadPicker />
      </div>
    </section>
  );
}
