import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The style references and the sheet font live outside public/, so tracing has to be told
  // to bundle them. Every route that composes a sheet needs the font.
  outputFileTracingIncludes: {
    "/api/convert": ["./assets/style-references/**/*", "./assets/fonts/**/*"],
    "/api/convert-polycam": ["./assets/style-references/**/*", "./assets/fonts/**/*"],
    "/api/recompose-sheet": ["./assets/fonts/**/*"],
    "/api/compare-before": ["./assets/fonts/**/*"],
  },
};

export default nextConfig;
