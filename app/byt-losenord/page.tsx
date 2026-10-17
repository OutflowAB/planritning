"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

import { describeError, apiFetch } from "@/lib/api-client";
import { getStoredRole, homePathForRole } from "@/lib/auth";
import { clearSessionCache } from "@/lib/auth-session";

const inputClass =
  "w-full rounded-md border border-white/20 bg-white/10 px-3 py-2 text-sm text-white outline-none transition focus:border-white/60";

/** First sign-in with a temporary password, or a password change at any time. */
export default function ChangePasswordPage() {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [repeated, setRepeated] = useState("");
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (newPassword !== repeated) {
      setError("De nya lösenorden är inte lika.");
      return;
    }

    setIsSaving(true);
    try {
      await apiFetch("/api/auth/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      clearSessionCache();
      router.replace(homePathForRole(getStoredRole()));
    } catch (caught) {
      setError(describeError(caught, "Kunde inte byta lösenord.") ?? "");
    } finally {
      setIsSaving(false);
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
          Välj ett eget lösenord, minst 10 tecken.
        </p>

        <form className="mt-8 space-y-4" onSubmit={handleSubmit}>
          <label className="block text-sm font-medium text-white/90">
            Nuvarande lösenord
            <input
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              required
              className={`mt-1 ${inputClass}`}
            />
          </label>
          <label className="block text-sm font-medium text-white/90">
            Nytt lösenord
            <input
              type="password"
              autoComplete="new-password"
              minLength={10}
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              required
              className={`mt-1 ${inputClass}`}
            />
          </label>
          <label className="block text-sm font-medium text-white/90">
            Upprepa nytt lösenord
            <input
              type="password"
              autoComplete="new-password"
              minLength={10}
              value={repeated}
              onChange={(event) => setRepeated(event.target.value)}
              required
              className={`mt-1 ${inputClass}`}
            />
          </label>

          {error ? (
            <p className="rounded-md border border-red-200/70 bg-red-100 px-3 py-2 text-sm text-red-700">{error}</p>
          ) : null}

          <button
            type="submit"
            disabled={isSaving}
            className="w-full rounded-md border border-white/70 bg-white/10 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSaving ? "Sparar..." : "Byt lösenord"}
          </button>
        </form>
      </div>
    </div>
  );
}
