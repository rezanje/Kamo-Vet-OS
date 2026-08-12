import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SecHeader } from "@/components/SecHeader";
import { buatPerintah } from "../actions";
import { hariIniWIB } from "@/lib/tanggal";
import { LingkupPicker, type ItemPilihan } from "./LingkupPicker";

export default async function OpnameBaruPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const supabase = await createClient();

  const [{ data: whs }, { data: itemRows }] = await Promise.all([
    supabase.from("warehouses").select("id, name").eq("is_active", true).neq("type", "TRANSIT").order("name"),
    supabase.from("items").select("id, code, name, item_categories(name)")
      .eq("is_active", true).eq("item_type", "Persediaan").order("name"),
  ]);

  // Hanya barang berpersediaan yang bisa dihitung fisik — jasa tidak punya stok.
  type ItemRow = { id: string; code: string; name: string; item_categories: { name: string } | { name: string }[] | null };
  const items: ItemPilihan[] = ((itemRows ?? []) as unknown as ItemRow[]).map((i) => {
    const kat = Array.isArray(i.item_categories) ? i.item_categories[0] : i.item_categories;
    return { id: i.id, code: i.code, name: i.name, kategori: kat?.name ?? "Tanpa kategori" };
  });

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/pos/opname" className="back-btn">
          <i className="ti ti-arrow-left" /> Kembali
        </Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Perintah Stok Opname</span>
      </div>

      {error && (
        <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}>
          <i className="ti ti-alert-circle" /> {error}
        </div>
      )}

      <form action={buatPerintah}>
        <div className="crm-sec" style={{ maxWidth: 560 }}>
          <SecHeader num="01" title="PERINTAH STOK OPNAME" desc="Surat tugas hitung fisik — seluruh gudang atau sebagian barang saja." />
          <div className="fg" style={{ marginBottom: 10 }}>
            <label className="flab">Gudang *</label>
            <select className="fi" name="warehouse_id" required>
              <option value="">Pilih gudang</option>
              {(whs ?? []).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
          <div className="fg" style={{ marginBottom: 10 }}>
            <label className="flab">Tanggal mulai *</label>
            <input className="fi" type="date" name="tanggal_mulai" defaultValue={hariIniWIB()} required />
          </div>
          <div className="fg" style={{ marginBottom: 10 }}>
            <label className="flab">Penanggung jawab *</label>
            <input className="fi" name="penanggung_jawab" placeholder="Nama penanggung jawab" required />
          </div>
          <div className="fg" style={{ marginBottom: 10 }}>
            <label className="flab">Dikerjakan oleh</label>
            <input className="fi" name="dikerjakan_oleh" placeholder="Nama / email petugas hitung (opsional)" />
          </div>
          <LingkupPicker items={items} />
          <div className="fg">
            <label className="flab">Keterangan</label>
            <textarea className="fi" name="keterangan" rows={3}
              placeholder='Mis. "SO GRND JULI 2026"' style={{ resize: "vertical" }} />
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
            <button type="submit" className="btn-acc">
              <i className="ti ti-clipboard-check" /> Simpan perintah
            </button>
          </div>
        </div>
      </form>
    </>
  );
}
