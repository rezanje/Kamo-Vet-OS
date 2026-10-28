import { TransactionForm } from "@/components/LocalTransactionDraft";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { advanceRecipeStatus, bahanRacikanUntukKunjungan, updateRacikPetunjuk, updateRacikPemakaian } from "../actions";
import { RacikanAksi } from "./RacikanAksi";
import { SubmitButton } from "@/components/SubmitButton";
import { readCompleteList } from "@/lib/checked-list";
import { hrefAsalBahan, hrefInvoiceTujuan, labelAsalBahan, readCompoundTrace, type CompoundTrace } from "@/lib/compound-trace";

type Rel<T> = T | T[] | null;
function one<T>(r: Rel<T>): T | null {
  return Array.isArray(r) ? (r[0] ?? null) : r;
}

const statusLabel: Record<string, string> = {
  pending: "Menunggu diracik", ready: "Siap diserahkan", handed_over: "Sudah diserahkan", void: "Void",
};
const statusBadge = (s: string) => (s === "handed_over" ? "g" : s === "ready" ? "b" : s === "void" ? "r" : "o");

type Ingredient = { ingredient_name: string; item_id: string | null; quantity: number; unit: string };
type Recipe = {
  id: string; recipe_name: string; created_at: string; dosage_instruction: string; total_volume: string; dosage_form: string;
  compounding_steps: string; status: string; compounding_ingredients: Ingredient[];
};

