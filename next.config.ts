import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    // Force the project root to this directory to avoid picking up parent lockfiles.
    root: __dirname,
  },
};

export default nextConfig;
