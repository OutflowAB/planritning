import { NextResponse } from "next/server";

import { requireRole } from "@/lib/server-auth";
import { getAdminSupabase, serverConfigMissingResponse, UPLOADS_TABLE } from "@/lib/supabase-server";
import { IMAGE_LABEL_MAX_LENGTH, MAX_LABELLED_IDS, normaliseImageLabel } from "@/lib/image-label";

export const runtime = "nodejs";

/**
 * POST /api/image-label { ids: number[], label: string | null }
 *
 * Names images, typically with the property's address. Several ids at once because one name
 * covers a plan and its original, or every floor of a house. An empty label clears the name.
 */
export async function POST(request: Request) {
  const session = await requireRole();
  if (!session.ok) {
    return session.response;
  }

  const supabase = getAdminSupabase();
  if (!supabase) {
    return serverConfigMissingResponse();
  }

  let body: { ids?: unknown; label?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ message: "Ogiltig förfrågan." }, { status: 400 });
  }

  const ids = Array.isArray(body.ids)
    ? [...new Set(body.ids.filter((id): id is number => Number.isInteger(id) && id > 0))]
    : [];
  if (ids.length === 0 || ids.length > MAX_LABELLED_IDS) {
    return NextResponse.json({ message: "Ogiltiga bild-id:n." }, { status: 400 });
  }
  if (body.label !== null && typeof body.label !== "string") {
    return NextResponse.json({ message: "Ogiltigt namn." }, { status: 400 });
  }
  if (typeof body.label === "string" && body.label.trim().length > IMAGE_LABEL_MAX_LENGTH) {
    return NextResponse.json(
      { message: `Namnet får vara högst ${IMAGE_LABEL_MAX_LENGTH} tecken.` },
      { status: 400 },
    );
  }

  const label = normaliseImageLabel(body.label);
  const { data, error } = await supabase
    .from(UPLOADS_TABLE)
    .update({ label })
    .in("id", ids)
    .select("id");

  if (error) {
    console.warn(
      `Image label not saved; has database/2026-10-15-uploaded-images-label.sql been run? ${JSON.stringify(
        { ids, reason: error.message },
      )}`,
    );
    return NextResponse.json(
      { message: "Namnet kunde inte sparas just nu." },
      { status: 503 },
    );
  }

  return NextResponse.json({ ids: (data ?? []).map((row) => row.id), label });
}
