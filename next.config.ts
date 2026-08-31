import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Dev server sering dibuka lewat 127.0.0.1 (bukan localhost) saat pengujian
  // browser. Tanpa ini Next 15 menandainya sebagai cross-origin ke /_next/*.
  // Hanya berlaku di `next dev`, tidak memengaruhi produksi.
  allowedDevOrigins: ["127.0.0.1"],
  experimental: {
    // Export Accurate bisa lebih besar dari batas bawaan Server Action (1 MB).
    // Validasi action tetap membatasi file .xlsx maksimum 15 MB.
    serverActions: { bodySizeLimit: "15mb" },
  },
};

export default nextConfig;
