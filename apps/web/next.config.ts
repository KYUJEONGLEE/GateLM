import path from "node:path";
import type { NextConfig } from "next";

const useStandaloneOutput = process.env.GATELM_NEXT_OUTPUT_STANDALONE !== "false";

const nextConfig: NextConfig = {
  ...(useStandaloneOutput ? { output: "standalone" as const } : {}),
  outputFileTracingRoot: path.join(process.cwd(), "../.."),
  reactStrictMode: true
};

export default nextConfig;
