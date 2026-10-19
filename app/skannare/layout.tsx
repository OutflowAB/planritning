import { ReactNode } from "react";

import { ProtectedRoute } from "@/components/auth/protected-route";
import { DashboardShell } from "@/components/layout/dashboard-shell";

type SkannareLayoutProps = {
  children: ReactNode;
};

export default function SkannareLayout({ children }: SkannareLayoutProps) {
  return (
    <ProtectedRoute>
      <DashboardShell>{children}</DashboardShell>
    </ProtectedRoute>
  );
}
