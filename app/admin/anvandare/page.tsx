"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

import { useConfirm } from "@/components/ui/confirm-dialog";
import { apiFetch, apiJson, describeError } from "@/lib/api-client";

type User = {
  id: string;
  email: string;
  display_name: string;
  role: "user" | "admin";
  must_change_password: boolean;
  disabled: boolean;
  created_at: string;
};

const buttonClass =
  "rounded-none border border-[#d8d2c8] bg-white px-3 py-1.5 text-xs font-semibold text-[#4d463f] transition hover:bg-[#f2ede5] disabled:opacity-50";

/** Superadmin: create realtors with a temporary password, reset passwords, disable accounts. */
export default function UsersPage() {
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [users, setUsers] = useState<User[] | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState<{ email: string; password: string } | null>(null);
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<"user" | "admin">("user");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await apiJson<{ users: User[] }>("/api/admin/users");
      setUsers(data.users);
    } catch (caught) {
      setError(describeError(caught, "Kunde inte hämta användare.") ?? "");
    }
  }, []);

  useEffect(() => {
    let active = true;
    apiJson<{ users: User[] }>("/api/admin/users")
      .then((data) => {
        if (active) setUsers(data.users);
      })
      .catch((caught: unknown) => {
        if (active) setError(describeError(caught, "Kunde inte hämta användare.") ?? "");
      });
    return () => {
      active = false;
    };
  }, []);

  async function createUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const data = await apiJson<{ user: User; temporaryPassword: string }>("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, displayName, role }),
      });
      setNotice({ email: data.user.email, password: data.temporaryPassword });
      setEmail("");
      setDisplayName("");
      setRole("user");
      await load();
    } catch (caught) {
      setError(describeError(caught, "Kunde inte skapa användaren.") ?? "");
    } finally {
      setBusy(false);
    }
  }

  async function act(user: User, action: "reset-password" | "disable" | "enable" | "delete") {
    const questions = {
      "reset-password": `Återställa lösenordet för ${user.display_name}? Hen loggas ut överallt.`,
      disable: `Inaktivera ${user.display_name}? Hen loggas ut och kan inte logga in.`,
      enable: `Aktivera ${user.display_name} igen?`,
      delete: `Ta bort ${user.display_name} permanent?`,
    };
    if (!(await confirm(questions[action], action === "delete" ? "Ta bort" : "Fortsätt"))) return;

    setError("");
    setBusy(true);
    try {
      if (action === "delete") {
        await apiFetch(`/api/admin/users/${user.id}`, { method: "DELETE" });
      } else {
        const response = await apiFetch(`/api/admin/users/${user.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        });
        const data = (await response.json()) as { temporaryPassword?: string };
        if (data.temporaryPassword) setNotice({ email: user.email, password: data.temporaryPassword });
      }
      await load();
    } catch (caught) {
      setError(describeError(caught, "Åtgärden misslyckades.") ?? "");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-[#3d3a36]">Användare</h1>

      <form onSubmit={createUser} className="flex flex-wrap items-end gap-3 border border-[#d8d2c8] bg-[#f7f4ef] p-4">
        <label className="text-xs font-semibold text-[#4d463f]">
          Namn
          <input
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            required
            className="mt-1 block w-48 border border-[#d8d2c8] bg-white px-2 py-1.5 text-sm"
          />
        </label>
        <label className="text-xs font-semibold text-[#4d463f]">
          E-post
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            className="mt-1 block w-64 border border-[#d8d2c8] bg-white px-2 py-1.5 text-sm"
          />
        </label>
        <label className="text-xs font-semibold text-[#4d463f]">
          Roll
          <select
            value={role}
            onChange={(event) => setRole(event.target.value as "user" | "admin")}
            className="mt-1 block border border-[#d8d2c8] bg-white px-2 py-1.5 text-sm"
          >
            <option value="user">Mäklare</option>
            <option value="admin">Superadmin</option>
          </select>
        </label>
        <button type="submit" disabled={busy} className={buttonClass}>
          Skapa användare
        </button>
      </form>

      {notice ? (
        <div className="border border-[#c9b98f] bg-[#fbf6e9] p-4 text-sm text-[#4d463f]" role="status">
          Tillfälligt lösenord för <strong>{notice.email}</strong>:{" "}
          <code className="select-all bg-white px-1.5 py-0.5 font-mono">{notice.password}</code>
          <p className="mt-1 text-xs">
            Visas bara nu. Lämna det till användaren; hen väljer ett eget vid första inloggningen.
          </p>
          <button type="button" onClick={() => setNotice(null)} className={`${buttonClass} mt-2`}>
            Klar
          </button>
        </div>
      ) : null}

      {error ? <p className="border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}

      <table className="w-full border-collapse text-left text-sm text-[#3d3a36]">
        <thead>
          <tr className="border-b border-[#d8d2c8] text-xs uppercase tracking-wide text-[#7b746a]">
            <th className="py-2">Namn</th>
            <th>E-post</th>
            <th>Roll</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {(users ?? []).map((user) => (
            <tr key={user.id} className="border-b border-[#ece7df]">
              <td className="py-2">{user.display_name}</td>
              <td>{user.email}</td>
              <td>{user.role === "admin" ? "Superadmin" : "Mäklare"}</td>
              <td>{user.disabled ? "Inaktiverad" : user.must_change_password ? "Väntar på lösenordsbyte" : "Aktiv"}</td>
              <td className="space-x-2 py-2 text-right">
                <button type="button" disabled={busy} className={buttonClass} onClick={() => act(user, "reset-password")}>
                  Återställ lösenord
                </button>
                <button
                  type="button"
                  disabled={busy}
                  className={buttonClass}
                  onClick={() => act(user, user.disabled ? "enable" : "disable")}
                >
                  {user.disabled ? "Aktivera" : "Inaktivera"}
                </button>
                <button type="button" disabled={busy} className={buttonClass} onClick={() => act(user, "delete")}>
                  Ta bort
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {users?.length === 0 ? <p className="text-sm text-[#7b746a]">Inga användare ännu.</p> : null}
      {confirmDialog}
    </div>
  );
}
