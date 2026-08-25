import { createClient } from "@/lib/supabase/server";
import { LaporanPage, KartuAngka, TabelKosong } from "@/components/LaporanPage";
import { voucherStatus, type VoucherRow } from "@/lib/voucher";
import { lineDiscount } from "@/lib/pos-calc";
import { rentangBulan } from "@/lib/pertumbuhan";
import { hariIniWIB, tanggalWIB } from "@/lib/tanggal";
import { tanggalIndo } from "@/lib/followup";

// Promo, Voucher & Diskon — permintaan Kamo Group 24 Agu 2026:
// "voucher: diterbitkan, ditukarkan, redemption rate per program per cabang" dan
// "diskon: dipakai dan rasio terhadap target".

type Rel<T> = T | T[] | null;
const one = <T,>(r: Rel<T>): T | null => (Array.isArray(r) ? (r[0] ?? null) : r);

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");
const persen = (x: number) => `${Math.round(x * 100)}%`;

const awalBulan = () => hariIniWIB().slice(0, 8) + "01";

const WARNA_STATUS: Record<string, string> = {
  aktif: "#15803d", terjadwal: "#2563eb", kadaluarsa: "#b45309", nonaktif: "var(--td)",
};

export default async function PromoPage({
  searchParams,
}: {
  searchParams: Promise<{ dari?: string; sampai?: string }>;
}) {
  const sp = await searchParams;
  const dari = sp.dari || awalBulan();
  const sampai = sp.sampai || hariIniWIB();
  const mulai = `${dari}T00:00:00+07:00`;
  const akhir = `${sampai}T23:59:59+07:00`;

  const supabase = await createClient();
  const [{ data: salesData }, { data: invData }, { data: voucherData }, { data: promoData }, { data: targetData }] =
    await Promise.all([
      supabase.from("sales")
        .select("id, total, subtotal, discount, diskon_kategori, poin_digunakan, voucher_code, created_at, branch_id, branches(name), sale_items(qty, harga, item_discount_type, item_discount_value, promo_id, promo_discount)")
        .gte("created_at", mulai).lte("created_at", akhir),
      supabase.from("invoices")
        .select("total, subtotal, discount, voucher_code, created_at, visits(branch_id, branches(name))")
        .is("voided_at", null).gte("created_at", mulai).lte("created_at", akhir),
      supabase.from("vouchers")
        .select("id, code, tipe, nilai, is_active, valid_from, valid_until, max_potongan, min_belanja, boleh_gabung_promo, customer_id, category_id"),
      supabase.from("promos").select("id, name, promo_type"),
      // Hanya target murni cabang / perusahaan. Target per karyawan atau per kategori
      // sengaja tidak dijumlah di sini — kalau digabung, satu omzet bisa terhitung
      // memenuhi beberapa target sekaligus dan rasionya jadi mengarang.
      supabase.from("sales_targets")
        .select("periode, branch_id, basis, target")
        .is("employee_id", null).is("category_id", null),
    ]);

  type SaleItem = {
    qty: number; harga: number; item_discount_type: string | null; item_discount_value: number | null;
    promo_id: string | null; promo_discount: number | null;
  };
  type Sale = {
    id: string; total: number; subtotal: number; discount: number; diskon_kategori: number | null;
    poin_digunakan: number | null; voucher_code: string | null; created_at: string;
    branch_id: string | null; branches: Rel<{ name: string }>; sale_items: SaleItem[] | null;
  };
  type Inv = {
    total: number; subtotal: number; discount: number; voucher_code: string | null; created_at: string;
    visits: Rel<{ branch_id: string | null; branches: Rel<{ name: string }> }>;
  };

  const sales = (salesData ?? []) as unknown as Sale[];
  const invoices = (invData ?? []) as unknown as Inv[];

  // ── Diskon per cabang ──────────────────────────────────────────────────────
  type Diskon = {
    cabang: string; branchId: string | null;
    kotor: number; item: number; golongan: number; poin: number; lain: number; total: number;
    omzet: number; trx: number;
  };
  const perCabang = new Map<string, Diskon>();
  const kosong = (cabang: string, branchId: string | null): Diskon => ({
    cabang, branchId, kotor: 0, item: 0, golongan: 0, poin: 0, lain: 0, total: 0, omzet: 0, trx: 0,
  });

  let promoTercatat = 0;
  const promoPakai = new Map<string, { baris: number; potongan: number; nilaiBaris: number }>();

  for (const s of sales) {
    const cabang = one(s.branches)?.name ?? "—";
    const row = perCabang.get(cabang) ?? kosong(cabang, s.branch_id);
    const items = s.sale_items ?? [];
    const diskonItem = items.reduce((a, l) => a + lineDiscount({
      qty: Number(l.qty) || 0, harga: Number(l.harga) || 0,
      item_discount_type: (l.item_discount_type as "nominal" | "percent" | null) ?? null,
      item_discount_value: Number(l.item_discount_value) || 0,
      promo_discount: Number(l.promo_discount) || 0,
    }), 0);
    const golongan = Number(s.diskon_kategori) || 0;
    const poin = Number(s.poin_digunakan) || 0;
    // `discount` menyimpan seluruh potongan selain diskon golongan; sisanya setelah
    // diskon item dan poin dikeluarkan = diskon manual kasir + voucher.
    const lain = Math.max(0, (Number(s.discount) || 0) - diskonItem - poin);

    row.kotor += Number(s.subtotal) || 0;
    row.item += diskonItem;
    row.golongan += golongan;
    row.poin += poin;
    row.lain += lain;
    row.total += diskonItem + golongan + poin + lain;
    row.omzet += Number(s.total) || 0;
    row.trx++;
    perCabang.set(cabang, row);

    for (const l of items) {
      const nilai = Number(l.promo_discount) || 0;
      promoTercatat += nilai;
      if (!l.promo_id) continue;
      const cur = promoPakai.get(l.promo_id) ?? { baris: 0, potongan: 0, nilaiBaris: 0 };
      cur.baris++;
      cur.potongan += nilai;
      cur.nilaiBaris += (Number(l.qty) || 0) * (Number(l.harga) || 0);
      promoPakai.set(l.promo_id, cur);
    }
  }

  for (const inv of invoices) {
    const v = one(inv.visits);
    const cabang = one(v?.branches ?? null)?.name ?? "—";
    const row = perCabang.get(cabang) ?? kosong(cabang, v?.branch_id ?? null);
    const d = Number(inv.discount) || 0;
    row.kotor += Number(inv.subtotal) || 0;
    row.lain += d;
    row.total += d;
    row.omzet += Number(inv.total) || 0;
    row.trx++;
    perCabang.set(cabang, row);
  }

  const diskonRows = [...perCabang.values()].sort((a, b) => b.total - a.total);
  const tot = diskonRows.reduce((a, r) => ({
    kotor: a.kotor + r.kotor, item: a.item + r.item, golongan: a.golongan + r.golongan,
    poin: a.poin + r.poin, lain: a.lain + r.lain, total: a.total + r.total, omzet: a.omzet + r.omzet,
  }), { kotor: 0, item: 0, golongan: 0, poin: 0, lain: 0, total: 0, omzet: 0 });

  // ── Target penjualan ───────────────────────────────────────────────────────
  const bulan = new Set(rentangBulan(dari, sampai));
  type Target = { periode: string; branch_id: string | null; basis: string; target: number };
  const targets = ((targetData ?? []) as Target[]).filter((t) => bulan.has(t.periode) && t.basis === "omzet");
  const targetPerCabang = new Map<string | null, number>();
  for (const t of targets) {
    targetPerCabang.set(t.branch_id, (targetPerCabang.get(t.branch_id) ?? 0) + (Number(t.target) || 0));
  }
  const targetPerusahaan = targetPerCabang.get(null) ?? 0;

  // ── Voucher ────────────────────────────────────────────────────────────────
  const hariIni = hariIniWIB();
  const pakaiVoucher = new Map<string, { trx: number; nilai: number; cabang: Set<string> }>();
  const catatVoucher = (kode: string | null, nilai: number, cabang: string) => {
    if (!kode) return;
    const cur = pakaiVoucher.get(kode) ?? { trx: 0, nilai: 0, cabang: new Set<string>() };
    cur.trx++;
    cur.nilai += nilai;
    cur.cabang.add(cabang);
    pakaiVoucher.set(kode, cur);
  };
  for (const s of sales) catatVoucher(s.voucher_code, Number(s.total) || 0, one(s.branches)?.name ?? "—");
  for (const inv of invoices) {
    catatVoucher(inv.voucher_code, Number(inv.total) || 0, one(one(inv.visits)?.branches ?? null)?.name ?? "—");
  }

  const vouchers = ((voucherData ?? []) as unknown as VoucherRow[]).map((v) => {
    const pakai = pakaiVoucher.get(v.code);
    return {
      ...v,
      status: voucherStatus(v, hariIni),
      sasaran: v.customer_id ? "1 pelanggan" : v.category_id ? "1 golongan" : "umum",
      dipakai: pakai?.trx ?? 0,
      nilaiTrx: pakai?.nilai ?? 0,
      cabang: pakai ? [...pakai.cabang].join(", ") : "—",
    };
  }).sort((a, b) => b.dipakai - a.dipakai || a.code.localeCompare(b.code));

  // Kode yang masa berlakunya menyentuh rentang ini = "diterbitkan" untuk periode ini.
  const berlaku = vouchers.filter((v) =>
    (!v.valid_until || v.valid_until >= dari) && (!v.valid_from || v.valid_from <= sampai));
  const terpakai = berlaku.filter((v) => v.dipakai > 0).length;
  const redemptionRate = berlaku.length ? terpakai / berlaku.length : 0;

  // Kode yang dipakai tapi tidak ada di master (mis. dihapus setelah dipakai).
  const kodeMaster = new Set(vouchers.map((v) => v.code));
  const kodeYatim = [...pakaiVoucher].filter(([k]) => !kodeMaster.has(k));

  // ── Promo otomatis ─────────────────────────────────────────────────────────
  const namaPromo = new Map(((promoData ?? []) as { id: string; name: string; promo_type: string }[])
    .map((p) => [p.id, p]));
  const promoRows = [...promoPakai].map(([id, v]) => ({
    id, nama: namaPromo.get(id)?.name ?? "(promo terhapus)",
    jenis: namaPromo.get(id)?.promo_type ?? "—", ...v,
  })).sort((a, b) => b.potongan - a.potongan || b.baris - a.baris);

  // Struk paling lama di rentang — dipakai memberi tahu kalau datanya dari masa
  // sebelum nilai promo mulai dicatat (migrasi 0127, 25 Agustus 2026).
  const strukTerlama = sales.length
    ? sales.map((s) => tanggalWIB(s.created_at)).sort()[0]
    : null;
  const adaDataLama = !!strukTerlama && strukTerlama < "2026-08-25" && promoTercatat === 0;

  return (
    <LaporanPage
      icon="ti-discount" title="PROMO, VOUCHER & DISKON"
      desc="Berapa kode voucher yang ditukarkan, promo mana yang jalan, dan berapa besar potongan yang diberikan."
      filter={
        <>
          <div>
            <label className="flab">Dari tanggal</label>
            <input className="fi" type="date" name="dari" defaultValue={dari} />
          </div>
          <div>
            <label className="flab">Sampai tanggal</label>
            <input className="fi" type="date" name="sampai" defaultValue={sampai} />
          </div>
          <button type="submit" className="btn-def"><i className="ti ti-filter" /> Tampilkan</button>
        </>
      }
      ringkasan={
        <KartuAngka items={[
          { label: "Voucher berlaku", nilai: `${berlaku.length} kode` },
          { label: "Kode yang pernah ditukar", nilai: `${terpakai} kode` },
          { label: "Redemption rate", nilai: persen(redemptionRate), warna: terpakai ? "#15803d" : "#b45309" },
          { label: "Total potongan diberikan", nilai: rp(tot.total), warna: "#b45309" },
          { label: "Omzet bersih", nilai: rp(tot.omzet), warna: "#15803d" },
          { label: "Rasio potongan", nilai: tot.kotor ? persen(tot.total / tot.kotor) : "—" },
        ]} />
      }
    >
      <div className="crm-sec" style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 8 }}>01 · VOUCHER</div>
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 900 }}>
            <thead>
              <tr>
                <th style={{ width: 130 }}>Kode</th>
                <th style={{ width: 110 }}>Status</th>
                <th style={{ width: 110 }}>Sasaran</th>
                <th style={{ width: 170 }}>Berlaku</th>
                <th style={{ width: 120, textAlign: "right" }}>Nilai voucher</th>
                <th style={{ width: 90, textAlign: "center" }}>Ditukar</th>
                <th style={{ width: 140, textAlign: "right" }}>Nilai transaksinya</th>
                <th style={{ width: 170 }}>Cabang</th>
              </tr>
            </thead>
            <tbody>
              {vouchers.map((v) => (
                <tr key={v.code} style={v.dipakai ? undefined : { opacity: .65 }}>
                  <td style={{ fontSize: 11.5, fontWeight: 700 }}>{v.code}</td>
                  <td style={{ fontSize: 10.5, fontWeight: 600, color: WARNA_STATUS[v.status] }}>{v.status}</td>
                  <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{v.sasaran}</td>
                  <td style={{ fontSize: 10.5, color: "var(--tm)" }}>
                    {v.valid_from ? tanggalIndo(v.valid_from) : "kapan saja"} – {v.valid_until ? tanggalIndo(v.valid_until) : "tanpa batas"}
                  </td>
                  <td style={{ textAlign: "right", fontSize: 11 }}>
                    {v.tipe === "persen" ? `${v.nilai}%` : rp(v.nilai)}
                  </td>
                  <td style={{ textAlign: "center", fontSize: 11.5, fontWeight: 700, color: v.dipakai ? "#15803d" : "var(--td)" }}>
                    {v.dipakai}x
                  </td>
                  <td style={{ textAlign: "right", fontSize: 11, color: "var(--tm)" }}>{v.nilaiTrx ? rp(v.nilaiTrx) : "—"}</td>
                  <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{v.cabang}</td>
                </tr>
              ))}
              {kodeYatim.map(([kode, v]) => (
                <tr key={`yatim-${kode}`}>
                  <td style={{ fontSize: 11.5, fontWeight: 700 }}>{kode}</td>
                  <td style={{ fontSize: 10.5, color: "#b45309" }}>sudah dihapus</td>
                  <td colSpan={3} style={{ fontSize: 10.5, color: "var(--td)" }}>kodenya tidak ada lagi di master voucher</td>
                  <td style={{ textAlign: "center", fontSize: 11.5, fontWeight: 700 }}>{v.trx}x</td>
                  <td style={{ textAlign: "right", fontSize: 11 }}>{rp(v.nilai)}</td>
                  <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{[...v.cabang].join(", ")}</td>
                </tr>
              ))}
              {vouchers.length === 0 && kodeYatim.length === 0 && (
                <TabelKosong kolom={8} pesan="Belum ada voucher yang dibuat." />
              )}
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 8, lineHeight: 1.6 }}>
          &quot;Ditukar&quot; = berapa transaksi memakai kode itu di rentang tanggal ini; satu kode umum
          boleh dipakai berkali-kali. Redemption rate di atas = berapa kode yang PERNAH dipakai
          dibagi kode yang masa berlakunya menyentuh rentang ini.<br />
          Rupiah potongan voucher belum disimpan terpisah — di kolom diskon bawah, potongannya
          menyatu dengan &quot;diskon transaksi&quot;. Yang bisa dipastikan di sini jumlah pemakaian
          dan nilai transaksi yang memakainya.
        </div>
      </div>

      <div className="crm-sec" style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 8 }}>02 · PROMO OTOMATIS</div>
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 620 }}>
            <thead>
              <tr>
                <th>Promo</th>
                <th style={{ width: 130 }}>Jenis</th>
                <th style={{ width: 100, textAlign: "center" }}>Baris kena</th>
                <th style={{ width: 140, textAlign: "right" }}>Nilai barisnya</th>
                <th style={{ width: 140, textAlign: "right" }}>Potongan</th>
              </tr>
            </thead>
            <tbody>
              {promoRows.map((p) => (
                <tr key={p.id}>
                  <td style={{ fontSize: 11.5, fontWeight: 600 }}>{p.nama}</td>
                  <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{p.jenis}</td>
                  <td style={{ textAlign: "center", fontSize: 11.5, fontWeight: 700 }}>{p.baris}</td>
                  <td style={{ textAlign: "right", fontSize: 11, color: "var(--tm)" }}>{rp(p.nilaiBaris)}</td>
                  <td style={{ textAlign: "right", fontSize: 11.5, fontWeight: 700, color: "#b45309" }}>{rp(p.potongan)}</td>
                </tr>
              ))}
              {promoRows.length === 0 && (
                <TabelKosong kolom={5} pesan="Belum ada promo otomatis yang kena di rentang ini." />
              )}
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 8, lineHeight: 1.6 }}>
          {adaDataLama
            ? "Struk sebelum 25 Agustus 2026 tidak menyimpan promo mana yang kena — potongannya dulu langsung dilebur ke kolom diskon. Tabel ini baru terisi untuk transaksi setelah tanggal itu."
            : "Satu baris hanya bisa kena satu promo — yang potongannya paling besar yang dipakai, dan diskon manual kasir mengalahkan promo."}
        </div>
      </div>

      <div className="crm-sec" style={{ marginBottom: 0 }}>
        <div style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 8 }}>03 · DISKON PER CABANG</div>
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 1020 }}>
            <thead>
              <tr>
                <th>Cabang</th>
                <th style={{ width: 130, textAlign: "right" }}>Penjualan kotor</th>
                <th style={{ width: 110, textAlign: "right" }}>Diskon item</th>
                <th style={{ width: 110, textAlign: "right" }}>Diskon golongan</th>
                <th style={{ width: 110, textAlign: "right" }}>Diskon transaksi</th>
                <th style={{ width: 100, textAlign: "right" }}>Poin ditukar</th>
                <th style={{ width: 130, textAlign: "right" }}>Total potongan</th>
                <th style={{ width: 90, textAlign: "center" }}>Rasio</th>
                <th style={{ width: 130, textAlign: "right" }}>Target</th>
                <th style={{ width: 90, textAlign: "center" }}>Capaian</th>
              </tr>
            </thead>
            <tbody>
              {diskonRows.map((r) => {
                const target = targetPerCabang.get(r.branchId) ?? 0;
                return (
                  <tr key={r.cabang}>
                    <td style={{ fontSize: 11.5, fontWeight: 600 }}>{r.cabang}</td>
                    <td style={{ textAlign: "right", fontSize: 11, color: "var(--tm)" }}>{rp(r.kotor)}</td>
                    <td style={{ textAlign: "right", fontSize: 11 }}>{r.item ? rp(r.item) : "—"}</td>
                    <td style={{ textAlign: "right", fontSize: 11 }}>{r.golongan ? rp(r.golongan) : "—"}</td>
                    <td style={{ textAlign: "right", fontSize: 11 }}>{r.lain ? rp(r.lain) : "—"}</td>
                    <td style={{ textAlign: "right", fontSize: 11 }}>{r.poin ? rp(r.poin) : "—"}</td>
                    <td style={{ textAlign: "right", fontSize: 11.5, fontWeight: 700, color: r.total ? "#b45309" : "var(--td)" }}>
                      {r.total ? rp(r.total) : "—"}
                    </td>
                    <td style={{ textAlign: "center", fontSize: 11 }}>{r.kotor ? persen(r.total / r.kotor) : "—"}</td>
                    <td style={{ textAlign: "right", fontSize: 11, color: "var(--tm)" }}>{target ? rp(target) : "—"}</td>
                    <td style={{ textAlign: "center", fontSize: 11, fontWeight: 700, color: target && r.omzet >= target ? "#15803d" : "var(--tm)" }}>
                      {target ? persen(r.omzet / target) : "—"}
                    </td>
                  </tr>
                );
              })}
              {diskonRows.length === 0 && <TabelKosong kolom={10} pesan="Belum ada transaksi di rentang ini." />}
            </tbody>
            {diskonRows.length > 0 && (
              <tfoot>
                <tr style={{ fontWeight: 800 }}>
                  <td style={{ fontSize: 11.5 }}>TOTAL</td>
                  <td style={{ textAlign: "right", fontSize: 11.5 }}>{rp(tot.kotor)}</td>
                  <td style={{ textAlign: "right", fontSize: 11.5 }}>{rp(tot.item)}</td>
                  <td style={{ textAlign: "right", fontSize: 11.5 }}>{rp(tot.golongan)}</td>
                  <td style={{ textAlign: "right", fontSize: 11.5 }}>{rp(tot.lain)}</td>
                  <td style={{ textAlign: "right", fontSize: 11.5 }}>{rp(tot.poin)}</td>
                  <td style={{ textAlign: "right", fontSize: 11.5 }}>{rp(tot.total)}</td>
                  <td style={{ textAlign: "center", fontSize: 11.5 }}>{tot.kotor ? persen(tot.total / tot.kotor) : "—"}</td>
                  <td style={{ textAlign: "right", fontSize: 11.5 }}>{targetPerusahaan ? rp(targetPerusahaan) : "—"}</td>
                  <td style={{ textAlign: "center", fontSize: 11.5 }}>
                    {targetPerusahaan ? persen(tot.omzet / targetPerusahaan) : "—"}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 8, lineHeight: 1.6 }}>
          &quot;Diskon transaksi&quot; adalah potongan di tingkat struk: diskon manual kasir dan voucher,
          termasuk potongan tagihan klinik. Poin yang ditukar dihitung terpisah karena itu hak
          pelanggan yang sudah dikumpulkan, bukan potongan harga baru.<br />
          {targets.length === 0
            ? "Kolom target masih kosong karena belum ada satu pun target penjualan yang disimpan. Isi dulu di layar Target Penjualan (Penjualan → Target), lalu kolom Capaian akan terisi sendiri."
            : "Target yang dipakai hanya target murni per cabang atau se-perusahaan. Target per karyawan dan per kategori sengaja tidak ikut dijumlah supaya satu omzet tidak terhitung memenuhi beberapa target sekaligus."}
        </div>
      </div>
    </LaporanPage>
  );
}
