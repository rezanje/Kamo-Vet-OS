import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SecHeader } from "@/components/SecHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { bolehTransaksiKas } from "@/lib/master-guard";
import { sisaFaktur, sisaKirim } from "@/lib/penjualan-dokumen";
import { batalPesanan, buatFakturJual, buatPengiriman } from "../actions";
import { hariIniWIB } from "@/lib/tanggal";

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");
const tgl = (s: string | null) => (s ? new Date(`${s}T00:00:00`).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" }) : "—");

type Rel<T> = T | T[] | null;
const one = <T,>(r: Rel<T>): T | null => (Array.isArray(r) ? (r[0] ?? null) : r);

type Baris = {
  id: string; nama: string; satuan: string | null;
  qty: number; harga: number; qty_kirim: number; qty_faktur: number;
};

const LABEL: Record<string, string> = { draft: "Draft", diproses: "Diproses", selesai: "Selesai", batal: "Batal" };

export default async function DetailPesananPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const supabase = await createClient();
  const boleh = await bolehTransaksiKas();

  const [{ data: so }, { data: kirimData }, { data: fakturData }, { data: gudangData }] = await Promise.all([
    supabase.from("sales_orders")
      .select("id, no_pesanan, tanggal, rencana_kirim, total, status, catatan, warehouse_id, customers(name, phone), branches(name), warehouses(name), sales_order_items(id, nama, satuan, qty, harga, qty_kirim, qty_faktur)")
      .eq("id", id).maybeSingle(),
    supabase.from("sales_deliveries").select("id, no_kirim, tanggal, ekspedisi, no_resi, sales_delivery_items(qty, hpp)").eq("order_id", id).order("tanggal"),
    supabase.from("sales_invoices").select("id, no_faktur, tanggal, jatuh_tempo, total, status").eq("order_id", id).order("tanggal"),
    supabase.from("warehouses").select("id, name").eq("is_active", true).order("name"),
  ]);

  if (!so) notFound();

  const baris = (so.sales_order_items ?? []) as Baris[];
  const spek = baris.map((b) => ({
    ...b,
    sisaKirim: sisaKirim({ id: b.id, qty: Number(b.qty), qtyKirim: Number(b.qty_kirim), qtyFaktur: Number(b.qty_faktur), harga: Number(b.harga) }),
    sisaFaktur: sisaFaktur({ id: b.id, qty: Number(b.qty), qtyKirim: Number(b.qty_kirim), qtyFaktur: Number(b.qty_faktur), harga: Number(b.harga) }),
  }));

  const kiriman = (kirimData ?? []) as unknown as { id: string; no_kirim: string; tanggal: string; ekspedisi: string | null; no_resi: string | null; sales_delivery_items: { qty: number; hpp: number | null }[] | null }[];
  const faktur = (fakturData ?? []) as { id: string; no_faktur: string; tanggal: string; jatuh_tempo: string; total: number; status: string }[];
  const gudang = (gudangData ?? []) as { id: string; name: string }[];

  const bisaKirim = spek.some((b) => b.sisaKirim > 0);
  const bisaFaktur = spek.some((b) => b.sisaFaktur > 0);
  const aktif = so.status !== "batal";
  const today = hariIniWIB();
  const tempo = new Date(`${today}T00:00:00Z`);
  tempo.setUTCDate(tempo.getUTCDate() + 30);
  const tempo30 = tempo.toISOString().slice(0, 10);

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/penjualan/pesanan" className="back-btn"><i className="ti ti-arrow-left" /> Kembali</Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>{so.no_pesanan}</span>
        <span className={`bge ${so.status === "selesai" ? "g" : so.status === "batal" ? "x" : "o"}`}>{LABEL[so.status] ?? so.status}</span>
      </div>

      {sp.error && (
        <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}>
          <i className="ti ti-alert-circle" /> {sp.error}
        </div>
      )}
      {sp.success && (
        <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}>
          <i className="ti ti-circle-check" /> {sp.success}
        </div>
      )}

      <div className="crm-sec">
        <SecHeader num="01" title="ISI PESANAN" desc="Sisa tagih dibatasi barang yang sudah dikirim — bukan yang baru dipesan." />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "3px 18px", fontSize: 11, marginBottom: 12 }}>
          <KV k="Pelanggan" v={one(so.customers as Rel<{ name: string }>)?.name ?? "—"} />
          <KV k="Cabang" v={one(so.branches as Rel<{ name: string }>)?.name ?? "—"} />
          <KV k="Gudang pengirim" v={one(so.warehouses as Rel<{ name: string }>)?.name ?? "tanpa potong stok"} />
          <KV k="Rencana kirim" v={tgl(so.rencana_kirim)} />
          <KV k="Nilai pesanan" v={rp(Number(so.total))} />
          <KV k="Catatan" v={so.catatan ?? "—"} />
        </div>

        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 720 }}>
            <thead>
              <tr>
                <th>Barang</th>
                <th style={{ width: 80, textAlign: "right" }}>Qty</th>
                <th style={{ width: 90, textAlign: "right" }}>Dikirim</th>
                <th style={{ width: 90, textAlign: "right" }}>Ditagih</th>
                <th style={{ width: 120, textAlign: "right" }}>Harga</th>
                <th style={{ width: 130, textAlign: "right" }}>Subtotal</th>
              </tr>
            </thead>
            <tbody>
              {spek.map((b) => (
                <tr key={b.id}>
                  <td style={{ fontSize: 11.5 }}>{b.nama}</td>
                  <td style={{ textAlign: "right", fontSize: 11 }}>{Number(b.qty)} {b.satuan ?? ""}</td>
                  <td style={{ textAlign: "right", fontSize: 11, color: b.sisaKirim > 0 ? "#b45309" : "#15803d" }}>{Number(b.qty_kirim)}</td>
                  <td style={{ textAlign: "right", fontSize: 11, color: b.sisaFaktur > 0 ? "#b45309" : "#15803d" }}>{Number(b.qty_faktur)}</td>
                  <td style={{ textAlign: "right", fontSize: 11 }}>{rp(Number(b.harga))}</td>
                  <td style={{ textAlign: "right", fontSize: 11.5 }}>{rp(Number(b.qty) * Number(b.harga))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {boleh && aktif && (bisaKirim || bisaFaktur) && (
        <div className="crm-sec">
          <SecHeader num="02" title="PROSES" desc="Kirim barangnya dulu, baru bisa ditagih." />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            {bisaKirim && (
              <form action={buatPengiriman}>
                <input type="hidden" name="id" value={id} />
                <div style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 8 }}>Kirim barang</div>
                <table className="tbl" style={{ marginBottom: 8 }}>
                  <thead><tr><th>Barang</th><th style={{ width: 90 }}>Sisa</th><th style={{ width: 110 }}>Kirim</th></tr></thead>
                  <tbody>
                    {spek.filter((b) => b.sisaKirim > 0).map((b) => (
                      <tr key={b.id}>
                        <td style={{ fontSize: 11 }}>{b.nama}</td>
                        <td style={{ fontSize: 11, color: "var(--tm)" }}>{b.sisaKirim}</td>
                        <td>
                          <input className="fi" type="number" name={`qty_${b.id}`} min={0} max={b.sisaKirim}
                            step="any" defaultValue={b.sisaKirim} style={{ width: 90, textAlign: "right" }} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="frow">
                  <div><label className="flab">Tanggal</label><input className="fi" type="date" name="tanggal" defaultValue={today} /></div>
                  <div>
                    <label className="flab">Gudang pengirim</label>
                    <select className="fi" name="warehouse_id" defaultValue={so.warehouse_id ?? ""}>
                      <option value="">— tanpa potong stok —</option>
                      {gudang.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                    </select>
                  </div>
                  <div><label className="flab">Ekspedisi</label><input className="fi" name="ekspedisi" placeholder="opsional" /></div>
                  <div><label className="flab">No. resi</label><input className="fi" name="no_resi" placeholder="opsional" /></div>
                </div>
                <SubmitButton className="btn-def" icon="ti-truck" pendingText="Memproses…">Catat pengiriman</SubmitButton>
              </form>
            )}

            {bisaFaktur && (
              <form action={buatFakturJual}>
                <input type="hidden" name="id" value={id} />
                <div style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 8 }}>Terbitkan faktur</div>
                <table className="tbl" style={{ marginBottom: 8 }}>
                  <thead><tr><th>Barang</th><th style={{ width: 90 }}>Bisa ditagih</th><th style={{ width: 110 }}>Tagih</th></tr></thead>
                  <tbody>
                    {spek.filter((b) => b.sisaFaktur > 0).map((b) => (
                      <tr key={b.id}>
                        <td style={{ fontSize: 11 }}>{b.nama}</td>
                        <td style={{ fontSize: 11, color: "var(--tm)" }}>{b.sisaFaktur}</td>
                        <td>
                          <input className="fi" type="number" name={`qty_${b.id}`} min={0} max={b.sisaFaktur}
                            step="any" defaultValue={b.sisaFaktur} style={{ width: 90, textAlign: "right" }} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="frow">
                  <div><label className="flab">Tanggal faktur</label><input className="fi" type="date" name="tanggal" defaultValue={today} /></div>
                  <div><label className="flab">Jatuh tempo</label><input className="fi" type="date" name="jatuh_tempo" defaultValue={tempo30} /></div>
                  <div><label className="flab">Catatan</label><input className="fi" name="catatan" placeholder="opsional" /></div>
                </div>
                <SubmitButton className="btn-acc" icon="ti-receipt-2" style={{ background: "#16a34a" }} pendingText="Memproses…">
                  Terbitkan faktur
                </SubmitButton>
              </form>
            )}
          </div>
        </div>
      )}

      <div className="crm-sec" style={{ marginBottom: 0 }}>
        <SecHeader num="03" title="DOKUMEN TURUNAN" desc="Pengiriman & faktur yang lahir dari pesanan ini." />

        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 640 }}>
            <thead>
              <tr>
                <th style={{ width: 150 }}>Dokumen</th>
                <th style={{ width: 110 }}>Tanggal</th>
                <th>Keterangan</th>
                <th style={{ width: 140, textAlign: "right" }}>Nilai</th>
              </tr>
            </thead>
            <tbody>
              {kiriman.map((k) => {
                const qty = (k.sales_delivery_items ?? []).reduce((a, x) => a + Number(x.qty), 0);
                const hpp = (k.sales_delivery_items ?? []).reduce((a, x) => a + Number(x.hpp ?? 0), 0);
                return (
                  <tr key={k.id}>
                    <td style={{ fontSize: 11.5, fontWeight: 600 }}>{k.no_kirim}</td>
                    <td style={{ fontSize: 11 }}>{tgl(k.tanggal)}</td>
                    <td style={{ fontSize: 10.5, color: "var(--tm)" }}>
                      {qty} unit dikirim{k.ekspedisi ? ` · ${k.ekspedisi}` : ""}{k.no_resi ? ` · ${k.no_resi}` : ""}
                    </td>
                    <td style={{ textAlign: "right", fontSize: 11 }}>modal {rp(hpp)}</td>
                  </tr>
                );
              })}
              {faktur.map((f) => (
                <tr key={f.id}>
                  <td style={{ fontSize: 11.5, fontWeight: 600 }}>{f.no_faktur}</td>
                  <td style={{ fontSize: 11 }}>{tgl(f.tanggal)}</td>
                  <td style={{ fontSize: 10.5, color: "var(--tm)" }}>
                    jatuh tempo {tgl(f.jatuh_tempo)} · {f.status === "lunas" ? "lunas" : "berjalan"}
                  </td>
                  <td style={{ textAlign: "right", fontSize: 11.5, fontWeight: 600 }}>{rp(Number(f.total))}</td>
                </tr>
              ))}
              {kiriman.length === 0 && faktur.length === 0 && (
                <tr><td colSpan={4} style={{ textAlign: "center", color: "var(--td)", padding: "18px 0", fontSize: 11 }}>
                  Belum ada pengiriman maupun faktur.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>

        {boleh && aktif && !spek.some((b) => Number(b.qty_kirim) > 0) && (
          <form action={batalPesanan} style={{ marginTop: 12 }}>
            <input type="hidden" name="id" value={id} />
            <SubmitButton className="btn-def" style={{ fontSize: 10.5, color: "#b91c1c" }} pendingText="…">
              Batalkan pesanan
            </SubmitButton>
          </form>
        )}
      </div>
    </>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: "flex", gap: 6 }}>
      <span style={{ color: "var(--tm)", minWidth: 130 }}>{k}</span>
      <span style={{ fontWeight: 600 }}>{v}</span>
    </div>
  );
}
