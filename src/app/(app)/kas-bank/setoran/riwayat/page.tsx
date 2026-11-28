import { SetoranRiwayatView } from "@/components/setoran/SetoranRiwayatView";

// Riwayat Setoran: tampilan awal hanya lihat, di bawah menu Rekap Setoran (mewarisi hak sub-menu kas-bank.setoran).
export default async function RiwayatSetoranPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  return <SetoranRiwayatView sp={await searchParams} />;
}
