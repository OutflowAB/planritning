"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { FloorplanEnhancer } from "@/components/dashboard/floorplan-enhancer";
import {
  consumeStartsidaConverterMountKey,
  hasPendingConverterTransfer,
} from "@/lib/startsida-converter-session";

export function StartsidaConverter() {
  const searchParams = useSearchParams();
  const fromUploadParam = searchParams.get("fromUpload");
  const [mountKey, setMountKey] = useState(() =>
    consumeStartsidaConverterMountKey(fromUploadParam),
  );

  useEffect(() => {
    function handlePageShow(event: PageTransitionEvent) {
      if (!event.persisted || hasPendingConverterTransfer(fromUploadParam)) {
        return;
      }

      setMountKey(`reset-${Date.now()}`);
    }

    window.addEventListener("pageshow", handlePageShow);
    return () => {
      window.removeEventListener("pageshow", handlePageShow);
    };
  }, [fromUploadParam]);

  return <FloorplanEnhancer key={mountKey} />;
}
