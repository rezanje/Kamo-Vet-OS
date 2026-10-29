import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Mitigasi audit tagihan berjalan rawat inap (#339). Tanpa database di CI, penjaga
// uangnya diperiksa dari teks migrasinya; alur uangnya sendiri dijalankan di
// PostgreSQL lokal oleh scripts/test-ranap-mitigasi-postgres.py.
const NAMA = "20261103010000_ranap_mitigasi_audit.sql";
const SQL = readFileSync(`supabase/migrations/${NAMA}`, "utf8");
const SATU_BARIS = SQL.replace(/\s+/g, " ");

describe("FIN-06/ACCESS-02 konteks posting internal", () => {
  it("penanda posting adalah baris tabel privat, bukan isi permintaan pemanggil", () => {
    expect(SQL).toContain("create unlogged table clinic_private.posting_ctx (");
    expect(SATU_BARIS).toContain("revoke all on table clinic_private.posting_ctx from public, anon, authenticated, service_role;");
    expect(SATU_BARIS).toContain("revoke all on schema clinic_private from public, anon, authenticated, service_role;");
  });

  it("penundaan uang muka minimal hanya dari konteks tahap/split/DEMO", () => {
    expect(SATU_BARIS).toContain("check (kind in ('stage','split','demo'))");
    expect(SATU_BARIS).toContain("select coalesce(clinic_private.posting_context(p_visit_id) in ('stage','split','demo'), false);");
    // Flag dan kunci JSON pemanggil dicabut dari pemeriksaan.
    expect(SQL).toContain("if not clinic_private.dp_deferred(p_visit_id) then");
    expect(SQL).toContain("E'  if not coalesce((p_invoice ->> ''min_dp_deferred'')::boolean, false)");
  });

  it("penanda tahap dibaca dari transaksi berjalan, bukan GUC sesi", () => {
    expect(SATU_BARIS).toContain("where c.txid = pg_catalog.txid_current_if_assigned() and c.visit_id = p_visit_id;");
    expect(SQL).toContain("create or replace function clinic_private.stage_billing(p_visit_id uuid)");
  });

  it("pembungkus split tetap memeriksa minimum sesudah seluruh bagian tersimpan", () => {
    expect(SQL).toContain("clinic_private.enforce_min_dp(v_invoice_id,p_invoice ->> ''dp_override_reason'')");
  });
});

describe("FIN-01 pembalikan kwitansi per rekening", () => {
  it("sisa uang muka dihitung per kas_code: diterima dikurangi yang sudah teralokasi", () => {
    expect(SATU_BARIS).toContain("sum(pt.amount) - coalesce((select sum(p.amount) from public.invoice_payments p where p.receipt_id = p_receipt_id and p.reversal_of is null and p.amount > 0 and p.kas_code = pt.kas_code), 0) as sisa");
    expect(SQL).toContain("ADVANCE_IMBALANCE");
  });

  it("tidak ada lagi pembalik yang menumpuk ke rekening bagian pertama", () => {
    expect(SQL).not.toContain("order by pt.urutan limit 1");
  });
});

describe("FIN-04 status bayar mengikuti uang yang benar-benar masuk", () => {
  it("nol = Belum Lunas, sebagian = DP, penuh = Lunas", () => {
    expect(SQL).toContain("create function clinic_private.sync_paid_status(p_invoice_id uuid)");
    expect(SATU_BARIS).toContain("if v_total <= 0 or v_received >= v_total then update public.invoices set paid_status = 'Lunas', paid_at = coalesce(paid_at, now())");
    expect(SATU_BARIS).toContain("elsif v_received > 0 then update public.invoices set paid_status = 'DP', paid_at = null");
  });

  it("dipanggil pada penerimaan kwitansi, pembatalan, tahap, dan pelunasan piutang", () => {
    expect(SQL).toContain("perform clinic_private.sync_paid_status(v_inv.id);");
    expect(SQL).toContain("perform clinic_private.sync_paid_status(v_target);");
    expect(SQL).toContain("perform clinic_private.sync_paid_status(v_invoice_id);");
    expect(SQL).toContain("clinic_private.sync_paid_status(p_invoice_id)");
  });
});

describe("FIN-02/FIN-03 lineage kwitansi dan pelepasan uang muka", () => {
  it("terbit ulang membawa receipt_id dan menandai tagihan pengganti sebagai tahap", () => {
    expect(SQL).toContain("p.receipt_id,p.reversal_of");
    expect(SQL).toContain("update public.invoices set stage_billing=true where id=v_new_id");
    expect(SQL).toContain("clinic_private.context_begin(''stage'',v_visit.id)");
  });

  it("pembalik mengenai dokumen yang masih hidup, tepat sekali", () => {
    expect(SQL).toContain("create function clinic_private.active_invoice(p_invoice_id uuid)");
    expect(SATU_BARIS).toContain("v_target := clinic_private.active_invoice(v_row.invoice_id);");
  });

  it("pelepasan uang muka dibatasi peran keuangan, shift, alasan, dan kunci permintaan", () => {
    expect(SQL).toContain("create function public.clinic_release_advance_application(");
    expect(SQL).toContain("ACCESS_DENIED: hanya OWNER, ADMIN, atau FINANCE boleh melepas uang muka");
    expect(SQL).toContain("SHIFT_INVALID: shift klinik aktif tidak ditemukan");
    expect(SQL).toContain("ADVANCE_RELEASED: uang muka ini sudah pernah dilepas");
    expect(SATU_BARIS).toContain("grant execute on function public.clinic_release_advance_application(uuid, text, text) to authenticated;");
  });

  it("pesan ADVANCE_USED menunjuk jalan keluar, bukan jalan buntu", () => {
    expect(SQL).toContain("ADVANCE_USED: lepas dulu pemakaian uang muka kwitansi ini, baru batalkan");
  });

  it("kolom jejak baru tidak menambah FK kedua ke tabel yang sudah dirujuk", () => {
    // FK kedua ke profiles/cashier_shifts/invoice_payments membuat embed PostgREST
    // ambigu (PGRST201) dan riwayatnya diam-diam kosong.
    expect(SATU_BARIS).toContain("add column released_by uuid, add column release_reason text, add column release_payment_id uuid;");
    expect(SATU_BARIS).toContain("add column release_request_key text, add column released_at timestamptz, add column released_by uuid, add column release_reason text, add column release_shift_id uuid;");
  });
});

describe("FIN-05 tagihan tahap tidak dilunasi lewat jalur piutang lama", () => {
  it("penanda tagihan tahap ada di dokumennya dan RPC piutang menolaknya", () => {
    expect(SQL).toContain("alter table public.invoices add column if not exists stage_billing boolean not null default false;");
    expect(SQL).toContain("STAGE_RECEIPT: terima uang tagihan tahap lewat layar Tagihan rawat inap");
  });

  it("penandaan baris lama tidak menyentuh nominal, status bayar, atau jurnal", () => {
    expect(SATU_BARIS).toContain("update public.invoices i set stage_billing = true where i.request_key is not null");
  });
});

describe("FIN-07 satu baris resep sekali saja", () => {
  it("payload berisi dua salinan ditolak sebelum stok bergerak", () => {
    expect(SATU_BARIS).toContain("group by e.value ->> ''prescription_item_id'' having count(*) > 1");
    expect(SQL).toContain("LINE_BILLED: baris resep tercantum lebih dari sekali dalam satu tagihan");
  });

  it("penjaga akhir transaksi tidak mematahkan koreksi tagihan yang sah", () => {
    // clinic_edit_invoice_core menyisipkan baris baru LEBIH DULU, baru menghapus baris
    // lamanya; penjaga BEFORE INSERT per baris akan salah menolaknya.
    expect(SQL).toContain("create constraint trigger guard_invoice_item_billed_once_final");
    expect(SQL).toContain("after insert on public.invoice_items deferrable initially deferred");
  });
});

describe("UF-04 tarif rawat inap manual", () => {
  it("hari inap tidak dihitung ulang bila petugas sudah mencatat jasanya", () => {
    expect(SQL).toContain("pi.kategori=''Rawat Inap''");
  });
});

describe("tambalan RPC berjalan", () => {
  it("gagal tertutup bila jangkarnya tidak muncul tepat sekali", () => {
    expect(SATU_BARIS).toContain("if (length(definition) - length(replace(definition, p.old_text, ''))) / length(p.old_text) <> 1 then");
    expect(SQL).toContain("raise exception 'Mitigasi ranap: RPC wajib tidak ada: %', p.sig;");
  });

  it("menambal keenam RPC uang yang terdampak", () => {
    for (const sig of [
      "public.clinic_post_invoice(uuid,text,jsonb,jsonb)",
      "public.clinic_post_split_invoice(uuid,text,jsonb,jsonb,jsonb)",
      "public.clinic_post_demo_invoice(uuid,text,jsonb,jsonb,uuid,jsonb,uuid[])",
      "public.clinic_receive_invoice_payment(uuid,date,numeric,text,text,text,text)",
      "public.clinic_void_reissue_invoice_core(uuid,text,text)",
      "public.clinic_change_inpatient_condition(uuid,text,text)",
    ]) expect(SQL).toContain(`('${sig}',`);
  });

  it("hak akses RPC tidak melebar: _core tetap tertutup untuk akun aplikasi", () => {
    expect(SATU_BARIS).toContain("revoke all on function public.clinic_void_reissue_invoice_core(uuid,text,text) from public, anon, authenticated, service_role;");
  });

  it("migrasi lama tidak diubah dan tabel inti tidak dirombak", () => {
    expect(SQL).not.toMatch(/drop\s+table/i);
    expect(SQL).not.toMatch(/alter\s+table\s+public\.(invoice_items|prescription_items)\b/i);
  });
});
