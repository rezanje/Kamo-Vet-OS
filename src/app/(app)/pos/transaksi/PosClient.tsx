"use client";

import { NumberInput } from "@/components/NumberInput";

import { useEffect, useMemo, useRef, useState } from "react";
import { checkoutSale } from "./actions";
import { SubmitButton } from "@/components/SubmitButton";
import { HppConfirmField } from "@/components/HppConfirmField";
import { pickUnit, type ItemUnit } from "@/lib/satuan";
import { diskonGolonganKeranjang, poinDidapat, type AturanDiskon, type BarangDiskon } from "@/lib/harga-golongan";
import { bacaDraftPos, POS_DRAFT_KEY, type PosDraft } from "@/lib/pos-draft";
import { ServicePerformersField } from "@/components/ServicePerformersField";
import { bulkFillServicePerformers, emptyServicePerformers, type ServicePerformersInput, type ServiceStaff } from "@/lib/service-performers";
import { PosPaymentFields } from "@/components/pos/PosPaymentFields";
import { resolvePosPayments, type PosPaymentPart } from "@/lib/pos-payments";
import { quotePosMerchantFees } from "@/lib/pos-merchant-fees";
import { totalPotonganPromo, type PromoHitung } from "@/lib/promo-hitung";
import { aggregateServiceLines, serviceLinePromos } from "@/lib/service-line-promos";
import { posNetTotal, posSubtotal } from "@/lib/pos-money";
import { bacaKode, pesanKampanyeDitolak, promoDenganKode, type KodeKampanye } from "@/lib/kode-kampanye";
import { pesanVoucherDitolak, potonganVoucher, type VoucherRow } from "@/lib/voucher";

export type Item = { id: string; code?: string; name: string; item_type?: string; tindakan_kategori?: string | null; sell_price: number; target_species: string; units: ItemUnit[] };
export type Pet = { id: string; name: string; species: string | null };
export type Cust = {
  id: string; name: string; phone: string; points: number; pets: Pet[];
  golonganId?: string | null;
  golongan: { nama: string; diskon_persen: number; rupiah_per_poin?: number | null } | null;
};
type Branch = { id: string; code: string; name: string };
type Line = {
  row_key: string; item_type?: string; tindakan_kategori?: string | null; service_performers: ServicePerformersInput | null;
  item_id: string; nama: string; qty: number; harga: number; target_species: string;
  satuan: string; faktor: number;
};

const rp = (n: number) => "Rp " + n.toLocaleString("id-ID", { maximumFractionDigits: 2 });
// Jasa yang sama boleh berulang dengan pelaksana berbeda; identitas baris tetap
// utuh saat jumlah, satuan, atau pilihan pelaksana diubah.
const lineKey = (l: { row_key: string }) => l.row_key;
const sameProductUnit = (a: Line, b: Line) => a.item_id === b.item_id && a.satuan === b.satuan;

// Harga jual bisa dikecualikan per cabang (migrasi 0073). Yang dikirim ke sini
// HANYA pengecualiannya — jumlahnya sedikit — jadi ganti cabang cukup dihitung
// ulang di layar, tidak perlu bolak-balik ke server.
export type HargaPerCabang = Record<string, Record<string, number>>; // branchId → "itemId|satuan" → harga

