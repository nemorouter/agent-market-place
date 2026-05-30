/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Emit a self-contained server (.next/standalone/server.js) for the Docker image
  // used by Cloud Run / Azure Container Apps. Honors $PORT at runtime.
  output: 'standalone',
};

export default nextConfig;
