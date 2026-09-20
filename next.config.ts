import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: [
    "https://pavement-exuberant-harness.ngrok-free.dev",
  ],
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'xabzbvanmqeplenfoozx.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
      {
        protocol: 'https',
        hostname: 'lh3.googleusercontent.com',
      },
      
    ],
  },

  /**
   * /about and /contact were folded into the home page. They were indexed and
   * linked from outside (and from printed material), so they redirect to the
   * anchors that replaced them rather than 404ing. Permanent (308) so search
   * engines transfer the ranking instead of keeping both around.
   */
  async redirects() {
    return [
      { source: "/about", destination: "/#historia", permanent: true },
      { source: "/contact", destination: "/#canales", permanent: true },
    ];
  },
};

export default nextConfig;
