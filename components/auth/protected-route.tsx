"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { ReactNode, useEffect, useState, useSyncExternalStore } from "react";

import {
  AUTH_ROLE_STORAGE_KEY,
  AUTH_STORAGE_KEY,
  getStoredRole,
  isAuthenticated,
  type UserRole,
} from "@/lib/auth";
import { clearStoredAuth, verifySessionRole } from "@/lib/auth-session";

type ProtectedRouteProps = {
  children: ReactNode;
  requiredRole?: UserRole;
};

function subscribeToAuthChanges(onStoreChange: () => void) {
  if (typeof window === "undefined") {
    return () => {};
  }

  const handleStorage = (event: StorageEvent) => {
    if (
      event.key === null ||
      event.key === AUTH_STORAGE_KEY ||
      event.key === AUTH_ROLE_STORAGE_KEY
    ) {
      onStoreChange();
    }
  };

  window.addEventListener("storage", handleStorage);
  return () => window.removeEventListener("storage", handleStorage);
}

/**
 * Renders the page as soon as the browser has hydrated and the stored session says the user is
 * signed in, then confirms it with the server in the background.
 *
 * Blocking on `/api/auth/session` before mounting anything cost a full round trip on every
 * navigation — each section has its own layout, so the guard remounts every time — and put a
 * "Kontrollerar inloggning" screen in front of it. Worse, it serialised the page's own data
 * loading behind the check, so no query and no image started until the check came back.
 *
 * The stored flag lives in localStorage, which the server cannot see, so it is read through
 * `useSyncExternalStore` with a server snapshot of `false`. That keeps the first paint
 * identical on both sides without an effect round trip. A revoked session still redirects,
 * one beat later, and every route behind this guard is protected server side regardless of
 * what gets painted here.
 */
export function ProtectedRoute({ children, requiredRole }: ProtectedRouteProps) {
  const router = useRouter();
  const [isRevoked, setIsRevoked] = useState(false);
  const hasStoredSession = useSyncExternalStore(
    subscribeToAuthChanges,
    () => isAuthenticated(),
    () => false,
  );
  const isAllowed = hasStoredSession && !isRevoked;

  useEffect(() => {
    let cancelled = false;

    if (!hasStoredSession) {
      router.replace("/login");
      return;
    }

    void (async () => {
      const role = await verifySessionRole();

      // `undefined` means the request itself failed. Staying put is the better failure mode:
      // a flaky network should not sign the user out.
      if (cancelled || role === undefined || role) {
        return;
      }

      clearStoredAuth();
      setIsRevoked(true);
      router.replace("/login");
    })();

    return () => {
      cancelled = true;
    };
  }, [hasStoredSession, router]);

  useEffect(() => {
    if (!isAllowed || !requiredRole) {
      return;
    }

    const currentRole = getStoredRole();
    if (currentRole !== requiredRole) {
      router.replace(currentRole === "admin" ? "/admin/dashboard" : "/startsida");
    }
  }, [isAllowed, requiredRole, router]);

  if (!isAllowed) {
    // Rendered by the server too, since it cannot see localStorage. On a hard load this is
    // what fills the moment before hydration; on a client-side navigation the stored session
    // is known synchronously, so it never appears.
    return (
      <div
        className="flex flex-1 items-center justify-center py-16"
        role="status"
        aria-live="polite"
      >
        <span className="inline-flex items-center gap-2 text-sm text-[#6a6258]">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Laddar...
        </span>
      </div>
    );
  }

  return <>{children}</>;
}
