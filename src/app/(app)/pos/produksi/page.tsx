import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SecHeader } from "@/components/SecHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { NoDok } from "@/components/NoDok";
import { ResepForm, type BarangPilihan } from "./ResepForm";
import { mulaiProduksi, selesaikanProduksi } from "./actions";
import { hariIniWIB } from "@/lib/tanggal";
import { kebutuhanBahan, rencanaJadi } from "@/lib/produksi";

// Produksi own brand: resep → perintah (bahan keluar) → penyelesaian (barang jadi
// masuk). Satu halaman karena ketiganya dipakai berurutan oleh orang yang sama;
// memecahnya jadi tiga menu cuma menambah klik tanpa menambah kejelasan.

type Rel<T> = T | T[] | null;
const one = <T,>(r: Rel<T>): T | null => (Array.isArray(r) ? r[0] ?? null : r ?? null);

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");
const tgl = (d: string | null) =>
  d ? new Date(d + "T00:00:00").toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" }) : "—";

type Resep = {
  id: string; nama: string; output_qty: number; is_active: boolean;
  items: Rel<{ code: string; name: string; unit: string }>;
  production_recipe_items: { qty: number; items: Rel<{ name: string; unit: string }> }[] | null;
};

type Perintah = {
  id: string; no_produksi: string; batch: number; qty_jadi: number; nilai_bahan: number;
  status: string; tanggal: string; tanggal_selesai: string | null;
  production_recipes: Rel<{ nama: string; output_qty: number }>;
  warehouses: Rel<{ name: string }>;
};

