import { createClient } from "@/lib/supabase/server";
import { SubmitButton } from "@/components/SubmitButton";
import { hariIniWIB } from "@/lib/tanggal";
import { JAM_BUKA, JENIS_HEWAN, POLI_BOOKING, MAKS_HARI_KE_DEPAN } from "@/lib/booking";
import { kirimBooking } from "./actions";

export const metadata = {
  title: "Booking Klinik — Kamo Pet Care",
  description: "Pesan jadwal periksa hewan peliharaan di klinik Kamo Pet Care.",
};

// Halaman publik: dibuka tanpa login, jadi sengaja tidak memakai kerangka aplikasi
// (sidebar, tab, data karyawan). Yang terlihat pengunjung hanya formulir ini.
export default async function BookingPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; sukses?: string }>;
}) {
  const { error, sukses } = await searchParams;
  const supabase = await createClient();

  const { data: branchData } = await supabase
    .from("branches").select("id, name").eq("is_active", true).eq("type", "KLINIK").order("name");
  const klinik = (branchData ?? []) as { id: string; name: string }[];

  const hariIni = hariIniWIB();
  const batas = new Date(`${hariIni}T00:00:00Z`);
  batas.setUTCDate(batas.getUTCDate() + MAKS_HARI_KE_DEPAN);

  return (
    <main style={{ minHeight: "100vh", background: "#f4f5f7", padding: "28px 16px" }}>
      <div style={{ maxWidth: 620, margin: "0 auto" }}>
        <div style={{ textAlign: "center", marginBottom: 18 }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: "#1e3a8a" }}>KAMO PET CARE</div>
          <div style={{ fontSize: 13, color: "#4b5563", marginTop: 2 }}>
            Booking jadwal periksa hewan kesayangan
          </div>
        </div>

        {sukses && (
          <div style={{
            background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d",
            borderRadius: 10, padding: "14px 16px", marginBottom: 14, fontSize: 13, lineHeight: 1.6,
          }}>
            <b>Booking terkirim.</b> Tim klinik akan menghubungi nomor WhatsApp yang kamu isi untuk
            memastikan jadwalnya. Booking dianggap pasti setelah dikonfirmasi.
          </div>
        )}
        {error && (
          <div style={{
            background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c",
            borderRadius: 10, padding: "12px 16px", marginBottom: 14, fontSize: 13,
          }}>
            {error}
          </div>
        )}

        <form action={kirimBooking} style={{
          background: "#fff", borderRadius: 12, padding: 20,
          border: ".5px solid #e5e7eb", boxShadow: "0 1px 3px rgba(0,0,0,.05)",
        }}>
          <Judul>1 · Klinik & jadwal</Judul>
          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr" }}>
            <Kolom label="Klinik tujuan *" full>
              <select className="fi" name="branch_id" required defaultValue="">
                <option value="" disabled>— pilih klinik —</option>
                {klinik.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </Kolom>
            <Kolom label="Layanan *">
              <select className="fi" name="poli" defaultValue="Poli Umum">
                {POLI_BOOKING.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </Kolom>
            <Kolom label="Tanggal *">
              <input className="fi" type="date" name="tanggal" required
                defaultValue={hariIni} min={hariIni} max={batas.toISOString().slice(0, 10)} />
            </Kolom>
            <Kolom label="Jam kedatangan *">
              <select className="fi" name="jam" defaultValue="09:00">
                {JAM_BUKA.map((j) => <option key={j} value={j}>{j} WIB</option>)}
              </select>
            </Kolom>
            <Kolom label="" >
              <div style={{ fontSize: 10.5, color: "#6b7280", paddingTop: 6 }}>
                Jam yang tersedia mengikuti jam buka klinik.
              </div>
            </Kolom>
          </div>

          <Judul>2 · Data kamu</Judul>
          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr" }}>
            <Kolom label="Nama pemilik *">
              <input className="fi" name="nama_pemilik" required maxLength={80} placeholder="Nama lengkap" />
            </Kolom>
            <Kolom label="Nomor WhatsApp *">
              <input className="fi" name="phone" required maxLength={20} placeholder="081234567890" inputMode="tel" />
            </Kolom>
          </div>

          <Judul>3 · Hewan yang diperiksa</Judul>
          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr" }}>
            <Kolom label="Nama hewan *">
              <input className="fi" name="nama_hewan" required maxLength={60} placeholder="mis. Michi" />
            </Kolom>
            <Kolom label="Jenis hewan *">
              <select className="fi" name="jenis_hewan" defaultValue="Kucing">
                {JENIS_HEWAN.map((j) => <option key={j} value={j}>{j}</option>)}
              </select>
            </Kolom>
            <Kolom label="Keluhan / alasan datang" full>
              <textarea className="fi" name="keluhan" rows={3} maxLength={500}
                placeholder="mis. batuk 3 hari, nafsu makan turun" style={{ resize: "vertical" }} />
            </Kolom>
          </div>

          <div style={{ marginTop: 16 }}>
            <SubmitButton className="btn-acc" style={{ width: "100%", padding: "10px 0", fontSize: 13 }}
              pendingText="Mengirim...">
              <i className="ti ti-calendar-plus" /> Kirim booking
            </SubmitButton>
          </div>

          <div style={{ fontSize: 10.5, color: "#6b7280", marginTop: 10, lineHeight: 1.6 }}>
            Booking ini permintaan jadwal, belum kepastian. Tim klinik akan mengonfirmasi lewat WhatsApp.
            Untuk keadaan darurat, langsung datang atau telepon kliniknya — jangan menunggu balasan booking.
          </div>
        </form>
      </div>
    </main>
  );
}

function Judul({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 12, fontWeight: 700, color: "#1e3a8a", margin: "16px 0 10px",
      paddingBottom: 6, borderBottom: ".5px solid #e5e7eb",
    }}>{children}</div>
  );
}

function Kolom({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <div style={{ gridColumn: full ? "1 / -1" : undefined }}>
      {label && (
        <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#374151", marginBottom: 4 }}>
          {label}
        </label>
      )}
      {children}
    </div>
  );
}
