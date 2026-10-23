import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // @aira/ui ships TypeScript source (workspace package).
  transpilePackages: ['@aira/ui'],
  // Native modules stay out of the bundler: argon2 is a .node binary and pg manages
  // its own pool. Both are server-only (never reachable from a client component).
  serverExternalPackages: ['@node-rs/argon2', 'pg'],
};

export default nextConfig;
