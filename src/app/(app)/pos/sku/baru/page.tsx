import Link from "next/link";
import { BarangForm } from "../BarangForm";
import { siapkanFormBarang } from "../data";

export default async function BarangBaruPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const { categories, brands, units, suppliers, barangLain } = await siapkanFormBarang();

  return (
    <>
      <div style={{ marginBottom: 4 }}>
        <Link href="/pos/sku" className="back-btn"><i className="ti ti-arrow-left" /> Barang & Jasa</Link>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
        <div style={{ width: 44, height: 44, borderRadius: 11, background: "#eff6ff", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <i className="ti ti-package" style={{ fontSize: 22, color: "#2563eb" }} />
        </div>
        <div>
          <div style={{ fontSize: 20, fontWeight: 800, color: "var(--sb)", lineHeight: 1.1 }}>BARANG BARU</div>
          <div style={{ fontSize: 11.5, color: "var(--tm)" }}>Isi tab Umum dulu, harga di tab sebelahnya</div>
        </div>
      </div>

      {error && <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}><i className="ti ti-alert-circle" /> {error}</div>}

      <BarangForm categories={categories} brands={brands} satuanMaster={units} suppliers={suppliers} barangLain={barangLain} editing={null} />
    </>
  );
}
