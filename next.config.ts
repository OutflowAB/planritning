import type { NextConfig } from "next";

// The dev server only serves its scripts to localhost unless told otherwise. A phone on the same
// network (testing the LiDAR scanner app) opens the site by IP, so private networks are allowed.
const privateNetworks = ["10.*.*.*", "192.168.*.*", ...Array.from({ length: 16 }, (_, i) => `172.${16 + i}.*.*`), "*.local"];

const nextConfig: NextConfig = {
  allowedDevOrigins: privateNetworks,
  // The style references and the sheet font live outside public/, so tracing has to be told
  // to bundle them. Every route that composes a sheet needs the font.
  outputFileTracingIncludes: {
    "/api/convert": ["./assets/style-references/**/*", "./assets/fonts/**/*"],
    "/api/convert-polycam": ["./assets/style-references/**/*", "./assets/fonts/**/*"],
    "/api/recompose-sheet": ["./assets/fonts/**/*"],
    "/api/compare-before": ["./assets/fonts/**/*"],
    "/api/blank-floorplan": ["./assets/fonts/**/*"],
  },
};

export default nextConfig;
