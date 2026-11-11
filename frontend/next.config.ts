import type { NextConfig } from "next";
import path from "path";

/** Version of the code this frontend is built from (same logic as backend/scripts/version-info.js). */
function buildInfo() {
  const builtAt = new Date().toISOString();
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require(path.join(process.cwd(), "..", "backend", "scripts", "version-info.js"));
    return { ...mod.getSourceVersion(path.join(process.cwd(), "..")), builtAt };
  } catch {
    return { source: "unknown", commit: null, label: "unknown", modified: false, builtAt };
  }
}

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_BUILD_INFO: JSON.stringify(buildInfo()),
  },
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
    // Backend address (read at build time). Override only for tests that run the backend on another port.
    const api = process.env.API_INTERNAL_URL || "http://127.0.0.1:3001";
    return [
      {
        source: "/api/:path*",
        destination: `${api}/api/:path*`,
      },
      {
        source: "/uploads/:path*",
        destination: `${api}/uploads/:path*`,
      },
    ];
  },
};

export default nextConfig;
