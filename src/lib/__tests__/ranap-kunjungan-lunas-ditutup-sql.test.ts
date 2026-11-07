import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Kunjungan rawat inap lunas + sudah pulang tetap "Pembayaran" di Antrian (Anisa TKI,
// 4 Nov 2026: CHLOE dan CHEETOZ). Tanpa database di CI, aturan penutupannya diperiksa
// dari teks migrasi; perilakunya dijalankan di PostgreSQL 16 lokal (lihat
// docs/2026-11-04-antrian-ranap-lunas-masih-bayar.md).
const NAMA = "20261106530000_ranap_kunjungan_lunas_ditutup.sql";
const SQL = readFileSync(`supabase/migrations/${NAMA}`, "utf8");
const SATU_BARIS = SQL.replace(/\s+/g, " ");

describe("aturan penutupan kunjungan rawat inap", () => {
  it("hanya menutup bila pasien sudah pulang dan seluruh tagihan aktif lunas", () => {
    expect(SATU_BARIS).toContain("update public.visits v set status = 'Selesai' where v.id = p_visit_id and v.status <> 'Selesai' and v.archived_at is null");
    expect(SATU_BARIS).toContain("not exists (select 1 from public.inpatient_records r where r.visit_id = v.id and r.discharged_at is null)");
    expect(SATU_BARIS).toContain("exists (select 1 from public.invoices i where i.visit_id = v.id and i.voided_at is null)");
    expect(SATU_BARIS).toContain("(i.paid_status <> 'Lunas' or i.correction_pending)");
  });

  it("baris rekam medis yang belum ditagih menahan kunjungan, kecuali yang dikeluarkan kasir", () => {
    // Predikat sama dengan clinic_private.inpatient_payment_quote: tarif rawat inap
    // otomatis saat pulang tetap muncul di Bayar sampai ditagih.
    expect(SATU_BARIS).toContain("where mr.visit_id = v.id and pi.billing_withdrawn_at is null and not exists (select 1 from public.invoice_items ii join public.invoices i on i.id = ii.invoice_id where ii.prescription_item_id = pi.id and i.voided_at is null)");
  });

  it("checked_out_at tidak diubah, sama seperti penutupan di penerimaan pembayaran", () => {
    expect(SQL).not.toMatch(/set[^;]*checked_out_at/);
  });

  it("fungsi pembantu tidak bisa dipanggil langsung dari aplikasi", () => {
    expect(SATU_BARIS).toContain("revoke all on function clinic_private.close_settled_visit(uuid) from public, anon, authenticated, service_role;");
    expect(SQL).toContain("security definer set search_path = ''");
  });
});

describe("dua jalur yang dulu meninggalkan kunjungan terbuka", () => {
  it("pulang sesudah lunas menutup kunjungan", () => {
    expect(SQL).toContain("('public.clinic_change_inpatient_condition(uuid,text,text)',");
    expect(SQL).toContain("E'    perform clinic_private.close_settled_visit(v_record.visit_id);\\n'");
    expect(SQL).toContain("E'  if v_discharged_at is not null then\\n'");
  });

  it("simpan & bayar yang melunasi tahap terakhir lewat uang muka menutup kunjungan", () => {
    expect(SQL).toContain("('public.clinic_bill_and_pay_inpatient(uuid,uuid,text,date,jsonb,text,boolean,text)',");
    expect(SQL).toContain("E'  perform clinic_private.close_settled_visit(p_visit_id);\\n'");
  });

  it("tambalan berjangkar: gagal keras bila fungsi berubah, aman dijalankan ulang", () => {
    expect(SQL).toContain("raise exception 'RANAP_CLOSE_DRIFT: % changed; review before release', p.sig;");
    expect(SQL).toContain("if position('RANAP_CLOSE_SETTLED' in definition) > 0 then");
    expect(SQL).toContain("grant execute on function public.clinic_change_inpatient_condition(uuid,text,text) to authenticated;");
  });
});

describe("pemulihan data", () => {
  it("hanya kunjungan yang punya rawat inap, lewat aturan yang sama", () => {
    expect(SATU_BARIS).toContain("where v.status <> 'Selesai' and exists (select 1 from public.inpatient_records r where r.visit_id = v.id)");
    expect(SQL).toContain("if clinic_private.close_settled_visit(v_id) then");
  });
});
