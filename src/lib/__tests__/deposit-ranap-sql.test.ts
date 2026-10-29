import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AKUN_DEPOSIT_RANAP, AKUN_PIUTANG, jurnalDepositDilepas, jurnalDepositDipakai,
} from "../deposit-ranap";

// Deposit rawat inap 2026-10-29. Tanpa database di CI, penjaga uangnya diperiksa
// dari teks migrasinya: peran, cabang, shift, idempotensi, dan hak tabelnya.
const NAMA = "20261031220000_deposit_rawat_inap.sql";
const SQL = readFileSync(`supabase/migrations/${NAMA}`, "utf8");
const LIFECYCLE = readFileSync("supabase/migrations/20260929120000_clinic_billing_lifecycle.sql", "utf8");
/** Hak akses sering ditulis terpotong dua baris; dibandingkan tanpa bentuk spasinya. */
const SATU_BARIS = SQL.replace(/\s+/g, " ");

describe("tabel deposit", () => {
  it("menyimpan tautan kunjungan, rawat inap, cabang, dan shift penerimanya", () => {
    expect(SQL).toContain("create table public.inpatient_deposits (");
    for (const kolom of [
      "visit_id uuid not null references public.visits(id)",
      "inpatient_record_id uuid not null references public.inpatient_records(id)",
      "branch_id uuid not null references public.branches(id)",
      "shift_id uuid references public.cashier_shifts(id)",
      "journal_id uuid references public.journal_entries(id)",
    ]) expect(SQL).toContain(kolom);
  });

  it("klik ganda tidak menggandakan uang: kunci permintaan unik untuk catat, batal, dan kembali", () => {
    expect(SQL).toContain("create unique index inpatient_deposits_request_key_unique on public.inpatient_deposits(request_key)");
    expect(SQL).toContain("create unique index inpatient_deposits_void_key_unique on public.inpatient_deposits(void_request_key)");
    expect(SQL).toContain("create unique index inpatient_deposits_refund_key_unique on public.inpatient_deposits(refund_request_key)");
    expect(SQL).toContain("request_key text not null unique,");
  });

  it("deposit tidak pernah dihapus — pembatalan dan pengembalian hanya menandai barisnya", () => {
    for (const kolom of ["voided_at timestamptz", "void_reason text", "refunded_at timestamptz", "refund_reason text"]) {
      expect(SQL).toContain(kolom);
    }
    expect(SQL).not.toMatch(/delete from public\.inpatient_deposits/);
    expect(SQL).toContain("released_at timestamptz");
  });

  it("saldo tidak bisa jadi negatif walau ada tulisan nakal", () => {
    expect(SQL).toContain("constraint inpatient_deposits_saldo_wajar check (terpakai + dikembalikan <= jumlah)");
    expect(SQL).toContain("jumlah numeric(15,2) not null check (jumlah > 0)");
  });
});

describe("hak akses tabel", () => {
  it("hanya boleh dibaca pengguna yang berhak atas cabangnya; semua tulisan lewat RPC", () => {
    expect(SQL).toContain("alter table public.inpatient_deposits enable row level security;");
    expect(SQL).toContain("alter table public.inpatient_deposit_applications enable row level security;");
    expect(SQL).toContain("revoke all on public.inpatient_deposits from public, anon, authenticated;");
    expect(SQL).toContain("revoke all on public.inpatient_deposit_applications from public, anon, authenticated;");
    expect(SQL).toContain("grant select on public.inpatient_deposits to authenticated;");
    expect(SQL).toContain("grant select on public.inpatient_deposit_applications to authenticated;");
    expect(SQL).toContain("create policy inpdep_sel on public.inpatient_deposits for select to authenticated");
    expect(SQL).toContain("using (public.user_can_access_branch(branch_id));");
    expect(SQL).not.toMatch(/for (all|insert|update|delete) to authenticated/);
  });

  it("RPC uang hanya diberikan ke pengguna terautentikasi, tidak ke anon atau service_role", () => {
    for (const sig of [
      "public.clinic_record_inpatient_deposit(uuid,text,date,numeric,text,text)",
      "public.clinic_cancel_inpatient_deposit(uuid,text,text)",
      "public.clinic_refund_inpatient_deposit(uuid,text,text)",
      "public.clinic_apply_inpatient_deposit(uuid,text)",
      "public.clinic_post_invoice_with_deposit(uuid,text,jsonb,jsonb)",
    ]) {
      expect(SATU_BARIS).toContain(`revoke all on function ${sig} from public, anon, service_role;`);
      expect(SATU_BARIS).toContain(`grant execute on function ${sig} to authenticated;`);
    }
    // Penolong internal tidak boleh dipanggil langsung dari aplikasi.
    for (const sig of [
      "clinic_private.apply_inpatient_deposit(uuid,text)",
      "clinic_private.deposit_open_shift(uuid)",
      "clinic_private.deposit_cash_account(text, uuid)",
    ]) expect(SATU_BARIS).toContain(`revoke all on function ${sig} from public, anon, authenticated, service_role;`);
  });

  it("semua RPC uang berjalan SECURITY DEFINER dengan search_path terkunci", () => {
    // catat, batal, kembalikan, pakai (internal + publik), posting+deposit, lepas.
    expect(SQL.match(/security definer set search_path = ''/g) ?? []).toHaveLength(7);
    // Penolongnya tetap mengunci search_path walau berjalan sebagai pemanggilnya.
    expect(SQL.match(/set search_path = ''/g) ?? []).toHaveLength(10);
  });
});

