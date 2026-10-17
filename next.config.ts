import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: { serverActions: { bodySizeLimit: "3mb" } },
  turbopack: { root: process.cwd() },
};

export default nextConfig;
