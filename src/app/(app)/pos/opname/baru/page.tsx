import { PreservedForm } from "@/components/LocalTransactionDraft";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SecHeader } from "@/components/SecHeader";
import { buatPerintah } from "../actions";
import { LingkupPicker, type ItemPilihan } from "@/app/kasir/opname/baru/LingkupPicker";
import { hariIniWIB } from "@/lib/tanggal";
import { opnameWarehouseIds } from "@/lib/opname-cancellation";
import { readCompleteList } from "@/lib/checked-list";
import { ListLoadFailure } from "@/components/ListPagination";

// Perintah opname dari modul Persediaan — untuk gudang yang TIDAK punya layar kasir petshop:
// gudang klinik (VET) dan gudang DC. Gudang toko (RETAIL) tetap boleh dibuatkan perintah di sini,
// tetapi hitungannya dikerjakan dari layar kasir cabang (satu pintu, keputusan meeting 14 Agustus).
type Gudang = { id: string; name: string; type: string; branches: { name: string } | { name: string }[] | null };

const LABEL_TIPE: Record<string, string> = { VET: "Klinik", DC: "Gudang DC", RETAIL: "Toko", ONLINE: "Online", EXPIRED: "Expired" };

export default async function OpnameBaruPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; gudang?: string }>;
}) {
  const { error, gudang } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  let gudangList: Gudang[] = [];
  try {
    const allowed = await opnameWarehouseIds(supabase, user.id);
    if (allowed.length) {
      const { data, error: whError } = await supabase.from("warehouses")
        .select("id, name, type, branches(name)")
        .in("id", allowed).eq("is_active", true).neq("type", "TRANSIT")
        .order("type").order("name");
      if (whError) throw new Error("Daftar gudang belum dapat dimuat.");
      gudangList = (data ?? []) as unknown as Gudang[];
    }
  } catch (loadError) {
    return <ListLoadFailure error={loadError} label="Daftar gudang" />;
  }
  const wh = gudangList.find((g) => g.id === gudang) ?? null;

  let items: ItemPilihan[] = [];
  if (wh) {
    type ItemRow = { code: string; name: string; item_type: string | null; item_categories: { name: string } | { name: string }[] | null };
    type StokRow = { id: string; item_id: string; items: ItemRow | ItemRow[] | null };
    try {
      const stokRows = await readCompleteList<StokRow>((from, to) => supabase.from("stock")
        .select("id, item_id, items(code, name, item_type, item_categories(name))", { count: "exact" })
        .eq("warehouse_id", wh.id).order("id").range(from, to), "Barang gudang");
      items = stokRows
        .map((r) => ({ item_id: r.item_id, item: Array.isArray(r.items) ? (r.items[0] ?? null) : r.items }))
        .filter((r): r is { item_id: string; item: ItemRow } => !!r.item && (r.item.item_type ?? "Persediaan") === "Persediaan")
        .map(({ item_id, item }) => {
          const kat = Array.isArray(item.item_categories) ? item.item_categories[0] : item.item_categories;
          return { id: item_id, code: item.code, name: item.name, kategori: kat?.name ?? "Tanpa kategori" };
        })
        .sort((a, b) => a.name.localeCompare(b.name));
    } catch (loadError) {
      return <ListLoadFailure error={loadError} label="Barang gudang" />;
    }
  }
  const { data: profile } = await supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle();
  const cabangOf = (g: Gudang) => (Array.isArray(g.branches) ? g.branches[0] : g.branches)?.name ?? "";

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <Link href="/pos/opname" className="back-btn"><i className="ti ti-arrow-left" /> Kembali</Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Buat Perintah Stok Opname</span>
      </div>

      {error && (
        <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}>
          <i className="ti ti-alert-circle" /> {error}
        </div>
      )}

      <form method="get" className="crm-sec" style={{ maxWidth: 620 }}>
        <SecHeader num="01" title="PILIH GUDANG" desc="Gudang klinik dan gudang DC dihitung langsung dari modul ini. Gudang toko dihitung dari layar kasir cabangnya." />
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div className="fg" style={{ flex: 1, minWidth: 240, marginBottom: 0 }}>
            <label className="flab">Gudang *</label>
            <select className="fi" name="gudang" defaultValue={wh?.id ?? ""} required>
              <option value="" disabled>Pilih gudang</option>
              {gudangList.map((g) => (
                <option key={g.id} value={g.id}>{g.name} · {LABEL_TIPE[g.type] ?? g.type}{cabangOf(g) ? ` · ${cabangOf(g)}` : ""}</option>
              ))}
            </select>
          </div>
          <button type="submit" className="btn-def" style={{ padding: "7px 14px" }}><i className="ti ti-arrow-right" /> Lanjut</button>
        </div>
        {gudangList.length === 0 && <div style={{ fontSize: 11, color: "var(--td)", marginTop: 8 }}>Belum ada gudang aktif yang bisa kamu akses.</div>}
      </form>

      {wh && (
        <PreservedForm action={buatPerintah}>
          <input type="hidden" name="warehouse_id" value={wh.id} />
          <input type="hidden" name="kembali" value="pos" />
          <div className="crm-sec" style={{ maxWidth: 620 }}>
            <SecHeader num="02" title="RINCIAN PERINTAH"
              desc={wh.type === "RETAIL"
                ? `Gudang toko ${wh.name}: setelah dibuat, hitungan dikerjakan kasir cabang lewat menu Stok Opname di layar kasir.`
                : `Gudang ${wh.name} · setelah dibuat, layar hitung langsung terbuka di sini.`} />
            <div className="frow">
              <div>
                <label className="flab">Tanggal mulai *</label>
                <input className="fi" type="date" name="tanggal_mulai" defaultValue={hariIniWIB()} max={hariIniWIB()} required />
              </div>
              <div>
                <label className="flab">Penanggung jawab *</label>
                <input className="fi" name="penanggung_jawab" defaultValue={profile?.full_name ?? ""} placeholder="Nama penanggung jawab" required />
              </div>
            </div>
            <div className="fg">
              <label className="flab">Dikerjakan oleh</label>
              <input className="fi" name="dikerjakan_oleh" placeholder="Nama petugas yang menghitung (opsional)" />
            </div>

            <LingkupPicker key={wh.id} scope={`opname-create:${wh.id}`} items={items} defaultMode={wh.type === "RETAIL" ? "auto" : "penuh"} />

            <div className="fg">
              <label className="flab">Keterangan</label>
              <textarea className="fi" name="keterangan" rows={2} placeholder='Mis. "SO bulanan gudang klinik"' style={{ resize: "vertical" }} />
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
              <button type="submit" className="btn-acc"><i className="ti ti-clipboard-check" /> Buat perintah</button>
            </div>
          </div>
        </PreservedForm>
      )}
    </>
  );
}
