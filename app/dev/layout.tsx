"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { ReactNode } from "react";

import { ProtectedRoute } from "@/components/auth/protected-route";
import { setAuthenticated } from "@/lib/auth";
import { clearSessionCache } from "@/lib/auth-session";

/** The developer account's own area: spending and usage, no plans, no menu of the realtors' pages. */
export default function DevLayout({ children }: { children: ReactNode }) {
  const router = useRouter();

  async function handleLogout() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // Still clear the local session below.
    }
    clearSessionCache();
    setAuthenticated(false);
    router.replace("/login");
  }

  return (
    <ProtectedRoute requiredRole="dev">
      <div className="min-h-screen bg-[#f5f3f0]">
        <header className="flex h-16 items-center justify-between bg-[#3f3f3f] px-4 text-white md:px-6">
          <span className="text-sm font-semibold tracking-wide">Utvecklare</span>
          <Image src="/sm-logo.svg" alt="SM-Planritning" width={160} height={32} className="h-8 w-auto brightness-0 invert" />
          <button
            type="button"
            onClick={handleLogout}
            className="rounded-none border border-white/30 px-3 py-1.5 text-xs font-semibold transition hover:bg-white/10"
          >
            Logga ut
          </button>
        </header>
        <main className="mx-auto w-full max-w-5xl px-4 py-8 md:px-6">{children}</main>
      </div>
    </ProtectedRoute>
  );
}
