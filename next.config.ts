import type { NextConfig } from "next";

const floorplanWidgetOrigin =
  process.env.FLOORPLAN_WIDGET_ORIGIN ?? "http://127.0.0.1:5000";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.supabase.co",
      },
    ],
  },
  async rewrites() {
    return [
      {
        source: "/floorplan-widget",
        destination: `${floorplanWidgetOrigin}/`,
      },
      {
        source: "/floorplan-widget/:path*",
        destination: `${floorplanWidgetOrigin}/:path*`,
      },
    ];
  },
};

export default nextConfig;
