import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow LAN access from local network devices (e.g. 192.168.1.131, phones, tablets)
  allowedDevOrigins: [
    "localhost",
    "localhost:3000",
    "127.0.0.1",
    "127.0.0.1:3000",
    "192.168.1.131",
    "192.168.1.131:3000",
    "*.local",
  ],
};

export default nextConfig;
