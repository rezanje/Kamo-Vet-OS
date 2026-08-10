import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SecHeader } from "@/components/SecHeader";
import { promoScheduleStatus, type PromoRow } from "@/lib/promo";
import { createPromo, togglePromo } from "./actions";
import { hariIniWIB } from "@/lib/tanggal";

const STATUS_BADGE: Record<string, string> = { aktif: "g", terjadwal: "b", kadaluarsa: "x", nonaktif: "r" };

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");

// Daftar barang dipotong supaya satu baris tabel tidak melebar tak terkendali.
function ringkasBarang(nama: string[] | undefined): string {
  if (!nama || nama.length === 0) return "Semua barang";
  if (nama.length <= 2) return nama.join(", ");
  return `${nama.slice(0, 2).join(", ")} +${nama.length - 2} lagi`;
}

// Aturan promo dalam satu kalimat pendek — supaya pemilik toko bisa baca sekilas
// tanpa membuka formulirnya.
function ringkasAturan(p: PromoRow): string {
  const bagian: string[] = [];
  if (p.discount_type && p.discount_value) {
    bagian.push(p.discount_type === "percent" ? `${p.discount_value}%` : `${rp(p.discount_value)}/pcs`);
  }
  if (p.min_qty) bagian.push(`min ${p.min_qty}`);
  if (p.max_qty) bagian.push(`maks ${p.max_qty}`);
  if (p.kelipatan) bagian.push("kelipatan");
  if (p.rule?.min_subtotal) bagian.push(`belanja ${rp(p.rule.min_subtotal)}`);
  return bagian.length ? bagian.join(" · ") : "—";
}
const STATUS_LABEL: Record<string, string> = { aktif: "Aktif hari ini", terjadwal: "Terjadwal", kadaluarsa: "Kadaluarsa", nonaktif: "Nonaktif" };

