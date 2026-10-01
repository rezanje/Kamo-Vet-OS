import { login } from "./actions";
import { SubmitButton } from "@/components/SubmitButton";

// Ditampilkan selama demo agar akun uji bisa langsung dipakai.
const AKUN_DEMO = [
  { role: "OWNER", email: "owner@vetos.local" },
  { role: "ADMIN", email: "claude-test@vetos.local" },
  { role: "FINANCE", email: "finance@vetos.local" },
  { role: "STAFF", email: "staff@vetos.local" },
  { role: "DOCTOR", email: "doctor@vetos.local" },
];
const PASSWORD_DEMO = "password123";

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

          <section
            aria-labelledby="akun-demo-title"
            style={{ marginTop: 4, padding: "10px 12px", borderRadius: 6, background: "#fffbeb", border: ".5px solid #fcd34d" }}
          >
            <h2 id="akun-demo-title" style={{ fontSize: 11, fontWeight: 700, color: "#b45309", margin: "0 0 8px" }}>
              Akun demo
            </h2>
            <table style={{ width: "100%", fontSize: 10, color: "#78350f", borderCollapse: "collapse" }}>
              <tbody>
                {AKUN_DEMO.map((akun) => (
                  <tr key={akun.email}>
                    <th scope="row" style={{ textAlign: "left", fontWeight: 700, padding: "2px 6px 2px 0", verticalAlign: "top" }}>{akun.role}</th>
                    <td style={{ fontFamily: "var(--font-geist-mono, monospace)", padding: "2px 0", overflowWrap: "anywhere" }}>{akun.email}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p style={{ fontSize: 11, color: "#78350f", margin: "8px 0 0", borderTop: ".5px solid #fcd34d", paddingTop: 6 }}>
              Password semua akun:{" "}
              <strong style={{ fontFamily: "var(--font-geist-mono, monospace)" }}>{PASSWORD_DEMO}</strong>
            </p>
          </section>
        </div>
      </form>
    </main>
  );
}
