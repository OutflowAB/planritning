"use client";

import { Loader2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import { apiFetch, apiJson, describeError } from "@/lib/api-client";
import { CEILING, inflateScanMesh, type ScanMesh } from "@/lib/scan-mesh-format";

// Colour per ARMeshClassification; windows stand out, since they are what RoomPlan misses most.
const COLORS = ["#b9b2a8", "#8a8178", "#e3dccf", "#d9d4cc", "#a67c52", "#a67c52", "#1d9bf0", "#c2410c"];
const LEGEND: Array<[string, string]> = [
  ["Vägg", COLORS[1]],
  ["Golv", COLORS[2]],
  ["Fönster", COLORS[6]],
  ["Dörr", COLORS[7]],
  ["Möbler", COLORS[4]],
  ["Övrigt", COLORS[0]],
];

/** Every face as its own triangle in its label's colour; the ceiling apart, so it can be hidden. */
function buildGeometries({ positions, indices, labels, colors: photo }: ScanMesh) {
  const ceilingFaces = labels.reduce((count, label) => count + (label === CEILING ? 1 : 0), 0);
  const parts = [labels.length - ceilingFaces, ceilingFaces].map((faces) => ({
    positions: new Float32Array(faces * 9),
    colors: new Float32Array(faces * 9),
    photo: new Float32Array(faces * 9),
    at: 0,
  }));
  const palette = COLORS.map((color) => new THREE.Color(color));
  for (let face = 0; face < labels.length; face++) {
    const part = parts[labels[face] === CEILING ? 1 : 0];
    const color = palette[labels[face]] ?? palette[0];
    for (let corner = 0; corner < 3; corner++) {
      const vertex = indices[face * 3 + corner] * 3;
      part.positions.set(positions.subarray(vertex, vertex + 3), part.at);
      part.colors.set([color.r, color.g, color.b], part.at);
      if (photo) part.photo.set([photo[vertex] / 255, photo[vertex + 1] / 255, photo[vertex + 2] / 255], part.at);
      part.at += 3;
    }
  }
  return parts.map((part) => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(part.positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(part.colors, 3));
    geometry.computeVertexNormals();
    // Both colourings stay on the geometry; the viewer picks one as "color".
    geometry.userData = { labelColors: geometry.getAttribute("color"), photoColors: photo ? new THREE.BufferAttribute(part.photo, 3) : null };
    return geometry;
  });
}

async function loadMesh(imageId: number) {
  const { parts } = await apiJson<{ parts: number }>(`/api/scan-mesh?imageId=${imageId}`, { cache: "no-store" });
  const pieces = await Promise.all(
    Array.from({ length: parts }, async (_, part) =>
      (await apiFetch(`/api/scan-mesh?imageId=${imageId}&part=${part}`, { cache: "no-store" })).arrayBuffer(),
    ),
  );
  return inflateScanMesh(pieces);
}