export default async function PromoAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const { error, success } = await searchParams;
  const supabase = await createClient();
  const today = hariIniWIB();

  const [{ data: promos }, { data: branches }, { data: items }, { data: promoItems }] = await Promise.all([
    supabase.from("promos")
      .select("id, name, promo_type, rule, is_active, branch_ids, valid_from, valid_until, min_qty, max_qty, kelipatan, auto_apply, discount_type, discount_value")
      .order("created_at", { ascending: false }),
    supabase.from("branches").select("id, name").eq("is_active", true).order("name"),
    // Jasa ikut ditawarkan: grooming & tindakan juga sering dipromokan.
    supabase.from("items").select("id, code, name").eq("is_active", true).order("name"),
    supabase.from("promo_items").select("promo_id, item_id"),
  ]);
  const branchName = new Map((branches ?? []).map((b) => [b.id, b.name]));
  const itemName = new Map((items ?? []).map((i) => [i.id, i.name]));
  const rows = (promos ?? []) as PromoRow[];

  // Barang per promo untuk kolom "Berlaku untuk" di daftar.
  const barangPromo = new Map<string, string[]>();
  for (const r of (promoItems ?? []) as { promo_id: string; item_id: string }[]) {
    const list = barangPromo.get(r.promo_id) ?? [];
    list.push(itemName.get(r.item_id) ?? "—");
    barangPromo.set(r.promo_id, list);
  }

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/crm" className="back-btn"><i className="ti ti-arrow-left" /> Kembali</Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Promo — Konfigurasi Pusat</span>
      </div>

      {/* Promo & voucher dua-duanya "potongan yang dikelola pusat" — dipasangkan
          di sini supaya tidak perlu balik ke menu CRM buat pindah antar keduanya. */}
      <div style={{ display: "flex", gap: 6, marginBottom: 11 }}>
        <Link href="/crm/promo" className="back-btn" style={tabAktif(true)}>
          <i className="ti ti-speakerphone" /> Promo
        </Link>
        <Link href="/crm/voucher" className="back-btn" style={tabAktif(false)}>
          <i className="ti ti-ticket" /> Kode Voucher
        </Link>
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

          {/* ── Aturan qty ──────────────────────────────────────────────── */}
          <div style={{ gridColumn: "1 / -1", borderTop: ".5px solid var(--bd)", paddingTop: 10, marginTop: 2 }}>
            <div style={{ fontSize: 11.5, fontWeight: 700 }}><i className="ti ti-adjustments" /> Aturan jumlah beli</div>
            <div style={{ fontSize: 9.5, color: "var(--td)" }}>
              Kosongkan semua kalau promo berlaku berapa pun jumlah belinya.
            </div>
          </div>
          <div>
            <label className="flab">Min. qty</label>
            <input className="fi" name="min_qty" type="number" min={1} step="any" placeholder="mis. 2" />
            <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 3 }}>Beli kurang dari ini, promo tidak jalan.</div>
          </div>
          <div>
            <label className="flab">Maks. qty</label>
            <input className="fi" name="max_qty" type="number" min={1} step="any" placeholder="tanpa batas" />
            <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 3 }}>Batas jumlah yang dapat potongan.</div>
          </div>
          <div style={{ gridColumn: "span 2" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, marginTop: 17 }}>
              <input type="checkbox" name="kelipatan" value="1" /> Berlaku kelipatan
            </label>
            <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 3 }}>
              Dicentang: min 2, beli 5 → yang dapat potongan 4, sisa 1 harga normal.
              Tidak dicentang: syarat terpenuhi, seluruh qty dapat.
            </div>
          </div>

          {/* ── Barang yang kena ────────────────────────────────────────── */}
          <div style={{ gridColumn: "1 / -1" }}>
            <label className="flab">Barang yang kena promo (kosongkan = semua barang)</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px", maxHeight: 120, overflowY: "auto", border: ".5px solid var(--bd)", borderRadius: 7, padding: "8px 10px" }}>
              {(items ?? []).map((it) => (
                <label key={it.id} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11 }}>
                  <input type="checkbox" name="item_ids" value={it.id} /> {it.code} — {it.name}
                </label>
              ))}
              {(items ?? []).length === 0 && <span style={{ fontSize: 10.5, color: "var(--td)" }}>Belum ada barang.</span>}
            </div>
          </div>

          {/* ── Potong otomatis ─────────────────────────────────────────── */}
          <div style={{ gridColumn: "1 / -1", background: "#f8fafc", border: ".5px solid var(--bd)", borderRadius: 7, padding: "9px 11px" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, fontWeight: 700 }}>
              <input type="checkbox" name="auto_apply" value="1" /> Potong otomatis di kasir
            </label>
            <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 3 }}>
              Dicentang: potongan langsung masuk keranjang, kasir tidak perlu mengetik apa pun —
              butuh jenis & nilai diskon terisi. Tidak dicentang: promo cuma muncul sebagai pengingat di layar kasir.
            </div>
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
              <tr>
                <th>Nama</th><th>Berlaku untuk</th><th>Aturan</th><th>Cabang</th>
                <th>Tanggal</th><th>Status</th><th /></tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const st = promoScheduleStatus(p, today);
                const cabang = !p.branch_ids || p.branch_ids.length === 0
                  ? "Semua cabang"
                  : p.branch_ids.map((id) => branchName.get(id) ?? "—").join(", ");
                return (
                  <tr key={p.id} style={{ opacity: p.is_active ? 1 : 0.55 }}>
                    <td style={{ fontWeight: 500 }}>
                      {p.name}
                      <div style={{ fontSize: 9.5, color: "var(--td)", textTransform: "capitalize" }}>
                        {p.promo_type.replace("_", " ")}
                        {p.auto_apply
                          ? <span style={{ color: "#15803d", fontWeight: 700 }}> · potong otomatis</span>
                          : <span> · pengingat saja</span>}
                      </div>
                    </td>
                    <td style={{ fontSize: 11 }}>{ringkasBarang(barangPromo.get(p.id))}</td>
                    <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{ringkasAturan(p)}</td>
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
              {rows.length === 0 && <tr><td colSpan={7} style={{ textAlign: "center", color: "var(--td)", padding: "16px 0", fontSize: 11 }}>Belum ada promo.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

// Penanda halaman aktif untuk pasangan tab Promo / Kode Voucher.
function tabAktif(active: boolean): React.CSSProperties {
  return active
    ? { background: "#eff6ff", color: "#2563eb", borderColor: "#bfdbfe", fontWeight: 700 }
    : {};
}
