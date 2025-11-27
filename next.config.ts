import type { NextConfig } from "next";

const rawBackendUrl = process.env.NEXT_PUBLIC_BACKEND_URL;

const nextConfig: NextConfig = {
  async rewrites() {
    if (!rawBackendUrl) {
      return [];
    }

    try {
      const backend = new URL(rawBackendUrl);
      return [
        {
          source: "/api/proxy/:path*",
          destination: `${backend.origin}/:path*`,
        },
      ];
    } catch (error) {
      console.warn("Invalid NEXT_PUBLIC_BACKEND_URL, skipping proxy rewrite.", error);
      return [];
    }
  },
};

export default nextConfig;
