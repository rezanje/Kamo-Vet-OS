import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SubmitButton } from "@/components/SubmitButton";
import { susunKartuStok, labelSource, type Mutasi } from "@/lib/kartu-stok";

type Rel<T> = T | T[] | null;
function one<T>(r: Rel<T>): T | null {
  return Array.isArray(r) ? (r[0] ?? null) : r;
}

// Tanggal WIB (server Vercel jalan di UTC) — samakan dengan halaman lain.
function todayWib() {
  return new Date(new Date().getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10);
}
function awalBulanWib() {
  return todayWib().slice(0, 8) + "01";
}

type MoveRow = {
  tanggal: string; qty: number; unit_cost: number; source: string; source_ref: string | null;
  warehouse_id: string; warehouses: Rel<{ code: string; name: string }>;
};

export default async function KartuStokPage({
  searchParams,
}: {
  searchParams: Promise<{ item?: string; gudang?: string; dari?: string; sampai?: string }>;
}) {
  const sp = await searchParams;
  const dari = sp.dari || awalBulanWib();
  const sampai = sp.sampai || todayWib();
  const supabase = await createClient();

  const [{ data: itemRows }, { data: whRows }] = await Promise.all([
    supabase.from("items").select("id, code, name, unit").eq("item_type", "Persediaan").eq("is_active", true).order("name"),
    supabase.from("warehouses").select("id, code, name").eq("is_active", true).order("code"),
  ]);
  const items = (itemRows ?? []) as { id: string; code: string; name: string; unit: string }[];
  const gudangs = (whRows ?? []) as { id: string; code: string; name: string }[];

  const itemId = items.some((i) => i.id === sp.item) ? sp.item! : "";
  const gudangId = gudangs.some((w) => w.id === sp.gudang) ? sp.gudang! : "";
  const item = items.find((i) => i.id === itemId) ?? null;

  let saldoAwal = 0;
  let baris: ReturnType<typeof susunKartuStok> = [];
  let perGudang: { nama: string; saldo: number }[] = [];

  if (itemId) {
    // Saldo awal = akumulasi semua mutasi SEBELUM tanggal mulai. Dihitung, bukan
    // disimpan, supaya rentang tanggal apa pun tetap nyambung dengan riwayatnya.
    let qAwal = supabase.from("stock_moves").select("qty").eq("item_id", itemId).lt("tanggal", dari);
    if (gudangId) qAwal = qAwal.eq("warehouse_id", gudangId);
    const { data: awal } = await qAwal;
    saldoAwal = (awal ?? []).reduce((a: number, r: { qty: number }) => a + Number(r.qty), 0);

    let qMoves = supabase
      .from("stock_moves")
      .select("tanggal, qty, unit_cost, source, source_ref, warehouse_id, warehouses(code, name)")
      .eq("item_id", itemId).gte("tanggal", dari).lte("tanggal", sampai)
      .order("tanggal", { ascending: true }).order("created_at", { ascending: true });
    if (gudangId) qMoves = qMoves.eq("warehouse_id", gudangId);
    const { data: moves } = await qMoves;

    const mutasi: Mutasi[] = ((moves ?? []) as unknown as MoveRow[]).map((m) => ({
      tanggal: m.tanggal, qty: Number(m.qty), unit_cost: Number(m.unit_cost),
      source: m.source, source_ref: m.source_ref,
      gudang: one(m.warehouses)?.code ?? "—",
    }));
    baris = susunKartuStok(saldoAwal, mutasi);

    // Saldo per gudang PER TANGGAL `sampai` — dihitung dari mutasi, bukan dari
    // tabel stock, supaya bisa melihat posisi stok di tanggal yang sudah lewat.
    const { data: sampaiRows } = await supabase
      .from("stock_moves").select("qty, warehouses(code, name)")
      .eq("item_id", itemId).lte("tanggal", sampai);
    const acc = new Map<string, number>();
    for (const r of (sampaiRows ?? []) as unknown as { qty: number; warehouses: Rel<{ code: string; name: string }> }[]) {
      const w = one(r.warehouses);
      const nama = w ? `${w.code}` : "—";
      acc.set(nama, (acc.get(nama) ?? 0) + Number(r.qty));
    }
    perGudang = [...acc.entries()].map(([nama, saldo]) => ({ nama, saldo })).sort((a, b) => a.nama.localeCompare(b.nama));
  }

  const saldoAkhir = baris.length ? baris[baris.length - 1].saldo : saldoAwal;
  const totalMasuk = baris.reduce((a, r) => a + r.masuk, 0);
  const totalKeluar = baris.reduce((a, r) => a + r.keluar, 0);
  const sat = item?.unit ?? "";

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/pos" className="back-btn"><i className="ti ti-arrow-left" /> Kembali</Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Kartu Stok</span>
      </div>

      <form className="crm-sec" style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 240 }}>
            <label className="flab">Barang *</label>
            <select className="fi" name="item" defaultValue={itemId}>
              <option value="">— pilih barang —</option>
              {items.map((i) => <option key={i.id} value={i.id}>{i.code} — {i.name}</option>)}
            </select>
          </div>
          <div style={{ minWidth: 170 }}>
            <label className="flab">Gudang</label>
            <select className="fi" name="gudang" defaultValue={gudangId}>
              <option value="">Semua gudang</option>
              {gudangs.map((w) => <option key={w.id} value={w.id}>{w.code} — {w.name}</option>)}
            </select>
          </div>
          <div style={{ width: 140 }}>
            <label className="flab">Dari</label>
            <input className="fi" type="date" name="dari" defaultValue={dari} />
          </div>
          <div style={{ width: 140 }}>
            <label className="flab">Sampai</label>
            <input className="fi" type="date" name="sampai" defaultValue={sampai} />
          </div>
          <SubmitButton className="btn-def" icon="ti-refresh" pendingText="Memuat…">Tampilkan</SubmitButton>
        </div>
      </form>

      {!itemId ? (
        <div className="crm-sec" style={{ textAlign: "center", color: "var(--td)", fontSize: 11, padding: "26px 0" }}>
          Pilih barang dulu untuk melihat riwayat masuk-keluarnya.
        </div>
      ) : (
        <>
          <div className="crm-sec" style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 9 }}>
              <i className="ti ti-history" /> {item?.code} — {item?.name}
              <span style={{ fontSize: 10.5, fontWeight: 400, color: "var(--tm)" }}> · satuan {sat}</span>
            </div>
            <div style={{ display: "flex", gap: 18, flexWrap: "wrap", fontSize: 11 }}>
              <Angka label="Saldo awal" nilai={saldoAwal} sat={sat} />
              <Angka label="Masuk" nilai={totalMasuk} sat={sat} warna="#15803d" />
              <Angka label="Keluar" nilai={totalKeluar} sat={sat} warna="#b91c1c" />
              <Angka label="Saldo akhir" nilai={saldoAkhir} sat={sat} tebal />
            </div>
          </div>

          <div className="crm-sec" style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>
              <i className="ti ti-building-warehouse" /> Saldo per gudang per {sampai}
            </div>
            <div style={{ overflowX: "auto" }}>
              <table className="tbl" style={{ minWidth: 320 }}>
                <thead><tr><th>Gudang</th><th style={{ width: 120, textAlign: "right" }}>Saldo</th></tr></thead>
                <tbody>
                  {perGudang.map((g) => (
                    <tr key={g.nama}>
                      <td style={{ fontSize: 11 }}>{g.nama}</td>
                      <td style={{ textAlign: "right", fontSize: 11, fontWeight: 600 }}>
                        {g.saldo.toLocaleString("id-ID")}
                      </td>
                    </tr>
                  ))}
                  {perGudang.length === 0 && (
                    <tr><td colSpan={2} style={{ textAlign: "center", color: "var(--td)", padding: "14px 0", fontSize: 11 }}>
                      Belum ada mutasi barang ini.
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="crm-sec" style={{ marginBottom: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>
              <i className="ti ti-list-details" /> Mutasi {dari} s/d {sampai}
            </div>
            <div style={{ overflowX: "auto" }}>
              <table className="tbl" style={{ minWidth: 760 }}>
                <thead>
                  <tr>
                    <th style={{ width: 92 }}>Tanggal</th>
                    <th style={{ width: 150 }}>No. Sumber</th>
                    <th>Tipe Transaksi</th>
                    <th style={{ width: 80 }}>Gudang</th>
                    <th style={{ width: 100, textAlign: "right" }}>Nilai Satuan</th>
                    <th style={{ width: 80, textAlign: "right" }}>Masuk</th>
                    <th style={{ width: 80, textAlign: "right" }}>Keluar</th>
                    <th style={{ width: 90, textAlign: "right" }}>Saldo</th>
                  </tr>
                </thead>
                <tbody>
                  <tr style={{ background: "var(--bg2, #f9fafb)" }}>
                    <td style={{ fontSize: 10.5 }}>{dari}</td>
                    <td />
                    <td style={{ fontSize: 11, fontWeight: 600 }}>Saldo per {dari}</td>
                    <td colSpan={4} />
                    <td style={{ textAlign: "right", fontSize: 11, fontWeight: 700 }}>{saldoAwal.toLocaleString("id-ID")}</td>
                  </tr>
                  {baris.map((r, i) => (
                    <tr key={i}>
                      <td style={{ fontSize: 10.5 }}>{r.tanggal}</td>
                      <td style={{ fontSize: 10.5, fontFamily: "var(--mono, monospace)", color: "var(--tm)" }}>{r.source_ref ?? "—"}</td>
                      <td style={{ fontSize: 11 }}>{labelSource(r.source)}</td>
                      <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{r.gudang}</td>
                      <td style={{ textAlign: "right", fontSize: 10.5, color: "var(--tm)" }}>
                        {r.unit_cost ? Math.round(r.unit_cost).toLocaleString("id-ID") : "—"}
                      </td>
                      <td style={{ textAlign: "right", fontSize: 11, color: r.masuk ? "#15803d" : "var(--td)" }}>
                        {r.masuk ? r.masuk.toLocaleString("id-ID") : "·"}
                      </td>
                      <td style={{ textAlign: "right", fontSize: 11, color: r.keluar ? "#b91c1c" : "var(--td)" }}>
                        {r.keluar ? r.keluar.toLocaleString("id-ID") : "·"}
                      </td>
                      <td style={{ textAlign: "right", fontSize: 11, fontWeight: 700 }}>{r.saldo.toLocaleString("id-ID")}</td>
                    </tr>
                  ))}
                  {baris.length === 0 && (
                    <tr><td colSpan={8} style={{ textAlign: "center", color: "var(--td)", padding: "18px 0", fontSize: 11 }}>
                      Tidak ada mutasi di rentang tanggal ini.
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 7 }}>
              Riwayat mulai tercatat sejak fitur kartu stok aktif; stok yang sudah ada sebelumnya masuk sebagai baris
              &ldquo;Saldo Awal&rdquo;. Semua angka dalam satuan {sat || "dasar"}.
            </div>
          </div>
        </>
      )}
    </>
  );
}

function Angka({ label, nilai, sat, warna, tebal }: { label: string; nilai: number; sat: string; warna?: string; tebal?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 9.5, color: "var(--td)" }}>{label}</div>
      <div style={{ fontSize: tebal ? 15 : 13, fontWeight: tebal ? 800 : 700, color: warna }}>
        {nilai.toLocaleString("id-ID")} <span style={{ fontSize: 9.5, fontWeight: 400, color: "var(--td)" }}>{sat}</span>
      </div>
    </div>
  );
}
