import { NumberInput } from "@/components/NumberInput";
import { TransactionForm } from "@/components/LocalTransactionDraft";
import { ProductionRequestIdentity } from "@/components/ProductionRequestIdentity";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SecHeader } from "@/components/SecHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { ResepForm, type BarangPilihan } from "./ResepForm";
import { mulaiProduksi, selesaikanProduksi } from "./actions";
import { hariIniWIB } from "@/lib/tanggal";
import { loadItemUnits, unitOptions } from "@/lib/satuan";
import { kebutuhanBahan } from "@/lib/produksi";
import { readCompleteList } from "@/lib/checked-list";
import { ProductionAdhocForm } from "./ProductionAdhocForm";
import { hrefPerintahProduksi } from "@/lib/tautan-dokumen";

// Produksi own brand: resep → perintah (bahan keluar) → penyelesaian (barang jadi
// masuk). Satu halaman karena ketiganya dipakai berurutan oleh orang yang sama;
// memecahnya jadi tiga menu cuma menambah klik tanpa menambah kejelasan.

type Rel<T> = T | T[] | null;
const one = <T,>(r: Rel<T>): T | null => (Array.isArray(r) ? r[0] ?? null : r ?? null);

const rp = (n: number) => Number.isFinite(n) ? "Rp " + n.toLocaleString("id-ID", { maximumFractionDigits: 8 }) : "Belum tersedia";
const tgl = (d: string | null) =>
  d ? new Date(d + "T00:00:00").toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta", day: "2-digit", month: "short", year: "numeric" }) : "—";

type MaterialSource={nama:string;warehouse_name?:string;qty:number;unit?:string;cost?:number};
function FrozenMaterials({materials,fallback}:{materials?:MaterialSource[];fallback?:string}){
  if(!Array.isArray(materials))return null;
  return <details><summary>Bahan keluar tersimpan</summary><ul>{materials.filter(m=>m&&typeof m.nama==='string'&&typeof m.qty==='number'&&Number.isFinite(m.qty)).map((m,i)=><li key={i}>{m.nama} · {m.qty.toLocaleString('id-ID',{maximumFractionDigits:12})} {typeof m.unit==='string'?m.unit:''} · {typeof m.warehouse_name==='string'?m.warehouse_name:fallback??'Gudang sumber'}{typeof m.cost==='number'&&Number.isFinite(m.cost)?` · ${rp(m.cost)}`:''}</li>)}</ul></details>;
}

type Resep = {
  id: string; nama: string; output_qty: number; is_active: boolean;
  items: Rel<{ code: string; name: string; unit: string }>;
  production_recipe_items: { qty: number; items: Rel<{ name: string; unit: string }> }[] | null;
};

type Perintah = {
  id: string; no_produksi: string; batch: number; qty_jadi: number; nilai_bahan: number;
  status: string; tanggal: string; tanggal_selesai: string | null;
  production_recipes: Rel<{ nama: string; output_qty: number; items: Rel<{ unit: string }> }>;
  warehouses: Rel<{ name: string }>;
};

