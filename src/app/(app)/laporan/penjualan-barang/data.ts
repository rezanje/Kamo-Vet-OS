import { readReportRows } from "@/lib/hpp-reports-server";
import { createClient } from "@/lib/supabase/server";
import { batasTanggalWIB } from "@/lib/laporan-transaksi";
import { lineDiscount } from "@/lib/pos-calc";
import { PosDecimal } from "@/lib/pos-money";
import { jenisBarisKlinik, SEMUA_JENIS_KLINIK, type JenisBarisPenjualan } from "@/lib/laporan-penjualan-barang";
import { namaRacikanPerKunjungan } from "@/lib/racikan-klinik-server";
import type { Kanal } from "@/lib/laporan-transaksi";
import { fakturGrosirOmzet, hppBarisGrosir, nilaiBarisGrosir, SELECT_FAKTUR_GROSIR, type FakturGrosirInti } from "@/lib/laporan-grosir";
import { isCompletedSale, type SaleCompletion } from "@/lib/sale-payment-reporting";
import { servicePerformerNames, type ServicePerformersSnapshot } from "@/lib/service-performers";

type Rel<T> = T | T[] | null;
const one = <T,>(value: Rel<T>): T | null => Array.isArray(value) ? (value[0] ?? null) : value;
export const waktuWIB = (value: string) => new Date(value).toLocaleString("id-ID", {
  timeZone: "Asia/Jakarta", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
});

type HubunganVisit = {
  branch_id: string | null;
  branches: Rel<{ name: string }>;
  customers: Rel<{ name: string }>;
  pets: Rel<{ name: string }>;
};
/** K02/pekerjaan pesanan: BMHP yang dipakai pada satu baris tindakan klinik. */
type BmhpSnapshot = { cost?: number | null; components?: { name?: string | null; qty?: number | null; unit?: string | null; cost?: number | null }[] | null };
type InvoiceItem = {
  id: string; deskripsi: string; qty: number; harga: number; diskon_persen: number;
  jenis: string | null; item_id: string | null; compound_recipe_id: string | null;
  bmhp_components: BmhpSnapshot | null;
  service_performers: ServicePerformersSnapshot | null;
  invoices: Rel<{
    id: string; visit_id: string; invoice_no: string | null; created_at: string; paid_status: string;
    subtotal: number; discount: number;
    visits: Rel<HubunganVisit>;
  }>;
};
type SaleItem = {
  id: string; nama: string; qty: number; harga: number;
  service_performers: ServicePerformersSnapshot | null;
  item_discount_type: "nominal" | "percent" | null;
  item_discount_value: number | null; promo_discount: number | null;
  sales: Rel<SaleCompletion & {
    id: string; branch_id: string | null; no_struk: string | null; created_at: string; channel: string | null;
    total: number; merchant_fee_total: number | null;
    branches: Rel<{ name: string }>; customers: Rel<{ name: string }>;
  }>;
};
/** Faktur grosir seperti dibaca baris item: cukup untuk menyaring dan menamai barisnya. */
type FakturGrosirBaris = FakturGrosirInti & {
  no_faktur: string | null; branch_id: string | null; tanggal: string;
  branches: Rel<{ name: string }>; customers: Rel<{ name: string }>;
};
type GrosirItem = {
  id: string; nama: string; satuan: string | null; qty: number; harga: number;
  diskon: number | null; hpp: number | null; item_id: string | null;
  sales_invoices: Rel<FakturGrosirBaris>;
};
export type Baris = {
  id: string; waktu: string; dokumen: string; href: string; kanal: Kanal;
  jenis: JenisBarisPenjualan; cabang: string; cabangId: string | null; pelanggan: string; hewan: string;
  nama: string; pelaksana: string; qty: number; harga: number; diskon: number; nilai: number; status: string;
  pelaksanaIds?: string[];
  /** Baris anak BMHP: id baris induknya. Nilainya 0 dan tidak masuk total. */
  indukId?: string;
  satuan?: string;
  hpp?: number;
};
export type PilihanPelaksana = { id: string; nama: string };

function pelaksanaBaris(value: ServicePerformersSnapshot | null | undefined): { ids: string[]; pilihan: PilihanPelaksana[] } {
  if (!value) return { ids: [], pilihan: [] };
  const pilihan = [
    value.doctor_id ? { id: value.doctor_id, nama: `Dokter: ${value.doctor_name || `ID ${value.doctor_id.slice(-8)}`}` } : null,
    value.staff_id ? { id: value.staff_id, nama: `Pelaksana: ${value.staff_name || `ID ${value.staff_id.slice(-8)}`}` } : null,
  ].filter((row): row is PilihanPelaksana => row !== null);
  return { ids: pilihan.map(row => row.id), pilihan };
}

