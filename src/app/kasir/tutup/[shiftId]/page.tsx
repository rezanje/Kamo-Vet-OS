import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { muatRincianTutupShift } from "@/lib/rincian-tutup-shift-server";
import { RincianTutupShift } from "@/components/RincianTutupShift";

// Ringkasan setelah shift petshop ditutup — layar ini yang difoto anak toko ke grup.
export default async function RingkasanTutupShiftPage({ params }: { params: Promise<{ shiftId: string }> }) {
  const { shiftId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const data = await muatRincianTutupShift(supabase, shiftId);
  if (!data) notFound();
  // Milik kasir yang nutup — atasan melihatnya lewat Riwayat Tutup Shift (/pos/shift/riwayat).
  if (data.openedBy !== user.id) redirect("/mulai");
  if (data.status !== "closed") redirect("/kasir/tutup");

  return (
    <div className="pshop-wrap">
      <i className="ti ti-bone pshop-deco" style={{ top: "14%", left: "7%", fontSize: 70 }} />
      <i className="ti ti-paw pshop-deco" style={{ top: "16%", right: "9%", fontSize: 86 }} />
      <i className="ti ti-paw pshop-deco" style={{ bottom: "12%", left: "5%", fontSize: 60 }} />
      <i className="ti ti-shopping-bag pshop-deco" style={{ bottom: "8%", right: "10%", fontSize: 72 }} />

      <div className="pshop-hero">
        <div className="pshop-welcome" style={{ fontSize: 28 }}>Shift Ditutup</div>
        <div style={{ fontSize: 12, color: "var(--tm)", marginTop: 6 }}>
          Foto layar ini lalu kirim ke grup. Atasan juga bisa membukanya lagi di Riwayat Tutup Shift.
        </div>
      </div>

      <RincianTutupShift
        data={data}
        footer={
          <Link href="/mulai" className="kpos-bayar" style={{ marginTop: 16, textDecoration: "none", background: "var(--posb)" }}>
            <i className="ti ti-check" /> SELESAI
          </Link>
        }
      />
    </div>
  );
}
