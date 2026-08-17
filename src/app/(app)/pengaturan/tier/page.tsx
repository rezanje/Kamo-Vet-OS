import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { updateTierSettings, tutupPoinTahunan } from "./actions";

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");

export default async function TierSettingsPage({ searchParams }: { searchParams: Promise<{ error?: string; success?: string }> }) {
  const { error, success } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: me } = await supabase.from("profiles").select("role").eq("id", user?.id ?? "").maybeSingle();
  if (!me || !["OWNER", "ADMIN"].includes(me.role)) redirect("/pengaturan");

  const { data: cfg } = await supabase.from("tier_settings").select("bronze_min, silver_min, gold_min, platinum_min").eq("id", 1).maybeSingle();
  const c = cfg ?? { bronze_min: 1000000, silver_min: 5000000, gold_min: 15000000, platinum_min: 50000000 };

  // Angka poin beredar dipakai supaya penutupan tidak ditekan buta.
  const { data: poinRows } = await supabase.from("customers").select("points").gt("points", 0);
  const poinBeredar = (poinRows ?? []).reduce((a: number, c: { points: number }) => a + Number(c.points), 0);
  const jumlahPunyaPoin = (poinRows ?? []).length;
  const tahunLalu = String(new Date().getFullYear() - 1);
  const bolehTutup = me.role === "OWNER";

  const rows: { name: string; k: string; v: number }[] = [
    { name: "Bronze", k: "bronze_min", v: Number(c.bronze_min) },
    { name: "Silver", k: "silver_min", v: Number(c.silver_min) },
    { name: "Gold", k: "gold_min", v: Number(c.gold_min) },
    { name: "Platinum", k: "platinum_min", v: Number(c.platinum_min) },
  ];

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/pengaturan" className="back-btn"><i className="ti ti-arrow-left" /> Kembali</Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Threshold Tier Pelanggan</span>
      </div>

      {error && <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c", marginBottom: 12 }}><i className="ti ti-alert-circle" /> {error}</div>}
      {success && <div className="p2ban" style={{ background: "#f0fdf4", border: ".5px solid #86efac", color: "#166534", marginBottom: 12 }}><i className="ti ti-check" /> {success === "1" ? "Tersimpan" : success}</div>}

      <form action={updateTierSettings} className="crm-sec" style={{ maxWidth: 460 }}>
        <div style={{ fontSize: 11, color: "var(--td)", marginBottom: 10 }}>
          Minimum total transaksi (gabungan petshop + klinik) untuk tiap tier. Di bawah Bronze = New.
        </div>
        {rows.map((r) => (
          <div className="fg" key={r.k}>
            <label className="flab">{r.name} — minimum (Rp)</label>
            <input className="fi" name={r.k} type="number" min={0} defaultValue={r.v} />
            <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 2 }}>Saat ini: {rp(r.v)}</div>
          </div>
        ))}
        <button type="submit" className="btn-acc" style={{ marginTop: 6 }}>Simpan Threshold</button>
      </form>

      {/* Tutup poin akhir tahun (permintaan Pak Andri, meeting 14 Agustus). */}
      <form action={tutupPoinTahunan} className="crm-sec" style={{ maxWidth: 460, marginTop: 14 }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 6 }}>
          <i className="ti ti-calendar-off" /> Tutup poin tahunan
        </div>
        <div style={{ fontSize: 11, color: "var(--td)", marginBottom: 10 }}>
          Menghanguskan sisa poin SELURUH pelanggan dan mencatatnya di buku poin masing-masing.
          Sekali per tahun; poin yang diperoleh setelah penutupan tidak ikut hangus.
          {poinBeredar > 0
            ? ` Sekarang ada ${poinBeredar.toLocaleString("id-ID")} poin beredar di ${jumlahPunyaPoin} pelanggan.`
            : " Sekarang tidak ada poin beredar."}
        </div>
        <div className="fg">
          <label className="flab">Tahun yang ditutup</label>
          <input className="fi" name="tahun" pattern="[0-9]{4}" maxLength={4} defaultValue={tahunLalu} required />
        </div>
        {bolehTutup ? (
          <button type="submit" className="btn-def" style={{ marginTop: 6, color: "#b91c1c", borderColor: "#fca5a5" }}>
            Hanguskan poin tahun itu
          </button>
        ) : (
          <div style={{ fontSize: 10.5, color: "var(--td)" }}>Hanya OWNER yang bisa menutup poin.</div>
        )}
      </form>
    </>
  );
}
