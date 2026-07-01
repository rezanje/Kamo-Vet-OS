import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SecHeader } from "@/components/SecHeader";
import { updatePOStatus, tambahSupplier } from "./actions";

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
};

type Supplier = {
  id: string;
  nama: string;
  kontak: string | null;
  telp: string | null;
};

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });

export default async function PembelianPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; success_sup?: string; error?: string; tab?: string }>;
}) {
  const { success, success_sup, error, tab } = await searchParams;
  const supabase = await createClient();

  const [{ data: poData }, { data: supData }] = await Promise.all([
    supabase
      .from("purchase_orders")
      .select("id, no_po, tanggal, status, total, suppliers(nama), warehouses(name)")
      .order("created_at", { ascending: false }),
    supabase.from("suppliers").select("id, nama, kontak, telp").order("nama"),
  ]);

  const pos = (poData ?? []) as unknown as PO[];
  const suppliers = (supData ?? []) as unknown as Supplier[];
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
      {error && (
        <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}>
          <i className="ti ti-alert-circle" /> {error}
        </div>
      )}

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
                  return (
                    <tr key={po.id}>
                      <td style={{ fontWeight: 500, fontSize: 11.5 }}>{po.no_po ?? "—"}</td>
                      <td style={{ fontSize: 11, color: "var(--tm)" }}>{fmtDate(po.tanggal)}</td>
                      <td style={{ fontSize: 11.5 }}>{sup?.nama ?? <span style={{ color: "var(--td)" }}>—</span>}</td>
                      <td style={{ fontSize: 11.5 }}>{wh?.name ?? <span style={{ color: "var(--td)" }}>—</span>}</td>
                      <td style={{ textAlign: "right", fontSize: 11.5 }}>{rp(po.total)}</td>
                      <td>
                        <span className={`bge ${STATUS_BADGE[po.status] ?? "x"}`}>{po.status}</span>
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
                              <form action={updatePOStatus}>
                                <input type="hidden" name="id" value={po.id} />
                                <input type="hidden" name="status" value="Diterima" />
                                <button type="submit" className="btn-acc" style={{ padding: "4px 10px", fontSize: 10.5 }}>
                                  <i className="ti ti-package-import" /> Terima Barang
                                </button>
                              </form>
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
                    <th>Kontak</th>
                    <th>Telp</th>
                  </tr>
                </thead>
                <tbody>
                  {suppliers.map((s) => (
                    <tr key={s.id}>
                      <td style={{ fontWeight: 500, fontSize: 11.5 }}>{s.nama}</td>
                      <td style={{ fontSize: 11.5 }}>{s.kontak ?? <span style={{ color: "var(--td)" }}>—</span>}</td>
                      <td style={{ fontSize: 11.5 }}>{s.telp ?? <span style={{ color: "var(--td)" }}>—</span>}</td>
                    </tr>
                  ))}
                  {suppliers.length === 0 && (
                    <tr>
                      <td colSpan={3} style={{ textAlign: "center", color: "var(--td)", padding: "16px 0", fontSize: 11 }}>
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
                <label className="flab">Nama kontak</label>
                <input className="fi" name="kontak" placeholder="Budi Santoso" />
              </div>
              <div className="fg" style={{ marginBottom: 10 }}>
                <label className="flab">Telepon</label>
                <input className="fi" name="telp" placeholder="08xxxxxxxx" />
              </div>
              <div className="fg" style={{ marginBottom: 12 }}>
                <label className="flab">Alamat</label>
                <textarea className="fi" name="alamat" rows={2} placeholder="Jl. ..." style={{ resize: "vertical" }} />
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
