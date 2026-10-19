import { NextResponse } from "next/server";

import { readBytesCapped } from "@/lib/http";
import { completeMesh, MAX_MESH_PARTS, MESH_PART_BYTES, meshPartPath, meshPartPaths } from "@/lib/scan-mesh";
import { requireRole } from "@/lib/server-auth";
import {
  BLANK_FLOORPLAN_PREFIX,
  BUCKET_NAME,
  getAdminSupabase,
  serverConfigMissingResponse,
  UPLOADS_TABLE,
} from "@/lib/supabase-server";

export const runtime = "nodejs";

const notFound = () => NextResponse.json({ message: "Bilden finns inte längre." }, { status: 404 });

/** Whether the id is a plan started from a scan (or blank page), the only kind that has a mesh. */
async function isScanPlan(supabase: NonNullable<ReturnType<typeof getAdminSupabase>>, imageId: number) {
  if (!Number.isInteger(imageId) || imageId <= 0) return false;
  const { data } = await supabase
    .from(UPLOADS_TABLE)
    .select("id")
    .eq("id", imageId)
    .like("file_path", `${BLANK_FLOORPLAN_PREFIX}%`)
    .maybeSingle();
  return Boolean(data);
}

/**
 * PUT /api/scan-mesh?imageId=&part=&parts= — one piece of a scan's LiDAR mesh, sent by the phone
 * right after the scan itself. The first piece clears whatever an earlier send left.
 */
export async function PUT(request: Request) {
  const session = await requireRole();
  if (!session.ok) return session.response;
  const supabase = getAdminSupabase();
  if (!supabase) return serverConfigMissingResponse();

  const url = new URL(request.url);
  const imageId = Number(url.searchParams.get("imageId"));
  const part = Number(url.searchParams.get("part"));
  const parts = Number(url.searchParams.get("parts"));
  if (!Number.isInteger(parts) || parts < 1 || parts > MAX_MESH_PARTS || !Number.isInteger(part) || part < 0 || part >= parts) {
    return NextResponse.json({ message: "Ogiltig del av meshen." }, { status: 400 });
  }
  // Only scanned plans take a mesh.
  if (!(await isScanPlan(supabase, imageId))) return notFound();

  const read = await readBytesCapped(request, MESH_PART_BYTES);
  if (!read.ok) return read.response;
  if (read.data.byteLength === 0) return NextResponse.json({ message: "Meshen är tom." }, { status: 400 });

  if (part === 0) {
    const old = await meshPartPaths(supabase, imageId);
    if (old.length > 0) await supabase.storage.from(BUCKET_NAME).remove(old);
  }
  const { error } = await supabase.storage
    .from(BUCKET_NAME)
    .upload(meshPartPath(imageId, part, parts), read.data, { contentType: "application/octet-stream", upsert: true });
  if (error) {
    console.error("Failed to store a mesh piece", error);
    return NextResponse.json({ message: "Kunde inte spara meshen." }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

/**
 * GET /api/scan-mesh?imageId= — how many pieces the mesh has; with &part=, that piece. Pieces
 * go one per request so each response stays under Vercel's limit too, and come from this site,
 * as its content policy allows nothing else.
 */
export async function GET(request: Request) {
  const session = await requireRole();
  if (!session.ok) return session.response;
  const supabase = getAdminSupabase();
  if (!supabase) return serverConfigMissingResponse();

  const url = new URL(request.url);
  const imageId = Number(url.searchParams.get("imageId"));
  if (!(await isScanPlan(supabase, imageId))) return notFound();

  const paths = completeMesh(await meshPartPaths(supabase, imageId));
  if (!paths) return NextResponse.json({ message: "Planen har ingen 3D-skanning." }, { status: 404 });
  const partText = url.searchParams.get("part");
  if (partText === null) return NextResponse.json({ parts: paths.length }, { headers: { "Cache-Control": "no-store" } });

  const path = paths[Number(partText)];
  if (!path) return NextResponse.json({ message: "Ogiltig del av meshen." }, { status: 400 });
  const { data, error } = await supabase.storage.from(BUCKET_NAME).download(path);
  if (error || !data) return NextResponse.json({ message: "Kunde inte hämta 3D-skanningen." }, { status: 500 });
  return new NextResponse(data.stream(), {
    headers: { "Content-Type": "application/octet-stream", "Cache-Control": "private, no-store" },
  });
}