export default async function ProduksiPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const { error, success } = await searchParams;
  const supabase = await createClient();

  const [{ data: resepData }, { data: orderData }, { data: itemData }, { data: whData }] = await Promise.all([
    supabase.from("production_recipes")
      .select("id, nama, output_qty, is_active, items(code, name, unit), production_recipe_items(qty, items(name, unit))")
      .eq("is_active", true).order("created_at", { ascending: false }),
    supabase.from("production_orders")
      .select("id, no_produksi, batch, qty_jadi, nilai_bahan, status, tanggal, tanggal_selesai, production_recipes(nama, output_qty), warehouses(name)")
      .order("created_at", { ascending: false }).limit(50),
    supabase.from("items").select("id, code, name, unit")
      .eq("is_active", true).eq("item_type", "Persediaan").order("name"),
    supabase.from("warehouses").select("id, name").eq("is_active", true).order("name"),
  ]);

  const resep = (resepData ?? []) as unknown as Resep[];
  const perintah = (orderData ?? []) as unknown as Perintah[];
  const barang = (itemData ?? []) as BarangPilihan[];
  const gudang = (whData ?? []) as { id: string; name: string }[];
  const berjalan = perintah.filter((p) => p.status === "berjalan");

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/pos" className="back-btn"><i className="ti ti-arrow-left" /> Kembali</Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Produksi Own Brand</span>
      </div>

      {success && (
        <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}>
          <i className="ti ti-circle-check" /> {success}
        </div>
      )}
      {error && (
        <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}>
          <i className="ti ti-alert-circle" /> {error}
        </div>
      )}

      {/* 01 — perintah produksi yang masih berjalan, beserta penyelesaiannya */}
      <div className="crm-sec">
        <SecHeader
          num="01"
          title="PRODUKSI BERJALAN"
          desc="Bahannya sudah keluar gudang. Isi jumlah barang jadi untuk menutup perintahnya — harga pokok dihitung dari modal bahan yang terpakai."
        />
        {berjalan.length === 0 ? (
          <div style={{ fontSize: 11, color: "var(--td)", padding: "14px 0", textAlign: "center" }}>
            Tidak ada produksi yang sedang berjalan.
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="tbl" style={{ minWidth: 820 }}>
              <thead>
                <tr>
                  <th style={{ width: 150 }}>Nomor</th><th>Resep</th><th style={{ width: 120 }}>Gudang</th>
                  <th style={{ width: 90, textAlign: "right" }}>Rencana jadi</th>
                  <th style={{ width: 130, textAlign: "right" }}>Modal bahan</th>
                  <th style={{ width: 260 }}>Selesaikan</th>
                </tr>
              </thead>
              <tbody>
                {berjalan.map((p) => {
                  const r = one(p.production_recipes);
                  const rencana = rencanaJadi(Number(r?.output_qty ?? 0), Number(p.batch));
                  return (
                    <tr key={p.id}>
                      <td style={{ fontSize: 11, fontWeight: 600 }}>
                        <NoDok nomor={p.no_produksi} />
                        <div style={{ fontSize: 9.5, color: "var(--td)", fontWeight: 400 }}>{tgl(p.tanggal)}</div>
                      </td>
                      <td style={{ fontSize: 11.5 }}>{r?.nama ?? "—"} <span style={{ color: "var(--td)" }}>× {Number(p.batch)}</span></td>
                      <td style={{ fontSize: 11 }}>{one(p.warehouses)?.name ?? "—"}</td>
                      <td style={{ textAlign: "right", fontSize: 11.5 }}>{rencana.toLocaleString("id-ID")}</td>
                      <td style={{ textAlign: "right", fontSize: 11.5 }}>{rp(Number(p.nilai_bahan))}</td>
                      <td>
                        <form action={selesaikanProduksi} style={{ display: "flex", gap: 5, alignItems: "flex-end", flexWrap: "wrap" }}>
                          <input type="hidden" name="id" value={p.id} />
                          <div style={{ width: 90 }}>
                            <label className="flab">Jadi</label>
                            <input className="fi" type="number" name="qty_jadi" min={0} step="any"
                              defaultValue={rencana || ""} style={{ textAlign: "right" }} />
                          </div>
                          <div style={{ width: 130 }}>
                            <label className="flab">Tanggal</label>
                            <input className="fi" type="date" name="tanggal_selesai" defaultValue={hariIniWIB()} />
                          </div>
                          <SubmitButton className="btn-acc" icon="ti-package-import" pendingText="Memproses…"
                            style={{ padding: "5px 10px", fontSize: 10.5 }}>
                            Selesai
                          </SubmitButton>
                        </form>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 02 — mulai produksi baru dari resep yang ada */}
      <div className="crm-sec">
        <SecHeader
          num="02"
          title="MULAI PRODUKSI"
          desc="Pilih resep dan jumlah batch. Bahan langsung keluar dari gudang yang dipilih; nilainya pindah ke Persediaan Dalam Proses sampai barang jadi masuk."
        />
        {resep.length === 0 ? (
          <div style={{ fontSize: 11, color: "var(--td)", padding: "10px 0" }}>
            Belum ada resep produksi — buat dulu di bawah.
          </div>
        ) : (
          <form action={mulaiProduksi}>
            <div className="frow" style={{ marginBottom: 10 }}>
              <div>
                <label className="flab">Resep *</label>
                <select className="fi" name="recipe_id" required defaultValue="">
                  <option value="" disabled>— pilih resep —</option>
                  {resep.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.nama} → {Number(r.output_qty)} {one(r.items)?.unit ?? ""} {one(r.items)?.name ?? ""}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="flab">Gudang bahan *</label>
                <select className="fi" name="warehouse_id" required defaultValue="">
                  <option value="" disabled>— pilih gudang —</option>
                  {gudang.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              </div>
              <div>
                <label className="flab">Jumlah batch *</label>
                <input className="fi" type="number" name="batch" min={1} step="any" defaultValue={1} required />
              </div>
              <div>
                <label className="flab">Tanggal</label>
                <input className="fi" type="date" name="tanggal" defaultValue={hariIniWIB()} />
              </div>
            </div>
            <div className="fg" style={{ marginBottom: 10 }}>
              <label className="flab">Catatan</label>
              <input className="fi" name="catatan" placeholder="opsional" />
            </div>
            <SubmitButton className="btn-acc" icon="ti-player-play" pendingText="Memproses…">
              Mulai produksi (bahan keluar)
            </SubmitButton>
          </form>
        )}
      </div>

      {/* 03 — daftar resep */}
      <div className="crm-sec">
        <SecHeader num="03" title="RESEP PRODUKSI" desc={`${resep.length} resep aktif.`} />
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 640 }}>
            <thead>
              <tr><th>Resep</th><th>Barang jadi</th><th style={{ width: 100, textAlign: "right" }}>Hasil</th><th>Bahan</th></tr>
            </thead>
            <tbody>
              {resep.map((r) => {
                const jadi = one(r.items);
                return (
                  <tr key={r.id}>
                    <td style={{ fontSize: 11.5, fontWeight: 600 }}>{r.nama}</td>
                    <td style={{ fontSize: 11.5 }}>{jadi ? `${jadi.code} — ${jadi.name}` : "—"}</td>
                    <td style={{ textAlign: "right", fontSize: 11.5 }}>
                      {Number(r.output_qty)} {jadi?.unit ?? ""}
                    </td>
                    <td style={{ fontSize: 10.5, color: "var(--tm)" }}>
                      {kebutuhanBahan(
                        (r.production_recipe_items ?? []).map((b) => ({
                          item_id: one(b.items)?.name ?? "", nama: one(b.items)?.name ?? "", qty: Number(b.qty),
                        })), 1,
                      ).map((b) => `${b.nama} ${b.qty}`).join(" · ") || "—"}
                    </td>
                  </tr>
                );
              })}
              {resep.length === 0 && (
                <tr><td colSpan={4} style={{ textAlign: "center", color: "var(--td)", padding: "16px 0", fontSize: 11 }}>
                  Belum ada resep produksi.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <ResepForm barang={barang} />

      {/* 04 — riwayat */}
      <div className="crm-sec" style={{ marginBottom: 0 }}>
        <SecHeader num="04" title="RIWAYAT PRODUKSI" desc="Perintah yang sudah ditutup." />
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 720 }}>
            <thead>
              <tr>
                <th style={{ width: 150 }}>Nomor</th><th>Resep</th>
                <th style={{ width: 100, textAlign: "right" }}>Jadi</th>
                <th style={{ width: 130, textAlign: "right" }}>Modal bahan</th>
                <th style={{ width: 120, textAlign: "right" }}>HPP / unit</th>
                <th style={{ width: 110 }}>Selesai</th>
              </tr>
            </thead>
            <tbody>
              {perintah.filter((p) => p.status === "selesai").map((p) => (
                <tr key={p.id}>
                  <td style={{ fontSize: 11, fontWeight: 600 }}><NoDok nomor={p.no_produksi} /></td>
                  <td style={{ fontSize: 11.5 }}>{one(p.production_recipes)?.nama ?? "—"}</td>
                  <td style={{ textAlign: "right", fontSize: 11.5 }}>{Number(p.qty_jadi).toLocaleString("id-ID")}</td>
                  <td style={{ textAlign: "right", fontSize: 11.5 }}>{rp(Number(p.nilai_bahan))}</td>
                  <td style={{ textAlign: "right", fontSize: 11.5 }}>
                    {Number(p.qty_jadi) > 0 ? rp(Number(p.nilai_bahan) / Number(p.qty_jadi)) : "—"}
                  </td>
                  <td style={{ fontSize: 11 }}>{tgl(p.tanggal_selesai)}</td>
                </tr>
              ))}
              {perintah.filter((p) => p.status === "selesai").length === 0 && (
                <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--td)", padding: "16px 0", fontSize: 11 }}>
                  Belum ada produksi yang selesai.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
