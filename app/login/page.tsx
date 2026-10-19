"use client";

import { Loader2 } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { CoBrand } from "@/components/layout/co-brand";
import { buttonClass } from "@/components/ui/button";
import { getStoredRole, isAuthenticated, setAuthenticated, type UserRole } from "@/lib/auth";
import { PRODUCT_NAME, TENANT } from "@/lib/brand";

function getRedirectPathByRole(role: UserRole | null): string {
  if (role === "admin") {
    return "/admin/dashboard";
  }

  return "/startsida";
}

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (isAuthenticated()) {
      router.replace(getRedirectPathByRole(getStoredRole()));
    }
  }, [router]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email, password }),
      });

      const data = (await response.json()) as { message?: string; role?: UserRole };

      if (!response.ok) {
        setError(data.message ?? "Inloggning misslyckades.");
        setAuthenticated(false);
        return;
      }

      const role = data.role === "admin" ? "admin" : "user";
      setAuthenticated(true, role);
      router.replace(getRedirectPathByRole(role));
    } catch {
      setError("Ett oväntat fel uppstod. Försök igen.");
      setAuthenticated(false);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-canvas px-4 py-10">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 [background-image:linear-gradient(to_right,rgba(28,25,23,0.045)_1px,transparent_1px),linear-gradient(to_bottom,rgba(28,25,23,0.045)_1px,transparent_1px)] [background-size:32px_32px] [mask-image:radial-gradient(ellipse_at_center,black_20%,transparent_70%)]"
      />

      <div className="relative w-full max-w-[400px]">
        <div className="mb-8 flex justify-center">
          <CoBrand />
        </div>

        <div className="rounded-2xl border border-stone-200 bg-white p-7 shadow-[0_1px_2px_rgba(28,25,23,0.04),0_24px_48px_-24px_rgba(28,25,23,0.18)] sm:p-8">
          <h1 className="text-xl font-semibold tracking-[-0.02em] text-stone-900">Välkommen tillbaka</h1>
          <p className="mt-1.5 text-sm text-stone-500">
            Logga in på {TENANT.name}s arbetsyta.
          </p>

          <form className="mt-7 space-y-4" onSubmit={handleSubmit}>
            <div>
              <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-stone-700">
                E-post
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="namn@foretag.se"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                className="h-11 w-full rounded-lg border border-stone-200 bg-white px-3.5 text-sm text-stone-900 shadow-[0_1px_2px_rgba(28,25,23,0.04)] outline-none transition placeholder:text-stone-400 hover:border-stone-300 focus:border-accent focus:ring-4 focus:ring-accent/15"
              />
            </div>

            <div>
              <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-stone-700">
                Lösenord
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                className="h-11 w-full rounded-lg border border-stone-200 bg-white px-3.5 text-sm text-stone-900 shadow-[0_1px_2px_rgba(28,25,23,0.04)] outline-none transition placeholder:text-stone-400 hover:border-stone-300 focus:border-accent focus:ring-4 focus:ring-accent/15"
              />
            </div>

            {error ? (
              <p
                role="alert"
                className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700"
              >
                {error}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={isLoading}
              className={buttonClass("primary", "lg", "mt-2 w-full")}
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Loggar in...
                </>
              ) : (
                "Logga in"
              )}
            </button>
          </form>
        </div>

        <p className="mt-6 text-center text-xs text-stone-400">
          {PRODUCT_NAME} · Planritningar för mäklare
        </p>
      </div>
    </div>
  );
}
