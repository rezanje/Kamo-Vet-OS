import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SecHeader } from "@/components/SecHeader";
import { TileGrid } from "@/components/ModuleHome";
import { updatePOStatus, tambahSupplier } from "./actions";
import { adaSelisih, nilaiDiterima } from "@/lib/penerimaan";

// ponytail: PO list + supplier section. Status badge colours match template.

type Rel<T> = T | T[] | null;
function one<T>(r: Rel<T>): T | null {
  return Array.isArray(r) ? (r[0] ?? null) : r;
}

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");

const STATUS_BADGE: Record<string, string> = {
  Draft: "x",
  Dipesan: "b",
  Diterima: "g",
  Batal: "r",
};

type PO = {
  id: string;
  no_po: string | null;
  tanggal: string;
  status: string;
  total: number;
  suppliers: Rel<{ nama: string }>;
  warehouses: Rel<{ name: string }>;
  purchase_order_items: { qty: number; qty_terima: number | null; harga_beli: number }[] | null;
};

type Supplier = {
  id: string;
  nama: string;
  kontak: string | null;
  telp: string | null;
  npwp: string | null;
  termin_hari: number | null;
  bank_nama: string | null;
  bank_rekening: string | null;
  supplier_categories: Rel<{ nama: string }>;
};

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });

