/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@ohsboard/db", "@ohsboard/types"],
  typedRoutes: true,
};

export default nextConfig;
