/** @type {import('next').NextConfig} */
const nextConfig = {
  // @scarnergy/opname-calc ships raw TypeScript (no dist build step), so Next
  // must transpile it from node_modules.
  transpilePackages: ['@scarnergy/opname-calc'],
  experimental: {
    serverComponentsExternalPackages: [],
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
        ],
      },
    ];
  },
};

export default nextConfig;