export default async function PembelianPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; success_sup?: string; success_terima?: string; error?: string; tab?: string }>;
}) {
  const { success, success_sup, success_terima, error, tab } = await searchParams;
  const supabase = await createClient();

  const [{ data: poData }, { data: supData }, { data: supCatData }] = await Promise.all([
    supabase
      .from("purchase_orders")
      .select("id, no_po, tanggal, status, total, suppliers(nama), warehouses(name), purchase_order_items(qty, qty_terima, harga_beli)")
      .order("created_at", { ascending: false }),
    supabase.from("suppliers").select("id, nama, kontak, telp, npwp, termin_hari, bank_nama, bank_rekening, supplier_categories(nama)").order("nama"),
    supabase.from("supplier_categories").select("id, nama").eq("is_active", true).order("nama"),
  ]);

  const pos = (poData ?? []) as unknown as PO[];
  const suppliers = (supData ?? []) as unknown as Supplier[];
  const supplierCategories = (supCatData ?? []) as { id: string; nama: string }[];
  const showSupplier = tab === "supplier";

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/" className="back-btn">
          <i className="ti ti-arrow-left" /> Beranda
        </Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Pembelian</span>
      </div>

      {success && (
        <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}>
          <i className="ti ti-circle-check" /> PO berhasil dibuat.
        </div>
      )}
      {success_sup && (
        <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}>
          <i className="ti ti-circle-check" /> Supplier berhasil ditambahkan.
        </div>
      )}
      {success_terima && (
        <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}>
          <i className="ti ti-package-import" /> {success_terima}
        </div>
      )}
      {error && (
        <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}>
          <i className="ti ti-alert-circle" /> {error}
        </div>
      )}

      {/* Menu modul — halaman ini menggantikan tile-grid lama, jadi submenu
          (Faktur Pembelian, Retur Pembelian, dst) ikut ditaruh di sini. */}
      <div style={{ marginBottom: 18 }}>
        <TileGrid moduleId="pembelian" />
      </div>

      {/* Tab nav */}
      <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
        <Link
          href="/pembelian"
          className={showSupplier ? "btn-def" : "btn-acc"}
          style={{ textDecoration: "none", padding: "5px 14px", fontSize: 11.5 }}
        >
          <i className="ti ti-file-invoice" /> Purchase Order
        </Link>
        <Link
          href="/pembelian?tab=supplier"
          className={showSupplier ? "btn-acc" : "btn-def"}
          style={{ textDecoration: "none", padding: "5px 14px", fontSize: 11.5 }}
        >
          <i className="ti ti-building-store" /> Supplier
        </Link>
      </div>

      {!showSupplier && (
        <div className="crm-sec">
          <SecHeader
            num="01"
            title="PURCHASE ORDER"
            desc="Daftar PO pembelian barang ke supplier."
            action={
              <Link href="/pembelian/baru" className="btn-acc" style={{ textDecoration: "none" }}>
                + Buat PO
              </Link>
            }
          />

          <div style={{ overflowX: "auto" }}>
            <table className="tbl" style={{ minWidth: 860 }}>
              <thead>
                <tr>
                  <th>No. PO</th>
                  <th>Tanggal</th>
                  <th>Supplier</th>
                  <th>Gudang Tujuan</th>
                  <th style={{ textAlign: "right" }}>Total</th>
                  <th>Status</th>
                  <th>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {pos.map((po) => {
                  const sup = one(po.suppliers);
                  const wh = one(po.warehouses);
                  const items = po.purchase_order_items ?? [];
                  const beda = adaSelisih(items);
                  return (
                    <tr key={po.id}>
                      <td style={{ fontWeight: 500, fontSize: 11.5 }}>
                        <Link href={`/pembelian/${po.id}`} style={{ color: "var(--ac)" }}>{po.no_po ?? "—"}</Link>
                      </td>
                      <td style={{ fontSize: 11, color: "var(--tm)" }}>{fmtDate(po.tanggal)}</td>
                      <td style={{ fontSize: 11.5 }}>{sup?.nama ?? <span style={{ color: "var(--td)" }}>—</span>}</td>
                      <td style={{ fontSize: 11.5 }}>{wh?.name ?? <span style={{ color: "var(--td)" }}>—</span>}</td>
                      <td style={{ textAlign: "right", fontSize: 11.5 }}>
                        {rp(po.total)}
                        {beda && (
                          <div style={{ fontSize: 9.5, color: "#b45309" }}>
                            diterima {rp(nilaiDiterima(items))}
                          </div>
                        )}
                      </td>
                      <td>
                        <span className={`bge ${STATUS_BADGE[po.status] ?? "x"}`}>{po.status}</span>
                        {beda && (
                          <span style={{ fontSize: 9.5, color: "#b45309", marginLeft: 5 }}>≠ PO</span>
                        )}
                      </td>
                      <td>
                        <div style={{ display: "flex", gap: 5 }}>
                          {po.status === "Draft" && (
                            <form action={updatePOStatus}>
                              <input type="hidden" name="id" value={po.id} />
                              <input type="hidden" name="status" value="Dipesan" />
                              <button type="submit" className="btn-acc" style={{ padding: "4px 10px", fontSize: 10.5 }}>
                                <i className="ti ti-send" /> Pesan
                              </button>
                            </form>
                          )}
                          {po.status === "Dipesan" && (
                            <>
                              <Link
                                href={`/pembelian/${po.id}/terima`}
                                className="btn-acc"
                                style={{ textDecoration: "none", padding: "4px 10px", fontSize: 10.5 }}
                              >
                                <i className="ti ti-package-import" /> Terima Barang
                              </Link>
                              <form action={updatePOStatus}>
                                <input type="hidden" name="id" value={po.id} />
                                <input type="hidden" name="status" value="Batal" />
                                <button type="submit" className="btn-def" style={{ padding: "4px 10px", fontSize: 10.5, color: "#b91c1c" }}>
                                  Batal
                                </button>
                              </form>
                            </>
                          )}
                          {(po.status === "Diterima" || po.status === "Batal") && (
                            <span style={{ fontSize: 10.5, color: "var(--td)" }}>—</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {pos.length === 0 && (
                  <tr>
                    <td colSpan={7} style={{ textAlign: "center", color: "var(--td)", padding: "20px 0", fontSize: 11 }}>
                      Belum ada Purchase Order.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showSupplier && (
        <div className="grid2" style={{ alignItems: "flex-start" }}>
          {/* Supplier list */}
          <div className="crm-sec" style={{ marginBottom: 0 }}>
            <SecHeader num="01" title="DAFTAR SUPPLIER" desc="Supplier terdaftar untuk pembelian." />
            <div style={{ overflowX: "auto" }}>
              <table className="tbl" style={{ minWidth: 360 }}>
                <thead>
                  <tr>
                    <th>Nama</th>
                    <th style={{ width: 100 }}>Kategori</th>
                    <th>Kontak</th>
                    <th>Telp</th>
                    <th style={{ width: 130 }}>NPWP</th>
                    <th style={{ width: 80 }}>Termin</th>
                    <th style={{ width: 160 }}>Rekening</th>
                  </tr>
                </thead>
                <tbody>
                  {suppliers.map((s) => (
                    <tr key={s.id}>
                      <td style={{ fontWeight: 500, fontSize: 11.5 }}>{s.nama}</td>
                      <td style={{ fontSize: 11.5 }}>
                        {one(s.supplier_categories)?.nama ?? <span style={{ color: "var(--td)" }}>—</span>}
                      </td>
                      <td style={{ fontSize: 11.5 }}>{s.kontak ?? <span style={{ color: "var(--td)" }}>—</span>}</td>
                      <td style={{ fontSize: 11.5 }}>{s.telp ?? <span style={{ color: "var(--td)" }}>—</span>}</td>
                      <td style={{ fontSize: 11 }}>{s.npwp ?? <span style={{ color: "var(--td)" }}>—</span>}</td>
                      <td style={{ fontSize: 11 }}>{Number(s.termin_hari ?? 30)} hari</td>
                      <td style={{ fontSize: 10.5, color: "var(--tm)" }}>
                        {s.bank_nama ? `${s.bank_nama} ${s.bank_rekening ?? ""}`.trim() : "—"}
                      </td>
                    </tr>
                  ))}
                  {suppliers.length === 0 && (
                    <tr>
                      <td colSpan={7} style={{ textAlign: "center", color: "var(--td)", padding: "16px 0", fontSize: 11 }}>
                        Belum ada supplier.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Tambah supplier form */}
          <div className="crm-sec" style={{ marginBottom: 0 }}>
            <SecHeader num="02" title="TAMBAH SUPPLIER" desc="Daftarkan supplier baru." />
            <form action={tambahSupplier}>
              <div className="fg" style={{ marginBottom: 10 }}>
                <label className="flab">Nama supplier *</label>
                <input className="fi" name="nama" required placeholder="PT Maju Bersama" />
              </div>
              <div className="fg" style={{ marginBottom: 10 }}>
                <label className="flab">Kategori</label>
                <select className="fi" name="category_id" defaultValue="">
                  <option value="">— tanpa kategori —</option>
                  {supplierCategories.map((k) => <option key={k.id} value={k.id}>{k.nama}</option>)}
                </select>
                <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 3 }}>
                  Daftarnya diatur di <Link href="/pembelian/kategori-pemasok" style={{ color: "#2563eb" }}>Kategori Pemasok</Link>.
                </div>
              </div>
              <div className="fg" style={{ marginBottom: 10 }}>
                <label className="flab">Nama kontak</label>
                <input className="fi" name="kontak" placeholder="Budi Santoso" />
              </div>
              <div className="fg" style={{ marginBottom: 10 }}>
                <label className="flab">Telepon</label>
                <input className="fi" name="telp" placeholder="08xxxxxxxx" />
              </div>
              <div className="fg" style={{ marginBottom: 10 }}>
                <label className="flab">Alamat</label>
                <textarea className="fi" name="alamat" rows={2} placeholder="Jl. ..." style={{ resize: "vertical" }} />
              </div>
              <div className="frow" style={{ marginBottom: 10 }}>
                <div>
                  <label className="flab">NPWP</label>
                  <input className="fi" name="npwp" maxLength={25} placeholder="untuk faktur pajak" />
                </div>
                <div>
                  <label className="flab">Termin (hari)</label>
                  <input className="fi" name="termin_hari" type="number" min={0} defaultValue={30} />
                </div>
              </div>
              <div className="frow" style={{ marginBottom: 12 }}>
                <div>
                  <label className="flab">Bank</label>
                  <input className="fi" name="bank_nama" maxLength={60} placeholder="BCA" />
                </div>
                <div>
                  <label className="flab">No. rekening</label>
                  <input className="fi" name="bank_rekening" maxLength={40} placeholder="1234567890" />
                </div>
                <div>
                  <label className="flab">Atas nama</label>
                  <input className="fi" name="bank_atas_nama" maxLength={100} placeholder="PT Maju Bersama" />
                </div>
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button type="submit" className="btn-acc">
                  <i className="ti ti-plus" /> Simpan supplier
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
