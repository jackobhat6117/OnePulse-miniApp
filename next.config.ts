// import type { NextConfig } from "next";

// const nextConfig: NextConfig = {
//   /* config options here */
// };

// export default nextConfig;


import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        // 1. The fake path your frontend will use
        source: '/api/proxy/:path*',
        // 2. The REAL backend URL (change this to your swagger API base URL)
        destination: 'https://api.your-backend-domain.com/:path*',
      },
    ];
  },
};

export default nextConfig;