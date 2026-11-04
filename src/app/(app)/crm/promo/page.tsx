import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { promoCategoryOptions, promoCategoryItem, promoMatchesCategory, type PromoCategoryItem } from "@/lib/promo-categories";
import type { KategoriRow } from "@/lib/kategori";
import {readCompleteList} from "@/lib/checked-list";
import {PreservedForm,TransactionDraftComplete} from "@/components/LocalTransactionDraft";
import {PromoFields} from "./PromoFields";
import {packageTotalReleased} from "@/lib/promo-edit";
import styles from "./PromoForm.module.css";
import { SecHeader } from "@/components/SecHeader";
import type { PromoRow } from "@/lib/promo";
import { filterPromosByStatus, parseStatusFilter, promoMatchesBranch, promoMatchesQuery, promoStatusCounts, sortPromosByStatus } from "@/lib/promo-list";
import { PromoList } from "./PromoList";
import { createPromo } from "./actions";
import { hariIniWIB } from "@/lib/tanggal";
import { nonaktifkanPromoKadaluarsa } from "@/lib/promo-kadaluarsa";

export default async function PromoAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string; kategori?: string; status?: string; q?: string; cabang?: string }>;
}) {
  const { error, success, kategori = "", status: statusParam, q: qParam, cabang: cabangParam } = await searchParams;
  const supabase = await createClient();
  const today = hariIniWIB();
  // Promo yang sudah lewat tanggal dimatikan dulu, baru daftarnya dibaca, supaya
  // yang terlihat di layar sama dengan yang tersimpan. Lihat lib/promo-kadaluarsa.
  await nonaktifkanPromoKadaluarsa(supabase);
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

  const statusFilter = parseStatusFilter(statusParam);
  const q = (typeof qParam === "string" ? qParam : "").trim().slice(0, 100);
  // Hitungan chip memakai SELURUH daftar (sudah dibaca lengkap) pada kategori + pencarian yang sama.
  // Cabang tak dikenal diabaikan (tampil semua), tidak pernah menyembunyikan baris diam-diam.
  const cabang = typeof cabangParam === "string" && branches.some(b => b.id === cabangParam) ? cabangParam : "";
  const scoped = rows.filter(p => promoMatchesBranch(p, cabang) && promoMatchesQuery(p.name, (targetsByPromo.get(p.id) ?? []).map(id => itemById.get(id)?.name ?? ""), q));
  const counts = promoStatusCounts(scoped, today);
  const shown = sortPromosByStatus(filterPromosByStatus(scoped, statusFilter, today), today);

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
        {canEdit && <Link href="/crm/promo/paket/baru" className="back-btn" style={{ marginLeft: "auto" }}>
          <i className="ti ti-packages" /> + Promo Paket
        </Link>}
      </div>

      {error && <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}><i className="ti ti-alert-circle" /> {error}</div>}
      {success && <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}><i className="ti ti-circle-check" /> {success === "edit" ? "Perubahan promo tersimpan." : success === "paket-aktif" ? "Promo paket diaktifkan." : success === "paket-nonaktif" ? "Promo paket dinonaktifkan." : "Promo baru dibuat."}</div>}

      {canEdit&&<div style={{marginBottom:12}}><Link className="btn-def" href="/crm/promo/impor"><i className="ti ti-file-import" /> Impor promo dari Excel</Link></div>}

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
        <p style={{fontSize:11,color:"var(--tm)",marginBottom:8}}>
          <span className="bge g">Potong otomatis</span> = potongan langsung terhitung sendiri di kasir begitu syaratnya terpenuhi.{" "}
          <span className="bge o">Pengingat saja</span> = kasir hanya melihat saran di layar; tidak ada potongan kecuali pelanggan memakai kode kampanye yang ditautkan ke promo ini.{" "}
          <span className="bge x">Kadaluarsa</span> = masa berlakunya sudah lewat dan promonya dinonaktifkan otomatis; perpanjang tanggal &quot;Berlaku s/d&quot; lewat Edit promo kalau mau dipakai lagi.
        </p>
        <form method="get" style={{display:"flex",flexWrap:"wrap",gap:8,alignItems:"end",marginBottom:12}}>
          <input type="hidden" name="status" value={statusFilter} />{q&&<input type="hidden" name="q" value={q} />}
          <label className="flab" style={{minWidth:0,maxWidth:"100%"}}>Cabang
            <select className="fi" aria-label="Cabang daftar promo" name="cabang" defaultValue={cabang} style={{display:"block",width:200,maxWidth:"100%"}}>
              <option value="">Semua cabang</option>
              {branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </label>
          <label className="flab" style={{minWidth:0,maxWidth:"100%"}}>Kategori daftar promo
            <select className="fi" aria-label="Kategori daftar promo" name="kategori" defaultValue={kategori} style={{display:"block",width:280,maxWidth:"100%"}}>
              <option value="">Semua kategori</option>{invalidCategory&&<option value={kategori}>Filter kategori tidak tersedia</option>}
              {categories.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </label>
          <button type="submit" className="btn-def">Filter promo</button>
          {(kategori||cabang)&&<Link className="back-btn" href={q?`/crm/promo?status=${statusFilter}&q=${encodeURIComponent(q)}`:`/crm/promo?status=${statusFilter}`}>Bersihkan filter</Link>}
        </form>
        <p style={{fontSize:11,color:"var(--tm)"}}>Kategori mengikuti master barang saat ini. Promo semua barang ikut setiap kategori; filter ini tidak mengubah aturan promo.</p>
        {invalidCategory&&<p role="alert">Filter kategori tidak tersedia. Bersihkan filter atau pilih kategori yang tersedia.</p>}
        <PromoList rows={shown} total={promos.length} counts={counts} status={statusFilter} q={q} kategori={kategori} cabang={cabang} today={today} canEdit={canEdit}
          targetsByPromo={targetsByPromo} itemById={itemById} branchName={branchName}
          emptyMessage={promos.length === 0 ? "Belum ada promo." : "Tidak ada promo pada filter ini."} />
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
