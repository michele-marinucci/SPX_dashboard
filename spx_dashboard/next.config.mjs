/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // The Equities Dashboard Excel export patches the committed workbook
    // template at runtime; make sure it ships with the serverless function.
    outputFileTracingIncludes: {
      "/api/equities/export": ["./data/detailed_dashboard_template.xlsx"],
    },
  },
};

export default nextConfig;
