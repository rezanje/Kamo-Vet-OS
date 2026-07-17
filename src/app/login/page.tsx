import { login } from "./actions";
import { SubmitButton } from "@/components/SubmitButton";

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

          {/* Demo only: daftar akun uji coba biar gampang login. Hapus sebelum produksi. */}
          <div style={{ borderRadius: 8, border: ".5px dashed var(--bd)", padding: 12, fontSize: 10.5, color: "var(--tm)" }}>
            <p style={{ fontWeight: 700, color: "var(--tx)", marginBottom: 4 }}>Akun demo (password: password123)</p>
            <p><span style={{ fontWeight: 500 }}>owner@vetos.local</span> — OWNER</p>
            <p><span style={{ fontWeight: 500 }}>claude-test@vetos.local</span> — ADMIN</p>
            <p><span style={{ fontWeight: 500 }}>staff@vetos.local</span> — STAFF (kasir)</p>
            <p><span style={{ fontWeight: 500 }}>finance@vetos.local</span> — FINANCE (keuangan)</p>
          </div>
        </div>
      </form>
    </main>
  );
}
