import { login } from "./actions";
import { SubmitButton } from "@/components/SubmitButton";

// ⚠️ AKUN UJI TERPAJANG PUBLIK — termasuk di production (keputusan boss, 2026-07-26,
// selama fase development). Artinya siapa pun yang menemukan URL Vercel bisa masuk
// sebagai OWNER: pembukuan, data pelanggan, dan data gaji HRIS terbuka.
// HAPUS BLOK INI (dan ganti password akun-akun di bawah) SEBELUM dipakai pelanggan/
// karyawan asli. Tercatat sebagai item wajib di docs/RINGKASAN-KLONING-ACCURATE-2026-07.md.
// ponytail: daftar statis, tanpa klik-isi-otomatis (butuh client component); tambah kalau perlu.
const AKUN_DEV = [
  { role: "OWNER", email: "owner@vetos.local", ket: "akses penuh" },
  { role: "ADMIN", email: "claude-test@vetos.local", ket: "akses penuh" },
  { role: "FINANCE", email: "finance@vetos.local", ket: "hanya modul keuangan" },
  { role: "STAFF", email: "staff@vetos.local", ket: "cabang yang ditugaskan" },
  { role: "DOCTOR", email: "doctor@vetos.local", ket: "klinik" },
];
const PASSWORD_DEV = "password123";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <main
      style={{
        minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
        background: "linear-gradient(160deg, #eef4ff 0%, #f6faff 55%, #eaf6f0 100%)",
      }}
    >
      <form action={login} className="card" style={{ width: "100%", maxWidth: 380, padding: 0, overflow: "hidden" }}>
        <div style={{ background: "linear-gradient(90deg, var(--posb-dk), var(--posb))", padding: "26px 28px", display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 44, height: 44, borderRadius: 10, background: "rgba(255,255,255,.16)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <i className="ti ti-paw" style={{ fontSize: 22, color: "#fff" }} />
          </div>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, color: "#fff", letterSpacing: ".02em" }}>VetOS</div>
            <div style={{ fontSize: 11.5, color: "rgba(255,255,255,.8)" }}>Masuk ke platform Kamo Group</div>
          </div>
        </div>

        <div style={{ padding: "24px 28px 28px", display: "flex", flexDirection: "column", gap: 14 }}>
          {error && (
            <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c", margin: 0 }}>
              <i className="ti ti-alert-circle" /> {error}
            </div>
          )}

          <div className="fg">
            <label className="flab">Email</label>
            <input className="fi" name="email" type="email" required placeholder="nama@vetos.local" />
          </div>

          <div className="fg">
            <label className="flab">Password</label>
            <input className="fi" name="password" type="password" required placeholder="••••••••" />
          </div>

          <SubmitButton className="btn-acc" style={{ width: "100%", justifyContent: "center", background: "var(--posb)", padding: "10px 0", fontSize: 13 }} pendingText="Masuk…">
            Masuk
          </SubmitButton>

          {/* Akun dibuat oleh admin di Pengaturan → Manajemen Pengguna. */}
          <p style={{ fontSize: 10, color: "var(--td)", textAlign: "center", margin: 0 }}>
            Lupa password atau belum punya akun? Hubungi admin Kamo Group.
          </p>

          <div
            style={{
              marginTop: 4, padding: "10px 12px", borderRadius: 6,
              background: "#fffbeb", border: ".5px solid #fcd34d",
            }}
          >
            <div style={{ fontSize: 9.5, fontWeight: 700, color: "#b45309", letterSpacing: ".04em", marginBottom: 6 }}>
              <i className="ti ti-tool" /> AKUN UJI — FASE DEVELOPMENT
            </div>
            <table style={{ width: "100%", fontSize: 10, color: "#78350f", borderCollapse: "collapse" }}>
              <tbody>
                {AKUN_DEV.map((a) => (
                  <tr key={a.email}>
                    <td style={{ fontWeight: 700, paddingRight: 6, whiteSpace: "nowrap", verticalAlign: "top" }}>{a.role}</td>
                    <td style={{ fontFamily: "var(--font-geist-mono, monospace)", paddingRight: 6 }}>{a.email}</td>
                    <td style={{ color: "#a16207", whiteSpace: "nowrap", verticalAlign: "top" }}>{a.ket}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ fontSize: 10, color: "#78350f", marginTop: 6, borderTop: ".5px solid #fcd34d", paddingTop: 5 }}>
              Password semua akun:{" "}
              <strong style={{ fontFamily: "var(--font-geist-mono, monospace)" }}>{PASSWORD_DEV}</strong>
            </div>
            <div style={{ fontSize: 9, color: "#b91c1c", marginTop: 5, fontWeight: 600 }}>
              <i className="ti ti-alert-triangle" /> Data di sini asli. Hapus blok ini &amp; ganti
              password sebelum sistem dipakai karyawan/pelanggan.
            </div>
          </div>
        </div>
      </form>
    </main>
  );
}
