import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { promoCategoryOptions, promoCategoryItem, promoCategorySummary, promoMatchesCategory, type PromoCategoryItem } from "@/lib/promo-categories";
import type { KategoriRow } from "@/lib/kategori";
import {readCompleteList} from "@/lib/checked-list";
import {PreservedForm,TransactionDraftComplete} from "@/components/LocalTransactionDraft";
import {PromoFields} from "./PromoFields";
import {packageTotalReleased} from "@/lib/promo-edit";
import styles from "./PromoForm.module.css";
import { SecHeader } from "@/components/SecHeader";
import { promoScheduleStatus, type PromoRow } from "@/lib/promo";
import { createPromo, togglePromo } from "./actions";
import { hariIniWIB } from "@/lib/tanggal";

const STATUS_BADGE: Record<string, string> = { aktif: "g", terjadwal: "b", kadaluarsa: "x", nonaktif: "r" };

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");

// Daftar barang dipotong supaya satu baris tabel tidak melebar tak terkendali.
function ringkasBarang(nama: string[] | undefined): string {
  if (!nama || nama.length === 0) return "Semua barang";
  if (nama.length <= 2) return nama.join(", ");
  return `${nama.slice(0, 2).join(", ")} +${nama.length - 2} lagi`;
}

// Aturan promo dalam satu kalimat pendek — supaya pemilik toko bisa baca sekilas
// tanpa membuka formulirnya.
function ringkasAturan(p: PromoRow): string {
  const bagian: string[] = [];
  if (p.discount_type && p.discount_value) {
    bagian.push(p.discount_type === "percent" ? `${p.discount_value}%` : p.rule?.discount_mode === "package_total" ? `${rp(p.discount_value)}/paket min ${p.min_qty}` : `${rp(p.discount_value)}/${p.rule?.unit ?? "satuan"}`);
  }
  if (p.rule?.unit) bagian.push(`satuan ${p.rule.unit}`);
  if (p.min_qty) bagian.push(`min ${p.min_qty}`);
  if (p.max_qty) bagian.push(`maks ${p.max_qty}`);
  if (p.kelipatan) bagian.push("kelipatan");
  if (p.rule?.min_subtotal) bagian.push(`belanja ${rp(p.rule.min_subtotal)}`);
  return bagian.length ? bagian.join(" · ") : "—";
}
const STATUS_LABEL: Record<string, string> = { aktif: "Aktif hari ini", terjadwal: "Terjadwal", kadaluarsa: "Kadaluarsa", nonaktif: "Nonaktif" };

