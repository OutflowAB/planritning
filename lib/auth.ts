export const AUTH_STORAGE_KEY = "sm_planritning_auth";

export function isAuthenticated(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  return window.localStorage.getItem(AUTH_STORAGE_KEY) === "true";
}

export function setAuthenticated(value: boolean): void {
  if (typeof window === "undefined") {
    return;
  }

  if (value) {
    window.localStorage.setItem(AUTH_STORAGE_KEY, "true");
    return;
  }

  window.localStorage.removeItem(AUTH_STORAGE_KEY);
}
