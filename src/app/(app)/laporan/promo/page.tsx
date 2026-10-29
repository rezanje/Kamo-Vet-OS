import Link from "next/link";
import { completeReportQuery } from "@/lib/report-query";
import { createClient } from "@/lib/supabase/server";
import { LaporanPage, KartuAngka, TabelKosong } from "@/components/LaporanPage";
import { voucherStatus, type VoucherRow } from "@/lib/voucher";
import { lineDiscount } from "@/lib/pos-calc";
import { rentangBulan } from "@/lib/pertumbuhan";
import { hariIniWIB, tanggalWIB } from "@/lib/tanggal";
import { tanggalIndo } from "@/lib/followup";
import { isCompletedSale, type SaleCompletion } from "@/lib/sale-payment-reporting";
import { hrefInvoiceKlinik } from "@/lib/tautan-dokumen";

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
  searchParams: Promise<{ dari?: string; sampai?: string; promo_id?: string; cabang?: string; kanal?: string }>;
}) {
  const sp = await searchParams;
  const dari = sp.dari || awalBulan();
  const sampai = sp.sampai || hariIniWIB();
  // Satu kotak "Program" untuk promo, voucher, dan kode kampanye sekaligus.
  // Nilai promo tetap UUID telanjang supaya preset laporan lama tetap terbuka.
  const promoId = (sp.promo_id ?? "").slice(0, 80);
  const cabang = (sp.cabang ?? "").slice(0, 120);
  const kanal = sp.kanal === "Petshop" || sp.kanal === "Klinik" ? sp.kanal : "";
  const mulai = `${dari}T00:00:00+07:00`;
  const akhir = `${sampai}T23:59:59+07:00`;

  const supabase = await createClient();
  const [{ data: salesData }, { data: invData }, { data: voucherData }, { data: promoData }, { data: targetData },
    { data: kodeData }, pemakaianKode, { data: cabangList }] =
    await Promise.all([
      completeReportQuery(supabase.from("sales")
        .select("id, no_struk, total, subtotal, discount, diskon_kategori, poin_digunakan, voucher_code, campaign_code, cashier_name, created_at, branch_id, payment_plan, payments_finalized_at, voided_at, branches(name), customers(name), sale_items(qty, harga, item_discount_type, item_discount_value, promo_id, promo_discount)", { count: "exact" })
        .gte("created_at", mulai).lte("created_at", akhir)),
      completeReportQuery(supabase.from("invoices")
        .select("id, invoice_no, total, subtotal, discount, voucher_code, campaign_code, voucher_discount, diskon_kategori, cashier_name, created_at, visit_id, visits(branch_id, branches(name), customers(name)), invoice_items(qty, harga, diskon_persen, promo_id, promo_discount)", { count: "exact" })
        .is("voided_at", null).gte("created_at", mulai).lte("created_at", akhir)),
      completeReportQuery(supabase.from("vouchers")
        .select("id, code, tipe, nilai, is_active, valid_from, valid_until, max_potongan, min_belanja, boleh_gabung_promo, customer_id, category_id", { count: "exact" })),
      completeReportQuery(supabase.from("promos").select("id, name, promo_type", { count: "exact" })),
      // Hanya target murni cabang / perusahaan. Target per karyawan atau per kategori
      // sengaja tidak dijumlah di sini — kalau digabung, satu omzet bisa terhitung
      // memenuhi beberapa target sekaligus dan rasionya jadi mengarang.
      completeReportQuery(supabase.from("sales_targets")
        .select("id, periode, branch_id, basis, target", { count: "exact" })
        .is("employee_id", null).is("category_id", null)),
      completeReportQuery(supabase.from("campaign_codes")
        .select("id, code, voucher_id, promo_id, max_uses, is_active", { count: "exact" }).order("code")),
      // Batas pemakaian kode dihitung sepanjang masa (bukan periode ini) dan hanya
      // terbuka untuk OWNER/ADMIN; peran lain cukup melihat pemakaian periode ini.
      supabase.rpc("campaign_code_usage"),
      completeReportQuery(supabase.from("branches")
        .select("id, name", { count: "exact" }).eq("is_active", true).order("name")),
    ]);

  type SaleItem = {
    qty: number; harga: number; item_discount_type: string | null; item_discount_value: number | null;
    promo_id: string | null; promo_discount: number | null;
  };
  type Sale = SaleCompletion & {
    id: string; no_struk: string | null; total: number; subtotal: number; discount: number; diskon_kategori: number | null;
    poin_digunakan: number | null; voucher_code: string | null; campaign_code: string | null;
    cashier_name: string | null; created_at: string;
    branch_id: string | null; branches: Rel<{ name: string }>; customers: Rel<{ name: string }>;
    sale_items: SaleItem[] | null;
  };
  type InvItem = {
    qty: number; harga: number; diskon_persen: number | null;
    promo_id: string | null; promo_discount: number | null;
  };
  type Inv = {
    id: string; invoice_no: string | null; visit_id: string;
    total: number; subtotal: number; discount: number; voucher_code: string | null; campaign_code: string | null;
    voucher_discount: number | null; diskon_kategori: number | null; cashier_name: string | null; created_at: string;
    visits: Rel<{ branch_id: string | null; branches: Rel<{ name: string }>; customers: Rel<{ name: string }> }>;
    invoice_items: InvItem[] | null;
  };

  const namaCabangSale = (s: Sale) => one(s.branches)?.name ?? "\u2014";
  const namaCabangInv = (i: Inv) => one(one(i.visits)?.branches ?? null)?.name ?? "\u2014";
  // Filter cabang & kanal berlaku untuk SELURUH halaman: angka di kartu ringkasan,
  // tabel voucher, dan tabel diskon harus menceritakan potongan yang sama.
  const sales = kanal === "Klinik" ? [] : ((salesData ?? []) as unknown as Sale[])
    .filter(isCompletedSale).filter((s) => !cabang || namaCabangSale(s) === cabang);
  const invoices = kanal === "Petshop" ? [] : ((invData ?? []) as unknown as Inv[])
    .filter((i) => !cabang || namaCabangInv(i) === cabang);

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
  const promoRowsTerpilih = promoId ? promoRows.filter(row => row.id === promoId) : promoRows;
  const promoOptions = [...namaPromo].map(([id, promo]) => ({ id, nama: promo.name }));
  for (const row of promoRows) if (!namaPromo.has(row.id)) promoOptions.push({ id: row.id, nama: row.nama });
  promoOptions.sort((a, b) => a.nama.localeCompare(b.nama, "id"));

  // ── Per program: promo, voucher, kode kampanye ─────────────────────────────
  // Satu transaksi bisa muncul di beberapa program (mis. kode kampanye yang
  // menunjuk sebuah promo). Daftar ini sengaja BUKAN pembagian habis total
  // potongan — kolomnya menjawab "program X menghasilkan potongan berapa".
  type JenisProgram = "Promo" | "Voucher" | "Kode kampanye";
  type PakaiProgram = { key: string; jenis: JenisProgram; nama: string; potongan: number; baris: number; unit: number; pasti: boolean };
  type Transaksi = {
    id: string; waktu: string; tanggal: string; kanal: "Petshop" | "Klinik";
    cabang: string; nomor: string; href: string; pelanggan: string; kasir: string;
    kodeDiketik: string; bruto: number; netto: number;
    program: PakaiProgram[]; tidakTercatat: boolean;
  };

  const kodeKampanye = ((kodeData ?? []) as { code: string; voucher_id: string | null; promo_id: string | null; max_uses: number | null; is_active: boolean }[]);
  const kodeByCode = new Map(kodeKampanye.map((k) => [k.code, k]));
  const pakaiSepanjangMasa = new Map(((pemakaianKode?.data ?? []) as { code: string; used: number }[])
    .map((u) => [u.code, Number(u.used) || 0]));

  const labelPromo = (id: string) => namaPromo.get(id)?.name ?? "(promo terhapus)";
  const kumpulkanPromo = (rows: { qty: number; promo_id: string | null; promo_discount: number | null }[]) => {
    const per = new Map<string, { potongan: number; baris: number; unit: number }>();
    for (const row of rows) {
      const nilai = Number(row.promo_discount) || 0;
      if (!row.promo_id || nilai <= 0) continue;
      const cur = per.get(row.promo_id) ?? { potongan: 0, baris: 0, unit: 0 };
      cur.potongan += nilai;
      cur.baris++;
      cur.unit += Number(row.qty) || 0;
      per.set(row.promo_id, cur);
    }
    return per;
  };
  const programKampanye = (kode: string | null, promoPer: Map<string, { potongan: number }>, voucherNilai: number, voucherPasti: boolean): PakaiProgram | null => {
    if (!kode) return null;
    const master = kodeByCode.get(kode);
    const potongan = master?.promo_id ? promoPer.get(master.promo_id)?.potongan ?? 0 : master?.voucher_id ? voucherNilai : 0;
    return { key: `kode:${kode}`, jenis: "Kode kampanye", nama: kode, potongan,
      baris: 0, unit: 0, pasti: master?.promo_id ? true : master?.voucher_id ? voucherPasti : false };
  };

  const transaksi: Transaksi[] = [
    ...sales.map((s): Transaksi => {
      const items = s.sale_items ?? [];
      const diskonItem = items.reduce((a, l) => a + lineDiscount({
        qty: Number(l.qty) || 0, harga: Number(l.harga) || 0,
        item_discount_type: (l.item_discount_type as "nominal" | "percent" | null) ?? null,
        item_discount_value: Number(l.item_discount_value) || 0,
        promo_discount: Number(l.promo_discount) || 0,
      }), 0);
      const poin = Number(s.poin_digunakan) || 0;
      // Kasir petshop belum menyimpan rupiah voucher terpisah: sisanya setelah
      // diskon item dan poin = diskon manual kasir + voucher, masih menyatu.
      const sisaTransaksi = Math.max(0, (Number(s.discount) || 0) - diskonItem - poin);
      const promoPer = kumpulkanPromo(items.map((l) => ({ qty: l.qty, promo_id: l.promo_id, promo_discount: l.promo_discount })));
      const program: PakaiProgram[] = [...promoPer].map(([id, v]) => ({
        key: id, jenis: "Promo" as const, nama: labelPromo(id), potongan: v.potongan, baris: v.baris, unit: v.unit, pasti: true,
      }));
      if (s.voucher_code) {
        program.push({ key: `voucher:${s.voucher_code}`, jenis: "Voucher", nama: s.voucher_code,
          potongan: sisaTransaksi, baris: 0, unit: 0, pasti: false });
      }
      const kampanye = programKampanye(s.campaign_code, promoPer, sisaTransaksi, false);
      if (kampanye) program.push(kampanye);
      return {
        id: s.id, waktu: s.created_at, tanggal: tanggalWIB(s.created_at), kanal: "Petshop",
        cabang: namaCabangSale(s), nomor: s.no_struk ?? "—", href: `/penjualan/${s.id}`,
        pelanggan: one(s.customers)?.name ?? "—", kasir: s.cashier_name ?? "—",
        kodeDiketik: s.campaign_code || s.voucher_code || "—",
        bruto: Number(s.subtotal) || 0, netto: Number(s.total) || 0, program, tidakTercatat: false,
      };
    }),
    ...invoices.map((inv): Transaksi => {
      const items = inv.invoice_items ?? [];
      const promoPer = kumpulkanPromo(items.map((l) => ({ qty: l.qty, promo_id: l.promo_id, promo_discount: l.promo_discount })));
      // NULL = tagihan sebelum rilis atribusi klinik. Tidak ditebak mundur.
      const tercatat = inv.voucher_discount != null || inv.diskon_kategori != null
        || items.some((l) => l.promo_discount != null);
      const voucherNilai = Number(inv.voucher_discount) || 0;
      const program: PakaiProgram[] = [...promoPer].map(([id, v]) => ({
        key: id, jenis: "Promo" as const, nama: labelPromo(id), potongan: v.potongan, baris: v.baris, unit: v.unit, pasti: true,
      }));
      if (inv.voucher_code) {
        program.push({ key: `voucher:${inv.voucher_code}`, jenis: "Voucher", nama: inv.voucher_code,
          potongan: tercatat ? voucherNilai : 0, baris: 0, unit: 0, pasti: tercatat });
      }
      const kampanye = programKampanye(inv.campaign_code, promoPer, voucherNilai, tercatat);
      if (kampanye) program.push(kampanye);
      const v = one(inv.visits);
      return {
        id: inv.id, waktu: inv.created_at, tanggal: tanggalWIB(inv.created_at), kanal: "Klinik",
        cabang: namaCabangInv(inv), nomor: inv.invoice_no ?? "—", href: hrefInvoiceKlinik(inv.visit_id, inv.id),
        pelanggan: one(v?.customers ?? null)?.name ?? "—", kasir: inv.cashier_name ?? "—",
        kodeDiketik: inv.campaign_code || inv.voucher_code || "—",
        bruto: Number(inv.subtotal) || 0, netto: Number(inv.total) || 0, program,
        tidakTercatat: !tercatat && (Number(inv.discount) || 0) > 0,
      };
    }),
  ].sort((a, b) => b.waktu.localeCompare(a.waktu));

  type RingkasProgram = {
    key: string; jenis: JenisProgram; nama: string; trx: number; baris: number; unit: number;
    potongan: number; bruto: number; netto: number; pasti: boolean; batas: number | null; dipakaiTotal: number | null;
  };
  const ringkasProgram = new Map<string, RingkasProgram>();
  for (const t of transaksi) {
    for (const p of t.program) {
      const master = p.jenis === "Kode kampanye" ? kodeByCode.get(p.nama) : undefined;
      const cur = ringkasProgram.get(p.key) ?? {
        key: p.key, jenis: p.jenis, nama: p.nama, trx: 0, baris: 0, unit: 0, potongan: 0, bruto: 0, netto: 0,
        pasti: true, batas: master?.max_uses ?? null, dipakaiTotal: pakaiSepanjangMasa.get(p.nama) ?? null,
      };
      cur.trx++;
      cur.baris += p.baris;
      cur.unit += p.unit;
      cur.potongan += p.potongan;
      cur.bruto += t.bruto;
      cur.netto += t.netto;
      if (!p.pasti) cur.pasti = false;
      ringkasProgram.set(p.key, cur);
    }
  }
  const programRows = [...ringkasProgram.values()]
    .filter((row) => !promoId || row.key === promoId)
    .sort((a, b) => b.potongan - a.potongan || b.trx - a.trx || a.nama.localeCompare(b.nama, "id"));

  const rincianRows = transaksi.flatMap((t) => {
    const dipakai = t.program.filter((p) => !promoId || p.key === promoId);
    const baris = dipakai.map((p) => ({ t, program: p.nama, jenis: p.jenis as string, potongan: p.potongan, pasti: p.pasti }));
    if (!promoId && t.tidakTercatat) {
      baris.push({ t, program: "tidak tercatat per program", jenis: "—", potongan: 0, pasti: false });
    }
    return baris;
  });
  const RINCIAN_MAKS = 400;
  const rincianTampil = rincianRows.slice(0, RINCIAN_MAKS);

  // Pilihan program menggabungkan promo, voucher, dan kode kampanye dalam satu kotak.
  const programOptions = [
    ...promoOptions.map((promo) => ({ value: promo.id, label: `Promo · ${promo.nama} · ${promo.id.slice(-8)}` })),
    ...vouchers.map((v) => ({ value: `voucher:${v.code}`, label: `Voucher · ${v.code}` })),
    ...kodeKampanye.map((k) => ({ value: `kode:${k.code}`, label: `Kode kampanye · ${k.code}` })),
  ];

  // Struk paling lama di rentang — dipakai memberi tahu kalau datanya dari masa
  // sebelum nilai promo mulai dicatat (migrasi 0127, 25 Agustus 2026).
  const strukTerlama = sales.length
    ? sales.map((s) => tanggalWIB(s.created_at)).sort()[0]
    : null;
  const adaDataLama = !!strukTerlama && strukTerlama < "2026-08-25" && promoTercatat === 0;

  return (
    <LaporanPage
      icon="ti-discount" title="PROMO, VOUCHER & DISKON"
      desc="Promo, voucher, dan kode kampanye di petshop maupun klinik: berapa kali dipakai, berapa potongannya, dan di transaksi mana. Bisa diunduh ke Excel."
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
          <div style={{ minWidth: 170 }}>
            <label className="flab">Cabang</label>
            <select className="fi" name="cabang" defaultValue={cabang}>
              <option value="">Semua cabang</option>
              {(cabangList ?? []).map((b) => <option key={b.id} value={b.name}>{b.name}</option>)}
            </select>
          </div>
          <div style={{ minWidth: 150 }}>
            <label className="flab">Kanal</label>
            <select className="fi" name="kanal" defaultValue={kanal}>
              <option value="">Petshop &amp; Klinik</option>
              <option value="Petshop">Petshop (kasir)</option>
              <option value="Klinik">Klinik</option>
            </select>
          </div>
          <div style={{ minWidth: 230 }}>
            <label className="flab">Program</label>
            <select className="fi" name="promo_id" defaultValue={promoId}>
              <option value="">Semua program</option>
              {promoId && !programOptions.some(option => option.value === promoId) && <option value={promoId}>Program tidak ada · {promoId.slice(0, 12)}</option>}
              {programOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
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
        {promoId && <div style={{ fontSize: 10.5, color: "var(--tm)", marginBottom: 8 }}>Pilihan promo berlaku untuk tabel ini. Ringkasan, voucher, dan diskon cabang tetap mencakup seluruh transaksi pada periode terpilih.</div>}
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
              {promoRowsTerpilih.map((p) => (
                <tr key={p.id}>
                  <td style={{ fontSize: 11.5, fontWeight: 600 }}>{p.nama}</td>
                  <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{p.jenis}</td>
                  <td style={{ textAlign: "center", fontSize: 11.5, fontWeight: 700 }}>{p.baris}</td>
                  <td style={{ textAlign: "right", fontSize: 11, color: "var(--tm)" }}>{rp(p.nilaiBaris)}</td>
                  <td style={{ textAlign: "right", fontSize: 11.5, fontWeight: 700, color: "#b45309" }}>{rp(p.potongan)}</td>
                </tr>
              ))}
              {promoRowsTerpilih.length === 0 && (
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

      <div className="crm-sec" style={{ marginBottom: 12 }}>
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

      <div className="crm-sec" style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 8 }}>04 · RINGKASAN PER PROGRAM</div>
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 1180 }}>
            <thead>
              <tr>
                <th style={{ width: 120 }}>Jenis</th>
                <th>Program</th>
                <th style={{ width: 90, textAlign: "center" }}>Transaksi</th>
                <th style={{ width: 95, textAlign: "center" }}>Baris kena</th>
                <th style={{ width: 90, textAlign: "center" }}>Unit kena</th>
                <th style={{ width: 130, textAlign: "right" }}>Total potongan</th>
                <th style={{ width: 130, textAlign: "right" }}>Rata-rata / transaksi</th>
                <th style={{ width: 130, textAlign: "right" }}>Omzet bruto</th>
                <th style={{ width: 130, textAlign: "right" }}>Omzet netto</th>
                <th style={{ width: 120, textAlign: "center" }}>Pemakaian / batas</th>
              </tr>
            </thead>
            <tbody>
              {programRows.map((row) => (
                <tr key={row.key}>
                  <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{row.jenis}</td>
                  <td style={{ fontSize: 11.5, fontWeight: 600 }}>
                    {row.nama}
                    {!row.pasti && <span style={{ fontSize: 9.5, color: "#b45309", marginLeft: 6 }}>potongan belum tercatat terpisah</span>}
                  </td>
                  <td style={{ textAlign: "center", fontSize: 11.5, fontWeight: 700 }}>{row.trx}</td>
                  <td style={{ textAlign: "center", fontSize: 11 }}>{row.baris || "—"}</td>
                  <td style={{ textAlign: "center", fontSize: 11 }}>{row.unit ? Math.round(row.unit * 100) / 100 : "—"}</td>
                  <td style={{ textAlign: "right", fontSize: 11.5, fontWeight: 700, color: row.potongan ? "#b45309" : "var(--td)" }}>{rp(row.potongan)}</td>
                  <td style={{ textAlign: "right", fontSize: 11, color: "var(--tm)" }}>{rp(row.trx ? row.potongan / row.trx : 0)}</td>
                  <td style={{ textAlign: "right", fontSize: 11, color: "var(--tm)" }}>{rp(row.bruto)}</td>
                  <td style={{ textAlign: "right", fontSize: 11, color: "var(--tm)" }}>{rp(row.netto)}</td>
                  <td style={{ textAlign: "center", fontSize: 11 }}>
                    {row.batas == null ? "tanpa batas" : `${row.dipakaiTotal ?? row.trx} / ${row.batas}`}
                  </td>
                </tr>
              ))}
              {programRows.length === 0 && (
                <TabelKosong kolom={10} pesan="Belum ada promo, voucher, atau kode kampanye yang terpakai pada rentang ini." />
              )}
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 8, lineHeight: 1.6 }}>
          Satu transaksi bisa muncul di dua baris sekaligus — kode kampanye dihitung bersama promo
          atau voucher yang ditunjuknya — jadi kolom potongan di tabel ini TIDAK untuk dijumlah
          ke bawah. Gunakan tabel 03 untuk total potongan yang tidak tumpang tindih.<br />
          Omzet bruto = nilai transaksi sebelum potongan; omzet netto = yang benar-benar ditagih.
          Keduanya nilai SELURUH transaksi yang memakai program itu, bukan hanya baris yang kena.<br />
          Kolom &quot;Pemakaian / batas&quot; hanya untuk kode kampanye yang dibatasi. Angka kiri
          dihitung sepanjang masa bila akun Anda Owner/Admin; peran lain melihat pemakaian pada
          rentang tanggal ini saja.<br />
          Potongan voucher di kasir petshop masih menyatu dengan diskon manual kasir — baris itu
          ditandai &quot;potongan belum tercatat terpisah&quot; dan nilainya adalah batas atas.
          Tagihan klinik yang dibuat sebelum rilis ini juga tidak menyimpan rinciannya.
        </div>
      </div>

      <div className="crm-sec" style={{ marginBottom: 0 }}>
        <div style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 8 }}>05 · RINCIAN PER TRANSAKSI</div>
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 1180 }}>
            <thead>
              <tr>
                <th style={{ width: 95 }}>Tanggal</th>
                <th style={{ width: 140 }}>Cabang</th>
                <th style={{ width: 85 }}>Kanal</th>
                <th style={{ width: 140 }}>No. struk / invoice</th>
                <th>Program</th>
                <th style={{ width: 120 }}>Kode diketik</th>
                <th style={{ width: 120, textAlign: "right" }}>Potongan</th>
                <th style={{ width: 150 }}>Kasir</th>
                <th style={{ width: 150 }}>Pelanggan</th>
              </tr>
            </thead>
            <tbody>
              {rincianTampil.map((row, index) => (
                <tr key={`${row.t.id}:${row.program}:${index}`}>
                  <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{tanggalIndo(row.t.tanggal)}</td>
                  <td style={{ fontSize: 10.5 }}>{row.t.cabang}</td>
                  <td style={{ fontSize: 10.5 }}>{row.t.kanal}</td>
                  <td style={{ fontSize: 11 }}><Link href={row.t.href}>{row.t.nomor}</Link></td>
                  <td style={{ fontSize: 11 }}>
                    {row.program}
                    <span style={{ fontSize: 9.5, color: "var(--td)", marginLeft: 6 }}>{row.jenis}</span>
                  </td>
                  <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{row.t.kodeDiketik}</td>
                  <td style={{ textAlign: "right", fontSize: 11, fontWeight: 700, color: row.potongan ? "#b45309" : "var(--td)" }}>
                    {row.pasti || row.potongan ? rp(row.potongan) : "—"}
                  </td>
                  <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{row.t.kasir}</td>
                  <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{row.t.pelanggan}</td>
                </tr>
              ))}
              {rincianTampil.length === 0 && (
                <TabelKosong kolom={9} pesan="Belum ada transaksi berpromo pada rentang ini." />
              )}
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 8, lineHeight: 1.6 }}>
          Transaksi yang dibatalkan TIDAK ditampilkan: struk kasir yang di-void atau belum selesai
          dibayar dan tagihan klinik yang dibatalkan ikut hilang dari semua tabel di halaman ini,
          sama seperti laporan penjualan lain. Tagihan klinik yang dibatalkan lalu diterbitkan ulang
          muncul satu kali, dengan nomor barunya.<br />
          Satu transaksi muncul satu baris per program. Tagihan klinik lama yang potongannya tidak
          pernah dicatat per program muncul sebagai &quot;tidak tercatat per program&quot; — isinya
          tidak ditebak mundur.
          {rincianRows.length > rincianTampil.length && <><br />Hanya {RINCIAN_MAKS} baris terbaru yang ditampilkan dari {rincianRows.length} baris. Persempit rentang tanggal, cabang, atau program untuk melihat sisanya.</>}
        </div>
      </div>
    </LaporanPage>
  );
}
