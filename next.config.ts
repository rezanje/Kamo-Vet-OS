import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Dev server sering dibuka lewat 127.0.0.1 (bukan localhost) saat pengujian
  // browser. Tanpa ini Next 15 menandainya sebagai cross-origin ke /_next/*.
  // Hanya berlaku di `next dev`, tidak memengaruhi produksi.
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;