describe("penjaga saat menerima deposit", () => {
  it("menolak akun tidak aktif dan memeriksa cabang kunjungan", () => {
    expect(SQL).toContain("ACCESS_DENIED: akun tidak aktif");
    expect(SQL).toContain("if not found or not public.user_can_access_branch(v_record.branch_id) then");
    expect(SQL).toContain("ACCESS_DENIED: cabang kunjungan tidak cocok");
  });
  it("uang hanya boleh diterima saat ada shift klinik terbuka milik kasir itu", () => {
    expect(SQL).toContain("and s.shift_type = 'klinik' and s.status = 'open'");
    expect(SQL).toContain("s.opened_by = auth.uid()");
    expect(SQL.match(/SHIFT_INVALID: shift klinik aktif tidak ditemukan/g) ?? []).toHaveLength(3);
  });
  it("hanya selama pasien masih dirawat — setelah pulang uangnya pembayaran tagihan", () => {
    expect(SQL).toContain("if v_record.discharged_at is not null then");
    expect(SQL).toContain("DEPOSIT_CLOSED");
  });
  it("mengulang kunci yang sama mengembalikan deposit lama, bukan membuat deposit kedua", () => {
    expect(SQL).toContain("select * into v_existing from public.inpatient_deposits where request_key = v_key for update;");
    expect(SQL).toContain("IDEMPOTENCY_CONFLICT: kunci deposit dipakai untuk data berbeda");
  });
  it("nomor dokumen dikunci per awalan supaya dua kasir tidak dapat nomor sama", () => {
    expect(SQL).toContain("perform pg_advisory_xact_lock(hashtextextended('clinic-deposit-number:' || v_prefix, 0));");
    expect(SQL).toContain("select coalesce(max(substring(d.no_deposit, length(v_prefix) + 1)::bigint), 0) + 1 into v_seq");
  });
  it("titipan dijurnal sebagai utang ke pemilik, bukan pendapatan", () => {
    expect(SQL).toContain("jsonb_build_object('code', v_kas, 'debit', v_amount, 'credit', 0)");
    expect(SQL).toContain(`jsonb_build_object('code', '${AKUN_DEPOSIT_RANAP}', 'debit', 0, 'credit', v_amount)`);
    expect(SQL).toContain("JOURNAL_MISSING: jurnal deposit tidak terbentuk");
  });
});

describe("batal dan kembalikan", () => {
  it("hanya pemilik, admin, atau keuangan", () => {
    expect(SQL.match(/v_role not in \('OWNER','ADMIN','FINANCE'\)/g) ?? []).toHaveLength(2);
  });
  it("wajib beralasan", () => {
    expect(SQL).toContain("DEPOSIT_INVALID: alasan pembatalan wajib diisi");
    expect(SQL).toContain("DEPOSIT_INVALID: alasan pengembalian wajib diisi");
  });
  it("batal hanya selama deposit belum terpakai sama sekali", () => {
    expect(SQL).toContain("if v_dep.status <> 'aktif' or v_dep.terpakai <> 0 or v_dep.dikembalikan <> 0 then");
    expect(SQL).toContain("DEPOSIT_USED");
  });
  it("pengembalian hanya sebesar sisa yang benar-benar masih ada", () => {
    expect(SQL).toContain("v_sisa := v_dep.jumlah - v_dep.terpakai - v_dep.dikembalikan;");
    expect(SQL).toContain("DEPOSIT_EMPTY");
  });
});

