import Link from "next/link";
import { notFound } from "next/navigation";
import { BarangForm } from "../BarangForm";
import { siapkanFormBarang, loadBarang } from "../data";

export default async function BarangDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const [{ id }, { error }] = await Promise.all([params, searchParams]);
  const { supabase, categories, brands, units } = await siapkanFormBarang();

  const barang = await loadBarang(supabase, id);
  if (!barang) notFound();

  return (
    <>
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

      <BarangForm categories={categories} brands={brands} satuanMaster={units} editing={barang} />
    </>
  );
}
