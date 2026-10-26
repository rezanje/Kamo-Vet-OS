import { ActivityHistoryLink } from "@/components/ActivityHistoryLink";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BarangForm } from "../BarangForm";
import { siapkanFormBarang, loadBarang } from "../data";
import { loadProductionSkuHistory } from "@/lib/production-sku-history";
import { hrefPerintahProduksi } from "@/lib/tautan-dokumen";

export default async function BarangDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const [{ id }, { error }] = await Promise.all([params, searchParams]);
  const { supabase, categories, brands, units, suppliers, barangLain, kandidatGrup } = await siapkanFormBarang();

  const barang = await loadBarang(supabase, id);
  if (!barang) notFound();
  let productionError = false;
  const productionOrders = barang.item_type === "Persediaan" ? await loadProductionSkuHistory(supabase, id).catch(() => {
    productionError = true;
    return [];
  }) : [];

  return (
    <>
      <ActivityHistoryLink entity="items" id={id} />
      <div style={{ marginBottom: 4 }}>
        <Link href="/pos/sku" className="back-btn"><i className="ti ti-arrow-left" /> Barang & Jasa</Link>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
        <div style={{ width: 44, height: 44, borderRadius: 11, background: "#eff6ff", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <i className="ti ti-package" style={{ fontSize: 22, color: "#2563eb" }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: "var(--sb)", lineHeight: 1.1 }}>{barang.name}</div>
          <div style={{ fontSize: 11.5, color: "var(--tm)" }}>
            {barang.item_type} · kode {barang.code || "—"}
            {barang.is_active ? "" : " · nonaktif"}
          </div>
        </div>
      </div>

      {error && <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}><i className="ti ti-alert-circle" /> {error}</div>}

      {barang.item_type === "Persediaan" && <section className="crm-sec" aria-label="Pekerjaan produksi SKU" style={{ marginBottom: 14 }}>
        <h2 style={{ fontSize: 14, marginBottom: 6 }}>Pekerjaan produksi dengan SKU hasil ini</h2>
        <p style={{ fontSize: 11, color: "var(--tm)" }}>Dokumen di bawah memakai ID SKU hasil yang sama. Ini bukan bukti bahwa suatu racikan klinik memakai batch produksi tertentu.</p>
        {productionError ? <p role="alert">Riwayat produksi belum dapat diperiksa untuk akses Anda. Muat ulang atau buka modul produksi.</p>
          : productionOrders.length === 0 ? <p>Belum ada pekerjaan produksi tersimpan yang dapat ditelusuri untuk SKU ini.</p>
          : <ul>{productionOrders.map(order => <li key={order.id}>
              <Link href={hrefPerintahProduksi(order.no_produksi)}>{order.no_produksi}</Link>
              {` · ${order.tanggal} · ${order.status} · hasil ${Number(order.qty_jadi).toLocaleString("id-ID")}`}
            </li>)}</ul>}
      </section>}

      <BarangForm categories={categories} brands={brands} satuanMaster={units}
        suppliers={suppliers} barangLain={barangLain} kandidatGrup={kandidatGrup} editing={barang} />
    </>
  );
}