describe("memakai deposit di tagihan", () => {
  it("dicatat sebagai baris pembayaran bermetode Deposit di rekening titipan", () => {
    expect(SQL).toContain("p_invoice_id, current_date, v_applied, 'Deposit', 'Deposit rawat inap dipakai',");
    expect(SQL).toContain(`'${AKUN_DEPOSIT_RANAP}', v_user, v_key, md5(`);
  });
  it("jurnalnya menutup piutang dari utang titipan, tanpa penerimaan kas kedua", () => {
    const [debit, credit] = jurnalDepositDipakai(1);
    expect(SQL).toContain(`jsonb_build_object('code', '${debit.code}', 'debit', v_applied, 'credit', 0)`);
    expect(SQL).toContain(`jsonb_build_object('code', '${credit.code}', 'debit', 0, 'credit', v_applied)`);
    expect(AKUN_PIUTANG).toBe("1201");
  });
  it("tidak pernah memotong lebih dari sisa tagihan", () => {
    expect(SQL).toContain("v_sisa := v_invoice.total - v_invoice.dp_amount - v_paid;");
    expect(SQL).toContain("if v_sisa <= 0 then return 0; end if;");
    expect(SQL).toContain("v_take := least(v_dep.saldo, v_sisa);");
  });
  it("deposit terpakai dicatat per deposit supaya bisa dilepas lagi saat tagihan dibatalkan", () => {
    expect(SQL).toContain("insert into public.inpatient_deposit_applications(");
    expect(SQL).toContain("update public.inpatient_deposits set terpakai = terpakai + v_take where id = v_dep.id;");
  });
  it("kunci pemakaian yang sama tidak memotong deposit dua kali", () => {
    expect(SQL).toContain("select * into v_existing from public.invoice_payments where request_key = v_key for update;");
    expect(SQL).toContain("IDEMPOTENCY_CONFLICT: kunci deposit dipakai untuk tagihan berbeda");
  });
  it("tagihan lunas karena deposit ikut menutup kunjungan", () => {
    expect(SQL).toContain("update public.invoices set paid_status = 'Lunas', paid_at = now() where id = p_invoice_id;");
    expect(SQL).toContain("perform public.set_visit_service_state(v_invoice.visit_id, 'checkout');");
  });
});

describe("posting tagihan pulang", () => {
  it("memakai pembungkus, bukan mengubah tanda tangan RPC lama yang dipakai produksi", () => {
    expect(SQL).toContain("create function public.clinic_post_invoice_with_deposit(");
    expect(SQL).toContain("v_invoice_id := public.clinic_post_invoice(p_visit_id, v_key, v_base, p_lines);");
    expect(SQL).not.toMatch(/create or replace function public\.clinic_post_invoice\(/);
    expect(SQL).not.toMatch(/create or replace function public\.clinic_post_split_invoice\(/);
  });
  it("uang yang dipakai dihitung server dari saldo titipan, bukan dari layar", () => {
    expect(SQL).toContain("from public.inpatient_deposits d where d.visit_id = p_visit_id and d.status = 'aktif';");
    expect(SQL).toContain("v_apply := least(greatest(v_saldo, 0), greatest(v_total, 0));");
    expect(SQL).toContain("v_cash := least(v_cash, v_total - v_apply);");
  });
  it("pengulangan setelah berhasil mengembalikan invoice yang sama", () => {
    expect(SQL).toContain("select i.* into v_existing from public.invoices i where i.request_key = v_key;");
    expect(SQL).toContain("IDEMPOTENCY_CONFLICT: kunci invoice telah dipakai untuk data berbeda");
  });
});

describe("void tagihan mengembalikan deposit", () => {
  it("menambal fungsi pembatalan dengan jangkar eksak dan gagal tertutup", () => {
    expect(SQL).toContain("to_regprocedure('public.clinic_void_reissue_invoice_core(uuid,text,text)')");
    expect(SQL).toContain("Deposit ranap: jangkar harus muncul tepat sekali di clinic_void_reissue_invoice_core");
    expect(SQL).toContain("execute definition;");
  });
  it("baris deposit tidak ikut dialihkan ke tagihan pengganti", () => {
    expect(SQL).toContain("p.metode is distinct from ''Deposit''");
  });
  it("saldo deposit kembali lewat jurnal kebalikan dari pemakaiannya", () => {
    const [debit, credit] = jurnalDepositDilepas(1);
    expect(SQL).toContain(`jsonb_build_object('code', '${debit.code}', 'debit', v_total, 'credit', 0)`);
    expect(SQL).toContain(`jsonb_build_object('code', '${credit.code}', 'debit', 0, 'credit', v_total)`);
    expect(SQL).toContain("update public.inpatient_deposits set terpakai = greatest(terpakai - v_row.amount, 0)");
    expect(SQL).toContain("update public.inpatient_deposit_applications set released_at = now()");
  });
});

describe("yang sengaja tidak disentuh", () => {
  it("penjaga INPATIENT_OPEN tetap utuh di migrasi lamanya dan tidak dicabut di sini", () => {
    expect(LIFECYCLE).toContain("create trigger guard_open_inpatient_invoice before insert on public.invoices");
    expect(SQL).not.toContain("guard_open_inpatient_invoice");
    expect(SQL).not.toMatch(/drop trigger/i);
  });
  it("tidak menyentuh stok, HPP, racikan, promo, atau komisi", () => {
    for (const kata of ["stock_layers", "stock_moves", "compound", "promo", "commission", "hpp"]) {
      expect(SQL.toLowerCase()).not.toContain(kata);
    }
  });
  it("tidak mengubah migrasi lama", () => {
    expect(LIFECYCLE).not.toContain("inpatient_deposits");
  });
});
