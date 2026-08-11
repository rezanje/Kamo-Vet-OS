"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { checkoutKasir } from "./checkout";
import { tambahCustomerKasir } from "./actions";
import { SubmitButton } from "@/components/SubmitButton";
import { computeTotals, lineDiscount, matchPromos, type Promo } from "@/lib/pos-calc";
import { diskonGolonganKeranjang, type AturanDiskon, type BarangDiskon } from "@/lib/harga-golongan";
import { normalizeKode, pesanVoucherDitolak, potonganVoucher, type VoucherRow } from "@/lib/voucher";
import { hitungPromoKeranjang, type PromoHitung } from "@/lib/promo-hitung";
import type { ItemUnit } from "@/lib/satuan";

export type ItemRow = {
  id: string; code: string; name: string; harga: number; kategori: string; stok: number;
  // Aturan jual dari master barang (migrasi 0075).
  minJual?: number; diskonDefault?: number; substitusi?: string | null;
  // Satuan berjenjang; hanya diisi kalau barangnya punya lebih dari satu satuan.
  satuan?: ItemUnit[];
};
export type CustRow = {
  id: string; name: string; phone: string; points: number; tier: string | null; kategori: string;
  trx: number; belanja: number;
  diskonPersen?: number;      // diskon DASAR golongan (customer_categories)
  rupiahPerPoin?: number;     // belanja sebesar ini = 1 poin
  golonganId?: string | null; // kunci ke pengecualian diskon per produk (0082)
};
// Bentuknya sama persis dengan lib/voucher — layar kasir perlu syarat lengkapnya
// (plafon, minimal belanja, boleh gabung promo) untuk menolak SEBELUM bayar.
export type { VoucherRow } from "@/lib/voucher";
export type PromoRow = Promo & {
  valid_from?: string | null; valid_until?: string | null;
  auto_apply?: boolean;
};
type CartLine = {
  item_id: string; nama: string; qty: number; harga: number;
  item_discount_type?: "nominal" | "percent" | null; item_discount_value?: number | null;
  minJual?: number;
  // Satuan yang dipilih kasir + faktornya ke satuan dasar. Barang yang sama boleh
  // muncul dua baris (1 dus + 3 pcs), makanya kunci baris bukan item_id saja.
  satuan?: string; faktor?: number; opsiSatuan?: ItemUnit[];
};

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");

// Kunci baris keranjang: barang + satuan.
const kunciBaris = (l: { item_id: string; satuan?: string }) => `${l.item_id}|${l.satuan ?? ""}`;

const TIER_BADGE: Record<string, { bg: string; color: string }> = {
  New: { bg: "#f1f5f9", color: "#475569" },
  Bronze: { bg: "#fef3c7", color: "#92400e" },
  Silver: { bg: "#f3f4f6", color: "#4b5563" },
  Gold: { bg: "#fef9c3", color: "#713f12" },
  Platinum: { bg: "#ede9fe", color: "#5b21b6" },
};

