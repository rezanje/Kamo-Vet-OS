import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SecHeader } from "@/components/SecHeader";
import { promoScheduleStatus, type PromoRow } from "@/lib/promo";
import { createPromo, togglePromo } from "./actions";

const STATUS_BADGE: Record<string, string> = { aktif: "g", terjadwal: "b", kadaluarsa: "x", nonaktif: "r" };
const STATUS_LABEL: Record<string, string> = { aktif: "Aktif hari ini", terjadwal: "Terjadwal", kadaluarsa: "Kadaluarsa", nonaktif: "Nonaktif" };

export default async function PromoAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const { error, success } = await searchParams;
  const supabase = await createClient();
  const today = new Date(new Date().getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10);

  const [{ data: promos }, { data: branches }] = await Promise.all([
    supabase.from("promos").select("id, name, promo_type, rule, is_active, branch_ids, valid_from, valid_until").order("created_at", { ascending: false }),
    supabase.from("branches").select("id, name").eq("is_active", true).order("name"),
  ]);
  const branchName = new Map((branches ?? []).map((b) => [b.id, b.name]));
  const rows = (promos ?? []) as PromoRow[];

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/crm" className="back-btn"><i className="ti ti-arrow-left" /> Kembali</Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Promo — Konfigurasi Pusat</span>
      </div>

      {error && <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}><i className="ti ti-alert-circle" /> {error}</div>}
      {success && <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}><i className="ti ti-circle-check" /> Promo baru dibuat.</div>}

      <div className="crm-sec">
        <SecHeader num="01" title="BUAT PROMO" desc="Set promo per cabang + masa berlaku. Kosongkan cabang = berlaku semua cabang." />
        <form action={createPromo} style={{ display: "grid", gridTemplateColumns: "2fr 1.3fr 1fr 1fr", gap: 8, alignItems: "flex-end" }}>
          <div style={{ gridColumn: "1 / -1" }}>
            <label className="flab">Nama promo *</label>
            <input className="fi" name="name" required placeholder="mis. Diskon Lebaran Royal Canin" />
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <label className="flab">Teks saran untuk kasir *</label>
            <input className="fi" name="suggest" required placeholder="mis. Beli 2 Royal Canin diskon 10% item kedua" />
          </div>
          <div>
            <label className="flab">Tipe</label>
            <select className="fi" name="promo_type" defaultValue="diskon_produk">
              <option value="diskon_produk">Diskon Produk</option>
              <option value="bundling">Bundling</option>
              <option value="tebus_murah">Tebus Murah</option>
            </select>
          </div>
          <div>
            <label className="flab">Jenis diskon</label>
            <select className="fi" name="discount_type" defaultValue="">
              <option value="">—</option>
              <option value="percent">Persen</option>
              <option value="nominal">Nominal</option>
            </select>
          </div>
          <div>
            <label className="flab">Nilai diskon</label>
            <input className="fi" name="discount_value" type="number" min={0} step="any" placeholder="0" />
          </div>
          <div>
            <label className="flab">Min. subtotal</label>
            <input className="fi" name="min_subtotal" type="number" min={0} step="any" placeholder="0" />
          </div>
          <div>
            <label className="flab">Berlaku dari</label>
            <input className="fi" name="valid_from" type="date" defaultValue={today} />
          </div>
          <div>
            <label className="flab">Berlaku s/d</label>
            <input className="fi" name="valid_until" type="date" />
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <label className="flab">Cabang (kosongkan = semua cabang)</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px", maxHeight: 96, overflowY: "auto", border: ".5px solid var(--bd)", borderRadius: 7, padding: "8px 10px" }}>
              {(branches ?? []).map((b) => (
                <label key={b.id} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11 }}>
                  <input type="checkbox" name="branch_ids" value={b.id} /> {b.name}
                </label>
              ))}
            </div>
          </div>
          <button type="submit" className="btn-acc" style={{ gridColumn: "1 / -1", justifyContent: "center" }}>
            <i className="ti ti-plus" /> Buat Promo
          </button>
        </form>
      </div>

      <div className="crm-sec">
        <SecHeader num="02" title="DAFTAR PROMO" desc="Semua promo terdaftar + status masa berlaku." />
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 760 }}>
            <thead>
              <tr><th>Nama</th><th>Tipe</th><th>Cabang</th><th>Berlaku</th><th>Status</th><th /></tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const st = promoScheduleStatus(p, today);
                const cabang = !p.branch_ids || p.branch_ids.length === 0
                  ? "Semua cabang"
                  : p.branch_ids.map((id) => branchName.get(id) ?? "—").join(", ");
                return (
                  <tr key={p.id} style={{ opacity: p.is_active ? 1 : 0.55 }}>
                    <td style={{ fontWeight: 500 }}>{p.name}</td>
                    <td style={{ fontSize: 11, textTransform: "capitalize" }}>{p.promo_type.replace("_", " ")}</td>
                    <td style={{ fontSize: 11 }}>{cabang}</td>
                    <td style={{ fontSize: 11 }}>{p.valid_from ?? "—"} s/d {p.valid_until ?? "∞"}</td>
                    <td><span className={`bge ${STATUS_BADGE[st]}`}>{STATUS_LABEL[st]}</span></td>
                    <td>
                      <form action={togglePromo}>
                        <input type="hidden" name="id" value={p.id} />
                        <input type="hidden" name="active" value={p.is_active ? "0" : "1"} />
                        <button type="submit" className="btn-def" style={{ padding: "3px 10px", fontSize: 10 }}>
                          {p.is_active ? "Nonaktifkan" : "Aktifkan"}
                        </button>
                      </form>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--td)", padding: "16px 0", fontSize: 11 }}>Belum ada promo.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
