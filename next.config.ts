import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

/**
 * The browser only ever talks to this app: fonts are self-hosted by next/font, images are
 * served by /api/image, and the canvas works with blob: and data: URLs. Inline scripts stay
 * allowed (Next needs them without nonces); nothing on these pages renders user HTML.
 */
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "font-src 'self' data:",
  "connect-src 'self' blob: data:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  ...(isDev ? [] : ["upgrade-insecure-requests"]),
].join("; ");

// The dev server only serves its scripts to localhost unless told otherwise. A phone on the same
// network (or a hotspot) opens the site by IP, so private-network addresses are allowed in dev.
const privateNetworks = ["10.*.*.*", "192.168.*.*", ...Array.from({ length: 16 }, (_, i) => `172.${16 + i}.*.*`), "*.local"];

const nextConfig: NextConfig = {
  allowedDevOrigins: privateNetworks,
  // The style references live outside public/, so tracing has to be told to bundle them.
  outputFileTracingIncludes: {
    "/api/convert": ["./assets/style-references/**/*"],
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: contentSecurityPolicy },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
        ],
      },
    ];
  },
};

export default nextConfig;
