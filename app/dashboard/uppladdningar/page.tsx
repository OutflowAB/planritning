import { redirect } from "next/navigation";

type LegacySearchParams = Record<string, string | string[] | undefined>;

function buildQueryString(searchParams: LegacySearchParams) {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (value === undefined) {
      continue;
    }
    if (Array.isArray(value)) {
      value.forEach((entry) => qs.append(key, entry));
    } else {
      qs.set(key, value);
    }
  }
  const serialized = qs.toString();
  return serialized ? `?${serialized}` : "";
}

type LegacyUppladdningarPageProps = {
  searchParams: Promise<LegacySearchParams>;
};

export default async function UppladdningarLegacyRedirectPage({ searchParams }: LegacyUppladdningarPageProps) {
  const resolved = await searchParams;
  redirect(`/uppladdningar${buildQueryString(resolved)}`);
}
