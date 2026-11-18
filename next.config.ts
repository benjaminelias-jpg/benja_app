import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // PGlite y pg cargan binarios/WASM: deben quedar fuera del bundle del servidor.
  serverExternalPackages: ['@electric-sql/pglite', 'pg'],
  experimental: {
    // Las server actions reciben payloads de webhooks replayados desde la UI.
    serverActions: { bodySizeLimit: '2mb' },
  },
};

export default nextConfig;