// Racik obat (referensi RACIK OBAT): petunjuk racik dari resep dokter — apoteker/PCA.
export default async function RacikDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ recipeId: string }>;
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const { recipeId } = await params;
  const { error, success } = await searchParams;
  const supabase = await createClient();

  const { data: r, error: recipeError } = await supabase
    .from("compounding_recipes")
    .select(`id, recipe_name, dosage_instruction, total_volume, dosage_form, compounding_steps, status, created_at, medical_record_id, compound_official_usage(recipe_id),
      medical_records(id, diagnosis, anamnesis, catatan_resep, visit_id,
        visits(id, poli, dokter, keluhan, created_at, pets(name, species, breed, photo_url), customers(name, phone, address)))`)
    .eq("id", recipeId)
    .maybeSingle();
  // A failed read is not evidence that the source document is missing.
  if (recipeError) throw new Error("Racikan belum dapat dimuat. Coba muat ulang.");
  if (!r) notFound();
  const official = !!one(r.compound_official_usage as Rel<{ recipe_id: string }>);

  const mr = one(r.medical_records as Rel<{ id: string; diagnosis: string | null; anamnesis: string | null; catatan_resep: string | null; visit_id: string; visits: Rel<{ id: string; poli: string; dokter: string | null; keluhan: string | null; created_at: string; pets: Rel<{ name: string; species: string | null; breed: string | null; photo_url: string | null }>; customers: Rel<{ name: string; phone: string; address: string | null }> }> }>);
  const visit = one(mr?.visits ?? null);
  const pet = one(visit?.pets ?? null);
  const cust = one(visit?.customers ?? null);

  // The selling parent is a stored identity, not a physical stock balance.
  const { data: saleBinding, error: saleBindingError } = await supabase
    .from("clinic_compound_sales")
    .select("recipe_id, visit_id, sale_item_id, sale_name")
    .eq("recipe_id", recipeId)
    .maybeSingle();
  const sellingParent = !saleBindingError && saleBinding?.recipe_id === recipeId
    && saleBinding.visit_id === visit?.id && saleBinding.sale_item_id ? saleBinding : null;

  type InvoiceLine = { id: string; invoice_id: string; invoices: Rel<{ id: string; visit_id: string; invoice_no: string | null; voided_at: string | null }> };
  let invoiceLines: InvoiceLine[] = [];
  let invoiceLookupFailed = false;
  if (visit) {
    try {
      invoiceLines = await readCompleteList<InvoiceLine>((from, to) => supabase
        .from("invoice_items")
        .select("id, invoice_id, invoices(id, visit_id, invoice_no, voided_at)", { count: "exact" })
        .eq("compound_recipe_id", recipeId)
        .order("id")
        .range(from, to), "Invoice racikan", { maxRows: null });
    } catch {
      invoiceLookupFailed = true;
    }
  }
  const linkedInvoices = Array.from(new Map(invoiceLines.flatMap(line => {
    const invoice = one(line.invoices);
    return invoice && invoice.id === line.invoice_id && invoice.visit_id === visit?.id ? [[invoice.id, invoice] as const] : [];
  })).values());

  // I09: bahan terpakai, asal lapisannya, mutasi stok bahan dan invoice tujuan.
  // Dibaca saja; induk racikan tetap tanpa stok.
  const trace: CompoundTrace | null = await readCompoundTrace(supabase, recipeId).catch(() => null);

  // Semua racikan dalam resep yang sama (referensi: daftar bisa >1 baris).
  const { data: siblings, error: siblingsError } = mr
    ? await supabase
        .from("compounding_recipes")
        .select("id, recipe_name, created_at, dosage_instruction, total_volume, dosage_form, compounding_steps, status, compounding_ingredients(ingredient_name, item_id, quantity, unit)")
        .eq("medical_record_id", mr.id)
        .order("created_at", { ascending: true })
    : { data: [], error: null };
  const recipes = siblingsError ? [] : (siblings ?? []) as Recipe[];
  // Stock moves for an issue are dated on or after the recipe was saved (UTC date is never later).
  const stockCardHref = (itemId: string, savedAt: string | null | undefined) => {
    const dari = /^\d{4}-\d{2}-\d{2}/.exec(savedAt ?? "")?.[0];
    return `/pos/kartu-stok?item=${encodeURIComponent(itemId)}${dari ? `&dari=${dari}` : ""}`;
  };

  // Aksi racikan butuh komposisi berjalan dan daftar bahan aktif cabang ini.
  const komposisiIni = (recipes.find(row => row.id === r.id)?.compounding_ingredients ?? [])
    .flatMap(row => row.item_id ? [{ item_id: row.item_id, nama: row.ingredient_name, qty: Number(row.quantity), satuan: row.unit }] : []);
  const bahanPilihan = visit
    ? await bahanRacikanUntukKunjungan(visit.id).then(rows => rows.map(row => ({ id: row.id, name: row.name, unit: row.unit, stok: row.stok })))
      .catch(() => [] as { id: string; name: string; unit: string; stok: number }[])
    : [];

  const tglResep = visit ? new Date(visit.created_at).toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta", day: "2-digit", month: "2-digit", year: "numeric" }) : "—";
  const tglPeriksa = visit ? new Date(visit.created_at).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
  const noRM = visit ? `RM/${new Date(visit.created_at).getFullYear()}/${new Date(visit.created_at).toISOString().slice(5, 10).replace("-", "")}/${(visit.id as string).slice(0, 3).toUpperCase()}` : "—";
  const noResep = visit ? `R/${new Date(visit.created_at).getFullYear()}/${new Date(visit.created_at).toISOString().slice(5, 10).replace("-", "")}/${(r.id as string).slice(0, 3).toUpperCase()}` : "—";
  const catatanResep = mr?.catatan_resep
    || [mr?.diagnosis ? `Diagnosa: ${mr.diagnosis}` : "", visit?.keluhan ? `Keluhan: ${visit.keluhan}` : ""].filter(Boolean).join(". ")
    || "—";

  return (
    <>
      <div style={{ marginBottom: 4, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <Link href="/klinik/racik" className="back-btn"><i className="ti ti-arrow-left" /> Racik Obat</Link>
        {visit && mr && <Link href={`/klinik/rekam-medis/${visit.id}/resep?record=${encodeURIComponent(mr.id)}`} className="btn-def" style={{ textDecoration: "none" }}>
          <i className="ti ti-printer" /> Cetak resep kunjungan
        </Link>}
      </div>

      {visit && <div className="crm-sec" aria-label="Invoice terkait" style={{ marginBottom: 14 }}>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>Invoice terkait racikan</div>
        {invoiceLookupFailed ? <p role="alert">Tautan invoice belum dapat diperiksa. Coba muat ulang.</p> : linkedInvoices.length ?
          linkedInvoices.map(invoice => <div key={invoice.id}>
            {invoice.voided_at ? <span>{invoice.invoice_no ?? "Invoice tanpa nomor"} · Dibatalkan</span> :
              <Link href={`/klinik/pembayaran/${visit.id}/invoice?invoice_id=${invoice.id}`}>
                {invoice.invoice_no ?? "Buka invoice tersimpan"}
              </Link>}
          </div>) : <p>Belum ada invoice terkait yang tersedia untuk akses Anda.</p>}
      </div>}

      <div className="crm-sec" aria-label="Jejak sumber racikan" style={{ marginBottom: 14 }}>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>Jejak sumber racikan</div>
        <p>Induk racikan adalah identitas penjualan nonstok; stok fisik dan mutasinya berada pada bahan.</p>
        {sellingParent ? <p>Induk penjualan: <Link href={`/pos/sku/${encodeURIComponent(sellingParent.sale_item_id)}`}>{sellingParent.sale_name}</Link></p>
          : <p>{saleBindingError ? "Tautan induk belum dapat diperiksa. Coba muat ulang." : "Induk penjualan tersimpan belum tersedia untuk racikan ini."}</p>}
        {visit && mr && <p>Dokumen asal: <Link href={`/klinik/rekam-medis/${encodeURIComponent(visit.id)}`}>Kunjungan / rekam medis</Link></p>}
      </div>

      <div className="crm-sec" aria-label="Jejak bahan racikan" style={{ marginBottom: 14 }}>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>Jejak bahan racikan</div>
        {!trace ? <p role="alert">Jejak bahan belum dapat diperiksa untuk akses Anda. Coba muat ulang.</p> : <>
          {trace.materials.length === 0 ? <p>Belum ada bahan yang tercatat keluar untuk racikan ini.</p> : <div style={{ overflowX: "auto" }}>
            <table className="tbl" style={{ minWidth: 640 }}>
              <thead><tr><th>Bahan terpakai</th><th>Gudang</th><th style={{ textAlign: "right" }}>Jumlah</th><th>Asal bahan</th><th>Transaksi tujuan</th></tr></thead>
              <tbody>
                {trace.materials.map((m, i) => {
                  const asal = hrefAsalBahan(m.origin);
                  return <tr key={`${m.item_id}-${i}`}>
                    <td>{m.item_name}{m.restored && <span className="bge o" style={{ marginLeft: 6 }}>Dikembalikan ke stok</span>}</td>
                    <td>{m.warehouse_name}</td>
                    <td style={{ textAlign: "right" }}>{m.qty.toLocaleString("id-ID", { maximumFractionDigits: 6 })} {m.unit}</td>
                    <td>{labelAsalBahan(m.origin.source)}{asal ? <> · <Link href={asal.href}>{asal.label}</Link></> : null}</td>
                    <td>{m.invoice ? (m.invoice.voided ? <span>{m.invoice.invoice_no ?? "Invoice"} · Dibatalkan</span>
                      : <Link href={hrefInvoiceTujuan(m.invoice)}>{m.invoice.invoice_no ?? "Buka invoice"}</Link>)
                      : <span style={{ color: "var(--tm)" }}>Belum ditagihkan</span>}{cust?.name ? ` · ${cust.name}` : ""}</td>
                  </tr>;
                })}
              </tbody>
            </table>
          </div>}
          {trace.moves.length > 0 && <div style={{ marginTop: 8 }}>
            <div style={{ fontSize: 11.5, fontWeight: 600 }}>Mutasi stok bahan</div>
            <ul style={{ fontSize: 11.5, margin: "4px 0 0 16px" }}>
              {trace.moves.map((mv, i) => <li key={i}>
                {mv.tanggal} · <Link href={stockCardHref(mv.item_id, mv.tanggal)}>{mv.item_name}</Link> · {mv.warehouse_name} · {mv.qty < 0 ? "keluar" : "masuk kembali"} {Math.abs(mv.qty).toLocaleString("id-ID", { maximumFractionDigits: 6 })} {mv.unit}
              </li>)}
            </ul>
          </div>}
        </>}
      </div>

      {/* Judul besar (referensi) */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
        <div style={{ width: 44, height: 44, borderRadius: 11, background: "#eff6ff", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <i className="ti ti-flask" style={{ fontSize: 22, color: "var(--posb)" }} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: "var(--sb)", lineHeight: 1.1 }}>RACIK OBAT</div>
          <div style={{ fontSize: 11.5, color: "var(--tm)" }}>Informasi obat dan petunjuk pemakaian untuk pemilik hewan</div>
        </div>
        <span className={`bge ${statusBadge(r.status)}`}>{statusLabel[r.status]}</span>
      </div>

      {error && <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}><i className="ti ti-alert-circle" /> {error}</div>}
      {success === "ready" && <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}><i className="ti ti-circle-check" /> Obat siap diserahkan ke pasien.</div>}
      {success === "handed_over" && <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}><i className="ti ti-circle-check" /> Racikan sudah diserahkan.</div>}
      {success === "petunjuk" && <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}><i className="ti ti-circle-check" /> Petunjuk racik tersimpan.</div>}
      {success === "pemakaian" && <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}><i className="ti ti-circle-check" /> Petunjuk pemakaian tersimpan.</div>}
      {success === "komposisi" && <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}><i className="ti ti-circle-check" /> Komposisi racikan tersimpan; hanya selisih bahannya yang menggerakkan stok.</div>}

      {/* Kartu pasien + catatan resep */}
      <div className="card" style={{ marginBottom: 14, padding: 20 }}>
        <div style={{ display: "flex", gap: 22, flexWrap: "wrap", alignItems: "flex-start" }}>
          <div style={{ display: "flex", gap: 16, minWidth: 300, flex: 1 }}>
            <div style={{ width: 96, height: 96, borderRadius: 12, background: "var(--sf1)", border: ".5px solid var(--bd)", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", flexShrink: 0 }}>
              {pet?.photo_url ? <img src={pet.photo_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <i className="ti ti-paw" style={{ fontSize: 40, color: "var(--td)" }} />}
            </div>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 19, fontWeight: 800, color: "var(--sb)" }}>{pet?.name ?? "—"}</span>
                <span className="bge b">{pet?.species ?? "—"}</span>
              </div>
              <Pair label="Pemilik" value={cust?.name} />
              <Pair label="No. RM" value={noRM} />
              <Pair label="No. HP" value={cust?.phone} />
              <Pair label="Jenis / Ras" value={`${pet?.species ?? "—"}${pet?.breed ? ` / ${pet.breed}` : ""}`} />
            </div>
          </div>
          <div style={{ minWidth: 220 }}>
            <div style={{ fontSize: 10, color: "var(--tm)" }}>Dokter Penanggung Jawab</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--tx)", marginBottom: 12 }}>{visit?.dokter ?? "—"}</div>
            <Pair label="Tanggal Resep" value={tglResep} />
            <Pair label="No. Resep" value={noResep} />
          </div>
          <div style={{ background: "#eff6ff", border: ".5px solid #bfdbfe", borderRadius: 10, padding: 14, maxWidth: 360, flex: 1, minWidth: 240 }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--posb)", marginBottom: 6 }}><i className="ti ti-clipboard-text" /> CATATAN RESEP</div>
            <div style={{ fontSize: 11.5, color: "var(--tm)", lineHeight: 1.5 }}>{catatanResep}</div>
          </div>
        </div>
      </div>

      {/* Daftar obat racikan */}
      <div className="crm-sec" aria-label="Daftar obat racikan">
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <i className="ti ti-mortar" style={{ fontSize: 18, color: "var(--posb)" }} />
          <div style={{ fontSize: 13, fontWeight: 800, color: "var(--posb)", letterSpacing: ".02em" }}>DAFTAR OBAT RACIKAN</div>
        </div>
        {siblingsError ? <p role="alert">Komposisi racikan belum dapat dimuat lengkap. Coba muat ulang.</p>
          : !mr && <p role="alert">Rekam medis sumber tidak tersedia untuk akses Anda, jadi komposisi tidak ditampilkan.</p>}
        {!siblingsError && mr && <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 820 }}>
            <thead>
              <tr><th style={{ width: 30 }}>No.</th><th>Nama Racikan</th><th>Komposisi</th><th>Petunjuk pemakaian</th><th>Jumlah Racikan</th><th>Bentuk Sediaan</th><th>Catatan racik tersimpan (internal)</th></tr>
            </thead>
            <tbody>
              {recipes.map((rc, ri) => {
                const ings = rc.compounding_ingredients ?? [];
                return (
                  <tr key={rc.id}>
                    <td style={{ verticalAlign: "top", fontSize: 11, color: "var(--tm)" }}>{ri + 1}</td>
                    <td style={{ fontWeight: 600, verticalAlign: "top" }}>
                      {rc.id === r.id ? rc.recipe_name : <Link href={`/klinik/racik/${encodeURIComponent(rc.id)}`}>{rc.recipe_name}</Link>}
                      {rc.id !== r.id && <span className={`bge ${statusBadge(rc.status)}`} style={{ display: "block", marginTop: 4, width: "fit-content" }}>{statusLabel[rc.status]}</span>}
                    </td>
                    <td style={{ verticalAlign: "top" }}>
                      {ings.map((i, idx) => (
                        <div key={idx} style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 11, padding: "1px 0" }}>
                          <span>• {i.item_id ? <Link href={stockCardHref(i.item_id, rc.created_at)}>{i.ingredient_name} · kartu stok bahan</Link> : i.ingredient_name}</span>
                          <span style={{ color: "var(--tm)", whiteSpace: "nowrap" }}>{Number(i.quantity)} {i.unit}</span>
                        </div>
                      ))}
                    </td>
                    <td style={{ fontSize: 11.5, verticalAlign: "top", whiteSpace: "pre-line" }}>{rc.dosage_instruction || <Kosong />}</td>
                    <td style={{ fontSize: 11.5, verticalAlign: "top" }}>{rc.total_volume || <Kosong />}</td>
                    <td style={{ fontSize: 11.5, verticalAlign: "top", textTransform: "capitalize" }}>{rc.dosage_form || <Kosong />}</td>
                    <td style={{ verticalAlign: "top" }}>
                      {rc.compounding_steps ? <div style={{ fontSize: 11, whiteSpace: "pre-wrap" }}>{rc.compounding_steps}</div> : <Kosong />}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>}

        <p style={{ fontSize: 11, color: "var(--tm)", marginTop: 10 }}>
          Catatan racik tersimpan perlu ditinjau oleh dokter sebelum digunakan sebagai petunjuk pemakaian. Isinya tidak disalin otomatis.
        </p>

        {(r.status === "pending" || r.status === "ready") && (
          <TransactionForm scope={`clinic-racik-usage:${recipeId}`} action={updateRacikPemakaian} style={{ border: ".5px solid #bfdbfe", background: "#f8fbff", borderRadius: 10, padding: 14, marginTop: 14 }}>
            <input type="hidden" name="recipeId" value={r.id} />
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--posb)", marginBottom: 3 }}>
              <i className="ti ti-pencil" /> ISI PETUNJUK PEMAKAIAN — {r.recipe_name}
            </div>
            <div style={{ fontSize: 10.5, color: "var(--tm)", marginBottom: 10 }}>
              Informasi penggunaan obat untuk pemilik hewan. Isi sesuai petunjuk dokter yang telah dikonfirmasi.
            </div>
            <div className="frow">
              <div>
                <label className="flab" htmlFor="usage-total-volume">Jumlah racikan (hasil jadi)</label>
                <input className="fi" id="usage-total-volume" name="total_volume" defaultValue={r.total_volume ?? ""} />
              </div>
              <div>
                <label className="flab">Bentuk sediaan</label>
                <input className="fi" defaultValue={r.dosage_form ?? "—"} disabled style={{ background: "var(--sf1)", textTransform: "capitalize" }} />
              </div>
            </div>
            <div className="fg">
              <label className="flab" htmlFor="recipient-instructions">Petunjuk pemakaian untuk pemilik hewan</label>
              <textarea className="fi" id="recipient-instructions" name="dosage_instruction" rows={4} defaultValue={r.dosage_instruction ?? ""}
                readOnly={official} placeholder="Isi petunjuk pemakaian yang telah dikonfirmasi dokter" style={{ resize: "vertical" }} />
              {official && <div style={{ fontSize: 10.5, color: "var(--tm)" }}>Petunjuk pemakaian resep resmi mengikuti formula yang tersimpan dan tidak dapat diubah di sini.</div>}
            </div>
            <SubmitButton className="btn-acc" icon="ti-device-floppy" pendingText="Menyimpan…">Simpan Petunjuk Pemakaian</SubmitButton>
          </TransactionForm>
        )}

        {/* Keep technical preparation and its existing drafts separate from recipient usage. */}
        {(r.status === "pending" || r.status === "ready") && (
          <details style={{ marginTop: 14 }}>
            <summary style={{ fontSize: 11, cursor: "pointer" }}>Instruksi peracikan internal — apoteker/PCA</summary>
          <TransactionForm scope={`clinic-racik-instructions:${recipeId}`} action={updateRacikPetunjuk} style={{ border: ".5px solid #bfdbfe", background: "#f8fbff", borderRadius: 10, padding: 14, marginTop: 14 }}>
            <input type="hidden" name="recipeId" value={r.id} />
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--posb)", marginBottom: 3 }}>
              <i className="ti ti-pencil" /> ISI PETUNJUK RACIK — {r.recipe_name}
            </div>
            <div style={{ fontSize: 10.5, color: "var(--tm)", marginBottom: 10 }}>
              Khusus langkah teknis peracikan. Catatan lama perlu ditinjau; petunjuk untuk pemilik hewan diisi terpisah di atas.
            </div>
            <div className="fg">
              <label className="flab">Petunjuk racik — satu langkah per baris</label>
              <textarea className="fi" name="compounding_steps" rows={4} defaultValue={r.compounding_steps ?? ""}
                placeholder="Isi langkah teknis peracikan sesuai resep yang telah dikonfirmasi"
                style={{ resize: "vertical" }} />
            </div>
            <SubmitButton className="btn-acc" icon="ti-device-floppy" pendingText="Menyimpan…">Simpan Petunjuk Racik</SubmitButton>
          </TransactionForm>
          </details>
        )}

        <div style={{ background: "#fffbeb", border: ".5px solid #fde68a", borderRadius: 10, padding: 14, marginTop: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#d97706", marginBottom: 3 }}><i className="ti ti-alert-triangle" /> PERHATIAN</div>
          <div style={{ fontSize: 11, color: "#92400e" }}>Pastikan semua bahan sesuai resep dan dalam kondisi baik sebelum diracik.</div>
        </div>
      </div>

      {/* Informasi resep + pemilik */}
      <div className="grid2" style={{ marginTop: 12 }}>
        <div className="crm-sec" style={{ marginBottom: 0 }}>
          <div style={{ fontSize: 12.5, fontWeight: 800, color: "var(--posb)", letterSpacing: ".02em", marginBottom: 10 }}>INFORMASI RESEP</div>
          <Pair label="Tanggal Periksa" value={tglPeriksa} />
          <Pair label="Poli" value={visit?.poli} />
          <Pair label="Keluhan" value={visit?.keluhan} />
          <Pair label="Diagnosa" value={mr?.diagnosis} />
        </div>
        <div className="crm-sec" style={{ marginBottom: 0 }}>
          <div style={{ fontSize: 12.5, fontWeight: 800, color: "var(--posb)", letterSpacing: ".02em", marginBottom: 10 }}>INFORMASI PEMILIK</div>
          <Pair label="Nama" value={cust?.name} />
          <Pair label="No. HP" value={cust?.phone} />
          <Pair label="Alamat" value={cust?.address} />
        </div>
      </div>

      {/* Aksi */}
      {(r.status === "pending" || r.status === "ready") && (
        <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "center" }}>
          <form action={advanceRecipeStatus}>
            <input type="hidden" name="recipeId" value={r.id} />
            <SubmitButton className="pay-btn" icon="ti-circle-check" style={{ background: "#16a34a", minWidth: 260, padding: "12px 22px", fontSize: 13.5 }} pendingText="Memproses…">{r.status === "pending" ? "Obat Siap Diserahkan" : "Tandai Sudah Diserahkan"}</SubmitButton>
          </form>
        </div>
      )}
      {(r.status === "pending" || r.status === "ready") && (
        <RacikanAksi recipeId={r.id} visitId={visit?.id ?? ""} ingredients={komposisiIni} materials={bahanPilihan} />
      )}
      {r.status !== "pending" && r.status !== "ready" && (
        <div style={{ fontSize: 10, color: "var(--td)", textAlign: "center", marginTop: 12 }}>
          Racikan sudah diproses — perubahan resep butuh racikan baru; komposisi dan pengembalian bahan hanya terbuka sebelum diserahkan dan sebelum tagihan dibayar. Addendum §2.
        </div>
      )}
    </>
  );
}

function Kosong() {
  return <span style={{ fontSize: 10.5, color: "var(--td)", fontStyle: "italic" }}>belum diisi</span>;
}
function Pair({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "110px 1fr", gap: 6, padding: "3px 0", fontSize: 12 }}>
      <span style={{ color: "var(--tm)" }}>{label}</span>
      <span style={{ color: "var(--tx)", fontWeight: 500 }}>: {value || "—"}</span>
    </div>
  );
}
