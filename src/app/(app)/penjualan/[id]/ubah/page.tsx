import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatPosMoney } from "@/lib/pos-money";
import { loadKatalogPilihan, loadKatalogUntuk, loadStrukUbah } from "@/lib/ubah-struk-server";
import { alasanTidakBisaUbah, potonganLainLama } from "@/lib/ubah-struk";
import { UbahStrukForm } from "./UbahStrukForm";

const fmtDt = (iso: string) =>
  new Date(iso).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });

export default async function UbahStrukPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: profile } = user ? await supabase.from("profiles").select("role,is_active").eq("id", user.id).maybeSingle() : { data: null };
  const boleh = profile?.is_active === true && (profile.role === "OWNER" || profile.role === "FINANCE");
  const lama = await loadStrukUbah(supabase, id);
  if (!lama) notFound();
  const back = <Link href={`/penjualan/${id}`} className="back-btn"><i className="ti ti-arrow-left" /> Kembali ke struk</Link>;
  if (!boleh || !user) return <>{back}<div role="alert" className="p2ban">Hanya Owner atau Finance yang dapat mengubah transaksi.</div></>;
  const [{ count: receiptCount }, { count: returnCount }] = await Promise.all([
    supabase.from("pos_receipt_cancellations").select("id", { count: "exact", head: true }).eq("sale_id", id),
    supabase.from("sales_returns").select("id", { count: "exact", head: true }).eq("sale_id", id).is("voided_at", null),
  ]);
  const alasan = alasanTidakBisaUbah(lama, { receiptCycle: (receiptCount ?? 0) > 0, returns: (returnCount ?? 0) > 0 });
  if (alasan) return <>{back}<div role="alert" className="p2ban">{alasan}</div></>;

  const [pilihan, terlibat] = await Promise.all([
    loadKatalogPilihan(supabase),
    loadKatalogUntuk(supabase, lama.items.map(line => line.item_id ?? "")),
  ]);
  const katalog = [...new Map([...pilihan, ...terlibat.values()].map(item => [item.id, item])).values()];

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        {back}<span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Ubah {lama.no_struk}</span>
      </div>
      <div role="status" className="p2ban">
        Struk tanggal <strong>{fmtDt(lama.created_at)}</strong> · total sekarang {formatPosMoney(lama.total)}.
        Hasil ubah <strong>tetap tercatat di tanggal struk ini</strong> (omzet, kas/bank). Koreksi stok dan modal barang dicatat hari ini.
        Struk lama ditutup dan diganti nomor baru berakhiran &quot;-U&quot;; semua perubahan tercatat di riwayat.
      </div>
      <UbahStrukForm userId={user.id} saleId={lama.id} revision={lama.revision}
        lines={lama.items.map(line => ({
          asal: line.id, item_id: line.item_id ?? "", nama: line.nama, qty: line.qty, harga: line.harga, satuan: line.satuan ?? "",
          diskon_tipe: line.item_discount_type === "percent" ? "percent" : line.item_discount_value > 0 ? "nominal" : null,
          diskon_nilai: line.item_discount_value, promo: !!(line.promo_id || line.promo_claim_id), promo_diskon: line.promo_discount,
          grup: (line.components?.length ?? 0) > 0,
        }))}
        katalog={katalog.map(item => ({ id: item.id, code: item.code, nama: item.nama, item_type: item.item_type, is_active: item.is_active, units: item.units, unitHarga: item.unitHarga }))}
        diskonKategori={lama.diskon_kategori} potonganLain={potonganLainLama(lama)} poinDigunakan={lama.poin_digunakan}
        payments={lama.payments.map(p => ({ method: p.method, amount: Math.round((p.amount - p.fee_amount) * 100) / 100, fee_percent: p.fee_percent }))}
        punyaPelanggan={!!lama.customer_id} />
    </>
  );
}
