import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  allowedDevOrigins: process.env.NGROK_DOMAIN ? [process.env.NGROK_DOMAIN] : [],
  async headers() {
    return [
      {
        // The join token is a bearer credential in the URL path: never leak it via Referer or indexing.
        source: "/join/:path*",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
    ];
  },
};

export default nextConfig;
