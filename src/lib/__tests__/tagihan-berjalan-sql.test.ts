import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Tagihan berjalan rawat inap + uang muka minimal (Andri, 29 Oktober 2026).
// Tanpa database di CI, penjaga uangnya diperiksa dari teks migrasinya: peran, cabang,
// shift, idempotensi, hak tabel, dan jangkar tambalan pada RPC yang sudah berjalan.
const NAMA = "20261031230000_ranap_tagihan_berjalan.sql";
const SQL = readFileSync(`supabase/migrations/${NAMA}`, "utf8");
/** Hak akses sering ditulis terpotong dua baris; dibandingkan tanpa bentuk spasinya. */
const SATU_BARIS = SQL.replace(/\s+/g, " ");

const RPC_PUBLIK = [
  "public.clinic_post_inpatient_stage_invoice(uuid, text, jsonb, jsonb)",
  "public.clinic_receive_visit_payment(uuid, text, date, jsonb, uuid, text)",
  "public.clinic_void_payment_receipt(uuid, text, text)",
];

describe("tabel baru", () => {
  it("kwitansi menyimpan kunjungan, pemilik, cabang, dan shift penerimanya", () => {
    expect(SQL).toContain("create table public.clinic_payment_receipts (");
    for (const kolom of [
      "visit_id uuid not null references public.visits(id)",
      "customer_id uuid references public.customers(id)",
      "branch_id uuid not null references public.branches(id)",
      "shift_id uuid references public.cashier_shifts(id)",
      "void_shift_id uuid references public.cashier_shifts(id)",
    ]) expect(SQL).toContain(kolom);
  });

  it("klik ganda tidak menggandakan uang: kunci permintaan kwitansi unik", () => {
    expect(SQL).toContain("request_key text not null unique,");
    expect(SQL).toContain("request_hash text not null");
    expect(SATU_BARIS).toContain("if v_existing.visit_id is distinct from p_visit_id or v_existing.request_hash is distinct from v_hash then");
  });

  it("kwitansi tidak pernah dihapus — pembatalan hanya menandai barisnya", () => {
    expect(SQL).toContain("status text not null default 'aktif' check (status in ('aktif','batal'))");
    expect(SQL).toContain("void_reason text,");
    expect(SQL).not.toMatch(/delete from public\.clinic_payment_receipts/);
    expect(SQL).not.toMatch(/delete from public\.invoice_payments/);
  });

  it("saldo uang muka tidak bisa jadi negatif walau ada tulisan nakal", () => {
    expect(SQL).toContain("amount numeric(15,2) not null check (amount > 0)");
    expect(SQL).toContain("constraint clinic_customer_advances_applied_cap check (applied <= amount)");
  });

  it("bagian kwitansi dibatasi metode resmi dan maksimal enam", () => {
    expect(SQL).toContain("metode text not null check (metode in ('Tunai','Transfer','Debit','Kredit','QRIS','E-Wallet'))");
    expect(SQL).toContain("urutan smallint not null check (urutan between 1 and 6)");
    expect(SATU_BARIS).toContain("or jsonb_array_length(p_parts) not between 1 and 6 then");
  });

  it("uang muka minimal disimpan sebagai persen 0–100 satu baris", () => {
    expect(SQL).toContain("create table public.clinic_billing_settings (");
    expect(SQL).toContain("id boolean primary key default true check (id)");
    expect(SQL).toContain("min_dp_percent numeric(5,2) not null default 50 check (min_dp_percent >= 0 and min_dp_percent <= 100)");
  });
});

