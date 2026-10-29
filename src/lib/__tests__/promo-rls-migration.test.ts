import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Audit promo 2026-10-28: master promo & voucher hanya boleh ditulis OWNER/ADMIN.
// Tanpa database di CI, invariannya diperiksa dari teks migrasinya.
const NAMA = "20261031090000_promo_voucher_manager_only_rls.sql";
const SQL = readFileSync(`supabase/migrations/${NAMA}`, "utf8");

describe("kunci tulis master promo & voucher", () => {
  it("mengganti policy 'siapa pun yang login boleh menulis' pada ketiga tabel", () => {
    expect(SQL).toContain("array['promos','promo_items','vouchers']");
    expect(SQL).toContain("drop policy if exists %I on public.%I', t || '_all', t");
  });

  it("menyisakan BACA terbuka supaya kasir tetap bisa menghitung potongan", () => {
    expect(SQL).toContain("for select to authenticated using (true)");
  });

  it("mengunci tulis ke owner/manajer aktif untuk insert, update, dan delete", () => {
    for (const perintah of ["for insert", "for update", "for delete"]) {
      expect(SQL).toContain(perintah);
    }
    expect(SQL).toContain("with check (public.is_promo_manager())");
    expect(SQL).toContain("using (public.is_promo_manager())");
    expect(SQL).toContain("p.is_active and p.role in ('OWNER','ADMIN')");
  });

  it("pemeriksa peran tidak bisa dipanggil anon/service_role dan tidak bocor lewat search_path", () => {
    expect(SQL).toContain("security definer set search_path = ''");
    expect(SQL).toContain("revoke all on function public.is_promo_manager() from public, anon, service_role;");
    expect(SQL).toContain("grant execute on function public.is_promo_manager() to authenticated;");
  });

  it("mencabut sisa hak tabel untuk anon", () => {
    for (const tabel of ["promos", "promo_items", "vouchers"]) {
      expect(SQL).toContain(`revoke all on table public.${tabel} from anon;`);
    }
  });
});
