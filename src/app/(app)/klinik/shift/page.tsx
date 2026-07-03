import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getOpenShift } from "@/lib/shift";
import { expectedCash, invoiceCashRows, methodBreakdown, PAYMENT_METHODS } from "@/lib/shift-calc";
import { mulaiShiftKlinik, tutupShiftKlinik } from "./actions";

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");

// Layar "Mulai Shift" klinik (design-reference/klinik/01-shift-start.png):
// wajib buka shift sebelum akses pembayaran klinik (Addendum §1).
export default async function KlinikShiftPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const shift = await getOpenShift(supabase as never, user.id, "klinik");

  if (shift) {
    // shift berjalan → ringkasan + tutup shift.
    const { data: invoices } = await supabase
      .from("invoices").select("total, dp_amount, paid_status, metode_bayar").eq("shift_id", shift.id);
    const breakdown = methodBreakdown(invoiceCashRows(invoices ?? []));
    const expected = expectedCash(Number(shift.opening_balance), breakdown);

    return (
      <div style={{ minHeight: "60vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16 }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: "var(--sb)" }}>Shift Klinik Berjalan</div>
          <div style={{ fontSize: 12, color: "var(--tm)", marginTop: 2 }}>
            {shift.branchName} · dibuka {new Date(shift.opened_at).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}
          </div>
        </div>
        {error && (
          <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c", maxWidth: 440 }}>
            <i className="ti ti-alert-circle" /> {error}
          </div>
        )}
        <div className="card" style={{ width: "100%", maxWidth: 460, padding: 22 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--tm)", letterSpacing: ".04em", marginBottom: 8 }}>
            KAS DITERIMA PER METODE (INVOICE SHIFT INI)
          </div>
          {PAYMENT_METHODS.map((m) => (
            <div key={m} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: ".5px dashed var(--bd)" }}>
              <span style={{ fontSize: 12, color: "var(--tm)" }}>{m}</span>
              <span style={{ fontSize: 12.5, fontWeight: 600 }}>{rp(breakdown[m] ?? 0)}</span>
            </div>
          ))}
          <div style={{ display: "flex", justifyContent: "space-between", padding: "9px 0", marginBottom: 10 }}>
            <span style={{ fontSize: 12.5, fontWeight: 700 }}>Kas seharusnya (modal + tunai)</span>
            <span style={{ fontSize: 14, fontWeight: 800, color: "var(--acc)" }}>{rp(expected)}</span>
          </div>
          <form action={tutupShiftKlinik}>
            <input type="hidden" name="shiftId" value={shift.id} />
            <label className="flab">Uang kas dihitung (fisik) *</label>
            <input className="fi" name="closing_balance" type="number" min={0} step={500} placeholder="Hitung uang di kasir" required style={{ marginBottom: 10 }} />
            <button type="submit" className="pay-btn"><i className="ti ti-lock" /> Tutup Shift Klinik</button>
          </form>
          <Link href="/klinik" className="back-btn" style={{ marginTop: 12, justifyContent: "center", width: "100%" }}>
            <i className="ti ti-arrow-left" /> Kembali ke menu klinik
          </Link>
        </div>
      </div>
    );
  }

  const { data: branches } = await supabase
    .from("branches").select("id, name").eq("is_active", true).order("name");

  return (
    <div style={{ minHeight: "60vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 18 }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 26, fontWeight: 800, color: "var(--sb)" }}>Selamat Datang!</div>
        <div style={{ fontSize: 13, color: "var(--tm)", marginTop: 2 }}>Sistem Informasi Klinik Hewan</div>
        <div style={{ fontSize: 11.5, color: "var(--td)", marginTop: 8 }}>Silakan mulai shift untuk mengakses pembayaran klinik.</div>
      </div>

      {error && (
        <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c", maxWidth: 420 }}>
          <i className="ti ti-alert-circle" /> {error}
        </div>
      )}

      <form action={mulaiShiftKlinik} className="card" style={{ width: "100%", maxWidth: 440, padding: 22 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 14 }}>
          <div style={{ width: 44, height: 44, borderRadius: "50%", background: "#eff6ff", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <i className="ti ti-cash-banknote" style={{ fontSize: 20, color: "var(--sb)" }} />
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700 }}>UANG DI KASIR SAAT INI</div>
            <div style={{ fontSize: 11, color: "var(--tm)", marginTop: 2 }}>
              Masukkan jumlah uang tunai yang ada di kasir sebelum memulai shift.
            </div>
          </div>
        </div>

        <div style={{ marginBottom: 10 }}>
          <label className="flab">Cabang klinik *</label>
          <select className="fi" name="branchId" required defaultValue="">
            <option value="" disabled>Pilih cabang tempat kamu bertugas</option>
            {(branches ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>

        <div style={{ marginBottom: 14 }}>
          <label className="flab">Modal awal kas (Rp) *</label>
          <div style={{ display: "flex", alignItems: "stretch" }}>
            <span style={{ background: "var(--sf1)", border: ".5px solid var(--bd)", borderRight: "none", borderRadius: "6px 0 0 6px", padding: "6px 10px", fontSize: 12, color: "var(--tm)" }}>Rp</span>
            <input className="fi" name="opening_balance" type="number" min={0} step={1000} placeholder="0" required style={{ borderRadius: "0 6px 6px 0" }} />
          </div>
        </div>

        <button type="submit" className="pay-btn">
          <i className="ti ti-player-play" /> MULAI SHIFT
        </button>
      </form>
    </div>
  );
}