describe("hak akses tabel", () => {
  it("tabel uang hanya boleh dibaca pengguna yang berhak atas cabangnya; tulisan lewat RPC", () => {
    for (const tabel of [
      "public.clinic_payment_receipts", "public.clinic_payment_receipt_parts",
      "public.clinic_customer_advances", "public.clinic_advance_applications",
      "public.clinic_dp_overrides",
    ]) {
      expect(SATU_BARIS).toContain(`alter table ${tabel} enable row level security;`);
    }
    // Hak baca diberikan berkelompok; yang penting tak satu pun boleh ditulis langsung.
    expect(SATU_BARIS).toContain("grant select on public.clinic_payment_receipts, public.clinic_payment_receipt_parts to authenticated;");
    expect(SATU_BARIS).toContain("grant select on public.clinic_customer_advances, public.clinic_advance_applications to authenticated;");
    expect(SATU_BARIS).toContain("grant select on public.clinic_dp_overrides to authenticated;");
    expect(SATU_BARIS).not.toMatch(/grant (insert|update|delete)[^;]*on public\.clinic_(payment|customer|advance|dp)/);
    expect(SATU_BARIS).toContain("revoke all on public.clinic_payment_receipts, public.clinic_payment_receipt_parts from public, anon, authenticated, service_role;");
    expect(SATU_BARIS).toContain("revoke all on public.clinic_customer_advances, public.clinic_advance_applications from public, anon, authenticated, service_role;");
    expect(SQL).toContain("create policy clinic_payment_receipts_read on public.clinic_payment_receipts for select to authenticated");
    expect(SQL).toContain("using (public.user_can_access_branch(branch_id));");
  });

  it("setelan uang muka minimal dibaca semua akun login, ditulis OWNER/ADMIN saja", () => {
    expect(SQL).toContain("create policy clinic_billing_settings_read on public.clinic_billing_settings\n  for select to authenticated using (true);");
    expect(SATU_BARIS).toContain("create policy clinic_billing_settings_write on public.clinic_billing_settings for all to authenticated using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_active and p.role in ('OWNER','ADMIN')))");
  });

  it("RPC uang hanya diberikan ke pengguna terautentikasi, tidak ke anon atau service_role", () => {
    for (const sig of RPC_PUBLIK) {
      expect(SATU_BARIS).toContain(`revoke all on function ${sig} from public, anon, service_role;`);
      expect(SATU_BARIS).toContain(`grant execute on function ${sig} to authenticated;`);
    }
  });

  it("penolong internal tidak bisa dipanggil akun aplikasi sama sekali", () => {
    for (const sig of [
      "clinic_private.stage_billing(uuid)",
      "clinic_private.enforce_min_dp(uuid, text)",
      "clinic_private.kas_code(text, uuid)",
      "clinic_private.remap_advance_applications(uuid, uuid)",
      "public.guard_invoice_item_billed_once()",
      "public.guard_open_inpatient_invoice()",
    ]) {
      expect(SATU_BARIS).toMatch(new RegExp(`revoke all on function ${sig.replace(/[().]/g, "\\$&")} from public ?, ?anon ?, ?authenticated ?, ?service_role;`));
    }
  });
});

describe("penjaga RPC", () => {
  it("setiap RPC memeriksa peran terautentikasi lebih dulu", () => {
    expect(SQL.match(/ACCESS_DENIED: pengguna tidak terautentikasi/g)?.length).toBeGreaterThanOrEqual(3);
    expect(SQL.match(/security definer set search_path = ''/g)?.length).toBeGreaterThanOrEqual(6);
  });

  it("cabang kunjungan selalu diperiksa, tidak cuma id-nya", () => {
    expect(SATU_BARIS).toContain("if not found or not public.user_can_access_branch(v_visit.branch_id) then");
    expect(SATU_BARIS).toContain("if not found or not public.user_can_access_branch(v_receipt.branch_id) then");
  });

  it("menerima dan membatalkan uang wajib punya shift klinik terbuka milik kasirnya", () => {
    const shift = SQL.match(/s\.shift_type = 'klinik' and s\.status = 'open' for update/g);
    expect(shift?.length).toBe(2);
    expect(SATU_BARIS).toContain("where s.branch_id = v_visit.branch_id and s.opened_by = v_user");
    expect(SATU_BARIS).toContain("where s.branch_id = v_receipt.branch_id and s.opened_by = v_user");
    expect(SQL.match(/SHIFT_INVALID: shift klinik aktif tidak ditemukan/g)?.length).toBe(2);
  });

  it("membatalkan kwitansi dibatasi peran keuangan dan wajib beralasan", () => {
    expect(SATU_BARIS).toContain("if v_role is null or v_role not in ('OWNER','ADMIN','FINANCE') then");
    expect(SQL).toContain("RECEIPT_INVALID: alasan pembatalan wajib diisi");
    expect(SQL).toContain("ADVANCE_USED: uang muka dari kwitansi ini sudah dipakai");
  });

  it("uang muka minimal ditegakkan di database, penerobosnya dicatat", () => {
    expect(SQL).toContain("create function clinic_private.enforce_min_dp(p_invoice_id uuid, p_reason text)");
    expect(SATU_BARIS).toContain("if v_invoice.paid_status = 'Lunas' or v_received >= v_invoice.total then return; end if;");
    expect(SQL).toContain("v_min := ceil(v_invoice.total * v_pct / 100)::numeric(15,2);");
    expect(SQL).toContain("DP_OVERRIDE_DENIED: hanya OWNER, ADMIN, atau FINANCE");
    expect(SATU_BARIS).toContain("insert into public.clinic_dp_overrides( invoice_id, min_percent, required_amount, received_amount, reason, created_by )");
  });

  it("satu baris resep hanya boleh menempel pada satu tagihan aktif", () => {
    expect(SQL).toContain("create trigger guard_invoice_item_billed_once before insert on public.invoice_items");
    expect(SATU_BARIS).toContain("where ii.prescription_item_id = new.prescription_item_id and ii.id is distinct from new.id and ii.invoice_id is distinct from new.invoice_id and i.voided_at is null");
    expect(SQL).toContain("LINE_BILLED:");
  });

  it("mencabut kunci unik satu-invoice-per-kunjungan tanpa kehilangan indeks pencariannya", () => {
    // Migrasi 0028 memasang UNIQUE INDEX invoices_visit_active_key; itulah yang memaksa
    // seluruh biaya rawat inap keluar sekali saat pasien pulang.
    expect(SQL).toContain("drop index if exists public.invoices_visit_active_key;");
    expect(SQL).toContain("create index if not exists invoices_visit_active_idx on public.invoices(visit_id) where voided_at is null;");
  });

  it("penjaga INPATIENT_OPEN hanya dibuka untuk jalur tagihan tahap", () => {
    expect(SQL).toContain("and not clinic_private.stage_billing(new.visit_id) then");
    expect(SQL).toContain("INPATIENT_OPEN: biaya rawat inap belum dihitung");
    // Selalu true/false: `... and not null` membuat IF ikut NULL dan penjaganya diam.
    expect(SQL).toContain("select coalesce(nullif(current_setting('clinic.stage_visit', true), '') = p_visit_id::text, false);");
    // Penanda ditutup lagi begitu posting selesai.
    expect(SQL).toContain("perform set_config('clinic.stage_visit', '', true);");
  });

  it("uang muka hanya dipakai milik pemilik dan cabang yang sama, tertua lebih dulu", () => {
    expect(SATU_BARIS).toContain("where a.customer_id = v_visit.customer_id and a.branch_id = v_branch and a.status = 'aktif' and a.amount > a.applied order by a.created_at, a.id for update");
  });

  it("alokasi pembayaran mendahulukan tagihan yang dipilih kasir lalu tahap tertua", () => {
    expect(SATU_BARIS).toContain("order by (i.id = p_invoice_id) desc, i.created_at, i.id");
    expect(SATU_BARIS).toContain("and i.invoice_no is not null and i.request_key is not null and not i.correction_pending");
  });

  it("kunjungan tidak ditutup selagi pasien dirawat atau masih ada tahap belum lunas", () => {
    expect(SATU_BARIS).toContain("not exists (select 1 from public.inpatient_records r where r.visit_id = p_visit_id and r.discharged_at is null)");
    expect(SATU_BARIS).toContain("and not exists (select 1 from public.invoices i where i.visit_id = p_visit_id and i.voided_at is null and i.paid_status <> 'Lunas')");
  });
});

