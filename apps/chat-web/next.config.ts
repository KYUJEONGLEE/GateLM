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
        { key: 'Content-Security-Policy', value: "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'" },
        { key: 'Referrer-Policy', value: 'no-referrer' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' }
      ]
    }];
  }
};

export default nextConfig;