export default async function PromoAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string; kategori?: string }>;
}) {
  const { error, success, kategori = "" } = await searchParams;
  const supabase = await createClient();
  const today = hariIniWIB();
  const {data:{user}} = await supabase.auth.getUser();

  const {data:me}=await supabase.from("profiles").select("role,is_active").eq("id",user?.id??"").maybeSingle();
  const canEdit=!!user&&!!me?.is_active&&["OWNER","ADMIN"].includes(me.role);

  const [promos, branches, activeItems, promoItems, categoryRows] = await Promise.all([
    readCompleteList<PromoRow>((from,to)=>supabase.from("promos")
      .select("id, name, promo_type, rule, is_active, branch_ids, valid_from, valid_until, min_qty, max_qty, kelipatan, auto_apply, discount_type, discount_value",{count:"exact"})
      .order("created_at", { ascending: false }).order("id").range(from,to),"Daftar promo",{maxRows:null}),
    readCompleteList<{id:string;code:string;name:string}>((from,to)=>supabase.from("branches").select("id,code,name",{count:"exact"}).eq("is_active",true).order("name").order("id").range(from,to),"Daftar cabang promo",{maxRows:null}),
    // Only active items can be selected; services retain existing eligibility.
    readCompleteList<PromoCategoryItem>((from,to)=>supabase.from("items").select("id,code,name,category_id",{count:"exact"}).eq("is_active",true).order("name").order("id").range(from,to),"Daftar barang promo",{maxRows:null}),
    // Composite keys are explicit, stable IDs for the checked pagination reader.
    readCompleteList<{id:string;promo_id:string;item_id:string}>(async(from,to)=>{
      const result=await supabase.from("promo_items").select("promo_id,item_id",{count:"exact"}).order("promo_id").order("item_id").range(from,to);
      return {...result,data:result.data?.map(row=>({...row,id:`${row.promo_id}:${row.item_id}`}))??null};
    },"Daftar target promo",{maxRows:null}),
    readCompleteList<KategoriRow>((from,to)=>supabase.from("item_categories").select("id,name,parent_id,is_active",{count:"exact"}).order("name").order("id").range(from,to),"Daftar kategori promo",{maxRows:null}),
  ]);
  const categories = promoCategoryOptions(categoryRows);
  const items = activeItems.map(item=>promoCategoryItem(item,categories));
  const itemById = new Map(items.map(item=>[item.id,item]));
  // Read only explicit stored targets absent from the active selector (e.g. archived).
  // Same session/RLS; inaccessible rows stay honestly unavailable, never all-items.
  const missingIds = [...new Set(promoItems.map(row=>row.item_id))].filter(id=>!itemById.has(id));
  for(let offset=0;offset<missingIds.length;offset+=200){
    const legacyItems=await readCompleteList<PromoCategoryItem>((from,to)=>supabase.from("items").select("id,code,name,category_id",{count:"exact"}).in("id",missingIds.slice(offset,offset+200)).order("id").range(from,to),"Informasi target promo",{maxRows:null});
    for(const item of legacyItems)itemById.set(item.id,promoCategoryItem(item,categories));
  }
  const branchName = new Map(branches.map(b=>[b.id,b.name]));
  const targetsByPromo = new Map<string,string[]>();
  for(const row of promoItems){
    const ids=targetsByPromo.get(row.promo_id)??[];ids.push(row.item_id);targetsByPromo.set(row.promo_id,ids);
  }
  const category = categories.find(c=>c.id===kategori);
  const invalidCategory = !!kategori&&!category;
  const rows = invalidCategory ? [] : kategori&&category ? promos.filter(p=>promoMatchesCategory(targetsByPromo.get(p.id)??[],itemById,category)) : promos;

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/crm" className="back-btn"><i className="ti ti-arrow-left" /> Kembali</Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Promo — Konfigurasi Pusat</span>
      </div>

      {/* Promo & voucher dua-duanya "potongan yang dikelola pusat" — dipasangkan
          di sini supaya tidak perlu balik ke menu CRM buat pindah antar keduanya. */}
      <div style={{ display: "flex", gap: 6, marginBottom: 11 }}>
        <Link href="/crm/promo" className="back-btn" style={tabAktif(true)}>
          <i className="ti ti-speakerphone" /> Promo
        </Link>
        <Link href="/crm/voucher" className="back-btn" style={tabAktif(false)}>
          <i className="ti ti-ticket" /> Kode Voucher
        </Link>
        <Link href="/crm/kampanye" className="back-btn" style={tabAktif(false)}>
          <i className="ti ti-tag" /> Kode Kampanye
        </Link>
      </div>

      {error && <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}><i className="ti ti-alert-circle" /> {error}</div>}
      {success && <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}><i className="ti ti-circle-check" /> {success === "edit" ? "Perubahan promo tersimpan." : "Promo baru dibuat."}</div>}

      {canEdit&&<div style={{marginBottom:12,display:"flex",gap:8,flexWrap:"wrap"}}>
        <Link className="btn-def" href="/crm/promo/impor-daftar"><i className="ti ti-file-import" /> Impor daftar promo (banyak barang)</Link>
        <Link className="btn-def" href="/crm/promo/impor"><i className="ti ti-file-import" /> Impor promo per SKU</Link>
      </div>}

      <div className="crm-sec">
        <SecHeader num="01" title="BUAT PROMO" desc="Set promo per cabang + masa berlaku. Kosongkan cabang = berlaku semua cabang." />
        <TransactionDraftComplete userId={user?.id ?? ""}/><PreservedForm key={user?.id ?? ""} action={createPromo} className={styles.form}>
          <PromoFields userId={user?.id ?? ""} items={items} branches={branches} categories={categories} today={today} packageTotal={packageTotalReleased()}/>
          <button type="submit" className="btn-acc" style={{ gridColumn: "1 / -1", justifyContent: "center" }}>
            <i className="ti ti-plus" /> Buat Promo
          </button>
        </PreservedForm>
      </div>

      <div className="crm-sec">
        <SecHeader num="02" title="DAFTAR PROMO" desc="Semua promo terdaftar + status masa berlaku." />
        <form method="get" style={{display:"flex",flexWrap:"wrap",gap:8,alignItems:"end",marginBottom:12}}>
          <label className="flab" style={{minWidth:0,maxWidth:"100%"}}>Kategori daftar promo
            <select className="fi" aria-label="Kategori daftar promo" name="kategori" defaultValue={kategori} style={{display:"block",width:280,maxWidth:"100%"}}>
              <option value="">Semua kategori</option>{invalidCategory&&<option value={kategori}>Filter kategori tidak tersedia</option>}
              {categories.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </label>
          <button type="submit" className="btn-def">Filter promo</button>
          {kategori&&<Link className="back-btn" href="/crm/promo">Bersihkan filter</Link>}
        </form>
        <p style={{fontSize:11,color:"var(--tm)"}}>Kategori mengikuti master barang saat ini. Promo semua barang ikut setiap kategori; filter ini tidak mengubah aturan promo.</p>
        {invalidCategory&&<p role="alert">Filter kategori tidak tersedia. Bersihkan filter atau pilih kategori yang tersedia.</p>}
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 760 }}>
            <thead>
              <tr>
                <th>Nama</th><th>Berlaku untuk</th><th>Kategori</th><th>Aturan</th><th>Cabang</th>
                <th>Tanggal</th><th>Status</th><th /></tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const st = promoScheduleStatus(p, today);
                const targets=targetsByPromo.get(p.id)??[];
                const categoryLabels=promoCategorySummary(targets,itemById);
                const cabang = !p.branch_ids || p.branch_ids.length === 0
                  ? "Semua cabang"
                  : p.branch_ids.map((id) => branchName.get(id) ?? "—").join(", ");
                return (
                  <tr key={p.id} style={{ opacity: p.is_active ? 1 : 0.55 }}>
                    <td style={{ fontWeight: 500 }}>
                      {p.name}
                      <div style={{ fontSize: 9.5, color: "var(--td)", textTransform: "capitalize" }}>
                        {p.promo_type.replace("_", " ")}
                        {p.auto_apply
                          ? <span style={{ color: "#15803d", fontWeight: 700 }}> · potong otomatis</span>
                          : <span> · pengingat saja</span>}
                      </div>
                    </td>
                    <td style={{ fontSize: 11 }}>{ringkasBarang(targets.length?targets.map(id=>itemById.get(id)?.name??"Barang tidak tersedia"):undefined)}</td>
                    <td style={{fontSize:11,minWidth:160,maxWidth:260,overflowWrap:"anywhere"}}>{categoryLabels.join(", ")}</td>
                    <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{ringkasAturan(p)}</td>
                    <td style={{ fontSize: 11 }}>{cabang}</td>
                    <td style={{ fontSize: 11 }}>{p.valid_from ?? "—"} s/d {p.valid_until ?? "∞"}</td>
                    <td><span className={`bge ${STATUS_BADGE[st]}`}>{STATUS_LABEL[st]}</span></td>
                    <td>
                      {canEdit&&<Link className="back-btn" href={`/crm/promo/${p.id}/edit`}>Edit promo</Link>}
                      <form action={togglePromo}>
                        <input type="hidden" name="id" value={p.id} />
                        <input type="hidden" name="active" value={p.is_active ? "0" : "1"} />
                        <button type="submit" className="btn-def" style={{ padding: "3px 10px", fontSize: 10 }}>
                          {p.is_active ? "Nonaktifkan" : "Aktifkan"}
                        </button>
                      </form>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && <tr><td colSpan={8} style={{ textAlign: "center", color: "var(--td)", padding: "16px 0", fontSize: 11 }}>{kategori ? "Tidak ada promo pada filter ini." : "Belum ada promo."}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

// Penanda halaman aktif untuk pasangan tab Promo / Kode Voucher.
function tabAktif(active: boolean): React.CSSProperties {
  return active
    ? { background: "#eff6ff", color: "#2563eb", borderColor: "#bfdbfe", fontWeight: 700 }
    : {};
}