/** The phone's whole LiDAR scan in 3D, to check the plan against: turn, zoom and look into each room. */
export function ScanMeshViewer({ imageId, onClose }: { imageId: number; onClose: () => void }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const ceilingRef = useRef<THREE.Mesh | null>(null);
  // Set once the mesh is on screen: switches between the camera's colours and the labels'.
  const colouringRef = useRef<((photo: boolean) => void) | null>(null);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [showCeiling, setShowCeiling] = useState(false);
  // Whether this scan has the camera's colours, and whether they are the ones shown.
  const [hasPhoto, setHasPhoto] = useState(false);
  const [showPhoto, setShowPhoto] = useState(true);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    let disposed = false;
    let cleanup = () => {};

    loadMesh(imageId)
      .then((mesh) => {
        const container = containerRef.current;
        if (disposed || !container) return;

        const renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setPixelRatio(window.devicePixelRatio);
        container.appendChild(renderer.domElement);
        const scene = new THREE.Scene();
        scene.background = new THREE.Color("#f5f3f0");
        scene.add(new THREE.HemisphereLight("#ffffff", "#8a8178", 2.2));
        const sun = new THREE.DirectionalLight("#ffffff", 1.2);
        sun.position.set(3, 10, 4);
        scene.add(sun);

        // Labels are lit to read as shapes; the camera's colours already hold their own light.
        const labelMaterial = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
        const photoMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
        const [rest, ceiling] = buildGeometries(mesh);
        const restMesh = new THREE.Mesh<THREE.BufferGeometry, THREE.Material>(rest, labelMaterial);
        scene.add(restMesh);
        const ceilingMesh = new THREE.Mesh<THREE.BufferGeometry, THREE.Material>(ceiling, labelMaterial);
        ceilingMesh.visible = false;
        ceilingRef.current = ceilingMesh;
        scene.add(ceilingMesh);
        colouringRef.current = (photo) => {
          for (const part of [restMesh, ceilingMesh]) {
            const { labelColors, photoColors } = part.geometry.userData as { labelColors: THREE.BufferAttribute; photoColors: THREE.BufferAttribute | null };
            part.geometry.setAttribute("color", photo && photoColors ? photoColors : labelColors);
            part.material = photo && photoColors ? photoMaterial : labelMaterial;
          }
        };
        setHasPhoto(mesh.colors !== null);

        // Seen from above at a slant, the whole scan in view.
        rest.computeBoundingSphere();
        const { center, radius } = rest.boundingSphere ?? new THREE.Sphere(new THREE.Vector3(), 5);
        const camera = new THREE.PerspectiveCamera(45, 1, 0.05, radius * 20 + 100);
        camera.position.set(center.x + radius * 0.6, center.y + radius * 1.8, center.z + radius * 1.2);
        const controls = new OrbitControls(camera, renderer.domElement);
        controls.target.copy(center);
        controls.enableDamping = true;

        const resize = () => {
          const { clientWidth, clientHeight } = container;
          renderer.setSize(clientWidth, clientHeight);
          camera.aspect = clientWidth / Math.max(1, clientHeight);
          camera.updateProjectionMatrix();
        };
        resize();
        const observer = new ResizeObserver(resize);
        observer.observe(container);
        renderer.setAnimationLoop(() => {
          controls.update();
          renderer.render(scene, camera);
        });
        setReady(true);

        cleanup = () => {
          observer.disconnect();
          renderer.setAnimationLoop(null);
          controls.dispose();
          rest.dispose();
          ceiling.dispose();
          labelMaterial.dispose();
          photoMaterial.dispose();
          colouringRef.current = null;
          renderer.dispose();
          renderer.domElement.remove();
        };
      })
      .catch((loadError) => {
        if (!disposed) setError(describeError(loadError, "Kunde inte visa 3D-skanningen.") ?? "Kunde inte visa 3D-skanningen.");
      });

    return () => {
      disposed = true;
      cleanup();
    };
  }, [imageId]);

  useEffect(() => {
    if (ceilingRef.current) ceilingRef.current.visible = showCeiling;
  }, [showCeiling, ready]);

  useEffect(() => {
    colouringRef.current?.(showPhoto);
  }, [showPhoto, hasPhoto, ready]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="presentation" onClick={onClose}>
      <div
        className="flex h-full max-h-[900px] w-full max-w-6xl flex-col border border-[#d8d2c8] bg-white shadow-[0_12px_40px_rgba(0,0,0,0.35)]"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="scan-mesh-title"
      >
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-[#e8e2d8] bg-[#f7f4ef] px-4 py-2">
          <h2 id="scan-mesh-title" className="text-sm font-semibold text-[#4d463f]">
            3D-skanning
          </h2>
          {hasPhoto ? (
            <label className="flex items-center gap-1.5 text-xs text-[#4d463f]">
              <input type="checkbox" checked={showPhoto} onChange={(event) => setShowPhoto(event.target.checked)} />
              Verkliga färger
            </label>
          ) : null}
          <ul className={`flex flex-wrap items-center gap-3 text-xs text-[#6a6258] ${hasPhoto && showPhoto ? "hidden" : ""}`}>
            {LEGEND.map(([label, color]) => (
              <li key={label} className="flex items-center gap-1">
                <span aria-hidden="true" className="h-3 w-3 border border-black/10" style={{ background: color }} />
                {label}
              </li>
            ))}
          </ul>
          <label className="flex items-center gap-1.5 text-xs text-[#4d463f]">
            <input type="checkbox" checked={showCeiling} onChange={(event) => setShowCeiling(event.target.checked)} />
            Visa tak
          </label>
          <button
            type="button"
            onClick={onClose}
            aria-label="Stäng 3D-skanningen"
            className="ml-auto inline-flex h-8 w-8 items-center justify-center border border-[#d8d2c8] bg-white text-[#4d463f] transition hover:bg-[#f2ede5]"
          >
            <X size={15} />
          </button>
        </div>
        <div ref={containerRef} className="relative min-h-0 flex-1 touch-none">
          {!ready && !error ? (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-[#6a6258]" aria-live="polite">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" aria-hidden="true" />
              Laddar 3D-skanningen...
            </div>
          ) : null}
          {error ? (
            <p className="absolute inset-0 flex items-center justify-center px-4 text-center text-sm text-red-700" role="alert">
              {error}
            </p>
          ) : null}
        </div>
        <p className="border-t border-[#e8e2d8] px-4 py-2 text-xs text-[#6a6258]">
          Dra för att vrida, scrolla för att zooma, högerklicka och dra för att flytta. Skanningen är bara en hjälp för att
          kontrollera planen och syns inte i den.
        </p>
      </div>
    </div>
  );
}
