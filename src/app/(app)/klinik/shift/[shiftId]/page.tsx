import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { muatRincianTutupShift } from "@/lib/rincian-tutup-shift-server";
import { RincianTutupShift } from "@/components/RincianTutupShift";

// Ringkasan setelah shift klinik ditutup — kartu yang sama dengan petshop (/kasir/tutup/[shiftId]),
// permintaan Reza 2 Nov malam. Layar ini yang difoto ke grup; atasan membukanya lagi di Riwayat Tutup Shift.
export default async function RingkasanShiftKlinikPage({ params }: { params: Promise<{ shiftId: string }> }) {
  const { shiftId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const data = await muatRincianTutupShift(supabase, shiftId);
  if (!data) notFound();
  if (data.openedBy !== user.id) redirect("/mulai");
  if (data.status !== "closed") redirect("/klinik/shift");

  return (
    <div className="skl-wrap" style={{ minHeight: "60vh" }}>
      <i className="ti ti-paw skl-deco" style={{ top: "12%", left: "6%", fontSize: 80 }} />
      <i className="ti ti-paw skl-deco" style={{ bottom: "10%", left: "12%", fontSize: 54 }} />
      <i className="ti ti-paw skl-deco" style={{ bottom: "16%", right: "8%", fontSize: 86 }} />
      <i className="ti ti-plus skl-deco" style={{ top: "18%", right: "10%", fontSize: 48 }} />
      <i className="ti ti-plus skl-deco" style={{ bottom: "8%", right: "26%", fontSize: 36 }} />

      <div className="skl-hero-head">
        <div className="skl-welcome" style={{ fontSize: 26 }}>Shift Klinik Ditutup</div>
        <div style={{ fontSize: 12, color: "var(--tm)", marginTop: 4 }}>
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
