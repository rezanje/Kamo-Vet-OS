import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Audit HRIS 2026-10-29 (T1 & T2). Tanpa database di CI, invarian migrasinya
// diperiksa dari teksnya — sama seperti tambalan RPC lain di repo ini.
const NAMA = "20261031180000_hris_cabang_penugasan.sql";
const SQL = readFileSync(`supabase/migrations/${NAMA}`, "utf8");

describe("T2 — kolom dan aturan akhir penugasan", () => {
  it("menambah tanggal berakhir beserta pelaku dan alasannya", () => {
    for (const kolom of ["end_date date", "ended_at timestamptz", "ended_by uuid", "ended_reason text"]) {
      expect(SQL).toContain(`add column if not exists ${kolom}`);
    }
  });

  it("tanggal berakhir tidak boleh mendahului tanggal mulai", () => {
    expect(SQL).toContain("check (end_date is null or end_date >= effective_date)");
  });

  it("penugasan yang diakhiri wajib punya pelaku dan alasan 3–300 karakter", () => {
    expect(SQL).toContain("(end_date is null and ended_at is null and ended_by is null and ended_reason is null)");
    expect(SQL).toContain("(end_date is not null and ended_by is not null and length(btrim(ended_reason)) between 3 and 300)");
  });
});

describe("satu definisi 'penugasan sedang berlaku'", () => {
  it("fungsinya memakai tanggal WIB dan menyaring kedua ujungnya", () => {
    expect(SQL).toContain("create or replace function public.employee_assignment_current(p_effective date, p_end date)");
    expect(SQL).toContain("select p_effective <= (now() at time zone 'Asia/Jakarta')::date");
    expect(SQL).toContain("and (p_end is null or p_end >= (now() at time zone 'Asia/Jakarta')::date)");
    expect(SQL).toContain("revoke all on function public.employee_assignment_current(date, date) from public, anon, service_role;");
  });

  it("setiap pembaca penugasan di database ikut ditambal dan diperiksa ulang", () => {
    const fungsi = [
      "public.clinic_demo_care_staff(uuid)",
      "public.clinic_save_initial_record(uuid,uuid,jsonb,jsonb,jsonb,jsonb,uuid,uuid,text,text,text)",
      "public.set_visit_service_state(uuid,text,uuid)",
      "public.clinic_staff_name(uuid,uuid,text)",
      "public.normalize_service_performers(jsonb,uuid)",
      "public.guard_clinic_line_salesperson()",
      "public.guard_clinic_record_seller()",
      "public.change_master_data_lifecycle(text,uuid,text,bigint,text)",
    ];
    for (const sig of fungsi) {
      // sekali di daftar tambalan, sekali di pemeriksaan akhir
      expect(SQL.split(`'${sig}'`).length - 1).toBeGreaterThanOrEqual(2);
    }
    expect(SQL).toContain("raise exception 'Cabang HRIS: % masih mengabaikan tanggal berakhir penugasan', s;");
  });

  it("tambalan memakai jangkar eksak, gagal tertutup, dan boleh dijalankan ulang", () => {
    expect(SQL).toContain("definition := coalesce(pending->>p.sig, pg_get_functiondef(signature));");
    expect(SQL).toContain("if position(p.new_text in definition) = 0 then");
    expect(SQL).toContain("raise exception 'Cabang HRIS: jangkar harus muncul tepat sekali di %: %', p.sig, left(p.old_text, 80);");
    // Satu fungsi dikompilasi sekali setelah seluruh tambalannya digabung.
    expect(SQL).toContain("for k in select jsonb_object_keys(pending) loop");
  });
});

describe("RPC baru terjaga OWNER/ADMIN", () => {
  it("cabang utama dan akhiri penugasan sama-sama SECURITY DEFINER", () => {
    expect(SQL).toContain("create or replace function public.set_employee_primary_branches(");
    expect(SQL).toContain("create or replace function public.end_employee_branch_assignment(");
    expect(SQL.match(/security definer set search_path = ''/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });

  it("keduanya memeriksa peran aktif OWNER/ADMIN sebelum menulis", () => {
    expect(SQL.split("role in ('OWNER', 'ADMIN') and is_active = true for share").length - 1).toBeGreaterThanOrEqual(2);
  });

  it("hak eksekusi dicabut dari anon/service_role dan hanya diberikan ke authenticated", () => {
    for (const sig of [
      "public.set_employee_primary_branches(uuid[], uuid, text)",
      "public.end_employee_branch_assignment(uuid, uuid, date, text)",
      "public.log_employee_branch_reopen(uuid, uuid[], date)",
    ]) {
      expect(SQL).toContain(`revoke all on function ${sig} from public, anon, service_role;`);
      expect(SQL).toContain(`grant execute on function ${sig} to authenticated;`);
    }
  });

  it("cabang utama tidak boleh diakhiri lewat tombol Akhiri penugasan", () => {
    expect(SQL).toContain("cabang utama diubah lewat Edit Karyawan, bukan diakhiri di sini");
  });

  it("alasan wajib saat mengakhiri, opsional saat memindahkan cabang utama", () => {
    expect(SQL).toContain("ASSIGNMENT_INVALID: alasan wajib diisi 3 sampai 300 karakter");
    expect(SQL).toContain("p_reason text default null");
  });
});

describe("menugaskan ulang cabang yang pernah diakhiri", () => {
  it("membuka kembali baris yang sama dengan tanggal mulai baru", () => {
    expect(SQL).toContain("on conflict(employee_id,branch_id) do update set effective_date=excluded.effective_date,end_date=null,ended_at=null,ended_by=null,ended_reason=null");
  });

  it("periode lama tetap tersimpan sebagai jejak", () => {
    expect(SQL).toContain("create table if not exists public.employee_branch_change_log");
    expect(SQL).toContain("check (action in ('primary_branch', 'assignment_ended', 'assignment_reopened'))");
    expect(SQL).toContain("perform public.log_employee_branch_reopen(p_employee_id,v_ids,p_effective_date);");
  });

  it("jejak hanya bisa dibaca OWNER/ADMIN dan tidak bisa ditulis langsung dari browser", () => {
    expect(SQL).toContain("revoke all on table public.employee_branch_change_log from anon, authenticated;");
    expect(SQL).toContain("grant select on table public.employee_branch_change_log to authenticated;");
    expect(SQL).toContain("role in ('OWNER', 'ADMIN'))\n    and (select private.can_manage_hris_employee(employee_id))");
  });
});

describe("pemeriksaan akhir migrasi", () => {
  it("gagal tertutup bila RPC atau tabel jejaknya tidak terpasang", () => {
    expect(SQL).toContain("raise exception 'Cabang HRIS: RPC cabang utama / akhiri penugasan tidak terpasang';");
    expect(SQL).toContain("raise exception 'Cabang HRIS: tabel jejak perubahan cabang tidak terpasang';");
    expect(SQL).toContain("raise exception 'Cabang HRIS: penugasan ulang belum membuka kembali baris yang berakhir';");
  });
});
