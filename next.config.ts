import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  serverExternalPackages: ["bullmq", "ioredis"],
};

export default nextConfig;