export function PosClient({ items, customers, branches, serviceStaffByBranch = {}, groomingDoctorByBranch = {}, groomingAppliesByBranch = {}, hargaPerCabang = {}, promoPerCabang = {}, aturanDiskon = {}, infoBarang = {}, kodeKampanye = [], voucherKampanye = [], hariIni = "", hppWarning = null, hppSignature = null }: {
  items: Item[]; customers: Cust[]; branches: Branch[]; serviceStaffByBranch?: Record<string, ServiceStaff[]>; groomingDoctorByBranch?: Record<string, boolean>; groomingAppliesByBranch?: Record<string, boolean>; hargaPerCabang?: HargaPerCabang;
  /** P03: peringatan jual di bawah HPP dari simpan sebelumnya; wajib dikonfirmasi sebelum simpan ulang. */
  hppWarning?: string | null; hppSignature?: string | null;
  promoPerCabang?: Record<string, PromoHitung[]>;
  /** C05: kode kampanye aktif + voucher tujuannya — hanya untuk tampilan; server memeriksa ulang. */
  kodeKampanye?: KodeKampanye[];
  voucherKampanye?: VoucherRow[];
  hariIni?: string;
  aturanDiskon?: Record<string, AturanDiskon[]>;
  infoBarang?: Record<string, BarangDiskon>;
}) {
  const [branchId, setBranchId] = useState("");
  const [q, setQ] = useState("");
  const [cart, setCart] = useState<Line[]>([]);
  const [custQ, setCustQ] = useState("");
  const [cust, setCust] = useState<Cust | null>(null);
  const [petId, setPetId] = useState<string>("");
  const [metode, setMetode] = useState("Tunai");
  const [discount, setDiscount] = useState(0);
  const [voucher, setVoucher] = useState("");
  const [bayar, setBayar] = useState(0);
  const [split, setSplit] = useState(false);
  const [merchantFeePercent, setMerchantFeePercent] = useState(0);
  const [payments, setPayments] = useState<PosPaymentPart[]>([{ method: "Tunai", amount: 0 }, { method: "Transfer", amount: 0 }]);
  const [bulkPerformers, setBulkPerformers] = useState<ServicePerformersInput>(emptyServicePerformers);
  // Hanya dipertahankan untuk identitas retry draft lama; kasir aktual selalu
  // berasal dari akun di server dan tidak dapat dipilih dari layar.
  const [legacySalespersonId, setLegacySalespersonId] = useState("");
  const [checkoutKey, setCheckoutKey] = useState("");
  const draftReady = useRef(false);

  useEffect(() => {
    if (draftReady.current) return;
    const timer = window.setTimeout(() => {
      const draft = bacaDraftPos(sessionStorage.getItem(POS_DRAFT_KEY));
      setCheckoutKey(draft?.checkoutKey ?? crypto.randomUUID());
      if (draft) {
        const branchExists = branches.some((branch) => branch.id === draft.branchId);
        const branch = branchExists ? draft.branchId : "";
        const customer = customers.find((candidate) => candidate.id === draft.customerId) ?? null;
        const rowKeys = new Set<string>();
        const restoredCart = draft.cart.flatMap((line): Line[] => {
          const item = items.find((candidate) => candidate.id === line.item_id);
          const unit = item?.units.find((candidate) => candidate.unit === line.satuan);
          if (!item || !unit) return [];
          const price = hargaPerCabang[branch]?.[`${item.id}|${unit.unit}`] ?? unit.sell_price;
          const rowKey = line.row_key && !rowKeys.has(line.row_key) ? line.row_key : crypto.randomUUID();
          rowKeys.add(rowKey);
          return [{ ...line, row_key: rowKey, item_type: item.item_type, tindakan_kategori: item.tindakan_kategori,
            service_performers: line.service_performers ?? emptyServicePerformers(),
            nama: item.name, target_species: item.target_species, harga: price, faktor: unit.factor }];
        });
        setBranchId(branch);
        setCust(customer);
        setCustQ(customer?.name ?? "");
        setPetId(customer?.pets.some((pet) => pet.id === draft.petId) ? draft.petId : "");
        setLegacySalespersonId(draft.salespersonId);
        setMetode(draft.metode || "Tunai");
        setMerchantFeePercent(draft.merchantFeePercent ?? 0);
        setSplit(draft.split ?? draft.metode === "Split");
        if (draft.payments?.length) setPayments(draft.payments);
        setDiscount(draft.discount);
        setVoucher(draft.voucher ?? "");
        setBayar(draft.bayar);
        setCart(restoredCart);
      }
      draftReady.current = true;
    }, 0);
    return () => window.clearTimeout(timer);
  }, [branches, customers, hargaPerCabang, items]);

  useEffect(() => {
    if (!draftReady.current) return;
    if (!cart.length) {
      sessionStorage.removeItem(POS_DRAFT_KEY);
      return;
    }
    const draft: PosDraft = {
      version: 1,
      savedAt: Date.now(),
      checkoutKey,
      branchId,
      customerId: cust?.id ?? "",
      petId,
      salespersonId: legacySalespersonId,
      metode,
      split,
      payments,
      ...(merchantFeePercent ? { merchantFeePercent } : {}),
      discount,
      bayar,
      ...(voucher.trim() ? { voucher } : {}),
      cart,
    };
    sessionStorage.setItem(POS_DRAFT_KEY, JSON.stringify(draft));
  }, [branchId, bayar, cart, cust?.id, discount, voucher, metode, split, payments, merchantFeePercent, petId, legacySalespersonId, checkoutKey]);

  // Katalog dengan harga cabang terpasang — dasar untuk tampilan & keranjang.
  const katalog = useMemo(() => {
    const ov = hargaPerCabang[branchId];
    if (!ov) return items;
    return items.map((i) => {
      const units = i.units.map((u) => ({ ...u, sell_price: ov[`${i.id}|${u.unit}`] ?? u.sell_price }));
      return { ...i, units, sell_price: units[0]?.sell_price ?? i.sell_price };
    });
  }, [items, hargaPerCabang, branchId]);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? katalog.filter((i) => `${i.code ?? ""} ${i.name}`.toLowerCase().includes(s)) : katalog;
  }, [katalog, q]);

  const custHits = useMemo(() => {
    const s = custQ.trim().toLowerCase();
    if (!s) return [];
    return customers.filter((c) => c.name.toLowerCase().includes(s) || c.phone.includes(s)).slice(0, 5);
  }, [customers, custQ]);

  const unitsOf = (itemId: string) => katalog.find((i) => i.id === itemId)?.units ?? [];

  // Pindah cabang = harga keranjang ikut berubah; kalau tidak, kasir bisa checkout
  // dengan harga cabang lain yang tampil di layar.
  const gantiCabang = (id: string) => {
    setBranchId(id);
    setBulkPerformers(emptyServicePerformers());
    const ov = hargaPerCabang[id];
    setCart((c) => c.map((l) => ({
      ...l,
      service_performers: emptyServicePerformers(),
      harga: ov?.[`${l.item_id}|${l.satuan}`]
        ?? items.find((i) => i.id === l.item_id)?.units.find((u) => u.unit === l.satuan)?.sell_price
        ?? l.harga,
    })));
  };

  const add = (it: Item) =>
    setCart((c) => {
      const u = it.units[0];
      const baris: Line = {
        row_key: crypto.randomUUID(), item_type: it.item_type, tindakan_kategori: it.tindakan_kategori,
        service_performers: emptyServicePerformers(),
        item_id: it.id, nama: it.name, qty: 1, harga: u.sell_price,
        target_species: it.target_species, satuan: u.unit, faktor: u.factor,
      };
      if (it.item_type !== "Jasa" && c.some((l) => sameProductUnit(l, baris))) {
        return c.map((l) => sameProductUnit(l, baris) ? { ...l, qty: l.qty + 1 } : l);
      }
      return [...c, baris];
    });
  const setQty = (k: string, d: number) =>
    setCart((c) => c.flatMap((l) => (lineKey(l) === k ? (l.qty + d <= 0 ? [] : [{ ...l, qty: l.qty + d }]) : [l])));
  const remove = (k: string) => setCart((c) => c.filter((l) => lineKey(l) !== k));

  // Ganti satuan → harga ikut satuan baru. Barang fisik dengan satuan tujuan
  // yang sama tetap digabung; setiap baris jasa mempertahankan identitasnya.
  const setSatuan = (k: string, unit: string) =>
    setCart((c) => {
      const l = c.find((x) => lineKey(x) === k);
      if (!l) return c;
      const u = pickUnit(unitsOf(l.item_id), unit);
      const baru: Line = { ...l, satuan: u.unit, faktor: u.factor, harga: u.sell_price };
      const kembar = l.item_type === "Jasa" ? undefined : c.find((x) => sameProductUnit(x, baru) && x !== l);
      if (kembar) return c.flatMap((x) => (x === l ? [] : x === kembar ? [{ ...kembar, qty: kembar.qty + l.qty }] : [x]));
      return c.map((x) => (x === l ? baru : x));
    });

  const subtotal = posSubtotal(cart);
  // Pakai rumus dan master yang sama dengan checkout, termasuk promo cabang
  // serta pengecualian diskon golongan per produk/kategori.
  // C05: kode kampanye terikat promo → promo itu ikut dipotong; terikat voucher → rumus voucher itu.
  const kode = bacaKode(voucher, kodeKampanye);
  const promoCabang = promoDenganKode(promoPerCabang[branchId] ?? [], kode.promoId);
  const rincianPromo = serviceLinePromos(promoCabang, cart);
  const promoDiscount = totalPotonganPromo(rincianPromo);
  const infoMap = useMemo(() => new Map(Object.entries(infoBarang)), [infoBarang]);
  const diskonKategori = diskonGolonganKeranjang(
    aggregateServiceLines(cart), cust?.golonganId ? aturanDiskon[cust.golonganId] ?? [] : [],
    cust?.golongan?.diskon_persen ?? 0, infoMap,
  );
  let tolakKode: string | null = null;
  let voucherVal = 0;
  if (voucher.trim()) {
    if (!kode.kampanye) tolakKode = `Kode kampanye ${kode.kode ?? ""} tidak ditemukan`;
    else tolakKode = pesanKampanyeDitolak(kode.kampanye,
      promoCabang.some((p) => p.id === kode.promoId), rincianPromo.some((h) => h.promoId === kode.promoId));
    if (!tolakKode && kode.kampanye && !kode.kampanye.promo_id) {
      const voucherRow = voucherKampanye.find((v) => v.code === kode.voucherCode) ?? null;
      const dasarVoucher = posNetTotal(subtotal, promoDiscount);
      tolakKode = pesanVoucherDitolak(voucherRow, hariIni, {
        dasar: dasarVoucher, adaPromoOtomatis: rincianPromo.length > 0,
        customerId: cust?.id ?? null, categoryId: cust?.golonganId ?? null,
      });
      if (!tolakKode && voucherRow) voucherVal = potonganVoucher(dasarVoucher, voucherRow);
    }
  }
  const total = posNetTotal(subtotal, promoDiscount, diskonKategori, discount, voucherVal);
  const kembali = Math.max(0, bayar - total);
  const poin = cust ? poinDidapat(total, cust.golongan?.rupiah_per_poin) : 0;
  const kurang = metode === "Tunai" && bayar < total;
  let paymentValid = true;
  let feeTotal = 0;
  let finalTotal = total;
  try {
    const quote = quotePosMerchantFees({ total, method: split ? "Split" : metode, payments: split ? payments : [], feePercent: split ? 0 : merchantFeePercent });
    feeTotal = quote.feeTotal;
    finalTotal = quote.total;
    resolvePosPayments({ total: quote.total, method: split ? "Split" : metode, bayar, payments: split ? quote.parts : [] });
  } catch { paymentValid = false; }
  const canPay = checkoutKey && branchId && cart.length > 0 && paymentValid && !tolakKode;

  const pickCust = (c: Cust) => { setCust(c); setCustQ(c.name); setPetId(""); };
  const clearCust = () => { setCust(null); setCustQ(""); setPetId(""); };

  return (
    <form action={checkoutSale}>
      <input type="hidden" name="checkout_key" value={checkoutKey} />
      <input type="hidden" name="branchId" value={branchId} />
      <input type="hidden" name="customerId" value={cust?.id ?? ""} />
      <input type="hidden" name="petId" value={petId} />
      <input type="hidden" name="salespersonId" value={legacySalespersonId} />
      <input type="hidden" name="metode" value={split ? "Split" : metode} />
      <input type="hidden" name="split_payments" value={JSON.stringify(split ? payments : [])} />
      <input type="hidden" name="merchant_fee_percent" value={split ? 0 : merchantFeePercent} />
      <input type="hidden" name="discount" value={discount} />
      <input type="hidden" name="voucherCode" value={voucher} />
      <input type="hidden" name="bayar" value={bayar} />
      <input type="hidden" name="cart" value={JSON.stringify(cart)} />

      <div style={{ marginBottom: 9, display: "flex", gap: 7 }}>
        <select className="fi" value={branchId} onChange={(e) => gantiCabang(e.target.value)} style={{ width: 220 }} required>
          <option value="">Pilih cabang *</option>
          {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <input className="fi" placeholder="Cari produk..." value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1 }} />
      </div>

      <div className="pos-wrap">
        <div>
          <div className="pos-pgrid">
            {shown.map((it) => (
              <div key={it.id} className="pos-p" onClick={() => add(it)}>
                <i className="ti ti-package" style={{ fontSize: 20, color: "var(--td)" }} />
                <div className="pos-pn">{it.name}</div>
                <div className="pos-pp">{rp(it.sell_price)}<span style={{ fontSize: 8, fontWeight: 400, color: "var(--td)" }}> /{it.units[0]?.unit ?? "pcs"}</span></div>
                <div style={{ fontSize: 8, color: "var(--td)", marginTop: 2 }}>
                  {it.target_species}
                  {it.units.length > 1 && ` · ${it.units.slice(1).map((u) => u.unit).join("/")}`}
                </div>
              </div>
            ))}
            {shown.length === 0 && <div style={{ gridColumn: "1/-1", textAlign: "center", color: "var(--td)", fontSize: 11, padding: 20 }}>Produk tidak ditemukan.</div>}
          </div>
        </div>

        <div className="cart">
          <div style={{ fontSize: 12, fontWeight: 500 }}>
            <i className="ti ti-shopping-cart" style={{ fontSize: 14, verticalAlign: -1, color: "var(--acc)", marginRight: 5 }} />
            Keranjang ({cart.length})
          </div>

          {/* Pelanggan */}
          <div style={{ position: "relative" }}>
            <input className="fi" placeholder="Cari pelanggan / member..." value={custQ}
              onChange={(e) => { setCustQ(e.target.value); setCust(null); }} />
            {cust && <i className="ti ti-x" onClick={clearCust} style={{ position: "absolute", right: 8, top: 8, cursor: "pointer", color: "var(--td)", fontSize: 13 }} />}
            {!cust && custHits.length > 0 && (
              <div style={{ position: "absolute", zIndex: 5, top: "100%", left: 0, right: 0, background: "#fff", border: ".5px solid var(--bd)", borderRadius: 6, marginTop: 2, boxShadow: "0 2px 8px rgba(0,0,0,.1)" }}>
                {custHits.map((c) => (
                  <div key={c.id} onClick={() => pickCust(c)} style={{ padding: "6px 9px", cursor: "pointer", fontSize: 11, borderBottom: ".5px solid var(--bd)" }}>
                    {c.name} <span style={{ color: "var(--td)" }}>· {c.phone}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          {cust && (
            <div style={{ fontSize: 10, color: "var(--tm)" }}>
              {cust.points.toLocaleString("id-ID")} poin
              {cust.pets.length > 0 && (
                <span style={{ display: "flex", gap: 4, marginTop: 4, flexWrap: "wrap" }}>
                  {cust.pets.map((p) => (
                    <button type="button" key={p.id} onClick={() => setPetId(petId === p.id ? "" : p.id)}
                      style={{ padding: "2px 7px", borderRadius: 20, border: ".5px solid var(--bd)", cursor: "pointer", fontSize: 9.5,
                        background: petId === p.id ? "var(--sb)" : "#fff", color: petId === p.id ? "#fff" : "var(--tm)" }}>
                      {p.name} ({p.species})
                    </button>
                  ))}
                </span>
              )}
            </div>
          )}

          <div style={{ fontSize: 10, color: "var(--td)" }}>Kasir tercatat otomatis dari akun yang sedang masuk.</div>
          {cart.length > 0 && <div data-service-bulk>
            <ServicePerformersField label="Isi pelaksana untuk baris yang masih kosong" value={bulkPerformers}
              staff={serviceStaffByBranch[branchId] ?? []} onChange={setBulkPerformers} />
            <button type="button" className="back-btn" disabled={!branchId || (!bulkPerformers.doctor_id && !bulkPerformers.staff_id)}
              onClick={() => setCart(rows => bulkFillServicePerformers(rows, bulkPerformers))}>Isi baris kosong</button>
            <p style={{ fontSize: 10, color: "var(--td)", margin: "5px 0" }}>Pilihan per baris yang sudah diisi tetap dipertahankan. Pelaksana dapat diubah pada setiap baris.</p>
          </div>}

          {/* Items */}
          {cart.map((l) => {
            const k = lineKey(l);
            const opts = unitsOf(l.item_id);
            return (
              <div key={k} data-service-row={k}>
              <div className="ci">
                <div style={{ flex: 1, fontSize: 10.5 }}>
                  {l.nama}
                  <div style={{ fontSize: 9, color: "var(--td)" }}>
                    {rp(l.harga)}/{l.satuan}
                    {l.faktor !== 1 && ` · ${l.faktor} ${opts[0]?.unit ?? ""} per ${l.satuan}`}
                  </div>
                </div>
                {opts.length > 1 && (
                  <select className="fi" value={l.satuan} onChange={(e) => setSatuan(k, e.target.value)}
                    style={{ width: 64, padding: "2px 4px", fontSize: 10 }} title="Satuan">
                    {opts.map((u) => <option key={u.unit} value={u.unit}>{u.unit}</option>)}
                  </select>
                )}
                <button type="button" aria-label={`Kurangi jumlah ${l.nama}`} onClick={() => setQty(k, -1)} className="back-btn" style={{ fontSize: 12 }}><i className="ti ti-minus" /></button>
                <span style={{ fontSize: 10.5, minWidth: 14, textAlign: "center" }}>{l.qty}</span>
                <button type="button" aria-label={`Tambah jumlah ${l.nama}`} onClick={() => setQty(k, 1)} className="back-btn" style={{ fontSize: 12 }}><i className="ti ti-plus" /></button>
                <div style={{ fontSize: 10.5, minWidth: 62, textAlign: "right" }}>{rp(l.qty * l.harga)}</div>
                <button type="button" aria-label={`Hapus ${l.nama}`} onClick={() => remove(k)} className="back-btn" style={{ color: "#b91c1c" }}><i className="ti ti-trash" /></button>
              </div>
              <ServicePerformersField label={`Pelaksana ${l.nama}`} value={l.service_performers}
                grooming={groomingAppliesByBranch[branchId] && l.item_type === "Jasa" && l.tindakan_kategori === "Grooming"} doctorRequired={groomingDoctorByBranch[branchId]}
                staff={serviceStaffByBranch[branchId] ?? []} onChange={value => setCart(rows => rows.map(row => row.row_key === k ? { ...row, service_performers: value } : row))} />
              </div>
            );
          })}
          {cart.length === 0 && <div style={{ fontSize: 10.5, color: "var(--td)", textAlign: "center", padding: "8px 0" }}>Klik produk untuk menambah.</div>}

          {/* Totals */}
          <div style={{ borderTop: ".5px solid var(--bd)", paddingTop: 7 }}>
            <Row k="Subtotal" v={rp(subtotal)} />
            {promoDiscount > 0 && <Row k="Promo otomatis" v={`-${rp(promoDiscount)}`} />}
            {diskonKategori > 0 && cust?.golongan && (
              <Row k={`Diskon ${cust.golongan.nama}`} v={`-${rp(diskonKategori)}`} />
            )}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 10.5, color: "var(--tm)", margin: "3px 0" }}>
              <span>Diskon manual / promo</span>
              <NumberInput className="fi" type="number" min={0} step="0.01" value={discount} onChange={(e) => setDiscount(Number(e.target.value))} style={{ width: 90, textAlign: "right", padding: "3px 6px" }} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 10.5, color: "var(--tm)", margin: "3px 0" }}>
              <span>Kode kampanye</span>
              <input className="fi" aria-label="Kode kampanye" value={voucher} placeholder="opsional" onChange={(e) => setVoucher(e.target.value)}
                style={{ width: 110, textTransform: "uppercase", padding: "3px 6px", borderColor: tolakKode ? "#fca5a5" : undefined }} />
            </div>
            {tolakKode && <div style={{ fontSize: 9.5, color: "#b91c1c", textAlign: "right" }}>{tolakKode}</div>}
            {voucherVal > 0 && <Row k={`Kode ${kode.kampanye?.code ?? ""}`} v={`-${rp(voucherVal)}`} />}
            <Row k="Tagihan barang" v={rp(total)} />
            <Row k="Fee merchant" v={rp(feeTotal)} />
            <div style={{ display: "flex", justifyContent: "space-between", margin: "6px 0" }}>
              <span style={{ fontSize: 12, fontWeight: 500 }}>Total</span>
              <span style={{ fontSize: 17, fontWeight: 600, color: "var(--acc)" }}>{rp(finalTotal)}</span>
            </div>
            {cust && <div style={{ fontSize: 9.5, color: "#16a34a", textAlign: "right" }}>+{poin} poin untuk {cust.name.split(" ")[0]}</div>}
          </div>

          {/* Metode */}
          <PosPaymentFields total={total} split={split} payments={payments} bayar={bayar}
            method={metode} feePercent={merchantFeePercent} onFeePercentChange={setMerchantFeePercent}
            onSplitChange={enabled => { setSplit(enabled); setMerchantFeePercent(0); if (!enabled) setPayments(payments.map(part => ({ method: part.method, amount: part.amount }))); }} onPaymentsChange={setPayments} onBayarChange={setBayar} />
          {!split && <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 4 }}>
            {["Tunai", "QRIS", "Transfer"].map((m) => (
              <button type="button" key={m} onClick={() => { if (m !== metode) setMerchantFeePercent(0); setMetode(m); }} className="back-btn"
                style={{ padding: "5px 0", justifyContent: "center", borderRadius: 6, border: ".5px solid var(--bd)", fontSize: 10.5,
                  background: metode === m ? "var(--sb)" : "#fff", color: metode === m ? "#fff" : "var(--tm)" }}>{m}</button>
            ))}
          </div>}
          {!split && metode === "Tunai" && (
            <div style={{ marginTop: 6 }}>
              <NumberInput className="fi" type="number" min={0} placeholder="Uang dibayar" value={bayar || ""} onChange={(e) => setBayar(Number(e.target.value))} />
              {bayar > 0 && <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, marginTop: 4, color: kurang ? "#b91c1c" : "#16a34a" }}>
                <span>{kurang ? "Kurang" : "Kembali"}</span><span>{rp(kurang ? total - bayar : kembali)}</span>
              </div>}
            </div>
          )}

          <HppConfirmField warning={hppWarning} signature={hppSignature} />
          <SubmitButton className="pay-btn" icon="ti-circle-check" disabled={!canPay} style={{ marginTop: 8, opacity: canPay ? 1 : 0.5 }} pendingText="Memproses…">Bayar {rp(finalTotal)}</SubmitButton>
        </div>
      </div>
    </form>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, color: "var(--tm)" }}><span>{k}</span><span>{v}</span></div>;
}
