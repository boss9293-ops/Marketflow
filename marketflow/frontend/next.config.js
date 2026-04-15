/** @type {import('next').NextConfig} */
const RAILWAY_URL = 'https://marketflow-production-09df.up.railway.app'

const nextConfig = {
  env: {
    NEXT_PUBLIC_BACKEND_API: process.env.NEXT_PUBLIC_BACKEND_API || RAILWAY_URL,
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || RAILWAY_URL,
    NEXT_PUBLIC_BACKEND_URL: process.env.NEXT_PUBLIC_BACKEND_URL || RAILWAY_URL,
  },
  webpack: (config, { dev }) => {
    if (dev) {
      // Disable webpack filesystem cache on Windows to prevent file-lock UNKNOWN errors
      config.cache = false
    }
    return config
  },
}
module.exports = nextConfig
