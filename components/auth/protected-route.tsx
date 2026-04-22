"use client";

import { useRouter } from "next/navigation";
import { ReactNode, useEffect } from "react";

import { isAuthenticated } from "@/lib/auth";

type ProtectedRouteProps = {
  children: ReactNode;
};

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const router = useRouter();
  const authenticated = isAuthenticated();

  useEffect(() => {
    if (!authenticated) {
      router.replace("/login");
    }
  }, [authenticated, router]);

  if (!authenticated) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-slate-500">Kontrollerar inloggning...</p>
      </div>
    );
  }

  return <>{children}</>;
}
