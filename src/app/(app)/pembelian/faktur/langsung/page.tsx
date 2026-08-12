import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { loadUnitOptions } from "@/lib/satuan";
import { FakturLangsungForm } from "./FakturLangsungForm";

// Faktur Pembelian Langsung — beli barang tanpa PO, barang masuk di dokumen yang sama.

export default async function FakturLangsungPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const supabase = await createClient();

  const [{ data: suppliers }, { data: warehouses }, { data: items }] = await Promise.all([
    // Tabel pemasok tidak punya penanda aktif/nonaktif — jangan saring kolom yang
    // tidak ada, daftarnya jadi kosong tanpa pesan error.
    supabase.from("suppliers").select("id, nama, termin_hari").order("nama"),
    supabase.from("warehouses").select("id, code, name, branches(name)").eq("is_active", true).order("code"),
    supabase.from("items").select("id, code, name, buy_price, unit, track_expiry")
      .eq("is_active", true).eq("item_type", "Persediaan").order("name"),
  ]);

  const daftar = (items ?? []) as {
    id: string; code: string; name: string; buy_price: number; unit: string; track_expiry: boolean | null;
  }[];
  const unitMap = await loadUnitOptions(supabase, daftar.map((i) => i.id));

  type Rel<T> = T | T[] | null;
  const one = <T,>(r: Rel<T>): T | null => (Array.isArray(r) ? (r[0] ?? null) : r);

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/pembelian/faktur" className="back-btn">
          <i className="ti ti-arrow-left" /> Kembali
        </Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Faktur Pembelian Langsung</span>
      </div>

      {error && (
        <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}>
          <i className="ti ti-alert-circle" /> {error}
        </div>
      )}

      <FakturLangsungForm
        suppliers={(suppliers ?? []).map((s) => ({
          id: s.id as string, nama: s.nama as string, terminHari: Number(s.termin_hari) || 0,
        }))}
        warehouses={((warehouses ?? []) as { id: string; code: string; name: string; branches: Rel<{ name: string }> }[])
          .map((w) => ({
            id: w.id, label: `${w.name} — ${one(w.branches)?.name ?? "—"}`,
          }))}
        items={daftar.map((i) => ({
          id: i.id, code: i.code, name: i.name,
          hargaBeli: Number(i.buy_price) || 0,
          trackExpiry: !!i.track_expiry,
          satuan: (unitMap.get(i.id) ?? []).map((u) => ({
            unit: u.unit, factor: u.factor, buy_price: u.buy_price,
          })),
        }))}
      />
    </>
  );
}
