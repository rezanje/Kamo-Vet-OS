import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SecHeader } from "@/components/SecHeader";
import { AGING_BUCKETS, AGING_LABEL, agingBucket, agingDays, type AgingBucket } from "@/lib/aging";
import { sisaFakturable } from "@/lib/faktur-beli";
import { qtyDiterima } from "@/lib/penerimaan";
import { PilihRekening, loadRekeningAktif } from "@/components/PilihRekening";
import { NoDok } from "@/components/NoDok";
import { bayarFaktur } from "../../pembelian/faktur/actions";
import { hariIniWIB } from "@/lib/tanggal";

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");
const fmtDate = (s: string) => (s ? new Date(s + "T00:00:00").toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta", day: "2-digit", month: "short", year: "numeric" }) : "—");

type FakturRow = {
  id: string; no_faktur: string; no_faktur_pemasok: string | null; po_no: string | null; po_id: string | null;
  tanggal: string; jatuh_tempo: string; supplier: string; supplier_id: string | null;
  total: number; dibayar: number; retur: number; sisa: number; days: number; bucket: AgingBucket;
};

type UangMukaSiap = { id: string; no_um: string; sisa: number };

type PoBelum = { id: string; no_po: string | null; supplier: string; tanggal: string; nilai: number };

export default async function HutangPage({ searchParams }: { searchParams: Promise<{ success?: string; error?: string }> }) {
  const { success, error } = await searchParams;
  const supabase = await createClient();
  const today = hariIniWIB();
  const rekening = await loadRekeningAktif(supabase);

  // Hutang usaha (2101) lahir dari Faktur Pembelian; umur dihitung dari JATUH TEMPO (ala Accurate).
  const [{ data: invs }, { data: pos }, { data: rets }] = await Promise.all([
    supabase
      .from("purchase_invoices")
      .select("id, no_faktur, no_faktur_pemasok, tanggal, jatuh_tempo, total, po_id, supplier_id, suppliers(nama), purchase_orders(no_po), purchase_invoice_payments(amount)")
      .order("jatuh_tempo"),
    supabase
      .from("purchase_orders")
      .select("id, no_po, tanggal, total, suppliers(nama), purchase_order_items(item_id, qty, qty_terima, harga_beli)")
      .eq("status", "Diterima"),
    supabase.from("purchase_returns").select("po_id, total"),
  ]);

  // retur pembelian per PO = pengurang hutang pemasok (dialokasikan ke faktur PO yang sama)
  const returSisa = new Map<string, number>();
  for (const r of rets ?? []) returSisa.set(r.po_id, (returSisa.get(r.po_id) ?? 0) + Number(r.total));

  const rows: FakturRow[] = ((invs ?? []) as unknown as {
    id: string; no_faktur: string; no_faktur_pemasok: string | null; tanggal: string; jatuh_tempo: string;
    total: number; po_id: string; supplier_id: string | null; suppliers: { nama: string } | null;
    purchase_orders: { no_po: string | null } | null; purchase_invoice_payments: { amount: number }[] | null;
  }[])
    .map((v) => {
      const dibayar = (v.purchase_invoice_payments ?? []).reduce((a, p) => a + Number(p.amount), 0);
      let sisa = Math.max(0, Number(v.total) - dibayar);
      // alokasikan retur PO ke faktur ini (berurutan jatuh tempo)
      const retAvail = returSisa.get(v.po_id) ?? 0;
      const retur = Math.min(retAvail, sisa);
      if (retur > 0) returSisa.set(v.po_id, retAvail - retur);
      sisa -= retur;
      return {
        id: v.id, no_faktur: v.no_faktur, no_faktur_pemasok: v.no_faktur_pemasok,
        po_no: v.purchase_orders?.no_po ?? null, po_id: v.po_id ?? null,
        tanggal: v.tanggal, jatuh_tempo: v.jatuh_tempo,
        supplier: v.suppliers?.nama ?? "—", supplier_id: v.supplier_id,
        total: Number(v.total), dibayar, retur, sisa,
        days: agingDays(v.jatuh_tempo, today), bucket: agingBucket(v.jatuh_tempo, today),
      };
    })
    .filter((r) => r.sisa > 0);

  // Uang muka aktif per pemasok — ditawarkan di form bayar supaya DP yang sudah
  // dikeluarkan tidak terlupa dan dibayar dua kali.
  const { data: umData } = await supabase
    .from("purchase_advances").select("id, no_um, supplier_id, jumlah, terpakai").eq("status", "aktif");
  const umPerSupplier = new Map<string, UangMukaSiap[]>();
  for (const u of (umData ?? []) as { id: string; no_um: string; supplier_id: string | null; jumlah: number; terpakai: number }[]) {
    const sisa = Number(u.jumlah) - Number(u.terpakai);
    if (!u.supplier_id || sisa <= 0) continue;
    const arr = umPerSupplier.get(u.supplier_id) ?? [];
    arr.push({ id: u.id, no_um: u.no_um, sisa });
    umPerSupplier.set(u.supplier_id, arr);
  }

  const totalSisa = rows.reduce((a, r) => a + r.sisa, 0);
  const perBucket = Object.fromEntries(
    AGING_BUCKETS.map((b) => [b, rows.filter((r) => r.bucket === b).reduce((a, r) => a + r.sisa, 0)]),
  ) as Record<AgingBucket, number>;

  // PO Diterima yang belum difakturkan penuh (saldo 2102 berjalan, nilai ~ sisa qty x harga PO)
  const invoicedByPo: Record<string, Record<string, number>> = {};
  {
    const { data: invItems } = await supabase
      .from("purchase_invoices").select("po_id, purchase_invoice_items(item_id, qty)");
    for (const d of (invItems ?? []) as unknown as { po_id: string; purchase_invoice_items: { item_id: string | null; qty: number }[] | null }[]) {
      const m = (invoicedByPo[d.po_id] ??= {});
      for (const r of d.purchase_invoice_items ?? [])
        if (r.item_id) m[r.item_id] = (m[r.item_id] ?? 0) + Number(r.qty);
    }
  }
  const belumFaktur: PoBelum[] = ((pos ?? []) as unknown as {
    id: string; no_po: string | null; tanggal: string; total: number; suppliers: { nama: string } | null;
    purchase_order_items: { item_id: string | null; qty: number; qty_terima: number | null; harga_beli: number }[] | null;
  }[])
    .map((p) => {
      const qtyPO: Record<string, number> = {};
      const harga: Record<string, number> = {};
      // saldo GRNI 2102 = barang yang diterima & belum difakturkan
      for (const r of p.purchase_order_items ?? []) {
        if (!r.item_id) continue;
        qtyPO[r.item_id] = (qtyPO[r.item_id] ?? 0) + qtyDiterima(r);
        harga[r.item_id] = Number(r.harga_beli) || 0;
      }
      const sisa = sisaFakturable(qtyPO, invoicedByPo[p.id] ?? {});
      const nilai = Object.entries(sisa).reduce((a, [itemId, q]) => a + q * (harga[itemId] ?? 0), 0);
      return { id: p.id, no_po: p.no_po, supplier: p.suppliers?.nama ?? "—", tanggal: p.tanggal, nilai };
    })
    .filter((p) => p.nilai > 0);
  const totalBelumFaktur = belumFaktur.reduce((a, p) => a + p.nilai, 0);

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/keuangan" className="back-btn"><i className="ti ti-arrow-left" /> Kembali</Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Hutang Usaha (AP)</span>
        <Link href="/keuangan/hutang/pembantu" className="back-btn" style={{ marginLeft: "auto" }}>
          <i className="ti ti-book-2" /> Buku Besar Pembantu
        </Link>
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

      <div className="crm-sec">
        <SecHeader num="01" title="UMUR HUTANG (AP AGING)" desc="Faktur pembelian belum lunas, dikelompokkan menurut umur JATUH TEMPO (pola Accurate)." />
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${AGING_BUCKETS.length + 1}, 1fr)`, gap: 8 }}>
          {AGING_BUCKETS.map((b) => (
            <div key={b} style={{ padding: "10px 12px", borderRadius: 8, border: ".5px solid var(--bd)" }}>
              <div style={{ fontSize: 9.5, color: "var(--tm)" }}>{AGING_LABEL[b]}</div>
              <div style={{ fontSize: 12, fontWeight: 700, marginTop: 2 }}>{rp(perBucket[b])}</div>
            </div>
          ))}
          <div style={{ padding: "10px 12px", borderRadius: 8, background: "#fef2f2", border: ".5px solid #fca5a5" }}>
            <div style={{ fontSize: 9.5, color: "#b91c1c", fontWeight: 700 }}>TOTAL HUTANG</div>
            <div style={{ fontSize: 13, fontWeight: 800, marginTop: 2, color: "#dc2626" }}>{rp(totalSisa)}</div>
          </div>
        </div>
      </div>

      <div className="crm-sec">
        <SecHeader num="02" title="DAFTAR FAKTUR & PEMBAYARAN" desc="Bayar hutang per faktur pemasok — jurnal hutang & kas otomatis." />
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 900 }}>
            <thead>
              <tr>
                <th>Faktur</th>
                <th>PO</th>
                <th>Pemasok</th>
                <th>Jatuh Tempo</th>
                <th style={{ textAlign: "right" }}>Total</th>
                <th style={{ textAlign: "right" }}>Dibayar+Retur</th>
                <th style={{ textAlign: "right" }}>Sisa</th>
                <th>Umur</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  {/* Nomor faktur & PO bisa diklik ke dokumen pembelian aslinya
                      (permintaan Bu Nisa, meeting 14 Agustus). */}
                  <td style={{ fontWeight: 500, fontSize: 11.5 }}>
                    <NoDok nomor={r.no_faktur} />
                    {r.no_faktur_pemasok && <div style={{ fontSize: 9.5, color: "var(--td)" }}>{r.no_faktur_pemasok}</div>}
                  </td>
                  <td style={{ fontSize: 11 }}>
                    {r.po_id
                      ? <Link href={`/pembelian/${r.po_id}`} style={{ color: "#2563eb", textDecoration: "none" }}>{r.po_no ?? "Lihat PO"}</Link>
                      : (r.po_no ?? "—")}
                  </td>
                  <td style={{ fontSize: 11.5 }}>{r.supplier}</td>
                  <td style={{ fontSize: 11, color: r.days > 0 ? "#b91c1c" : "var(--tm)", fontWeight: r.days > 0 ? 700 : 400 }}>
                    {fmtDate(r.jatuh_tempo)}
                  </td>
                  <td style={{ textAlign: "right", fontSize: 11 }}>{rp(r.total)}</td>
                  <td style={{ textAlign: "right", fontSize: 11, color: "var(--tm)" }}>{rp(r.dibayar + r.retur)}</td>
                  <td style={{ textAlign: "right", fontSize: 11, fontWeight: 600 }}>{rp(r.sisa)}</td>
                  <td><span className={`bge ${r.bucket === "current" ? "g" : r.bucket === "d1_30" ? "o" : "r"}`}>{AGING_LABEL[r.bucket]}</span></td>
                  <td>
                    <details>
                      <summary className="btn-acc" style={{ padding: "4px 10px", fontSize: 10.5, cursor: "pointer", listStyle: "none", display: "inline-block" }}>
                        Bayar
                      </summary>
                      <form action={bayarFaktur} style={{ display: "flex", gap: 6, alignItems: "flex-end", padding: "8px 0", flexWrap: "wrap" }}>
                        <input type="hidden" name="invoice_id" value={r.id} />
                        <div>
                          <label className="flab">Nominal (maks {rp(r.sisa)})</label>
                          <input className="fi" type="number" name="amount" min={1} max={r.sisa} step="any" defaultValue={r.sisa} style={{ width: 140 }} />
                        </div>
                        <div>
                          <label className="flab">Metode</label>
                          <select className="fi" name="metode" defaultValue="Transfer" style={{ width: 110 }}>
                            <option>Transfer</option>
                            <option>Tunai</option>
                            <option>Debit</option>
                          </select>
                        </div>
                        <PilihRekening rekening={rekening} width={150} />
                        {(umPerSupplier.get(r.supplier_id ?? "") ?? []).length > 0 && (
                          <div>
                            <label className="flab">Potong uang muka</label>
                            <select className="fi" name="advance_id" defaultValue="" style={{ width: 190 }}>
                              <option value="">— tidak pakai —</option>
                              {(umPerSupplier.get(r.supplier_id ?? "") ?? []).map((u) => (
                                <option key={u.id} value={u.id}>{u.no_um} · sisa {rp(u.sisa)}</option>
                              ))}
                            </select>
                          </div>
                        )}
                        <div>
                          <label className="flab">Tanggal</label>
                          <input className="fi" type="date" name="tanggal" defaultValue={today} style={{ width: 140 }} />
                        </div>
                        <button type="submit" className="btn-acc" style={{ padding: "7px 12px", fontSize: 11 }}>
                          <i className="ti ti-cash" /> Simpan
                        </button>
                      </form>
                    </details>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={9} style={{ textAlign: "center", color: "var(--td)", padding: "20px 0", fontSize: 11 }}>
                    Tidak ada faktur dengan hutang berjalan. 🎉
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="crm-sec">
        <SecHeader
          num="03"
          title="BARANG DITERIMA BELUM DIFAKTURKAN"
          desc={`Saldo akun 2102 berjalan — PO Diterima yang belum dibuatkan faktur pemasok. Total ± ${rp(totalBelumFaktur)}.`}
          action={
            <Link href="/pembelian/faktur/baru" className="btn-def" style={{ textDecoration: "none", fontSize: 10.5 }}>
              + Buat faktur
            </Link>
          }
        />
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 560 }}>
            <thead>
              <tr><th>No. PO</th><th>Tanggal</th><th>Pemasok</th><th style={{ textAlign: "right" }}>Nilai Belum Difakturkan</th></tr>
            </thead>
            <tbody>
              {belumFaktur.map((p) => (
                <tr key={p.id}>
                  <td style={{ fontSize: 11.5, fontWeight: 500 }}>
                    <Link href={`/pembelian/${p.id}`} style={{ color: "#2563eb", textDecoration: "none" }}>
                      {p.no_po ?? "Lihat PO"}
                    </Link>
                  </td>
                  <td style={{ fontSize: 11, color: "var(--tm)" }}>{fmtDate(p.tanggal)}</td>
                  <td style={{ fontSize: 11.5 }}>{p.supplier}</td>
                  <td style={{ textAlign: "right", fontSize: 11.5, fontWeight: 600 }}>{rp(p.nilai)}</td>
                </tr>
              ))}
              {belumFaktur.length === 0 && (
                <tr>
                  <td colSpan={4} style={{ textAlign: "center", color: "var(--td)", padding: "16px 0", fontSize: 11 }}>
                    Semua PO Diterima sudah difakturkan.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
