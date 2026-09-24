import Link from "next/link";
import { LaporanPage, KartuAngka, TabelKosong } from "@/components/LaporanPage";
import { createClient } from "@/lib/supabase/server";
import { batasTanggalWIB } from "@/lib/laporan-transaksi";
import { hariIniWIB } from "@/lib/tanggal";
import { nilaiBaris } from "@/lib/tagihan-klinik";
import { lineDiscount } from "@/lib/pos-calc";
import { jenisBarisKlinik, kunciRacikan, type JenisBarisPenjualan } from "@/lib/laporan-penjualan-barang";

type Rel<T> = T | T[] | null;
const one = <T,>(value: Rel<T>): T | null => Array.isArray(value) ? (value[0] ?? null) : value;
const rupiah = (value: number) => `Rp ${Math.round(value).toLocaleString("id-ID")}`;
const waktuWIB = (value: string) => new Date(value).toLocaleString("id-ID", {
  timeZone: "Asia/Jakarta", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
});

type HubunganVisit = {
  branches: Rel<{ name: string }>;
  customers: Rel<{ name: string }>;
  pets: Rel<{ name: string }>;
};
type InvoiceItem = {
  id: string; deskripsi: string; qty: number; harga: number; diskon_persen: number;
  jenis: string | null; item_id: string | null;
  invoices: Rel<{
    visit_id: string; invoice_no: string | null; created_at: string; paid_status: string;
    visits: Rel<HubunganVisit>;
  }>;
};
type SaleItem = {
  id: string; nama: string; qty: number; harga: number;
  item_discount_type: "nominal" | "percent" | null;
  item_discount_value: number | null; promo_discount: number | null;
  sales: Rel<{
    id: string; no_struk: string | null; created_at: string; channel: string | null;
    branches: Rel<{ name: string }>; customers: Rel<{ name: string }>;
  }>;
};
type Baris = {
  id: string; waktu: string; dokumen: string; href: string; kanal: "POS" | "Online" | "Klinik";
  jenis: JenisBarisPenjualan; cabang: string; pelanggan: string; hewan: string;
  nama: string; qty: number; harga: number; diskon: number; nilai: number; status: string;
};

const UKURAN_HALAMAN_DATA = 500;
const BATAS_BARIS_DATA = 5_000;
const UKURAN_HALAMAN_TAMPILAN = 100;

async function bacaSemua<T>(ambil: (dari: number, sampai: number) => Promise<{
  data: T[] | null; error: { message: string } | null;
}>): Promise<T[]> {
  const rows: T[] = [];
  for (let dari = 0; dari <= BATAS_BARIS_DATA; dari += UKURAN_HALAMAN_DATA) {
    const { data, error } = await ambil(dari, dari + UKURAN_HALAMAN_DATA - 1);
    if (error) throw new Error(`Data laporan gagal dibaca: ${error.message}`);
    if (dari === BATAS_BARIS_DATA && data?.length) {
      throw new Error("Periode memuat terlalu banyak baris. Persempit tanggal agar laporan tetap lengkap.");
    }
    rows.push(...(data ?? []));
    if ((data ?? []).length < UKURAN_HALAMAN_DATA) break;
  }
  return rows;
}

function potong<T>(items: T[], ukuran = 100): T[][] {
  const hasil: T[][] = [];
  for (let i = 0; i < items.length; i += ukuran) hasil.push(items.slice(i, i + ukuran));
  return hasil;
}

