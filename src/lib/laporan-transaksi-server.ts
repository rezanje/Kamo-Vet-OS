// Penarikan data untuk laporan transaksi dasar. Dipisah dari halamannya karena
// dipakai dua laporan sekaligus (per cabang & per hari) — angkanya wajib sama.
import { createClient } from "@/lib/supabase/server";
import { tanggalWIB } from "@/lib/tanggal";
import type { Trx } from "@/lib/laporan-transaksi";

type Rel<T> = T | T[] | null;
const one = <T,>(r: Rel<T>): T | null => (Array.isArray(r) ? (r[0] ?? null) : r);

// Batas aman satu tarikan. Kalau kena batas, halaman menampilkan peringatan
// supaya angka yang terpotong tidak dibaca sebagai angka sebenarnya.
const BATAS = 5000;

export type HasilTarik = {
  trx: Trx[];
  cabangList: { id: string; name: string }[];
  terpotong: boolean;
};

export async function tarikTransaksi(dari: string, sampai: string): Promise<HasilTarik> {
  const supabase = await createClient();
  // created_at disimpan UTC; batasnya ditulis dengan offset +07:00 supaya struk
  // jam 07:00 WIB tidak jatuh ke hari sebelumnya.
  const mulai = `${dari}T00:00:00+07:00`;
  const akhir = `${sampai}T23:59:59+07:00`;

  const [{ data: sales }, { data: invoices }, { data: returs }, { data: cabangList }] =
    await Promise.all([
      supabase.from("sales")
        .select("id, customer_id, total, channel, created_at, branches(name), sale_items(id)")
        .gte("created_at", mulai).lte("created_at", akhir).limit(BATAS),
      // Tagihan klinik yang dibatalkan tidak dihitung sebagai transaksi.
      supabase.from("invoices")
        .select("id, total, created_at, visits(customer_id, branches(name)), invoice_items(id)")
        .is("voided_at", null)
        .gte("created_at", mulai).lte("created_at", akhir).limit(BATAS),
      // Retur ditarik tanpa batas tanggal: struk bulan lalu bisa diretur bulan ini,
      // dan omzet struk itu harus terlihat sudah berkurang.
      supabase.from("sales_returns").select("sale_id, total"),
      supabase.from("branches").select("id, name").eq("is_active", true).order("name"),
    ]);

  const returPerStruk = new Map<string, number>();
  for (const r of (returs ?? []) as { sale_id: string; total: number }[]) {
    returPerStruk.set(r.sale_id, (returPerStruk.get(r.sale_id) ?? 0) + (Number(r.total) || 0));
  }

  type SaleRow = {
    id: string; customer_id: string | null; total: number; channel: string | null;
    created_at: string; branches: Rel<{ name: string }>; sale_items: { id: string }[] | null;
  };
  type InvRow = {
    id: string; total: number; created_at: string;
    visits: Rel<{ customer_id: string | null; branches: Rel<{ name: string }> }>;
    invoice_items: { id: string }[] | null;
  };

  const trx: Trx[] = [];

  for (const s of (sales ?? []) as unknown as SaleRow[]) {
    trx.push({
      tanggal: tanggalWIB(s.created_at),
      cabang: one(s.branches)?.name ?? "—",
      customerId: s.customer_id,
      omzet: (Number(s.total) || 0) - (returPerStruk.get(s.id) ?? 0),
      item: s.sale_items?.length ?? 0,
      kanal: s.channel ? "Online" : "POS",
    });
  }

  for (const inv of (invoices ?? []) as unknown as InvRow[]) {
    const v = one(inv.visits);
    trx.push({
      tanggal: tanggalWIB(inv.created_at),
      cabang: one(v?.branches ?? null)?.name ?? "—",
      customerId: v?.customer_id ?? null,
      omzet: Number(inv.total) || 0,
      item: inv.invoice_items?.length ?? 0,
      kanal: "Klinik",
    });
  }

  return {
    trx,
    cabangList: (cabangList ?? []) as { id: string; name: string }[],
    terpotong: (sales?.length ?? 0) >= BATAS || (invoices?.length ?? 0) >= BATAS,
  };
}