export function KasirClient({
  branchName, items, customers, vouchers, hariIni, promos = [], promoHitung = [],
  aturanDiskon = {}, infoBarang = {}, error,
}: {
  branchName: string; items: ItemRow[]; customers: CustRow[]; vouchers: VoucherRow[]; hariIni: string;
  promos?: PromoRow[]; promoHitung?: PromoHitung[];
  aturanDiskon?: Record<string, AturanDiskon[]>;
  infoBarang?: Record<string, BarangDiskon>;
  error?: string;
}) {
  const [q, setQ] = useState("");
  const [kat, setKat] = useState("Semua");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 8;
  const [cart, setCart] = useState<CartLine[]>([]);
  const [custQ, setCustQ] = useState("");
  const [cust, setCust] = useState<CustRow | null>(null);
  const [diskon, setDiskon] = useState(0);
  const [diskonPct, setDiskonPct] = useState(false);
  const [poin, setPoin] = useState(0);
  const [voucher, setVoucher] = useState("");
  const [metode, setMetode] = useState("");
  const [bayar, setBayar] = useState(0);
  const [showAddCust, setShowAddCust] = useState(false);
  const [addErr, setAddErr] = useState<string | null>(null);
  const [addPending, startAdd] = useTransition();
  const router = useRouter();

  const submitNewCust = (fd: FormData) => {
    setAddErr(null);
    startAdd(async () => {
      const res = await tambahCustomerKasir(fd);
      if (!res.ok) { setAddErr(res.error); return; }
      setCust(res.customer);
      setCustQ(res.customer.name);
      setPoin(0);
      setShowAddCust(false);
      router.refresh(); // masukkan customer baru ke daftar cari; state cart client tetap.
    });
  };

  const kategoris = useMemo(() => ["Semua", ...new Set(items.map((i) => i.kategori))], [items]);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return items.filter((i) =>
      (kat === "Semua" || i.kategori === kat) &&
      (!s || i.name.toLowerCase().includes(s) || i.code.toLowerCase().includes(s))
    );
  }, [items, q, kat]);

  const totalPages = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageStart = (safePage - 1) * PAGE_SIZE;
  const pageRows = shown.slice(pageStart, pageStart + PAGE_SIZE);
  const pageNumbers = Array.from({ length: totalPages }, (_, i) => i + 1);

  const custHits = useMemo(() => {
    const s = custQ.trim().toLowerCase();
    if (!s || cust) return [];
    const digits = s.replace(/\D/g, "");
    return customers.filter((c) => (digits && c.phone.replace(/\D/g, "").includes(digits)) || c.name.toLowerCase().includes(s)).slice(0, 5);
  }, [customers, custQ, cust]);

  // Barang masuk keranjang langsung memakai aturan masternya: qty mulai dari
  // minimum jual, dan diskon default terpasang sebagai persen (0 = tanpa diskon).
  const add = (it: ItemRow) =>
    setCart((c) => {
      // Barang masuk dengan satuan DASAR (opsi pertama) — kasir tinggal menggantinya
      // di keranjang kalau menjual per dus.
      const dasar = it.satuan?.[0];
      const baris: CartLine = {
        item_id: it.id, nama: it.name, qty: 0, harga: dasar?.sell_price ?? it.harga,
        minJual: Math.max(1, Number(it.minJual) || 0),
        satuan: dasar?.unit, faktor: dasar?.factor ?? 1, opsiSatuan: it.satuan,
      };
      const k = kunciBaris(baris);
      const ex = c.find((l) => kunciBaris(l) === k);
      if (ex) return c.map((l) => (kunciBaris(l) === k ? { ...l, qty: l.qty + 1 } : l));
      const disk = Number(it.diskonDefault) || 0;
      return [...c, {
        ...baris, qty: baris.minJual!,
        ...(disk > 0 ? { item_discount_type: "percent" as const, item_discount_value: disk } : {}),
      }];
    });
  const setQty = (k: string, d: number) =>
    setCart((c) => c.flatMap((l) => (kunciBaris(l) === k ? (l.qty + d <= 0 ? [] : [{ ...l, qty: l.qty + d }]) : [l])));
  const removeLine = (k: string) => setCart((c) => c.filter((l) => kunciBaris(l) !== k));
  const setPot = (k: string, val: number) =>
    setCart((c) => c.map((l) => (kunciBaris(l) === k ? { ...l, item_discount_value: Math.max(0, val), item_discount_type: l.item_discount_type ?? "nominal" } : l)));
  const togglePotType = (k: string) =>
    setCart((c) => c.map((l) => (kunciBaris(l) === k ? { ...l, item_discount_type: l.item_discount_type === "percent" ? "nominal" : "percent" } : l)));

  // Ganti satuan: harga ikut satuan yang dipilih. Kalau satuan tujuan sudah ada
  // barisnya, qty-nya digabung supaya tidak ada dua baris identik.
  const setSatuan = (k: string, unit: string) =>
    setCart((c) => {
      const baris = c.find((l) => kunciBaris(l) === k);
      const opsi = baris?.opsiSatuan?.find((o) => o.unit === unit);
      if (!baris || !opsi) return c;
      const baru = { ...baris, satuan: opsi.unit, faktor: opsi.factor, harga: opsi.sell_price };
      const kBaru = kunciBaris(baru);
      const lain = c.filter((l) => kunciBaris(l) !== k);
      const bentrok = lain.find((l) => kunciBaris(l) === kBaru);
      return bentrok
        ? lain.map((l) => (kunciBaris(l) === kBaru ? { ...l, qty: l.qty + baru.qty } : l))
        : c.map((l) => (kunciBaris(l) === k ? baru : l));
    });

  // Promo otomatis (migrasi 0079): dihitung ulang tiap isi keranjang berubah.
  // Angka di sini cuma untuk DITAMPILKAN — server menghitung ulang saat bayar.
  const potonganPromo = useMemo(() => hitungPromoKeranjang(promoHitung, cart), [promoHitung, cart]);
  const promoPerItem = useMemo(
    () => new Map(potonganPromo.map((p) => [p.item_id, p])),
    [potonganPromo],
  );
  // Baris keranjang + potongan promonya, dipakai semua perhitungan di bawah.
  const cartHitung = useMemo(
    () => cart.map((l) => ({ ...l, promo_discount: promoPerItem.get(l.item_id)?.potongan ?? 0 })),
    [cart, promoPerItem],
  );

  // Urutan kalkulasi (§6): diskon item → diskon transaksi + voucher → poin (lihat lib/pos-calc).
  const subtotal = cartHitung.reduce((a, l) => a + l.qty * l.harga, 0);
  const itemDiscTotal = cartHitung.reduce((a, l) => a + lineDiscount(l), 0);
  // Yang benar-benar terpakai dari promo (diskon manual kasir menang atas promo).
  const promoTerpakai = cartHitung.reduce(
    (a, l) => a + Math.min(lineDiscount(l), Number(l.promo_discount) || 0),
    0,
  );
  const afterItems = subtotal - itemDiscTotal;
  const diskonVal = diskonPct ? Math.round((afterItems * diskon) / 100) : diskon;
  // Diskon golongan dihitung server saat bayar; di sini hanya DITAMPILKAN supaya
  // angka di layar sama dengan yang ditagih — kalau beda, uang kembalian salah.
  // Per baris, karena sejak 0082 tiap barang bisa punya persen sendiri.
  const infoMap = useMemo(() => new Map(Object.entries(infoBarang)), [infoBarang]);
  const diskonKategori = useMemo(
    () => diskonGolonganKeranjang(
      cart, cust?.golonganId ? (aturanDiskon[cust.golonganId] ?? []) : [],
      cust?.diskonPersen ?? 0, infoMap,
    ),
    [cart, cust, aturanDiskon, infoMap],
  );
  const v = vouchers.find((x) => x.code === normalizeKode(voucher));
  // Syarat keranjang diperiksa di layar juga supaya kasir tahu SEBELUM menekan
  // bayar — kalau hanya di server, pelanggan sudah terlanjur diberi tahu totalnya.
  const tolakVoucher = voucher.trim() === "" ? null : pesanVoucherDitolak(v ?? null, hariIni, {
    dasar: afterItems,
    adaPromoOtomatis: potonganPromo.length > 0,
  });
  const voucherVal = v && !tolakVoucher ? potonganVoucher(afterItems, v) : 0;
  const voucherInvalid = tolakVoucher !== null;
  const totals = computeTotals(cartHitung, diskonVal + diskonKategori, voucherVal, 0);
  const maxPoin = cust ? Math.min(cust.points, totals.afterItems - totals.txnLevel) : 0;
  const poinUsed = Math.min(poin, maxPoin);
  const total = computeTotals(cartHitung, diskonVal + diskonKategori, voucherVal, poinUsed).total;
  const kembali = Math.max(0, bayar - total);
  const kurang = metode === "Tunai" && bayar < total;
  // Minimum jual dari master: kasir tidak boleh menjual di bawahnya.
  // Minimum jual dicatat dalam satuan DASAR, jadi bandingkan setelah dikali faktor —
  // 1 dus isi 12 tidak boleh ditolak hanya karena angkanya "1".
  const dibawahMin = cart.filter((l) => (l.minJual ?? 0) > 1 && l.qty * (l.faktor ?? 1) < (l.minJual ?? 0));
  const canPay = cart.length > 0 && !!metode && !kurang && !voucherInvalid && !!cust && dibawahMin.length === 0;

  // Reminder Promo (§6): non-blocking, muncul lagi saat isi cart berubah setelah di-dismiss.
  // Promo yang sudah dipotong otomatis tidak perlu diingatkan lagi — kasir sudah
  // melihat potongannya di rincian. Reminder hanya untuk promo yang masih manual.
  const promoHits = useMemo(
    () => matchPromos(promos.filter((p) => !p.auto_apply), cart),
    [promos, cart],
  );
  const [dismissedAtCartLen, setDismissedAtCartLen] = useState<number | null>(null);
  const promoDismissed = dismissedAtCartLen === cart.length;
  const [showPromoList, setShowPromoList] = useState(false);

  return (
    <>
      {error && (
        <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}>
          <i className="ti ti-alert-circle" /> {error}
        </div>
      )}


      {/* DATA CUSTOMER strip */}
      <div className="card" style={{ marginBottom: 12, display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
        <div style={{ minWidth: 230, position: "relative" }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: "var(--posb)", letterSpacing: ".05em", marginBottom: 4 }}>DATA CUSTOMER</div>
          <div style={{ position: "relative" }}>
            <input className="fi" placeholder="Masukkan nomor HP / nama..." value={custQ}
              onChange={(e) => { setCustQ(e.target.value); setCust(null); setPoin(0); }} />
            {cust && <i className="ti ti-x" onClick={() => { setCust(null); setCustQ(""); setPoin(0); }}
              style={{ position: "absolute", right: 8, top: 8, cursor: "pointer", color: "var(--td)" }} />}
          </div>
          {custHits.length > 0 && (
            <div style={{ position: "absolute", zIndex: 20, top: "100%", left: 0, right: 0, background: "#fff", border: ".5px solid var(--bd)", borderRadius: 7, marginTop: 3, boxShadow: "0 4px 12px rgba(0,0,0,.12)" }}>
              {custHits.map((c) => (
                <div key={c.id} onClick={() => { setCust(c); setCustQ(c.name); }}
                  style={{ padding: "7px 10px", cursor: "pointer", fontSize: 11.5, borderBottom: ".5px solid var(--bd)" }}>
                  {c.name} <span style={{ color: "var(--td)" }}>· {c.phone}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <button type="button" onClick={() => { setAddErr(null); setShowAddCust(true); }}
          className="btn-def" style={{ padding: "6px 12px", fontSize: 11, display: "inline-flex", alignItems: "center", gap: 5, borderColor: "var(--posb)", color: "var(--posb)" }}>
          <i className="ti ti-user-plus" /> Customer Baru
        </button>
        {cust ? (
          <>
            <CustStat icon="ti-user" label={cust.name} sub={cust.phone} />
            <CustStat icon="ti-star" label={`${cust.points.toLocaleString("id-ID")} Poin`} sub="Jumlah poin" accent />
            <div style={{ textAlign: "center" }}>
              <span className="bge" style={{ ...(TIER_BADGE[cust.tier ?? "New"] ?? { bg: "#f3f4f6", color: "#6b7280" }), fontSize: 11, padding: "3px 12px" }}>
                <i className="ti ti-award" style={{ marginRight: 4 }} />{cust.tier ?? "New"}
              </span>
              <div style={{ fontSize: 9, color: "var(--td)", marginTop: 3 }}>Tier</div>
            </div>
            <div style={{ textAlign: "center" }}>
              <span className="bge" style={{ background: "#eff6ff", color: "#1d4ed8", fontSize: 11, padding: "3px 12px" }}>
                {cust.kategori}
              </span>
              <div style={{ fontSize: 9, color: "var(--td)", marginTop: 3 }}>Kategori</div>
            </div>
            <CustStat icon="ti-shopping-bag" label={`${cust.trx}x · ${rp(cust.belanja)}`} sub="Total transaksi" />
            <CustStat icon="ti-trending-up" label={rp(cust.trx ? cust.belanja / cust.trx : 0)} sub="Rata-rata transaksi" />
          </>
        ) : (
          <span style={{ fontSize: 11, color: "#b91c1c" }}><i className="ti ti-alert-circle" style={{ marginRight: 3 }} />Pilih atau tambah pelanggan dulu — wajib diisi sebelum bayar.</span>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.5fr) minmax(360px, 1fr)", gap: 12, alignItems: "start" }}>
        {/* DAFTAR PRODUK */}
        <div className="card" style={{ padding: 0 }}>
          <div style={{ padding: "13px 15px 10px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: "var(--posb)", letterSpacing: ".03em" }}>DAFTAR PRODUK</span>
            <span style={{ fontSize: 9.5, color: "var(--td)" }}>{branchName}</span>
            <button type="button" onClick={() => setShowPromoList(true)}
              className="btn-def" style={{ padding: "4px 11px", fontSize: 10.5, display: "inline-flex", alignItems: "center", gap: 5, borderColor: "var(--posb)", color: "var(--posb)" }}>
              <i className="ti ti-speakerphone" /> Promo Hari Ini
              {promos.length > 0 && (
                <span style={{ background: "var(--posb)", color: "#fff", borderRadius: 999, fontSize: 9, fontWeight: 700, padding: "1px 6px" }}>{promos.length}</span>
              )}
            </button>
            <div style={{ marginLeft: "auto", position: "relative", width: 240 }}>
              <input className="fi" placeholder="Cari nama / kode barang..." value={q}
                onChange={(e) => { setQ(e.target.value); setPage(1); }} style={{ fontSize: 11, paddingRight: 26 }} />
              <i className="ti ti-search" style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", color: "var(--td)", fontSize: 12 }} />
            </div>
          </div>
          <div style={{ padding: "0 15px 10px", display: "flex", gap: 14, flexWrap: "wrap", borderBottom: ".5px solid var(--bd)" }}>
            {kategoris.map((k) => (
              <button key={k} type="button" onClick={() => { setKat(k); setPage(1); }}
                className={`kpos-catTab ${kat === k ? "on" : ""}`}>
                {k}
              </button>
            ))}
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th style={{ width: 34 }}>No.</th><th>Kode Barang</th><th>Nama Barang</th><th>Kategori</th>
                  <th style={{ textAlign: "right" }}>Harga</th><th style={{ textAlign: "center" }}>Stok</th><th style={{ width: 40 }} />
                </tr>
              </thead>
              <tbody>
                {pageRows.map((it, i) => (
                  // Seluruh baris jadi tombol tambah — kasir tidak perlu membidik
                  // ikon "+" kecil di ujung kanan. Tombolnya tetap ada sebagai
                  // penanda visual bahwa baris ini bisa diklik.
                  <tr key={it.id} onClick={() => add(it)} style={{ cursor: "pointer" }} title={`Tambah ${it.name}`}>
                    <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{pageStart + i + 1}</td>
                    <td style={{ fontFamily: "monospace", fontSize: 10.5, color: "var(--tm)" }}>{it.code}</td>
                    <td style={{ fontSize: 11.5, fontWeight: 500 }}>
                      {it.name}
                      {/* Barang kosong: tawarkan penggantinya langsung, jangan biarkan
                          kasir bilang "habis" padahal ada substitusinya di rak. */}
                      {it.stok <= 0 && it.substitusi && (
                        <div style={{ fontSize: 9.5, color: "#b55a35" }}>
                          <i className="ti ti-arrow-right" /> ganti: {it.substitusi}
                        </div>
                      )}
                      {(it.minJual ?? 0) > 1 && (
                        <div style={{ fontSize: 9.5, color: "var(--td)" }}>min beli {it.minJual}</div>
                      )}
                    </td>
                    <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{it.kategori}</td>
                    <td style={{ textAlign: "right", fontSize: 11 }}>{rp(it.harga)}</td>
                    <td style={{ textAlign: "center", fontSize: 11, color: it.stok <= 0 ? "#b91c1c" : it.stok < 10 ? "#b55a35" : "var(--tm)" }}>{it.stok}</td>
                    <td style={{ textAlign: "center" }}>
                      {/* stopPropagation: tanpa ini klik tombol ikut memicu klik
                          baris di atasnya → barang masuk keranjang dua kali. */}
                      <button type="button" onClick={(e) => { e.stopPropagation(); add(it); }} className="btn-acc" style={{ padding: "3px 8px", fontSize: 11, background: "var(--posb)" }} title="Tambah"><i className="ti ti-plus" /></button>
                    </td>
                  </tr>
                ))}
                {shown.length === 0 && <tr><td colSpan={7} style={{ textAlign: "center", color: "var(--td)", padding: "18px 0", fontSize: 11 }}>Produk tidak ditemukan.</td></tr>}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 4, padding: "11px 0" }}>
              <button type="button" className="kpos-pagebtn" disabled={safePage === 1} onClick={() => setPage(safePage - 1)}>
                <i className="ti ti-chevron-left" />
              </button>
              {pageNumbers.map((n) => (
                <button key={n} type="button" className={`kpos-pagebtn ${n === safePage ? "on" : ""}`} onClick={() => setPage(n)}>{n}</button>
              ))}
              <button type="button" className="kpos-pagebtn" disabled={safePage === totalPages} onClick={() => setPage(safePage + 1)}>
                <i className="ti ti-chevron-right" />
              </button>
            </div>
          )}
        </div>

        {/* KERANJANG BELANJA */}
        <form action={checkoutKasir} className="card">
          <input type="hidden" name="customerId" value={cust?.id ?? ""} />
          <input type="hidden" name="cart" value={JSON.stringify(cart)} />
          <input type="hidden" name="diskon" value={diskonVal} />
          <input type="hidden" name="poinDigunakan" value={poinUsed} />
          <input type="hidden" name="voucherCode" value={v ? v.code : ""} />
          <input type="hidden" name="metode" value={metode} />
          <input type="hidden" name="bayar" value={bayar} />

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: "var(--posb)", letterSpacing: ".03em" }}>KERANJANG BELANJA</span>
            {cart.length > 0 && (
              <button type="button" onClick={() => setCart([])} className="back-btn" style={{ color: "#b91c1c", fontSize: 10.5 }}>
                <i className="ti ti-trash" /> Kosongkan
              </button>
            )}
          </div>

          <div style={{ maxHeight: 230, overflowY: "auto", marginBottom: 8 }}>
            {cart.length === 0 ? (
              <div style={{ fontSize: 10.5, color: "var(--td)", textAlign: "center", padding: "16px 0" }}>Klik baris produk untuk menambah.</div>
            ) : (
              <table className="tbl">
                <thead>
                  <tr>
                    <th style={{ width: 22 }}>No.</th><th>Nama Barang</th><th style={{ textAlign: "center", width: 58 }}>Qty</th>
                    <th style={{ textAlign: "right" }}>Subtotal</th><th style={{ width: 26 }} />
                  </tr>
                </thead>
                <tbody>
                  {cart.map((l, i) => {
                    const disc = lineDiscount(l);
                    const k = kunciBaris(l);
                    return (
                      <tr key={k}>
                        <td style={{ fontSize: 10, color: "var(--tm)" }}>{i + 1}</td>
                        <td style={{ fontSize: 10.5 }}>
                          {l.nama}
                          <div style={{ fontSize: 9, color: "var(--td)" }}>
                            {rp(l.harga)}{l.satuan ? ` / ${l.satuan}` : ""}
                          </div>
                          {/* Satuan berjenjang: muncul hanya untuk barang yang punya
                              lebih dari satu satuan. Ganti satuan = ganti harga. */}
                          {l.opsiSatuan && l.opsiSatuan.length > 1 && (
                            <select
                              className="fi" value={l.satuan ?? ""}
                              onChange={(e) => setSatuan(k, e.target.value)}
                              style={{ marginTop: 2, padding: "1px 4px", fontSize: 9, width: "100%", maxWidth: 130 }}
                            >
                              {l.opsiSatuan.map((o) => (
                                <option key={o.unit} value={o.unit}>
                                  {o.unit} — {rp(o.sell_price)}
                                  {o.factor > 1 ? ` (isi ${o.factor})` : ""}
                                </option>
                              ))}
                            </select>
                          )}
                          {/* Addendum §6: potongan per item (nominal / persen) */}
                          <div style={{ display: "flex", alignItems: "center", gap: 3, marginTop: 2 }}>
                            <span style={{ fontSize: 8.5, color: "var(--td)" }}>Pot.</span>
                            <input className="fi" type="number" min={0} value={l.item_discount_value || ""} placeholder="0"
                              onChange={(e) => setPot(k, Number(e.target.value))}
                              style={{ width: 52, padding: "1px 4px", fontSize: 9, textAlign: "right" }} />
                            <button type="button" onClick={() => togglePotType(k)} className="btn-def" style={{ padding: "0px 5px", fontSize: 8.5 }}>
                              {l.item_discount_type === "percent" ? "%" : "Rp"}
                            </button>
                          </div>
                        </td>
                        <td>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 3 }}>
                            <button type="button" onClick={() => setQty(k, -1)} className="kpos-qtybtn"><i className="ti ti-minus" /></button>
                            <span style={{ fontSize: 10.5, minWidth: 14, textAlign: "center" }}>{l.qty}</span>
                            <button type="button" onClick={() => setQty(k, 1)} className="kpos-qtybtn"><i className="ti ti-plus" /></button>
                          </div>
                          {(l.faktor ?? 1) > 1 && (
                            <div style={{ fontSize: 8.5, color: "var(--td)", textAlign: "center", marginTop: 1 }}>
                              = {l.qty * (l.faktor ?? 1)} pcs
                            </div>
                          )}
                        </td>
                        <td style={{ textAlign: "right", fontSize: 10.5, fontWeight: 500 }}>
                          {rp(l.qty * l.harga - disc)}
                          {disc > 0 && <div style={{ fontSize: 8.5, color: "#b91c1c", fontWeight: 400 }}>pot. {rp(disc)}</div>}
                        </td>
                        <td style={{ textAlign: "center" }}>
                          <i className="ti ti-x" onClick={() => removeLine(k)}
                            style={{ cursor: "pointer", color: "#dc2626", fontSize: 13 }} title="Hapus" />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          <div style={{ borderTop: ".5px solid var(--bd)", paddingTop: 8 }}>
            <Row k={`Total item`} v={`${cart.reduce((a, l) => a + l.qty, 0)}`} />
            <Row k="Subtotal" v={rp(subtotal)} />
            {itemDiscTotal > 0 && <Row k="Pot. per item" v={`- ${rp(itemDiscTotal)}`} red />}
            {promoTerpakai > 0 && (
              <div style={{ fontSize: 9.5, color: "#15803d", margin: "-2px 0 4px" }}>
                <i className="ti ti-discount-2" /> termasuk promo:{" "}
                {[...new Set(potonganPromo.map((p) => p.promoName))].join(", ")}
              </div>
            )}
            {diskonKategori > 0 && (
              // Persen tidak lagi ditulis di label: sejak 0082 satu transaksi
              // bisa memakai beberapa persen sekaligus (beda per barang), jadi
              // satu angka di judul justru menyesatkan.
              <Row k={`Diskon ${cust?.kategori ?? "golongan"}`} v={`- ${rp(diskonKategori)}`} red />
            )}

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "4px 0", gap: 6 }}>
              <span style={{ fontSize: 10.5, color: "var(--tm)" }}>Diskon</span>
              <span style={{ display: "flex", gap: 4 }}>
                <input className="fi" type="number" min={0} value={diskon || ""} onChange={(e) => setDiskon(Number(e.target.value))} placeholder="0" style={{ width: 90, padding: "3px 7px", textAlign: "right", fontSize: 11 }} />
                <button type="button" onClick={() => setDiskonPct(!diskonPct)} className="btn-def" style={{ padding: "2px 8px", fontSize: 10 }}>{diskonPct ? "%" : "Rp"}</button>
              </span>
            </div>
            {diskonVal > 0 && <Row k="" v={`- ${rp(diskonVal)}`} red />}

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "4px 0" }}>
              <span style={{ fontSize: 10.5, color: "var(--tm)" }}>Poin digunakan {cust ? `(maks ${maxPoin.toLocaleString("id-ID")})` : ""}</span>
              <input className="fi" type="number" min={0} max={maxPoin} value={poin || ""} disabled={!cust}
                onChange={(e) => setPoin(Number(e.target.value))} placeholder="0" style={{ width: 90, padding: "3px 7px", textAlign: "right", fontSize: 11 }} />
            </div>
            {poinUsed > 0 && <Row k="" v={`- ${rp(poinUsed)}`} red />}

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "4px 0" }}>
              <span style={{ fontSize: 10.5, color: "var(--tm)" }}>Kode voucher</span>
              <input className="fi" value={voucher} onChange={(e) => setVoucher(e.target.value)} placeholder="mis. HEMAT10"
                style={{ width: 110, padding: "3px 7px", fontSize: 11, textTransform: "uppercase", borderColor: voucherInvalid ? "#fca5a5" : undefined }} />
            </div>
            {voucherVal > 0 && <Row k="" v={`- ${rp(voucherVal)}`} red />}
            {tolakVoucher && <div style={{ fontSize: 9.5, color: "#b91c1c", textAlign: "right", lineHeight: 1.5 }}>{tolakVoucher}</div>}

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "8px 0", paddingTop: 6, borderTop: "1px solid var(--bd)" }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: "var(--posb)" }}>TOTAL</span>
              <span style={{ fontSize: 19, fontWeight: 800, color: "var(--posb)" }}>{rp(total)}</span>
            </div>

            <div style={{ fontSize: 9.5, fontWeight: 700, color: "var(--tm)", letterSpacing: ".04em", marginBottom: 5 }}>METODE PEMBAYARAN</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 8 }}>
              {[
                { m: "Tunai", ic: "ti-cash" },
                { m: "Debit", ic: "ti-credit-card" },
                { m: "Kredit", ic: "ti-credit-card-pay" },
                { m: "QRIS", ic: "ti-qrcode" },
                { m: "E-Wallet", ic: "ti-wallet" },
              ].map(({ m, ic }) => (
                <button key={m} type="button" onClick={() => setMetode(m)}
                  className={`kpos-pay ${metode === m ? "on" : ""}`} style={{ minWidth: "31%" }}>
                  <span className="kpos-radio" />
                  <i className={`ti ${ic}`} /> {m}
                </button>
              ))}
            </div>

            {metode === "Tunai" && (
              <div style={{ marginBottom: 8 }}>
                <input className="fi" type="number" min={0} placeholder="Uang bayar" value={bayar || ""} onChange={(e) => setBayar(Number(e.target.value))} />
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, marginTop: 4, color: kurang ? "#b91c1c" : "#15803d" }}>
                  <span>{kurang ? "Kurang" : "Kembalian"}</span><span>{rp(kurang ? total - bayar : kembali)}</span>
                </div>
              </div>
            )}

            {dibawahMin.length > 0 && (
              <div style={{ fontSize: 10, color: "#b91c1c", marginBottom: 7 }}>
                <i className="ti ti-alert-circle" /> Di bawah minimum jual:{" "}
                {dibawahMin.map((l) => `${l.nama} (min ${l.minJual})`).join(", ")}
              </div>
            )}

            <SubmitButton className="kpos-bayar" icon="ti-circle-check" disabled={!canPay} pendingText="Memproses…">Bayar {rp(total)}</SubmitButton>
          </div>
        </form>
      </div>

      {/* Reminder Promo (§6): modal tengah non-blocking — saran utk kasir, bukan auto-apply. */}
      {promoHits.length > 0 && !promoDismissed && (
        <div style={{ position: "fixed", inset: 0, zIndex: 50, background: "rgba(0,0,0,.35)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
          onClick={() => setDismissedAtCartLen(cart.length)}>
          <div style={{ width: 480, maxWidth: "92vw", maxHeight: "80vh", overflowY: "auto", background: "#fff", borderRadius: 12, boxShadow: "0 12px 40px rgba(0,0,0,.28)", overflow: "hidden" }}
            onClick={(e) => e.stopPropagation()}>
            <div style={{ background: "var(--posb)", color: "#fff", padding: "13px 18px", display: "flex", alignItems: "center", gap: 8 }}>
              <i className="ti ti-speakerphone" style={{ fontSize: 18 }} />
              <span style={{ fontSize: 15, fontWeight: 700, flex: 1 }}>Reminder Promo</span>
              <i className="ti ti-x" style={{ cursor: "pointer", fontSize: 16 }} onClick={() => setDismissedAtCartLen(cart.length)} />
            </div>
            <div style={{ padding: "14px 18px" }}>
              {promoHits.map((p) => (
                <div key={p.id} style={{ padding: "11px 0", borderBottom: ".5px dashed var(--bd)" }}>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>
                    <i className={`ti ${p.promo_type === "bundling" ? "ti-gift" : p.promo_type === "tebus_murah" ? "ti-tag" : "ti-discount-2"}`} style={{ marginRight: 6, color: "var(--acc)", fontSize: 16 }} />
                    {p.name}
                  </div>
                  {p.rule?.suggest && <div style={{ fontSize: 12.5, color: "var(--tm)", marginTop: 4 }}>{p.rule.suggest}</div>}
                </div>
              ))}
              <div style={{ fontSize: 11, color: "var(--td)", marginTop: 12 }}>
                Tawarkan ke customer — terapkan manual via potongan item / diskon bila diambil.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Daftar Promo Hari Ini — referensi kasir (read-only), diset dari pusat per cabang. */}
      {showPromoList && (
        <div style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(0,0,0,.35)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
          onClick={() => setShowPromoList(false)}>
          <div style={{ width: 460, maxHeight: "80vh", overflowY: "auto", background: "#fff", borderRadius: 12, overflow: "hidden" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ background: "var(--posb)", color: "#fff", padding: "11px 14px", display: "flex", alignItems: "center", gap: 8 }}>
              <i className="ti ti-speakerphone" />
              <span style={{ fontSize: 13, fontWeight: 700, flex: 1 }}>Promo Hari Ini · {branchName}</span>
              <i className="ti ti-x" style={{ cursor: "pointer" }} onClick={() => setShowPromoList(false)} />
            </div>
            <div style={{ padding: "12px 14px" }}>
              {promos.length === 0 ? (
                <div style={{ fontSize: 11.5, color: "var(--td)", textAlign: "center", padding: "16px 0" }}>Tidak ada promo aktif hari ini untuk cabang ini.</div>
              ) : (
                promos.map((p) => (
                  <div key={p.id} style={{ padding: "9px 0", borderBottom: ".5px dashed var(--bd)" }}>
                    <div style={{ fontSize: 12, fontWeight: 700 }}>
                      <i className={`ti ${p.promo_type === "bundling" ? "ti-gift" : p.promo_type === "tebus_murah" ? "ti-tag" : "ti-discount-2"}`} style={{ marginRight: 5, color: "var(--posb)" }} />
                      {p.name}
                    </div>
                    {p.rule?.suggest && <div style={{ fontSize: 11, color: "var(--tm)", marginTop: 2 }}>{p.rule.suggest}</div>}
                    <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 3 }}>
                      {p.rule?.discount_value != null && <span>Diskon {p.rule.discount_value}{p.rule.discount_type === "percent" ? "%" : " Rp"} · </span>}
                      Berlaku {p.valid_from ?? "—"} s/d {p.valid_until ?? "∞"}
                    </div>
                  </div>
                ))
              )}
              <div style={{ fontSize: 9, color: "var(--td)", marginTop: 10 }}>
                Diset dari pusat untuk cabang ini. Tawarkan ke customer — terapkan manual via potongan item / diskon.
              </div>
            </div>
          </div>
        </div>
      )}

      {showAddCust && (
        <div onClick={() => !addPending && setShowAddCust(false)}
          style={{ position: "fixed", inset: 0, zIndex: 50, background: "rgba(0,0,0,.4)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "40px 16px", overflowY: "auto" }}>
          <form action={submitNewCust} onClick={(e) => e.stopPropagation()}
            className="card" style={{ width: 520, maxWidth: "100%", padding: 20 }}>
            <div style={{ display: "flex", alignItems: "center", marginBottom: 12 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: "var(--posb)" }}>
                <i className="ti ti-user-plus" style={{ marginRight: 6 }} />Tambah Customer Baru
              </span>
              <button type="button" onClick={() => setShowAddCust(false)} className="back-btn" style={{ marginLeft: "auto" }}><i className="ti ti-x" /></button>
            </div>

            {addErr && (
              <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c", marginBottom: 10 }}>
                <i className="ti ti-alert-circle" /> {addErr}
              </div>
            )}

            <div className="frow">
              <div className="fg"><label className="flab">Nama <span style={{ color: "#dc2626" }}>*</span></label>
                <input className="fi" name="nama" placeholder="Andi Santoso" required /></div>
              <div className="fg"><label className="flab">No. HP <span style={{ color: "#dc2626" }}>*</span></label>
                <input className="fi" name="phone" placeholder="081234567890" required /></div>
            </div>
            <div className="frow">
              <div className="fg"><label className="flab">Email</label>
                <input className="fi" name="email" type="email" placeholder="andi@email.com" /></div>
              <div className="fg"><label className="flab">Tgl Lahir</label>
                <input className="fi" name="dob" type="date" /></div>
            </div>
            <div className="fg"><label className="flab">Alamat</label>
              <input className="fi" name="alamat" placeholder="Jl. Merdeka No. 10, Jakarta" /></div>
            <div className="frow">
              <div className="fg"><label className="flab">Pekerjaan</label>
                <input className="fi" name="pekerjaan" placeholder="Wiraswasta" /></div>
              <div className="fg"><label className="flab">Sumber Info</label>
                <input className="fi" name="sumber_info" placeholder="Instagram, Teman, dll." /></div>
            </div>
            <div className="fg"><label className="flab">Catatan</label>
              <textarea className="fi" name="catatan" placeholder="Catatan tambahan..." rows={3} style={{ resize: "vertical" }} /></div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
              <button type="button" onClick={() => setShowAddCust(false)} className="btn-def" disabled={addPending}>Batal</button>
              <button type="submit" className="btn-acc" disabled={addPending}>
                {addPending ? "Menyimpan..." : "Simpan & Pilih"}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}

function CustStat({ icon, label, sub, accent }: { icon: string; label: string; sub: string; accent?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <i className={`ti ${icon}`} style={{ fontSize: 18, color: accent ? "var(--acc)" : "var(--posb)" }} />
      <div>
        <div style={{ fontSize: 12.5, fontWeight: 700 }}>{label}</div>
        <div style={{ fontSize: 9, color: "var(--td)" }}>{sub}</div>
      </div>
    </div>
  );
}
function Row({ k, v, red }: { k: string; v: string; red?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, color: red ? "#b91c1c" : "var(--tm)", margin: "2px 0" }}>
      <span>{k}</span><span>{v}</span>
    </div>
  );
}