describe("tambalan RPC berjalan", () => {
  it("gagal tertutup bila jangkarnya tidak muncul tepat sekali", () => {
    expect(SATU_BARIS).toContain("if (length(definition) - length(replace(definition, p.old_text, ''))) / length(p.old_text) <> 1 then");
    expect(SQL).toContain("raise exception 'Tagihan berjalan: RPC wajib tidak ada: %', p.sig;");
    // Beberapa tambalan satu fungsi diterapkan pada teksnya dulu, baru dikompilasi sekali.
    expect(SQL).toContain("pending := jsonb_set(pending, array[p.sig], to_jsonb(replace(definition, p.old_text, p.new_text)));");
  });

  it("menambal keempat RPC uang yang terdampak", () => {
    for (const sig of [
      "public.clinic_post_invoice(uuid,text,jsonb,jsonb)",
      "public.clinic_receive_invoice_payment(uuid,date,numeric,text,text,text,text)",
      "public.clinic_void_reissue_invoice_core(uuid,text,text)",
      "public.clinic_change_inpatient_condition(uuid,text,text)",
    ]) expect(SQL).toContain(`('${sig}',`);
  });

  it("checkout campuran dan tahap rawat inap tidak diperiksa dua kali", () => {
    expect(SQL).toContain("min_dp_deferred");
    expect(SQL).toContain("split_payments");
  });

  it("kepulangan pasien tidak lagi diblokir tagihan yang sudah terbit", () => {
    expect(SQL).toContain("INVOICE_EXISTS: tagihan sudah terbit sebelum biaya rawat inap dihitung");
    expect(SQL).toContain("Tagihan berjalan: pasien boleh pulang walau tagihannya sudah terbit");
  });

  it("tarif rawat inap tidak dihitung otomatis lagi untuk kunjungan yang sudah ditagih", () => {
    expect(SQL).toContain("where i.visit_id=v_record.visit_id and i.request_key is not null");
  });
});

describe("batas perubahan", () => {
  it("tidak menyentuh kasir petshop, promo, racikan, atau BMHP", () => {
    for (const tabel of ["sales", "sale_payments", "promos", "vouchers", "compound_issues", "stock_layers"]) {
      expect(SQL).not.toContain(`public.${tabel} set`);
      expect(SQL).not.toContain(`delete from public.${tabel}`);
    }
  });

  it("tidak mengubah migrasi lama: hanya menambah kolom pada invoice_payments", () => {
    const alter = SQL.match(/alter table public\.[a-z_]+/g) ?? [];
    expect(new Set(alter)).toEqual(new Set([
      "alter table public.clinic_billing_settings",
      "alter table public.clinic_dp_overrides",
      "alter table public.clinic_payment_receipts",
      "alter table public.clinic_payment_receipt_parts",
      "alter table public.clinic_customer_advances",
      "alter table public.clinic_advance_applications",
      "alter table public.invoice_payments",
    ]));
    expect(SQL).toContain("add column receipt_id uuid references public.clinic_payment_receipts(id),");
    expect(SQL).toContain("add column reversal_of uuid references public.invoice_payments(id);");
  });
});
