import { SetoranDaftarView } from "@/components/setoran/SetoranDaftarView";

// Pintu masuk kasir/staf toko: tidak butuh shift terbuka (setoran dilakukan setelah tutup shift).
export default async function SetoranKasirPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  return <SetoranDaftarView basis="/kasir/setoran" sp={await searchParams} />;
}
