import path from 'node:path';
import type { NextConfig } from 'next';

const standalone = process.env.GATELM_NEXT_OUTPUT_STANDALONE === 'true' || process.platform !== 'win32';

const nextConfig: NextConfig = {
  ...(standalone ? { output: 'standalone' as const } : {}),
  outputFileTracingRoot: path.join(process.cwd(), '../..'),
  reactStrictMode: true,
  transpilePackages: ['@gatelm/ui', '@gatelm/web-bff'],
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'Cache-Control', value: 'no-store' },
        // Keep same-origin mutation requests compatible with the BFF Origin check.
        { key: 'Referrer-Policy', value: 'same-origin' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' }
      ]
    }];
  }
};

export default nextConfig;
