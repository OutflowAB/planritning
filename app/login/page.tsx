"use client";

import Image from "next/image";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { isAuthenticated, setAuthenticated } from "@/lib/auth";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (isAuthenticated()) {
      router.replace("/dashboard");
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

      if (!response.ok) {
        const data = (await response.json()) as { message?: string };
        setError(data.message ?? "Inloggning misslyckades.");
        setAuthenticated(false);
        return;
      }

      setAuthenticated(true);
      router.replace("/dashboard");
    } catch {
      setError("Ett oväntat fel uppstod. Försök igen.");
      setAuthenticated(false);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#5a5a5a] p-6">
      <div className="w-full max-w-md rounded-xl border border-white/35 bg-black/35 p-8 text-white shadow-2xl backdrop-blur-sm">
        <Image
          src="/sm-logo.svg"
          alt="SM-Planritning"
          width={220}
          height={44}
          priority
          className="mx-auto h-11 w-auto brightness-0 invert"
        />
        <p className="mt-2 text-center text-sm text-white/85">
          Logga in för att komma till adminpanelen.
        </p>

        <form className="mt-8 space-y-4" onSubmit={handleSubmit}>
          <div>
            <label
              htmlFor="email"
              className="mb-1 block text-sm font-medium text-white/90"
            >
              E-post
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              className="w-full rounded-md border border-white/20 bg-neutral-400 px-3 py-2 text-sm text-neutral-900 outline-none ring-0 transition focus:border-white/60"
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="mb-1 block text-sm font-medium text-white/90"
            >
              Lösenord
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              className="w-full rounded-md border border-white/20 bg-neutral-400 px-3 py-2 text-sm text-neutral-900 outline-none ring-0 transition focus:border-white/60"
            />
          </div>

          {error ? (
            <p className="rounded-md border border-red-200/70 bg-red-100 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={isLoading}
            className="w-full rounded-md border border-white/70 bg-white/10 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isLoading ? "Loggar in..." : "Logga in"}
          </button>
        </form>
      </div>
    </div>
  );
}
