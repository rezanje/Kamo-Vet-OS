import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { MasterPage } from "@/components/MasterPage";
import { bolehKelolaMaster } from "@/lib/master-guard";
import { SubmitButton } from "@/components/SubmitButton";
import { loadItemUnits, unitOptions } from "@/lib/satuan";
import { loadHargaCabang } from "@/lib/harga-cabang";
import { simpanHargaJual } from "./actions";

// Daftar barang sengaja dibatasi + ada pencarian: satu cabang bisa punya ribuan
// SKU, dan form harga yang memuat semuanya bikin halaman berat & rawan salah simpan.
const LIMIT = 150;

type ItemRow = { id: string; code: string; name: string; unit: string; sell_price: number };

export default async function HargaJualPage({
  searchParams,
}: {
  searchParams: Promise<{ cabang?: string; q?: string; error?: string; success?: string }>;
}) {
  const { cabang = "", q = "", error, success } = await searchParams;
  const supabase = await createClient();
  const bolehKelola = await bolehKelolaMaster();

  const { data: branchRows } = await supabase
    .from("branches").select("id, code, name").eq("is_active", true).order("code");
  const branches = (branchRows ?? []) as { id: string; code: string; name: string }[];
  const branchId = branches.some((b) => b.id === cabang) ? cabang : "";

  let itemQ = supabase
    .from("items").select("id, code, name, unit, sell_price")
    .eq("is_active", true).order("name").limit(LIMIT);
  if (q.trim()) itemQ = itemQ.or(`name.ilike.%${q.trim()}%,code.ilike.%${q.trim()}%`);
  const { data: itemRows } = await itemQ;
  const items = (itemRows ?? []) as ItemRow[];
  const ids = items.map((i) => i.id);

  const [unitMap, hargaMap] = await Promise.all([
    loadItemUnits(supabase, ids),
    loadHargaCabang(supabase, branchId || null, ids),
  ]);

  // Berapa cabang yang harganya beda — supaya kelihatan barang mana yang sudah
  // "dikecualikan" tanpa harus buka satu per satu cabang.
  const { data: overrideRows } = ids.length
    ? await supabase.from("item_branch_prices").select("item_id, unit, branch_id").in("item_id", ids)
    : { data: [] };
  const jumlahOverride = new Map<string, number>();
  for (const r of (overrideRows ?? []) as { item_id: string; unit: string }[]) {
    const k = `${r.item_id}|${r.unit}`;
    jumlahOverride.set(k, (jumlahOverride.get(k) ?? 0) + 1);
  }

  const baris = items.flatMap((it) =>
    unitOptions({ unit: it.unit, sell_price: Number(it.sell_price) }, unitMap.get(it.id) ?? []).map((u, idx) => ({
      item: it, unit: u.unit, faktor: u.factor, hargaPusat: u.sell_price, pertama: idx === 0,
      override: hargaMap.get(`${it.id}|${u.unit}`),
      dipakaiCabangLain: jumlahOverride.get(`${it.id}|${u.unit}`) ?? 0,
    })),
  );

  const namaCabang = branches.find((b) => b.id === branchId)?.name ?? "Semua Cabang";

  return (
    <MasterPage
      back="/pos" icon="ti-tag" title="HARGA JUAL"
      desc="Satu tempat untuk semua harga jual — bisa beda tiap cabang"
      error={error} success={success} successMsg="Harga jual tersimpan."
      bolehKelola={bolehKelola}
      readOnlyNote="Hanya OWNER/ADMIN yang bisa mengubah harga jual."
    >
      {/* Pemilih cabang + pencarian: GET biasa, biar bisa di-bookmark & di-refresh. */}
      <form className="crm-sec" style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div style={{ minWidth: 220 }}>
            <label className="flab">Cabang</label>
            <select className="fi" name="cabang" defaultValue={branchId}>
              <option value="">Semua Cabang</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}
            </select>
          </div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <label className="flab">Cari barang</label>
            <input className="fi" name="q" defaultValue={q} placeholder="nama atau kode barang" />
          </div>
          <SubmitButton className="btn-def" icon="ti-refresh" pendingText="Memuat…">Tampilkan</SubmitButton>
        </div>
        <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 6 }}>
          {branchId
            ? <>Kosongkan kolom harga cabang kalau <b>{namaCabang}</b> ikut harga Semua Cabang.</>
            : <>Harga <b>Semua Cabang</b> = harga dasar. Cabang yang tidak dikecualikan ikut harga ini.</>}
        </div>
      </form>

      <form action={simpanHargaJual} className="crm-sec" style={{ marginBottom: 0 }}>
        <input type="hidden" name="branch_id" value={branchId} />
        <input type="hidden" name="q" value={q} />

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 9 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700 }}>
            <i className="ti ti-tag" /> {namaCabang}
            <span style={{ fontSize: 10.5, fontWeight: 400, color: "var(--tm)" }}> · {baris.length} baris harga</span>
          </div>
          {bolehKelola && baris.length > 0 && (
            <SubmitButton className="btn-acc" icon="ti-device-floppy" pendingText="Menyimpan…" style={{ background: "var(--posb)" }}>
              Simpan harga
            </SubmitButton>
          )}
        </div>

        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 720 }}>
            <thead>
              <tr>
                <th style={{ width: 90 }}>Kode</th>
                <th>Barang</th>
                <th style={{ width: 90 }}>Satuan</th>
                <th style={{ width: 80 }}>Isi</th>
                <th style={{ width: 130, textAlign: "right" }}>Semua Cabang</th>
                {branchId && <th style={{ width: 150, textAlign: "right" }}>Harga {namaCabang}</th>}
                {!branchId && <th style={{ width: 130 }}>Dikecualikan</th>}
              </tr>
            </thead>
            <tbody>
              {baris.map((r) => (
                <tr key={`${r.item.id}|${r.unit}`}>
                  <td style={{ fontSize: 10.5, fontFamily: "var(--mono, monospace)", color: "var(--tm)" }}>
                    {r.pertama ? r.item.code : ""}
                  </td>
                  <td style={{ fontSize: 11 }}>{r.pertama ? r.item.name : ""}</td>
                  <td style={{ fontSize: 11, fontWeight: 600 }}>{r.unit}</td>
                  <td style={{ fontSize: 10.5, color: "var(--tm)" }}>
                    {r.faktor === 1 ? "dasar" : `${r.faktor} ${r.item.unit}`}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {branchId ? (
                      <span style={{ fontSize: 11 }}>{rp(r.hargaPusat)}</span>
                    ) : (
                      <input className="fi" name={`h|${r.item.id}|${r.unit}`} type="number" min={0} step="any"
                        defaultValue={r.hargaPusat} disabled={!bolehKelola}
                        style={{ textAlign: "right", height: 26, fontSize: 11 }} />
                    )}
                  </td>
                  {branchId && (
                    <td style={{ textAlign: "right" }}>
                      <input className="fi" name={`h|${r.item.id}|${r.unit}`} type="number" min={0} step="any"
                        defaultValue={r.override ?? ""} placeholder="ikut pusat" disabled={!bolehKelola}
                        style={{ textAlign: "right", height: 26, fontSize: 11 }} />
                    </td>
                  )}
                  {!branchId && (
                    <td style={{ fontSize: 10.5, color: r.dipakaiCabangLain ? "#d97706" : "var(--td)" }}>
                      {r.dipakaiCabangLain ? `${r.dipakaiCabangLain} cabang` : "—"}
                    </td>
                  )}
                </tr>
              ))}
              {baris.length === 0 && (
                <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--td)", padding: "20px 0", fontSize: 11 }}>
                  {q ? "Tidak ada barang yang cocok." : "Belum ada barang aktif."}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>

        {items.length >= LIMIT && (
          <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 7 }}>
            Menampilkan {LIMIT} barang pertama — pakai kolom cari untuk mempersempit.
          </div>
        )}

        <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 7 }}>
          Harga beli & HPP tidak diatur di sini: HPP tetap dihitung rata-rata dari pembelian yang benar-benar masuk.
          {" "}Atur kemasan & satuan di <Link href="/pos/sku" style={{ color: "#2563eb" }}>Barang &amp; Jasa</Link>.
        </div>
      </form>
    </MasterPage>
  );
}

const rp = (n: number) => "Rp " + Math.round(Number(n) || 0).toLocaleString("id-ID");
