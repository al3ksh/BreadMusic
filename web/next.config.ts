import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  experimental: {
    middlewareClientMaxBodySize: '256mb',
  },
  async rewrites() {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
    return [
      {
        source: '/api/:path*',
        destination: `${apiUrl}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
