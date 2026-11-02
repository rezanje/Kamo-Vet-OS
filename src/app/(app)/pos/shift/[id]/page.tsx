import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PrintButton } from "@/components/PrintButton";
import { RincianTutupShift } from "@/components/RincianTutupShift";
import { muatRincianTutupShift } from "@/lib/rincian-tutup-shift-server";

// Laporan satu shift — tampilan yang sama persis dengan layar yang difoto kasir
// saat tutup shift, dibuka ulang dari Riwayat Tutup Shift.
export default async function LaporanShiftPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  // Akses cabang dijaga basis data: shift cabang lain tidak terbaca → 404.
  const data = await muatRincianTutupShift(supabase, id);
  if (!data) notFound();

  return (
    <>
      <div className="no-print" style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11, flexWrap: "wrap" }}>
        <Link href="/pos/shift/riwayat" className="back-btn"><i className="ti ti-arrow-left" /> Riwayat Tutup Shift</Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Laporan Shift</span>
        <div style={{ marginLeft: "auto" }}><PrintButton /></div>
      </div>

      {data.status !== "closed" && (
        <div className="p2ban" style={{ background: "#fffbeb", border: ".5px solid #fde68a", color: "#92400e", maxWidth: 560, margin: "0 auto 10px" }}>
          <i className="ti ti-clock" /> Shift ini masih terbuka — angka kas &amp; selisih baru final setelah kasir menutup shift.
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "center" }}>
        <RincianTutupShift data={data} />
      </div>
    </>
  );
}
