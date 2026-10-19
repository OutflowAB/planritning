import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import { completeMesh } from "@/lib/scan-mesh";
import { decodeScanMesh, inflateScanMesh } from "@/lib/scan-mesh-format";

/** A mesh file as the phone writes it. */
function meshFile(positions: number[], indices: number[], labels: number[], colors?: number[]) {
  const buffer = new ArrayBuffer(12 + positions.length * 4 + indices.length * 4 + labels.length + (colors?.length ?? 0));
  const view = new DataView(buffer);
  [0x53, 0x4d, 0x4d, colors ? 0x32 : 0x31].forEach((value, index) => view.setUint8(index, value));
  view.setUint32(4, positions.length / 3, true);
  view.setUint32(8, labels.length, true);
  positions.forEach((value, index) => view.setFloat32(12 + index * 4, value, true));
  const indicesAt = 12 + positions.length * 4;
  indices.forEach((value, index) => view.setUint32(indicesAt + index * 4, value, true));
  labels.forEach((value, index) => view.setUint8(indicesAt + indices.length * 4 + index, value));
  colors?.forEach((value, index) => view.setUint8(indicesAt + indices.length * 4 + labels.length + index, value));
  return buffer;
}

const triangle = meshFile([0, 0, 0, 1, 0, 0, 0, 1, 0], [0, 1, 2], [6]);

describe("scan mesh file", () => {
  it("reads vertices, faces and labels", () => {
    const mesh = decodeScanMesh(triangle);
    expect([...mesh.positions]).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    expect([...mesh.indices]).toEqual([0, 1, 2]);
    expect([...mesh.labels]).toEqual([6]);
    expect(mesh.colors).toBeNull();
  });

  it("reads the colours of a version 2 file, and refuses one cut short", () => {
    const withColors = meshFile([0, 0, 0, 1, 0, 0, 0, 1, 0], [0, 1, 2], [6], [255, 0, 0, 0, 255, 0, 0, 0, 255]);
    expect([...decodeScanMesh(withColors).colors!]).toEqual([255, 0, 0, 0, 255, 0, 0, 0, 255]);
    expect(() => decodeScanMesh(withColors.slice(0, withColors.byteLength - 3))).toThrow();
  });

  it("refuses another file, a cut-off one and corners past the last vertex", () => {
    expect(() => decodeScanMesh(new TextEncoder().encode("hello world!").buffer)).toThrow();
    expect(() => decodeScanMesh(triangle.slice(0, triangle.byteLength - 1))).toThrow();
    expect(() => decodeScanMesh(meshFile([0, 0, 0, 1, 0, 0, 0, 1, 0], [0, 1, 3], [1]))).toThrow();
  });

  it("joins compressed pieces in order and inflates them", async () => {
    const packed = deflateRawSync(new Uint8Array(triangle));
    const cut = Math.floor(packed.length / 2);
    const pieces = [packed.subarray(0, cut), packed.subarray(cut)].map((piece) => new Uint8Array(piece).buffer);
    const mesh = await inflateScanMesh(pieces);
    expect(mesh.labels[0]).toBe(6);
  });

  it("uses a stored mesh only when every piece of the same send is there", () => {
    expect(completeMesh(["meshes/5/1-of-2.bin", "meshes/5/0-of-2.bin"])).toEqual(["meshes/5/0-of-2.bin", "meshes/5/1-of-2.bin"]);
    expect(completeMesh(["meshes/5/0-of-2.bin"])).toBeNull();
    expect(completeMesh(["meshes/5/0-of-2.bin", "meshes/5/1-of-3.bin"])).toBeNull();
    expect(completeMesh([])).toBeNull();
  });
});
