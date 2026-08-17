import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { MasterPage } from "@/components/MasterPage";
import { SecHeader } from "@/components/SecHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { bolehTransaksiKas } from "@/lib/master-guard";
import { BarisJualForm, type ItemJual } from "../BarisJualForm";
import { loadItemUnits } from "@/lib/satuan";
import { buatPenawaran, jadikanPesanan, ubahStatusPenawaran } from "./actions";
import { hariIniWIB } from "@/lib/tanggal";

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");
const tgl = (s: string | null) => (s ? new Date(`${s}T00:00:00`).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" }) : "—");

type Rel<T> = T | T[] | null;
const one = <T,>(r: Rel<T>): T | null => (Array.isArray(r) ? (r[0] ?? null) : r);

const BADGE: Record<string, string> = { draft: "", dikirim: "o", diterima: "g", ditolak: "x" };
const LABEL: Record<string, string> = { draft: "Draft", dikirim: "Dikirim ke pelanggan", diterima: "Diterima", ditolak: "Ditolak" };

type Penawaran = {
  id: string; no_penawaran: string; tanggal: string; berlaku_sampai: string | null;
  total: number; status: string;
  customers: Rel<{ name: string }>;
  sales_orders: { no_pesanan: string }[] | null;
};

export default async function PenawaranPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();
  const boleh = await bolehTransaksiKas();

  const [{ data: docData }, { data: custData }, { data: cabData }, { data: itemData }] = await Promise.all([
    supabase.from("sales_quotations")
      .select("id, no_penawaran, tanggal, berlaku_sampai, total, status, customers(name), sales_orders(no_pesanan)")
      .order("tanggal", { ascending: false }).order("created_at", { ascending: false }).limit(200),
    supabase.from("customers").select("id, name, phone").order("name").limit(500),
    supabase.from("branches").select("id, name").eq("is_active", true).order("name"),
    supabase.from("items").select("id, code, name, unit, sell_price").eq("is_active", true).order("name"),
  ]);

  const dok = (docData ?? []) as unknown as Penawaran[];
  const pelanggan = (custData ?? []) as { id: string; name: string; phone: string }[];
  const cabang = (cabData ?? []) as { id: string; name: string }[];
  // Satuan turunan ikut dikirim supaya baris pesanan bisa memilih dus/box, bukan
  // cuma satuan dasar (permintaan Bu Nisa, meeting 14 Agustus).
  const unitMap = await loadItemUnits(supabase);
  const items = ((itemData ?? []) as ItemJual[]).map((it) => ({ ...it, units: unitMap.get(it.id) ?? [] }));

  return (
    <MasterPage
      back="/penjualan" icon="ti-file-text" title="PENAWARAN PENJUALAN"
      desc="Harga yang ditawarkan ke pelanggan sebelum jadi pesanan"
      error={sp.error} success={sp.success} successMsg={sp.success ?? "Tersimpan."}
      bolehKelola={boleh}
      readOnlyNote="Kamu belum punya hak membuat penawaran."
    >
      {boleh && (
        <div className="crm-sec">
          <SecHeader num="01" title="BUAT PENAWARAN" desc="Belum menyentuh stok maupun jurnal — ini baru tawaran harga." />
          <form action={buatPenawaran}>
            <div className="frow">
              <div>
                <label className="flab">Pelanggan *</label>
                <select className="fi" name="customer_id" defaultValue="" required>
                  <option value="">— pilih pelanggan —</option>
                  {pelanggan.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.phone}</option>)}
                </select>
              </div>
              <div>
                <label className="flab">Cabang</label>
                <select className="fi" name="branch_id" defaultValue="">
                  <option value="">— tanpa cabang —</option>
                  {cabang.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
              <div>
                <label className="flab">Tanggal</label>
                <input className="fi" type="date" name="tanggal" defaultValue={hariIniWIB()} />
              </div>
              <div>
                <label className="flab">Berlaku sampai</label>
                <input className="fi" type="date" name="berlaku_sampai" />
              </div>
              <div>
                <label className="flab">Catatan</label>
                <input className="fi" name="catatan" placeholder="opsional" />
              </div>
            </div>

            <BarisJualForm items={items} listId="sq-items" />

            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
              <SubmitButton className="btn-acc" icon="ti-plus" pendingText="Menyimpan…" style={{ background: "#2563eb" }}>
                Simpan penawaran
              </SubmitButton>
            </div>
          </form>
        </div>
      )}

      <div className="crm-sec" style={{ marginBottom: 0 }}>
        <SecHeader num={boleh ? "02" : "01"} title="DAFTAR PENAWARAN" desc="Penawaran yang diterima pelanggan bisa langsung dijadikan pesanan." />

        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 880 }}>
            <thead>
              <tr>
                <th style={{ width: 150 }}>No. penawaran</th>
                <th style={{ width: 110 }}>Tanggal</th>
                <th>Pelanggan</th>
                <th style={{ width: 110 }}>Berlaku</th>
                <th style={{ width: 140, textAlign: "right" }}>Nilai</th>
                <th style={{ width: 150 }}>Status</th>
                {boleh && <th style={{ width: 250 }}>Aksi</th>}
              </tr>
            </thead>
            <tbody>
              {dok.map((d) => {
                const so = (d.sales_orders ?? [])[0];
                return (
                  <tr key={d.id}>
                    <td style={{ fontSize: 11.5, fontWeight: 600 }}>{d.no_penawaran}</td>
                    <td style={{ fontSize: 11 }}>{tgl(d.tanggal)}</td>
                    <td style={{ fontSize: 11.5 }}>{one(d.customers)?.name ?? "—"}</td>
                    <td style={{ fontSize: 11, color: "var(--tm)" }}>{tgl(d.berlaku_sampai)}</td>
                    <td style={{ textAlign: "right", fontSize: 11.5, fontWeight: 600 }}>{rp(Number(d.total))}</td>
                    <td style={{ fontSize: 10.5 }}>
                      <span className={`bge ${BADGE[d.status] ?? ""}`}>{LABEL[d.status] ?? d.status}</span>
                      {so && <div style={{ fontSize: 9.5, color: "var(--td)" }}>→ {so.no_pesanan}</div>}
                    </td>
                    {boleh && (
                      <td>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          {d.status === "draft" && (
                            <form action={ubahStatusPenawaran}>
                              <input type="hidden" name="id" value={d.id} />
                              <input type="hidden" name="status" value="dikirim" />
                              <SubmitButton className="btn-def" style={{ padding: "3px 9px", fontSize: 10.5 }} pendingText="…">
                                Tandai dikirim
                              </SubmitButton>
                            </form>
                          )}
                          {!so && d.status !== "ditolak" && (
                            <form action={jadikanPesanan}>
                              <input type="hidden" name="id" value={d.id} />
                              <SubmitButton className="btn-acc" style={{ padding: "3px 9px", fontSize: 10.5, background: "#16a34a" }} pendingText="…">
                                Jadikan pesanan
                              </SubmitButton>
                            </form>
                          )}
                          {d.status !== "ditolak" && !so && (
                            <form action={ubahStatusPenawaran}>
                              <input type="hidden" name="id" value={d.id} />
                              <input type="hidden" name="status" value="ditolak" />
                              <SubmitButton className="btn-def" style={{ padding: "3px 9px", fontSize: 10.5, color: "#b91c1c" }} pendingText="…">
                                Ditolak
                              </SubmitButton>
                            </form>
                          )}
                          {so && (
                            <Link href="/penjualan/pesanan" className="btn-def" style={{ padding: "3px 9px", fontSize: 10.5, textDecoration: "none" }}>
                              Lihat pesanan
                            </Link>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
              {dok.length === 0 && (
                <tr><td colSpan={boleh ? 7 : 6} style={{ textAlign: "center", color: "var(--td)", padding: "18px 0", fontSize: 11 }}>
                  Belum ada penawaran.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </MasterPage>
  );
}