export default async function ProduksiPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string; nomor?: string | string[] }>;
}) {
  const { error, success, nomor } = await searchParams;
  const requestedNumber = typeof nomor === "string" && nomor.length > 0 && nomor.length <= 30
    && !/[\u0000-\u001f\u007f]/.test(nomor) ? nomor : null;
  const supabase = await createClient();
  const { data: { user: draftUser } } = await supabase.auth.getUser();
  const draftUserId = draftUser?.id ?? "";

  const [resepData, { data: orderData }, itemData, whData, branchData, selectedResult] = await Promise.all([
    readCompleteList<Resep>((from,to)=>supabase.from("production_recipes")
      .select("id, nama, output_qty, is_active, items(code, name, unit), production_recipe_items(qty, items(name, unit))",{count:"exact"})
      .eq("is_active", true).order("created_at", { ascending: false }).order("id").range(from,to),"Resep produksi",{maxRows:null}),
    supabase.from("production_orders")
      .select("id, no_produksi, batch, qty_jadi, nilai_bahan, status, tanggal, tanggal_selesai, production_recipes(nama, output_qty, items(unit)), warehouses(name)")
      .order("created_at", { ascending: false }).limit(50),
    readCompleteList<BarangPilihan>((from,to)=>supabase.from("items").select("id, code, name, unit",{count:"exact"})
      .eq("is_active", true).eq("item_type", "Persediaan").order("name").order("id").range(from,to),"Barang produksi",{maxRows:null}),
    readCompleteList<{id:string;name:string;branch_id:string}>((from,to)=>supabase.from("warehouses").select("id, name, branch_id",{count:"exact"}).eq("is_active", true).order("name").order("id").range(from,to),"Gudang produksi",{maxRows:null}),
    readCompleteList<{id:string;name:string}>((from,to)=>supabase.from("branches").select("id, name",{count:"exact"}).eq("is_active",true).order("name").order("id").range(from,to),"Cabang produksi",{maxRows:null}),
    requestedNumber ? supabase.from("production_orders")
      .select("id, no_produksi, batch, qty_jadi, nilai_bahan, status, tanggal, tanggal_selesai, production_recipes(nama, output_qty, items(unit)), warehouses(name)")
      .eq("no_produksi", requestedNumber).maybeSingle() : Promise.resolve({ data: null, error: null }),
  ]);

  const resep = (resepData ?? []) as unknown as Resep[];
  const perintah = (orderData ?? []) as unknown as Perintah[];
  const itemUnits = await loadItemUnits(supabase, (itemData ?? []).map((item: { id: string }) => item.id));
  const barang = ((itemData ?? []) as BarangPilihan[]).map(item => ({ ...item, units: unitOptions({ unit: item.unit, sell_price: 0 }, itemUnits.get(item.id) ?? []) }));
  const gudang = whData;
  const berjalan = perintah.filter((p) => p.status === "berjalan");
  const selected = selectedResult.data && selectedResult.data.no_produksi === requestedNumber
    ? selectedResult.data as Perintah : null;
  const sourceResult = await supabase.rpc("read_production_atomic_sources", {
    p_order_ids: [...new Set([...perintah.map(p => p.id), ...(selected ? [selected.id] : [])])],
  });
  type FrozenSource = {recipe_name:string;output_name:string;unit:string|null;planned_qty:number;materials?:MaterialSource[]};
  const sourceMap = !sourceResult.error && sourceResult.data && typeof sourceResult.data === "object" && !Array.isArray(sourceResult.data) ? sourceResult.data as Record<string,FrozenSource> : {};
  const sourceFor = (id:string) => {
    const source = sourceMap[id];
    return source && typeof source.recipe_name === "string" && typeof source.output_name === "string" && (source.unit===null || typeof source.unit === "string") && typeof source.planned_qty === "number" && Number.isFinite(source.planned_qty) ? source : undefined;
  };
  const selectedSource = selected ? sourceFor(selected.id) : undefined;

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/pos" className="back-btn"><i className="ti ti-arrow-left" /> Kembali</Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Produksi Own Brand</span>
      </div>

      {success && (
        <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}>
          <i className="ti ti-circle-check" /> {success}
        </div>
      )}
      {error && (
        <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}>
          <i className="ti ti-alert-circle" /> {error}
        </div>
      )}

      {sourceResult.error && <div role="alert" className="p2ban">Bukti sumber produksi belum dapat diperiksa. Penyelesaian ditahan; muat ulang sebelum melanjutkan.</div>}

      {nomor !== undefined && <section id="selected-production" className="crm-sec" aria-label="Perintah produksi terpilih">
        {requestedNumber === null ? <p>Nomor pekerjaan tidak valid.</p> :
          selectedResult.error || sourceResult.error ? <p role="alert">Pekerjaan belum dapat diperiksa. Muat ulang.</p> :
          !selected || !selectedSource ? <p>Pekerjaan tidak tersedia untuk akses Anda.</p> : <>
              <h2 style={{ fontSize: 14, marginBottom: 8 }}>Perintah produksi {selected.no_produksi}</h2>
              <p>{selectedSource.recipe_name} · {selectedSource.output_name} · {selected.status === "selesai" ? "Selesai" : selected.status === "berjalan" ? "Berjalan" : "Batal"}</p>
              <p>Rencana {selectedSource.planned_qty.toLocaleString("id-ID")} {selectedSource.unit ?? ""} · Jadi {Number(selected.qty_jadi).toLocaleString("id-ID")} · Modal bahan {rp(Number(selected.nilai_bahan))}</p>
              <p>Mulai {tgl(selected.tanggal)} · Selesai {tgl(selected.tanggal_selesai)} · Gudang {one(selected.warehouses)?.name ?? "—"}</p>
              <FrozenMaterials materials={selectedSource.materials} fallback={one(selected.warehouses)?.name}/>
            </>}
      </section>}

      {/* 01 — perintah produksi yang masih berjalan, beserta penyelesaiannya */}
      <div className="crm-sec">
        <SecHeader
          num="01"
          title="PRODUKSI BERJALAN"
          desc="Bahannya sudah keluar gudang. Isi jumlah barang jadi untuk menutup perintahnya — harga pokok dihitung dari modal bahan yang terpakai."
        />
        {berjalan.length === 0 ? (
          <div style={{ fontSize: 11, color: "var(--td)", padding: "14px 0", textAlign: "center" }}>
            Tidak ada produksi yang sedang berjalan.
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="tbl" style={{ minWidth: 820 }}>
              <thead>
                <tr>
                  <th style={{ width: 150 }}>Nomor</th><th>Resep / pekerjaan</th><th style={{ width: 120 }}>Gudang hasil</th>
                  <th style={{ width: 90, textAlign: "right" }}>Rencana jadi</th>
                  <th style={{ width: 130, textAlign: "right" }}>Modal bahan</th>
                  <th style={{ width: 260 }}>Selesaikan</th>
                </tr>
              </thead>
              <tbody>
                {berjalan.map((p) => {
                  const frozen = sourceFor(p.id);
                  const outputBaseUnit = frozen?.unit ?? "";
                  const rencana = frozen?.planned_qty ?? 0;
                  return (
                    <tr key={p.id}>
                      <td style={{ fontSize: 11, fontWeight: 600 }}>
                        <Link href={hrefPerintahProduksi(p.no_produksi)}>{p.no_produksi}</Link>
                        <div style={{ fontSize: 9.5, color: "var(--td)", fontWeight: 400 }}>{tgl(p.tanggal)}</div>
                      </td>
                      <td style={{ fontSize: 11.5 }}>{frozen?.recipe_name ?? "Sumber lama / belum terverifikasi"}{frozen && <div>{frozen.output_name}</div>} <span style={{ color: "var(--td)" }}>× {Number(p.batch)}</span>
                        <FrozenMaterials materials={frozen?.materials} fallback={one(p.warehouses)?.name}/>
                      </td>
                      <td style={{ fontSize: 11 }}>{one(p.warehouses)?.name ?? "—"}</td>
                      <td style={{ textAlign: "right", fontSize: 11.5 }}>{rencana.toLocaleString("id-ID")}</td>
                      <td style={{ textAlign: "right", fontSize: 11.5 }}>{rp(Number(p.nilai_bahan))}</td>
                      <td>
                        {frozen ? <TransactionForm userId={draftUserId} scope={`production-complete:${p.id}`} action={selesaikanProduksi} style={{ display: "flex", gap: 5, alignItems: "flex-end", flexWrap: "wrap" }}>
                          <ProductionRequestIdentity userId={draftUserId} kind="finish" orderId={p.id}/>
                          <input type="hidden" name="id" value={p.id} />
                          <div style={{ width: 90 }}>
                            <label className="flab">Jadi {outputBaseUnit && `(${outputBaseUnit})`}</label>
                            <NumberInput className="fi" type="number" name="qty_jadi" min={0} step="any"
                              defaultValue={rencana || ""} style={{ textAlign: "right" }} />
                          </div>
                          <div style={{ width: 130 }}>
                            <label className="flab">Tanggal</label>
                            <input className="fi" type="date" name="tanggal_selesai" defaultValue={hariIniWIB()} />
                          </div>
                          <SubmitButton className="btn-acc" icon="ti-package-import" pendingText="Memproses…"
                            style={{ padding: "5px 10px", fontSize: 10.5 }}>
                            Selesai
                          </SubmitButton>
                        </TransactionForm> : <p>Rekonsiliasi bahan, WIP dan jurnal asal sebelum penyelesaian. Jangan membuat penerimaan ulang.</p>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="crm-sec"><SecHeader num="02" title="PEKERJAAN AD HOC" desc="Bahan dan gudang dipilih per pekerjaan, tanpa menambah master resep."/><ProductionAdhocForm userId={draftUserId} barang={barang} gudang={gudang} cabang={branchData}/></div>

      {/* Mulai produksi baru dari resep yang ada */}
      <div className="crm-sec">
        <SecHeader
          num="02"
          title="MULAI PRODUKSI"
          desc="Pilih resep dan jumlah batch. Bahan langsung keluar dari gudang yang dipilih; nilainya pindah ke Persediaan Dalam Proses sampai barang jadi masuk."
        />
        {resep.length === 0 ? (
          <div style={{ fontSize: 11, color: "var(--td)", padding: "10px 0" }}>
            Belum ada resep produksi — buat dulu di bawah.
          </div>
        ) : (
          <TransactionForm userId={draftUserId} scope={"production-create"} action={mulaiProduksi}>
            <ProductionRequestIdentity userId={draftUserId} kind="start"/>
            <div className="frow" style={{ marginBottom: 10 }}>
              <div>
                <label className="flab">Resep *</label>
                <select className="fi" name="recipe_id" required defaultValue="">
                  <option value="" disabled>— pilih resep —</option>
                  {resep.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.nama} → {Number(r.output_qty)} {one(r.items)?.unit ?? ""} {one(r.items)?.name ?? ""}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="flab">Gudang bahan *</label>
                <select className="fi" name="warehouse_id" required defaultValue="">
                  <option value="" disabled>— pilih gudang —</option>
                  {gudang.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              </div>
              <div>
                <label className="flab">Jumlah batch *</label>
                <NumberInput className="fi" type="number" name="batch" min={1} step="any" defaultValue={1} required />
              </div>
              <div>
                <label className="flab">Tanggal</label>
                <input className="fi" type="date" name="tanggal" defaultValue={hariIniWIB()} />
              </div>
            </div>
            <div className="fg" style={{ marginBottom: 10 }}>
              <label className="flab">Catatan</label>
              <input className="fi" name="catatan" placeholder="opsional" />
            </div>
            <SubmitButton className="btn-acc" icon="ti-player-play" pendingText="Memproses…">
              Mulai produksi (bahan keluar)
            </SubmitButton>
          </TransactionForm>
        )}
      </div>

      {/* 03 — daftar resep */}
      <div className="crm-sec">
        <SecHeader num="03" title="RESEP PRODUKSI" desc={`${resep.length} resep aktif.`} />
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 640 }}>
            <thead>
              <tr><th>Resep</th><th>Barang jadi</th><th style={{ width: 100, textAlign: "right" }}>Hasil</th><th>Bahan</th></tr>
            </thead>
            <tbody>
              {resep.map((r) => {
                const jadi = one(r.items);
                return (
                  <tr key={r.id}>
                    <td style={{ fontSize: 11.5, fontWeight: 600 }}>{r.nama}</td>
                    <td style={{ fontSize: 11.5 }}>{jadi ? <><span>{jadi.name}</span><small style={{display:'block',color:'var(--tm)'}}>Kode: {jadi.code}</small></> : "—"}</td>
                    <td style={{ textAlign: "right", fontSize: 11.5 }}>
                      {Number(r.output_qty)} {jadi?.unit ?? ""}
                    </td>
                    <td style={{ fontSize: 10.5, color: "var(--tm)" }}>
                      {kebutuhanBahan(
                        (r.production_recipe_items ?? []).map((b) => ({
                          item_id: one(b.items)?.name ?? "", nama: one(b.items)?.name ?? "", qty: Number(b.qty),
                        })), 1,
                      ).map((b) => `${b.nama} ${b.qty}`).join(" · ") || "—"}
                    </td>
                  </tr>
                );
              })}
              {resep.length === 0 && (
                <tr><td colSpan={4} style={{ textAlign: "center", color: "var(--td)", padding: "16px 0", fontSize: 11 }}>
                  Belum ada resep produksi.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <ResepForm barang={barang} />

      {/* 04 — riwayat */}
      <div className="crm-sec" style={{ marginBottom: 0 }}>
        <SecHeader num="04" title="RIWAYAT PRODUKSI" desc="Perintah yang sudah ditutup." />
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 720 }}>
            <thead>
              <tr>
                <th style={{ width: 150 }}>Nomor</th><th>Resep</th>
                <th style={{ width: 100, textAlign: "right" }}>Jadi</th>
                <th style={{ width: 130, textAlign: "right" }}>Modal bahan</th>
                <th style={{ width: 120, textAlign: "right" }}>HPP / unit</th>
                <th style={{ width: 110 }}>Selesai</th>
              </tr>
            </thead>
            <tbody>
              {perintah.filter((p) => p.status === "selesai").map((p) => (
                <tr key={p.id}>
                  <td style={{ fontSize: 11, fontWeight: 600 }}><Link href={hrefPerintahProduksi(p.no_produksi)}>{p.no_produksi}</Link></td>
                  <td style={{ fontSize: 11.5 }}>{sourceFor(p.id)?.recipe_name??one(p.production_recipes)?.nama??"Sumber lama / belum terverifikasi"}<div>{sourceFor(p.id)?.output_name??''}</div><FrozenMaterials materials={sourceFor(p.id)?.materials} fallback={one(p.warehouses)?.name}/></td>
                  <td style={{ textAlign: "right", fontSize: 11.5 }}>{Number(p.qty_jadi).toLocaleString("id-ID")}</td>
                  <td style={{ textAlign: "right", fontSize: 11.5 }}>{rp(Number(p.nilai_bahan))}</td>
                  <td style={{ textAlign: "right", fontSize: 11.5 }}>
                    {Number(p.qty_jadi) > 0 ? rp(Number(p.nilai_bahan) / Number(p.qty_jadi)) : "—"}
                  </td>
                  <td style={{ fontSize: 11 }}>{tgl(p.tanggal_selesai)}</td>
                </tr>
              ))}
              {perintah.filter((p) => p.status === "selesai").length === 0 && (
                <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--td)", padding: "16px 0", fontSize: 11 }}>
                  Belum ada produksi yang selesai.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
