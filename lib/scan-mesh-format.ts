/**
 * The phone's LiDAR mesh as it is stored (see ios/SMSkanner.swiftpm/MeshCollector.swift, model()), once its
 * pieces are joined and inflated (raw deflate). Little-endian:
 *   "SMM2" (or "SMM1", which has no colours), u32 vertex count, u32 face count,
 *   f32 x, y, z per vertex (metres, y up, as ARKit has them),
 *   u32 three corners per face,
 *   u8 ARMeshClassification per face,
 *   SMM2 only: u8 r, g, b per vertex, the colour the camera saw there.
 * The arrays are read in place; the byte arrays need no alignment.
 */
export type ScanMesh = { positions: Float32Array; indices: Uint32Array; labels: Uint8Array; colors: Uint8Array | null };

// ARMeshClassification's raw values.
export const MESH_LABELS = ["Övrigt", "Vägg", "Golv", "Tak", "Bord", "Sittplats", "Fönster", "Dörr"] as const;
export const CEILING = 3;

const MAGIC = [0x53, 0x4d, 0x4d]; // "SMM", then the version digit

export function decodeScanMesh(buffer: ArrayBuffer): ScanMesh {
  const bytes = new Uint8Array(buffer);
  const version = bytes[3] - 0x30;
  if (bytes.length < 12 || MAGIC.some((value, index) => bytes[index] !== value) || (version !== 1 && version !== 2)) {
    throw new Error("Filen är ingen 3D-skanning.");
  }
  const view = new DataView(buffer);
  const vertices = view.getUint32(4, true);
  const faces = view.getUint32(8, true);
  const indicesAt = 12 + vertices * 12;
  const labelsAt = indicesAt + faces * 12;
  const colorsAt = labelsAt + faces;
  if (colorsAt + (version === 2 ? vertices * 3 : 0) !== bytes.length) throw new Error("3D-skanningen är trasig.");

  const indices = new Uint32Array(buffer, indicesAt, faces * 3);
  if (indices.some((index) => index >= vertices)) throw new Error("3D-skanningen är trasig.");
  return {
    positions: new Float32Array(buffer, 12, vertices * 3),
    indices,
    labels: new Uint8Array(buffer, labelsAt, faces),
    colors: version === 2 ? new Uint8Array(buffer, colorsAt, vertices * 3) : null,
  };
}

/** Joins the stored pieces and inflates them. */
export async function inflateScanMesh(pieces: ArrayBuffer[]): Promise<ScanMesh> {
  const stream = new Blob(pieces).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return decodeScanMesh(await new Response(stream).arrayBuffer());
}
