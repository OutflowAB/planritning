export const PENDING_VERKTYG_SAVE_KEY = "pending-verktyg-save-v1";
export const VERKTYG_SAVE_PENDING_EVENT = "verktyg-save-pending-changed";

export type PendingVerktygSave = {
  imageId: number;
  imagePath: string;
};

export function getPendingVerktygSave(): PendingVerktygSave | null {
  if (typeof window === "undefined") {
    return null;
  }

  const rawPayload = window.sessionStorage.getItem(PENDING_VERKTYG_SAVE_KEY);
  if (!rawPayload) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawPayload) as Partial<PendingVerktygSave>;
    if (
      typeof parsed?.imageId !== "number" ||
      typeof parsed?.imagePath !== "string" ||
      parsed.imagePath.length === 0
    ) {
      return null;
    }

    return {
      imageId: parsed.imageId,
      imagePath: parsed.imagePath,
    };
  } catch {
    return null;
  }
}

export function setPendingVerktygSave(payload: PendingVerktygSave) {
  if (typeof window === "undefined") {
    return;
  }

  window.sessionStorage.setItem(PENDING_VERKTYG_SAVE_KEY, JSON.stringify(payload));
  window.dispatchEvent(new Event(VERKTYG_SAVE_PENDING_EVENT));
}

export function clearPendingVerktygSave() {
  if (typeof window === "undefined") {
    return;
  }

  window.sessionStorage.removeItem(PENDING_VERKTYG_SAVE_KEY);
  window.dispatchEvent(new Event(VERKTYG_SAVE_PENDING_EVENT));
}

export function hasPendingVerktygSave() {
  return getPendingVerktygSave() !== null;
}

export function buildVerktygHref(
  pathname: string,
  payload: PendingVerktygSave,
) {
  const basePath = pathname.startsWith("/admin") ? "/admin/verktyg" : "/verktyg";
  const params = new URLSearchParams({
    imageId: String(payload.imageId),
    imagePath: payload.imagePath,
  });

  return `${basePath}?${params.toString()}`;
}

export function buildVerktygListHref(pathname: string) {
  return pathname.startsWith("/admin") ? "/admin/verktyg" : "/verktyg";
}

export function buildPlanritningarHref(
  pathname: string,
  payload: Pick<PendingVerktygSave, "imageId"> & { imagePath?: string },
) {
  const basePath = pathname.startsWith("/admin") ? "/admin/planritningar" : "/planritningar";
  const params = new URLSearchParams({
    imageId: String(payload.imageId),
    previewImageId: String(payload.imageId),
  });

  if (payload.imagePath) {
    params.set("imagePath", payload.imagePath);
    params.set("previewImagePath", payload.imagePath);
  }

  return `${basePath}?${params.toString()}`;
}
