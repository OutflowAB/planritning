"use client";

import { useRouter } from "next/navigation";
import { ReactNode, useEffect, useState } from "react";

import { getStoredRole, isAuthenticated, type UserRole } from "@/lib/auth";

type ProtectedRouteProps = {
  children: ReactNode;
  requiredRole?: UserRole;
};

export function ProtectedRoute({ children, requiredRole }: ProtectedRouteProps) {
  const router = useRouter();
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setAuthenticated(isAuthenticated());
    }, 0);

    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (authenticated === false) {
      router.replace("/login");
    }
  }, [authenticated, router]);

  useEffect(() => {
    if (authenticated !== true || !requiredRole) {
      return;
    }

    const currentRole = getStoredRole();
    if (currentRole !== requiredRole) {
      router.replace(currentRole === "admin" ? "/admin/dashboard" : "/startsida");
    }
  }, [authenticated, requiredRole, router]);

  if (authenticated !== true) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-slate-500">Kontrollerar inloggning...</p>
      </div>
    );
  }

  return <>{children}</>;
}
