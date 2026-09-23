import type { NextConfig } from "next";
const config: NextConfig = {
  reactStrictMode: true,
  outputFileTracingIncludes: {
    "/api/team-schedule": ["./public/branding/curlstreamer-logo.png"],
  },
};
export default config;
