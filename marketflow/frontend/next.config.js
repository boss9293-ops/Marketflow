/** @type {import('next').NextConfig} */
const RAILWAY_URL = 'https://marketflow-production-09df.up.railway.app'

const nextConfig = {
  webpack: (config, { dev }) => {
    if (dev) {
      // Disable webpack filesystem cache on Windows to prevent file-lock UNKNOWN errors
      config.cache = false
    }
    return config
  },
  async rewrites() {
    // Proxy /api/flask/* → Railway backend (bypasses CORS + env var issues)
    return [
      {
        source: '/api/flask/:path*',
        destination: `${RAILWAY_URL}/api/:path*`,
      },
    ]
  },
}
module.exports = nextConfig
