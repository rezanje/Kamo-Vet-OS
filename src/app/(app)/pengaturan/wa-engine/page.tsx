import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SubmitButton } from "@/components/SubmitButton";
import { bolehKelolaMaster } from "@/lib/master-guard";
import { WA_TRIGGERS } from "@/lib/wa-engine";
import { jalankanWaManual, simpanWaSettings } from "./actions";

export default async function WaEnginePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const bolehKelola = await bolehKelolaMaster();
  const [{ data: settings }, { data: logs }] = await Promise.all([
    supabase.from("wa_engine_settings").select("*").eq("id", true).maybeSingle(),
    supabase.from("whatsapp_message_log").select("trigger_key, phone, status, error, created_at").order("created_at", { ascending: false }).limit(30),
  ]);
  const s = (settings ?? { is_enabled: false }) as Record<string, boolean>;
  const labelTrigger = new Map(WA_TRIGGERS);

  return (
    <>
      <div style={{ marginBottom: 4 }}><Link href="/pengaturan" className="back-btn"><i className="ti ti-arrow-left" /> Kembali</Link></div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
        <div style={{ width: 44, height: 44, borderRadius: 11, background: "#eff6ff", display: "flex", alignItems: "center", justifyContent: "center" }}><i className="ti ti-brand-whatsapp" style={{ fontSize: 22, color: "#2563eb" }} /></div>
        <div><div style={{ fontSize: 20, fontWeight: 800, color: "var(--sb)", lineHeight: 1.1 }}>WA ENGINE</div><div style={{ fontSize: 11.5, color: "var(--tm)" }}>Pengingat otomatis pelanggan, berjalan setiap hari</div></div>
      </div>

      {sp.error && <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}><i className="ti ti-alert-circle" /> {sp.error}</div>}
      {sp.success === "settings" && <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}><i className="ti ti-circle-check" /> Pengaturan WA tersimpan.</div>}
      {sp.success === "run" && <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}><i className="ti ti-circle-check" /> Pemeriksaan selesai: {sp.sent ?? 0} terkirim, {sp.failed ?? 0} gagal, {sp.created ?? 0} pesan baru.</div>}

      <div className="crm-sec">
        <p role="status">{process.env.FONNTE_TOKEN ? "Koneksi pengiriman sudah dikonfigurasi. Penerimaan pesan tetap perlu diuji pada nomor yang disetujui." : "Pengiriman belum siap: akun WhatsApp pengirim perlu dihubungkan oleh admin."}</p>
        <div style={{ fontSize: 12.5, fontWeight: 800, color: "#2563eb", marginBottom: 12 }}>TRIGGER RETENSI</div>
        <form action={simpanWaSettings}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, fontWeight: 700, marginBottom: 14 }}>
            <input type="checkbox" name="is_enabled" defaultChecked={s.is_enabled} disabled={!bolehKelola} /> Aktifkan pengiriman otomatis
          </label>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
            {WA_TRIGGERS.map(([key, label]) => {
              const settingKey = `${key}_enabled` as keyof typeof s;
              return <label key={key} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11.5, padding: "9px 10px", border: ".5px solid var(--bd)", borderRadius: 8 }}><input type="checkbox" name={settingKey} defaultChecked={s[settingKey] ?? true} disabled={!bolehKelola} /> {label}</label>;
            })}
          </div>
          {bolehKelola && <div style={{ marginTop: 12 }}><SubmitButton className="btn-acc" icon="ti-device-floppy" pendingText="Menyimpan…">Simpan pengaturan</SubmitButton></div>}
        </form>
        {bolehKelola && <form action={jalankanWaManual} style={{ marginTop: 10 }}><SubmitButton className="btn-def" icon="ti-player-play" pendingText="Memeriksa…">Jalankan sekarang</SubmitButton></form>}
        <div style={{ marginTop: 10, fontSize: 10.5, color: "var(--tm)" }}>Pesan hanya dibuat satu kali untuk kejadian yang sama. Nomor tanpa WhatsApp atau token pengiriman akan masuk riwayat gagal.</div>
      </div>

      <div className="crm-sec" style={{ marginBottom: 0 }}>
        <div style={{ fontSize: 12.5, fontWeight: 800, color: "#2563eb", marginBottom: 12 }}>RIWAYAT PENGIRIMAN TERBARU</div>
        <div style={{ overflowX: "auto" }}><table className="tbl" style={{ minWidth: 650 }}><thead><tr><th>Waktu</th><th>Trigger</th><th>Nomor</th><th>Status</th><th>Catatan</th></tr></thead><tbody>
          {(logs ?? []).map((l, i) => <tr key={`${l.created_at}-${i}`}><td style={{ fontSize: 10.5 }}>{new Date(l.created_at).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })}</td><td style={{ fontSize: 11 }}>{labelTrigger.get(l.trigger_key) ?? l.trigger_key}</td><td style={{ fontSize: 11 }}>{l.phone}</td><td><span className={`bge ${l.status === "sent" ? "g" : l.status === "failed" ? "r" : "b"}`}>{l.status === "sent" ? "Terkirim" : l.status === "failed" ? "Gagal" : "Antre"}</span></td><td style={{ fontSize: 10.5, color: "var(--tm)" }}>{l.error ?? "—"}</td></tr>)}
          {(logs ?? []).length === 0 && <tr><td colSpan={5} style={{ textAlign: "center", color: "var(--td)", padding: 18, fontSize: 11 }}>Belum ada riwayat pengiriman.</td></tr>}
        </tbody></table></div>
      </div>
    </>
  );
}
