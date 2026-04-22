const DEFAULT_ORIGIN = "http://127.0.0.1:5000";

export function getFloorplanApiOrigin(): string | null {
  const origin =
    process.env.FLOORPLAN_API_ORIGIN ??
    process.env.FLOORPLAN_WIDGET_ORIGIN ??
    DEFAULT_ORIGIN;

  const trimmed = origin.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed.replace(/\/+$/, "");
}

export function getFloorplanApiUrl(pathname: string): string | null {
  const origin = getFloorplanApiOrigin();
  if (!origin) {
    return null;
  }

  const safePath = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return `${origin}${safePath}`;
}
