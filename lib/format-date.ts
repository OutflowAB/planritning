const dateTimeFormat = new Intl.DateTimeFormat("sv-SE", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/** "14 okt. 2026 16:41" — for lists, where seconds are noise. */
export function formatDateTime(value: string | number | Date): string {
  return dateTimeFormat.format(new Date(value));
}
