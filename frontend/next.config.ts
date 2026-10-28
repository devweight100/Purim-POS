import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.PURIM_BUILD_DIR || '.next',
  // Allow LAN access from local network devices (e.g. 192.168.1.131, phones, tablets)
  allowedDevOrigins: [
    "localhost",
    "localhost:3000",
    "127.0.0.1",
    "127.0.0.1:3000",
    "192.168.1.*",
    "192.168.1.131",
    "*.local",
    "*.trycloudflare.com",
    "trycloudflare.com",
  ],
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: "http://127.0.0.1:3001/api/:path*",
      },
      {
        source: "/uploads/:path*",
        destination: "http://127.0.0.1:3001/uploads/:path*",
      },
    ];
  },
};

export default nextConfig;
