export const AUTH_STORAGE_KEY = "sm_planritning_auth";
export const AUTH_ROLE_STORAGE_KEY = "sm_planritning_auth_role";

/** A realtor, the firm's superadmin, or the single developer account (spending and usage only). */
export type UserRole = "user" | "admin" | "dev";

/** Where each kind of account lands after signing in. */
export function homePathForRole(role: UserRole | null): string {
  if (role === "admin") return "/admin/dashboard";
  if (role === "dev") return "/dev";
  return "/konverterare";
}

export function isAuthenticated(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  return window.localStorage.getItem(AUTH_STORAGE_KEY) === "true";
}

export function getStoredRole(): UserRole | null {
  if (typeof window === "undefined") {
    return null;
  }

  const role = window.localStorage.getItem(AUTH_ROLE_STORAGE_KEY);
  if (role === "user" || role === "admin" || role === "dev") {
    return role;
  }

  return null;
}

export function setAuthenticated(value: boolean, role: UserRole = "user"): void {
  if (typeof window === "undefined") {
    return;
  }

  if (value) {
    window.localStorage.setItem(AUTH_STORAGE_KEY, "true");
    window.localStorage.setItem(AUTH_ROLE_STORAGE_KEY, role);
    return;
  }

  window.localStorage.removeItem(AUTH_STORAGE_KEY);
  window.localStorage.removeItem(AUTH_ROLE_STORAGE_KEY);
}
