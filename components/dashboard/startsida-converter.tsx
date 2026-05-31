"use client";

import { Loader2 } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";

import { FloorplanEnhancer } from "@/components/dashboard/floorplan-enhancer";
import {
  consumeStartsidaConverterMountKey,
  hasPendingConverterTransfer,
} from "@/lib/startsida-converter-session";
import { hasPendingGenerationReview } from "@/lib/startsida-review-session";
import { hasPendingSourceSelection } from "@/lib/startsida-source-session";

function useIsClient() {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}

function StartsidaConverterPlaceholder() {
  return (
    <div
      className="mx-auto w-full max-w-3xl rounded-none border border-[#d8d2c8] bg-white p-5 text-left text-[#4d463f] shadow-sm"
      aria-busy="true"
      aria-live="polite"
    >
      <div className="flex min-h-[420px] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-[#5c544a]" aria-hidden="true" />
      </div>
    </div>
  );
}

export function StartsidaConverter() {
  const searchParams = useSearchParams();
  const fromUploadParam = searchParams.get("fromUpload");
  const isClient = useIsClient();
  const [mountKey, setMountKey] = useState(() =>
    consumeStartsidaConverterMountKey(fromUploadParam),
  );

  useEffect(() => {
    function handlePageShow(event: PageTransitionEvent) {
      if (
        !event.persisted ||
        hasPendingConverterTransfer(fromUploadParam) ||
        hasPendingGenerationReview() ||
        hasPendingSourceSelection()
      ) {
        return;
      }

      setMountKey(`reset-${Date.now()}`);
    }

    window.addEventListener("pageshow", handlePageShow);
    return () => {
      window.removeEventListener("pageshow", handlePageShow);
    };
  }, [fromUploadParam]);

  if (!isClient) {
    return <StartsidaConverterPlaceholder />;
  }

  return <FloorplanEnhancer key={mountKey} />;
}
