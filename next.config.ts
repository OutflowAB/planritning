import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The style references live outside public/, so tracing has to be told to bundle them.
  outputFileTracingIncludes: {
    "/api/convert": ["./assets/style-references/**/*"],
  },
};

export default nextConfig;
