import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: { serverActions: { bodySizeLimit: "3mb" } },
  turbopack: { root: process.cwd() },
  outputFileTracingIncludes: {
    "/relatorios/**": ["./src/lib/reports/assets/*", "./public/branding/repassum/repassum-logo-pdf.png"],
    "/repasses/**": ["./src/lib/reports/assets/*", "./public/branding/repassum/repassum-logo-pdf.png"],
  },
};

export default nextConfig;
