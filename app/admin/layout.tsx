import { ReactNode } from "react";

import { ProtectedRoute } from "@/components/auth/protected-route";
import { DashboardShell } from "@/components/layout/dashboard-shell";

type AdminLayoutProps = {
  children: ReactNode;
};

export default function AdminLayout({ children }: AdminLayoutProps) {
  return (
    <ProtectedRoute requiredRole="admin">
      <DashboardShell variant="admin">{children}</DashboardShell>
    </ProtectedRoute>
  );
}