function tanggalValid(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export default async function LaporanPenjualanBarangPage({ searchParams }: {
  searchParams: Promise<{ dari?: string; sampai?: string; kanal?: string; jenis?: string; q?: string; halaman?: string }>;
}) {
  const sp = await searchParams;
  const hariIni = hariIniWIB();
  const dari = sp.dari || `${hariIni.slice(0, 8)}01`;
  const sampai = sp.sampai || hariIni;
  const kanal = ["POS", "Online", "Klinik"].includes(sp.kanal ?? "") ? sp.kanal! : "Klinik";
  const jenis = kanal === "Klinik" && ["Obat", "Jasa", "Racikan"].includes(sp.jenis ?? "") ? sp.jenis! : kanal === "Klinik" ? "Racikan" : "Barang";
  const q = (sp.q ?? "").trim().slice(0, 120);
  const halamanDiminta = Number(sp.halaman);
  const halaman = Number.isSafeInteger(halamanDiminta) && halamanDiminta > 0 ? halamanDiminta : 1;
  const tanggalSalah = !tanggalValid(dari) || !tanggalValid(sampai) || dari > sampai;
  const { mulai, akhir } = batasTanggalWIB(dari, sampai);
  const rows: Baris[] = [];
  let pesanError = tanggalSalah ? "Rentang tanggal tidak valid. Periksa tanggal awal dan akhir." : "";

  if (!tanggalSalah) {
    try {
      const supabase = await createClient();
      const bacaKlinik = kanal === "Klinik";
      const bacaKasir = kanal === "POS" || kanal === "Online";
      const [invoiceItems, saleItems] = await Promise.all([
        bacaKlinik ? bacaSemua<InvoiceItem>(async (awal, ujung) => {
          const { data, error } = await supabase.from("invoice_items")
            .select("id, deskripsi, qty, harga, diskon_persen, jenis, item_id, invoices!inner(visit_id, invoice_no, created_at, paid_status, voided_at, visits(branches(name), customers(name), pets(name)))")
            .is("invoices.voided_at", null)
            .gte("invoices.created_at", mulai).lte("invoices.created_at", akhir)
            .order("id").range(awal, ujung);
          return { data: data as unknown as InvoiceItem[] | null, error };
        }) : Promise.resolve([] as InvoiceItem[]),
        bacaKasir ? bacaSemua<SaleItem>(async (awal, ujung) => {
          const { data, error } = await supabase.from("sale_items")
            .select("id, nama, qty, harga, item_discount_type, item_discount_value, promo_discount, sales!inner(id, no_struk, created_at, channel, branches(name), customers(name))")
            .gte("sales.created_at", mulai).lte("sales.created_at", akhir)
            .order("id").range(awal, ujung);
          return { data: data as unknown as SaleItem[] | null, error };
        }) : Promise.resolve([] as SaleItem[]),
      ]);

      // Invoice menyimpan nama racikan sebagai baris obat biasa. Cocokkan nama
      // dengan resep di kunjungan sama agar racikan terpisah dari obat ketikan.
      const visitIds = [...new Set(invoiceItems.flatMap((item) => {
        const visitId = one(item.invoices)?.visit_id;
        return visitId ? [visitId] : [];
      }))];
      const medicalRecords: { id: string; visit_id: string }[] = [];
      for (const batch of potong(visitIds)) {
        const { data, error } = await supabase.from("medical_records").select("id, visit_id").in("visit_id", batch);
        if (error) throw new Error(`Data racikan gagal dibaca: ${error.message}`);
        medicalRecords.push(...(data ?? []));
      }
      const visitPerRecord = new Map(medicalRecords.map((record) => [record.id, record.visit_id]));
      const namaRacikan = new Set<string>();
      for (const batch of potong(medicalRecords.map((record) => record.id))) {
        const { data, error } = await supabase.from("compounding_recipes")
          .select("medical_record_id, recipe_name").in("medical_record_id", batch);
        if (error) throw new Error(`Data racikan gagal dibaca: ${error.message}`);
        for (const recipe of data ?? []) {
          const visitId = visitPerRecord.get(recipe.medical_record_id);
          if (visitId) namaRacikan.add(kunciRacikan(visitId, recipe.recipe_name));
        }
      }

      for (const item of invoiceItems) {
        const invoice = one(item.invoices);
        if (!invoice) continue;
        const visit = one(invoice.visits);
        const nilai = nilaiBaris(item);
        rows.push({
          id: `klinik-${item.id}`, waktu: invoice.created_at, dokumen: invoice.invoice_no ?? "—",
          href: `/klinik/pembayaran/${invoice.visit_id}/invoice`, kanal: "Klinik",
          jenis: jenisBarisKlinik(item, invoice.visit_id, namaRacikan),
          cabang: one(visit?.branches ?? null)?.name ?? "—",
          pelanggan: one(visit?.customers ?? null)?.name ?? "—",
          hewan: one(visit?.pets ?? null)?.name ?? "—",
          nama: item.deskripsi, qty: Number(item.qty) || 0, harga: Number(item.harga) || 0,
          diskon: Math.max(0, (Number(item.qty) || 0) * (Number(item.harga) || 0) - nilai),
          nilai, status: invoice.paid_status,
        });
      }
      for (const item of saleItems) {
        const sale = one(item.sales);
        if (!sale) continue;
        const itemKanal = sale.channel ? "Online" : "POS";
        if (kanal !== itemKanal) continue;
        const qty = Number(item.qty) || 0;
        const harga = Number(item.harga) || 0;
        const diskon = lineDiscount({
          qty, harga, item_discount_type: item.item_discount_type,
          item_discount_value: item.item_discount_value, promo_discount: item.promo_discount,
        });
        rows.push({
          id: `kasir-${item.id}`, waktu: sale.created_at, dokumen: sale.no_struk ?? "—",
          href: `/penjualan/${sale.id}`, kanal: itemKanal, jenis: "Barang",
          cabang: one(sale.branches)?.name ?? "—", pelanggan: one(sale.customers)?.name ?? "—",
          hewan: "—", nama: item.nama, qty, harga, diskon, nilai: qty * harga - diskon, status: "—",
        });
      }
    } catch (error) {
      console.error("Laporan penjualan per barang gagal:", error);
      pesanError = error instanceof Error && error.message.startsWith("Periode memuat")
        ? error.message : "Laporan belum bisa dibaca. Coba lagi atau pilih periode lebih pendek.";
    }
  }

  const cari = q.toLocaleLowerCase("id-ID");
  const terpilih = pesanError ? [] : rows.filter((row) =>
    row.jenis === jenis && (!cari || [row.nama, row.dokumen, row.cabang, row.pelanggan, row.hewan]
      .some((value) => value.toLocaleLowerCase("id-ID").includes(cari))),
  ).sort((a, b) => b.waktu.localeCompare(a.waktu) || a.id.localeCompare(b.id));
  const nilaiTotal = terpilih.reduce((sum, row) => sum + row.nilai, 0);
  const qtyTotal = terpilih.reduce((sum, row) => sum + row.qty, 0);
  const banyakHalaman = Math.max(1, Math.ceil(terpilih.length / UKURAN_HALAMAN_TAMPILAN));
  const halamanAktif = Math.min(halaman, banyakHalaman);
  const terlihat = terpilih.slice((halamanAktif - 1) * UKURAN_HALAMAN_TAMPILAN, halamanAktif * UKURAN_HALAMAN_TAMPILAN);
  const tautanHalaman = (nomor: number) => {
    const params = new URLSearchParams({ dari, sampai, kanal, jenis, q, halaman: String(nomor) });
    return `/laporan/penjualan-barang?${params}`;
  };

  return (
    <LaporanPage
      icon="ti-list-details" title="RINCIAN PENJUALAN PER BARANG"
      desc="Setiap barang, obat, jasa, dan racikan yang tercatat pada struk atau invoice. Bawaan: racikan klinik bulan ini."
      filter={<>
        <div><label className="flab">Dari tanggal</label><input className="fi" type="date" name="dari" defaultValue={dari} /></div>
        <div><label className="flab">Sampai tanggal</label><input className="fi" type="date" name="sampai" defaultValue={sampai} /></div>
        <div><label className="flab">Sumber</label><select className="fi" name="kanal" defaultValue={kanal}>
          <option value="Klinik">Klinik</option><option value="POS">Kasir</option><option value="Online">Online</option>
        </select></div>
        <div><label className="flab">Jenis</label><select className="fi" name="jenis" defaultValue={jenis}>
          {kanal === "Klinik" ? <>
            <option value="Racikan">Racikan</option><option value="Obat">Obat lain</option>
            <option value="Jasa">Jasa/tindakan</option>
          </> : <option value="Barang">Barang kasir/online</option>}
        </select></div>
        <div><label className="flab">Cari nama / invoice / pelanggan</label><input className="fi" name="q" defaultValue={q} placeholder="Mis. puyer" style={{ minWidth: 190 }} /></div>
        <button className="btn-def" type="submit"><i className="ti ti-filter" /> Tampilkan</button>
      </>}
      ringkasan={!pesanError ? <KartuAngka items={[
        { label: "Baris penjualan", nilai: terpilih.length.toLocaleString("id-ID") },
        { label: "Jumlah terjual", nilai: qtyTotal.toLocaleString("id-ID", { maximumFractionDigits: 2 }) },
        { label: "Nilai setelah diskon item", nilai: rupiah(nilaiTotal), warna: "#15803d" },
      ]} /> : undefined}
    >
      {pesanError ? <div className="p2ban" style={{ color: "#b91c1c" }}>{pesanError}</div> : <>
        <div className="crm-sec" style={{ marginBottom: 0 }}>
          <div style={{ overflowX: "auto" }}><table className="tbl" style={{ minWidth: 1200, width: "100%" }}>
            <thead><tr>
              <th>Waktu</th><th>No. dokumen</th><th>Cabang</th><th>Pelanggan / pasien</th><th>Barang / layanan</th>
              <th style={{ textAlign: "right" }}>Qty</th><th style={{ textAlign: "right" }}>Harga</th>
              <th style={{ textAlign: "right" }}>Diskon item</th><th style={{ textAlign: "right" }}>Nilai baris</th>
            </tr></thead>
            <tbody>
              {terlihat.map((row) => <tr key={row.id}>
                <td style={{ whiteSpace: "nowrap", fontSize: 10.5 }}>{waktuWIB(row.waktu)}</td>
                <td><Link href={row.href} style={{ color: "#2563eb", fontWeight: 700 }}>{row.dokumen}</Link></td>
                <td>{row.cabang}</td><td>{row.pelanggan}{row.hewan !== "—" && <div style={{ color: "var(--td)" }}>Pasien: {row.hewan}</div>}</td>
                <td style={{ fontWeight: 600 }}>{row.nama}<div style={{ fontSize: 9.5, fontWeight: 400, color: "var(--td)" }}>{row.jenis}{row.status !== "—" ? ` · ${row.status}` : ""}</div></td>
                <td style={{ textAlign: "right" }}>{row.qty.toLocaleString("id-ID", { maximumFractionDigits: 2 })}</td>
                <td style={{ textAlign: "right" }}>{rupiah(row.harga)}</td>
                <td style={{ textAlign: "right" }}>{row.diskon ? rupiah(row.diskon) : "—"}</td>
                <td style={{ textAlign: "right", fontWeight: 700 }}>{rupiah(row.nilai)}</td>
              </tr>)}
              {terlihat.length === 0 && <TabelKosong kolom={9} pesan="Belum ada penjualan untuk pilihan ini." />}
            </tbody>
          </table></div>
          <div style={{ display: "flex", gap: 12, alignItems: "center", justifyContent: "space-between", marginTop: 12, fontSize: 11 }}>
            <span>Halaman {halamanAktif} dari {banyakHalaman}</span>
            <div style={{ display: "flex", gap: 8 }}>
              {halamanAktif > 1 && <Link className="btn-def" href={tautanHalaman(halamanAktif - 1)}>Sebelumnya</Link>}
              {halamanAktif < banyakHalaman && <Link className="btn-def" href={tautanHalaman(halamanAktif + 1)}>Berikutnya</Link>}
            </div>
          </div>
          <div style={{ fontSize: 10, color: "var(--td)", marginTop: 12 }}>
            Nilai baris sudah memperhitungkan diskon per barang. Diskon tingkat nota, retur kasir, dan pajak tidak dibagi ke tiap baris;
            total di sini bisa berbeda dari total pembayaran. Racikan dicocokkan dengan resep pada kunjungan yang sama.
          </div>
        </div>
      </>}
    </LaporanPage>
  );
}