function potong<T>(items: T[], ukuran = 100): T[][] {
  const hasil: T[][] = [];
  for (let i = 0; i < items.length; i += ukuran) hasil.push(items.slice(i, i + ukuran));
  return hasil;
}

export function tanggalValid(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function alokasiNetoBaris(bases: InstanceType<typeof PosDecimal>[], target: InstanceType<typeof PosDecimal>): number[] {
  const targetCents = target.times(100).toDecimalPlaces(0).toNumber();
  const baseTotal = bases.reduce((sum, value) => sum.plus(value), new PosDecimal(0));
  if (!Number.isSafeInteger(targetCents) || targetCents < 0
    || new PosDecimal(targetCents).div(100).gt(baseTotal.toDecimalPlaces(2))
    || bases.some(value => value.isNegative())) {
    throw new Error("Nilai dokumen tidak cocok dengan baris untuk laporan per item.");
  }
  let cumulative = new PosDecimal(0), allocated = 0;
  return bases.map(base => {
    cumulative = cumulative.plus(base);
    const next = baseTotal.isZero() ? 0 : new PosDecimal(targetCents).times(cumulative).div(baseTotal).toDecimalPlaces(0).toNumber();
    const net = (next - allocated) / 100;
    allocated = next;
    return net;
  });
}


export async function ambilPenjualanBarang({ dari, sampai, kanal, jenis, q, cabangId = "", pelaksanaId = "" }: {
  dari: string; sampai: string; kanal: Kanal;
  jenis: string; q: string; cabangId?: string; pelaksanaId?: string;
}): Promise<{ rows: Baris[]; cabangOptions: { id: string; name: string }[]; pelaksanaOptions: PilihanPelaksana[]; pesanError: string; nilaiTotal: number; qtyTotal: number }> {
  const tanggalSalah = !tanggalValid(dari) || !tanggalValid(sampai) || dari > sampai;
  const { mulai, akhir } = batasTanggalWIB(dari, sampai);
  const rows: Baris[] = [];
  const anakBmhp = new Map<string, Baris[]>();
  const pilihanPelaksana = new Map<string, PilihanPelaksana>();
  let pesanError = tanggalSalah ? "Rentang tanggal tidak valid. Periksa tanggal awal dan akhir." : "";
  if (!tanggalSalah) {
    try {
      const supabase = await createClient();
      const bacaKlinik = kanal === "Klinik";
      const bacaKasir = kanal === "POS" || kanal === "Online";
      const bacaGrosir = kanal === "Grosir";
      const [invoiceItems, saleItems, grosirItems] = await Promise.all([
        bacaKlinik ? readReportRows<InvoiceItem>(async (awal, ujung) => {
          const { data, error, count } = await supabase.from("invoice_items")
            .select("id, deskripsi, qty, harga, diskon_persen, jenis, item_id, compound_recipe_id, bmhp_components, service_performers, invoices!inner(id, visit_id, invoice_no, created_at, paid_status, subtotal, discount, voided_at, visits(branch_id, branches(name), customers(name), pets(name)))", { count: "exact" })
            .is("invoices.voided_at", null)
            .gte("invoices.created_at", mulai).lte("invoices.created_at", akhir)
            .order("id").range(awal, ujung);
          return { data: data as unknown as InvoiceItem[] | null, error, count };
        }) : Promise.resolve([] as InvoiceItem[]),
        bacaKasir ? readReportRows<SaleItem>(async (awal, ujung) => {
          const { data, error, count } = await supabase.from("sale_items")
            .select("id, nama, qty, harga, item_discount_type, item_discount_value, promo_discount, service_performers, sales!inner(id, branch_id, no_struk, created_at, channel, total, merchant_fee_total, payment_plan, payments_finalized_at, voided_at, branches(name), customers(name))", { count: "exact" })
            .gte("sales.created_at", mulai).lte("sales.created_at", akhir)
            .order("id").range(awal, ujung);
          return { data: data as unknown as SaleItem[] | null, error, count };
        }) : Promise.resolve([] as SaleItem[]),
        // Faktur grosir disaring lewat tanggal faktur (date, sudah WIB), bukan created_at.
        bacaGrosir ? readReportRows<GrosirItem>(async (awal, ujung) => {
          const { data, error, count } = await supabase.from("sales_invoice_items")
            .select(`id, nama, satuan, qty, harga, diskon, hpp, item_id, sales_invoices!inner(${SELECT_FAKTUR_GROSIR}, branches(name), customers(name))`, { count: "exact" })
            .gte("sales_invoices.tanggal", dari).lte("sales_invoices.tanggal", sampai)
            .order("id").range(awal, ujung);
          return { data: data as unknown as GrosirItem[] | null, error, count };
        }) : Promise.resolve([] as GrosirItem[]),
      ]);

      const clinicLines = new Map<string, InvoiceItem[]>();
      for (const item of invoiceItems) {
        const invoice = one(item.invoices);
        if (!invoice?.id) throw new Error("Invoice sumber baris laporan tidak dapat diverifikasi.");
        if (!clinicLines.has(invoice.id)) clinicLines.set(invoice.id, []);
        clinicLines.get(invoice.id)!.push(item);
      }
      const demoFees = new Map<string, number>();
      for (const batch of potong([...clinicLines.keys()])) {
        const snapshots = await readReportRows<{ invoice_id: string; fee_amount: number; fee_bearer: string }>(async (from, to) => {
          const { data, error, count } = await supabase.from("clinic_demo_invoice_snapshots")
            .select("invoice_id,fee_amount,fee_bearer", { count: "exact" }).in("invoice_id", batch)
            .order("invoice_id").range(from, to);
          return { data, error, count };
        }, row => row.invoice_id);
        for (const snapshot of snapshots) {
          if (snapshot.fee_bearer === "customer" && Number(snapshot.fee_amount) > 0) {
            demoFees.set(snapshot.invoice_id, Number(snapshot.fee_amount));
          }
        }
      }
      const netoKlinik = new Map<string, number>();
      const feeLineIds = new Set<string>();
      for (const items of clinicLines.values()) {
        const invoice = one(items[0].invoices)!;
        const fee = demoFees.get(invoice.id) ?? 0;
        const feeItems = fee ? items.filter(item => item.deskripsi === "Admin pembayaran DEMO" && !item.item_id
          && Number(item.qty) === 1 && Number(item.harga) === fee && Number(item.diskon_persen || 0) === 0) : [];
        if (fee && feeItems.length !== 1) throw new Error("Baris biaya admin DEMO tidak cocok dengan snapshot invoice.");
        const ordinary = fee ? items.filter(item => item.id !== feeItems[0].id) : items;
        const bases = ordinary.map(item => {
          const percent = Math.min(100, Math.max(0, Number(item.diskon_persen) || 0));
          return new PosDecimal(item.qty).times(item.harga).times(new PosDecimal(1).minus(new PosDecimal(percent).div(100)));
        });
        const net = alokasiNetoBaris(bases, new PosDecimal(invoice.subtotal).minus(invoice.discount).minus(fee));
        ordinary.forEach((item, index) => netoKlinik.set(item.id, net[index]));
        if (fee) {
          netoKlinik.set(feeItems[0].id, fee);
          feeLineIds.add(feeItems[0].id);
        }
      }

      // Alokasikan selisih neto struk POS setelah diskon baris. Nilai struk
      // tersimpan adalah sumber kebenaran; fee merchant bukan pendapatan item.
      const posLines = new Map<string, SaleItem[]>();
      for (const item of saleItems) {
        const sale = one(item.sales);
        if (!sale || sale.channel || !isCompletedSale(sale)) continue;
        if (!posLines.has(sale.id)) posLines.set(sale.id, []);
        posLines.get(sale.id)!.push(item);
      }
      const netoPos = new Map<string, number>();
      for (const items of posLines.values()) {
        const sale = one(items[0].sales)!;
        const bases = items.map(item => new PosDecimal(item.qty).times(item.harga).minus(lineDiscount(item)));
        const net = alokasiNetoBaris(bases, new PosDecimal(sale.total).minus(sale.merchant_fee_total ?? 0));
        items.forEach((item, index) => netoPos.set(item.id, net[index]));
      }

      // Invoice menyimpan nama racikan sebagai baris obat biasa. Cocokkan nama
      // dengan resep di kunjungan sama agar racikan terpisah dari obat ketikan.
      const namaRacikan = await namaRacikanPerKunjungan(supabase, invoiceItems.flatMap((item) => {
        const visitId = one(item.invoices)?.visit_id;
        return visitId ? [visitId] : [];
      }));

      for (const item of invoiceItems) {
        const invoice = one(item.invoices);
        if (!invoice?.id) throw new Error("Invoice sumber baris laporan tidak dapat diverifikasi.");
        const visit = one(invoice.visits);
        const barisId = `klinik-${item.id}`;
        const nilai = netoKlinik.get(item.id);
        if (nilai == null) throw new Error("Alokasi nilai baris invoice klinik tidak tersedia.");
        const jenis = feeLineIds.has(item.id) ? "Biaya Admin" : jenisBarisKlinik(item, invoice.visit_id, namaRacikan);
        const pelaksana = jenis === "Jasa" || item.service_performers != null ? pelaksanaBaris(item.service_performers) : { ids: [], pilihan: [] };
        pelaksana.pilihan.forEach(pilihan => pilihanPelaksana.set(pilihan.id, pilihan));
        rows.push({
          id: barisId, waktu: invoice.created_at, dokumen: invoice.invoice_no ?? "—",
          href: `/klinik/pembayaran/${invoice.visit_id}/invoice?invoice_id=${encodeURIComponent(invoice.id)}`, kanal: "Klinik",
          jenis,
          cabang: one(visit?.branches ?? null)?.name ?? "—",
          cabangId: visit?.branch_id ?? null,
          pelanggan: one(visit?.customers ?? null)?.name ?? "—",
          hewan: one(visit?.pets ?? null)?.name ?? "—",
          nama: item.deskripsi, pelaksana: jenis === "Jasa" || item.service_performers != null ? servicePerformerNames(item.service_performers).join(" · ") : "—",
          pelaksanaIds: pelaksana.ids,
          qty: Number(item.qty) || 0, harga: Number(item.harga) || 0,
          diskon: Math.max(0, (Number(item.qty) || 0) * (Number(item.harga) || 0) - nilai),
          nilai, status: invoice.paid_status,
        });
        // BMHP tampil sebagai baris anak: jumlah, satuan dan HPP-nya terlihat, tetapi
        // nilai jualnya 0 supaya omzet baris tindakan tidak terhitung dua kali.
        const bmhp = (item.bmhp_components?.components ?? []).filter(row => row && typeof row === "object");
        bmhp.forEach((material, index) => {
          const anak: Baris = {
            id: `${barisId}-bmhp-${index}`, indukId: barisId, waktu: invoice.created_at,
            dokumen: invoice.invoice_no ?? "—",
            href: `/klinik/pembayaran/${invoice.visit_id}/invoice?invoice_id=${encodeURIComponent(invoice.id)}`, kanal: "Klinik",
            jenis, cabang: one(visit?.branches ?? null)?.name ?? "—", cabangId: visit?.branch_id ?? null,
            pelanggan: one(visit?.customers ?? null)?.name ?? "—", hewan: one(visit?.pets ?? null)?.name ?? "—",
            nama: `BMHP · ${material.name ?? "Bahan"}`, pelaksana: "—",
            qty: Number(material.qty) || 0, satuan: material.unit ?? undefined, hpp: Number(material.cost) || 0,
            harga: 0, diskon: 0, nilai: 0, status: invoice.paid_status,
          };
          anakBmhp.set(barisId, [...(anakBmhp.get(barisId) ?? []), anak]);
        });
      }
      for (const item of saleItems) {
        const sale = one(item.sales);
        if (!sale || !isCompletedSale(sale)) continue;
        const itemKanal = sale.channel ? "Online" : "POS";
        if (kanal !== itemKanal) continue;
        const qty = Number(item.qty) || 0;
        const harga = Number(item.harga) || 0;
        const diskon = lineDiscount({
          qty, harga, item_discount_type: item.item_discount_type,
          item_discount_value: item.item_discount_value, promo_discount: item.promo_discount,
        });
        const nilai = itemKanal === "POS" ? netoPos.get(item.id) : qty * harga - diskon;
        if (nilai == null) throw new Error("Alokasi nilai baris POS tidak tersedia.");
        const pelaksana = pelaksanaBaris(item.service_performers);
        pelaksana.pilihan.forEach(pilihan => pilihanPelaksana.set(pilihan.id, pilihan));
        rows.push({
          id: `kasir-${item.id}`, waktu: sale.created_at, dokumen: sale.no_struk ?? "—",
          href: `/penjualan/${sale.id}`, kanal: itemKanal, jenis: "Barang",
          cabang: one(sale.branches)?.name ?? "—", pelanggan: one(sale.customers)?.name ?? "—",
          cabangId: sale.branch_id ?? null,
          hewan: "—", nama: item.nama,
          pelaksana: item.service_performers ? servicePerformerNames(item.service_performers).join(" · ") : "—",
          pelaksanaIds: pelaksana.ids,
          qty, harga, diskon: new PosDecimal(qty).times(harga).minus(nilai).toNumber(), nilai, status: "—",
        });
      }
      // Faktur batal, faktur yang sudah diganti faktur koreksi, faktur saldo awal, dan
      // faktur selisih stok opname disaring sekaligus dari kumpulan faktur induknya.
      const fakturGrosir = new Map<string, FakturGrosirBaris>();
      for (const item of grosirItems) {
        const faktur = one(item.sales_invoices);
        if (!faktur?.id) throw new Error("Faktur grosir sumber baris laporan tidak dapat diverifikasi.");
        fakturGrosir.set(faktur.id, faktur);
      }
      const grosirDihitung = new Set(fakturGrosirOmzet([...fakturGrosir.values()]).map(faktur => faktur.id));
      for (const item of grosirItems) {
        const faktur = one(item.sales_invoices)!;
        if (!grosirDihitung.has(faktur.id)) continue;
        const qty = Number(item.qty) || 0;
        const harga = Number(item.harga) || 0;
        const nilai = nilaiBarisGrosir(item);
        const hpp = hppBarisGrosir(item);
        rows.push({
          id: `grosir-${item.id}`,
          // Faktur hanya menyimpan tanggal, bukan jam; dipatok awal hari WIB.
          waktu: `${faktur.tanggal}T00:00:00+07:00`,
          dokumen: faktur.no_faktur ?? "—",
          href: `/penjualan/faktur/${faktur.id}`, kanal: "Grosir", jenis: "Barang",
          cabang: one(faktur.branches)?.name ?? "—", cabangId: faktur.branch_id ?? null,
          pelanggan: one(faktur.customers)?.name ?? "—", hewan: "—",
          nama: item.nama, pelaksana: "—", pelaksanaIds: [],
          qty, harga, diskon: Number(item.diskon) || 0, nilai,
          satuan: item.satuan ?? undefined,
          ...(hpp === null ? {} : { hpp }),
          // Akrual: faktur berjalan tetap omzet, statusnya saja yang belum lunas.
          status: (faktur.status ?? "").trim().toLowerCase() === "lunas" ? "Lunas" : "Belum lunas",
        });
      }
    } catch (error) {
      console.error("Laporan penjualan per barang gagal:", error);
      pesanError = error instanceof Error && error.message.startsWith("Periode memuat")
        ? error.message : "Laporan belum bisa dibaca. Coba lagi atau pilih periode lebih pendek.";
    }
  }

  const cari = q.toLocaleLowerCase("id-ID");
  const cabangOptions = pesanError ? [] : [...new Map(rows.filter(row => row.cabangId)
    .map(row => [row.cabangId!, { id: row.cabangId!, name: row.cabang }] as const)).values()]
    .sort((a, b) => a.name.localeCompare(b.name, "id") || a.id.localeCompare(b.id));
  const pelaksanaOptions = pesanError ? [] : [...pilihanPelaksana.values()]
    .sort((a, b) => a.nama.localeCompare(b.nama, "id") || a.id.localeCompare(b.id));
  const terpilih = pesanError ? [] : rows.filter((row) =>
    (jenis === SEMUA_JENIS_KLINIK || row.jenis === jenis) && (!cabangId || row.cabangId === cabangId) && (!pelaksanaId || row.pelaksanaIds?.includes(pelaksanaId)) && (!cari || [row.nama, row.dokumen, row.cabang, row.pelanggan, row.hewan, row.pelaksana]
      .some((value) => value.toLocaleLowerCase("id-ID").includes(cari))),
  ).sort((a, b) => b.waktu.localeCompare(a.waktu) || a.id.localeCompare(b.id));
  const nilaiTotal = terpilih.reduce((sum, row) => sum + row.nilai, 0);
  const qtyTotal = terpilih.reduce((sum, row) => sum + row.qty, 0);
  // Baris anak BMHP menyusul induknya dan tidak pernah ikut menghitung total.
  const dengan = terpilih.flatMap(row => [row, ...(anakBmhp.get(row.id) ?? [])]);
  return { rows: dengan, cabangOptions, pelaksanaOptions, pesanError, nilaiTotal, qtyTotal };
}
