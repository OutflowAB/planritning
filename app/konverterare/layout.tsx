import { ReactNode } from "react";

import { ProtectedRoute } from "@/components/auth/protected-route";
import { DashboardShell } from "@/components/layout/dashboard-shell";

type KonverterareLayoutProps = {
  children: ReactNode;
};

export default function KonverterareLayout({ children }: KonverterareLayoutProps) {
  return (
    <ProtectedRoute>
      <DashboardShell>{children}</DashboardShell>
    </ProtectedRoute>
  );
}
