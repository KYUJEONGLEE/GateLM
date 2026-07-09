import path from "node:path";
import type { NextConfig } from "next";

const standaloneOutputPreference = process.env.GATELM_NEXT_OUTPUT_STANDALONE;
const useStandaloneOutput =
  standaloneOutputPreference === "true" ||
  (standaloneOutputPreference !== "false" && process.platform !== "win32");

const nextConfig: NextConfig = {
  ...(useStandaloneOutput ? { output: "standalone" as const } : {}),
  outputFileTracingRoot: path.join(process.cwd(), "../.."),
  reactStrictMode: true
};

export default nextConfig;
