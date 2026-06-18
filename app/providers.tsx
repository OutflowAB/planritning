"use client";

import { ReactNode } from "react";

import { StartsidaConverterProvider } from "@/components/dashboard/startsida-converter-host";
import { ToastProvider } from "@/components/ui/toast-provider";

type ProvidersProps = {
  children: ReactNode;
};

export function Providers({ children }: ProvidersProps) {
  return (
    <ToastProvider>
      <StartsidaConverterProvider>{children}</StartsidaConverterProvider>
    </ToastProvider>
  );
}
