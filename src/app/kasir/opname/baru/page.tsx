import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getOpenShift } from "@/lib/shift";
import { SecHeader } from "@/components/SecHeader";
import { buatPerintah } from "@/app/(app)/pos/opname/actions";
import { LingkupPicker, type ItemPilihan } from "./LingkupPicker";
import { hariIniWIB } from "@/lib/tanggal";
import { gudangCabang } from "../gudang";

// Perintah opname versi kasir: gudang tidak dipilih (selalu gudang cabang shift),
// dan daftar barangnya hanya yang benar-benar ada di gudang itu — kasir tidak
// perlu melihat seluruh master barang perusahaan.
export default async function OpnameKasirBaruPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const shift = await getOpenShift(supabase as never, user.id);
  if (!shift) redirect("/kasir/mulai");

  const wh = await gudangCabang(supabase, shift.branch_id);
  if (!wh) redirect("/kasir/opname?error=" + encodeURIComponent("Cabang ini belum punya gudang aktif."));

  const [{ data: profile }, { data: stokRows }] = await Promise.all([
    supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle(),
    supabase.from("stock")
      .select("item_id, items(code, name, item_categories(name))")
      .eq("warehouse_id", wh.id),
  ]);

  type StokRow = {
    item_id: string;
    items: { code: string; name: string; item_categories: { name: string } | { name: string }[] | null } | null;
  };
  const items: ItemPilihan[] = ((stokRows ?? []) as unknown as StokRow[])
    .filter((r) => r.items)
    .map((r) => {
      const kat = Array.isArray(r.items!.item_categories) ? r.items!.item_categories[0] : r.items!.item_categories;
      return { id: r.item_id, code: r.items!.code, name: r.items!.name, kategori: kat?.name ?? "Tanpa kategori" };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <Link href="/kasir/opname" className="back-btn">
          <i className="ti ti-arrow-left" /> Kembali
        </Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Hitung Stok</span>
      </div>

      {error && (
        <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}>
          <i className="ti ti-alert-circle" /> {error}
        </div>
      )}

      <form action={buatPerintah}>
        <input type="hidden" name="warehouse_id" value={wh.id} />
        <input type="hidden" name="kembali" value="kasir" />

        <div className="crm-sec" style={{ maxWidth: 620 }}>
          <SecHeader
            num="01"
            title="HITUNG STOK"
            desc={`Gudang ${wh.name} · pilih seluruh gudang atau sebagian rak saja. Toko tidak perlu tutup.`}
          />

          <div className="fg" style={{ marginBottom: 10 }}>
            <label className="flab">Tanggal hitung *</label>
            <input className="fi" type="date" name="tanggal_mulai" defaultValue={hariIniWIB()} required />
          </div>
          <div className="fg" style={{ marginBottom: 10 }}>
            <label className="flab">Penanggung jawab *</label>
            <input className="fi" name="penanggung_jawab" defaultValue={profile?.full_name ?? ""} placeholder="Nama penanggung jawab" required />
          </div>

          <LingkupPicker items={items} />

          <div className="fg">
            <label className="flab">Keterangan</label>
            <textarea className="fi" name="keterangan" rows={2}
              placeholder='Mis. "Hitung rak makanan kucing"' style={{ resize: "vertical" }} />
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
            <button type="submit" className="btn-acc" style={{ background: "var(--posb)" }}>
              <i className="ti ti-clipboard-check" /> Mulai hitung
            </button>
          </div>
        </div>
      </form>
    </>
  );
}
