import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Keputusan pemilik 29 Okt 2026: diskon manual hanya untuk akun berwenang.
// Tanpa database di CI, invariannya diperiksa dari teks migrasinya — termasuk
// jangkar eksak yang dipakai menambal RPC yang sudah berjalan.
const NAMA = "20261031220000_diskon_manual_akses.sql";
const SQL = readFileSync(`supabase/migrations/${NAMA}`, "utf8");

describe("migrasi akses diskon manual", () => {
  it("menumpang matriks kemampuan peran yang sudah ada, bukan daftar peran baru", () => {
    expect(SQL).toContain("alter table public.role_capabilities add column manual_discount boolean;");
    expect(SQL).toContain("when ''manual_discount'' then coalesce(c.manual_discount,p.role in (''ADMIN'',''FINANCE''))");
    expect(SQL).toContain("create function public.can_manual_discount() returns boolean");
    expect(SQL).toContain("select public.has_role_capability('manual_discount')");
  });

  it("kemampuan baru tidak bisa dipanggil anon/service_role dan tidak bocor lewat search_path", () => {
    expect(SQL).toContain("revoke all on function public.can_manual_discount() from public, anon, service_role;");
    expect(SQL).toContain("grant execute on function public.can_manual_discount() to authenticated;");
    for (const fn of [
      "public.can_manual_discount()",
      "public.assert_manual_discount_sale(p_sale_id uuid)",
      "public.assert_manual_discount_clinic(p_invoice jsonb, p_lines jsonb)",
      "public.assert_manual_discount_clinic_edit(p_invoice_id uuid, p_invoice jsonb, p_lines jsonb)",
    ]) {
      expect(SQL).toContain(`create function ${fn}`);
    }
    expect(SQL.match(/security definer set search_path = ''/g)?.length).toBeGreaterThanOrEqual(4);
    // Penolong internal tidak boleh dipanggil langsung dari browser.
    for (const fn of ["assert_manual_discount_sale(uuid)", "assert_manual_discount_clinic(jsonb, jsonb)", "assert_manual_discount_clinic_edit(uuid, jsonb, jsonb)"]) {
      expect(SQL).toContain(`revoke all on function public.${fn} from public, anon, authenticated, service_role;`);
    }
  });

  it("menyimpan rincian potongan supaya kolom gelondongan bisa diperiksa", () => {
    expect(SQL).toContain("add column manual_discount numeric(15,2) not null default 0 check (manual_discount >= 0)");
    expect(SQL).toContain("add column voucher_discount numeric(15,2) not null default 0 check (voucher_discount >= 0)");
    expect(SQL).toContain("add column auto_discount numeric(15,2) not null default 0 check (auto_discount >= 0)");
    // Siapa yang memberi diskon ikut dicatat di struk maupun tagihan.
    expect(SQL.match(/add column manual_discount_by uuid references public\.profiles\(id\)/g)).toHaveLength(2);
  });

  it("menambal RPC yang sudah berjalan dengan jangkar eksak, dikompilasi sekali per fungsi", () => {
    for (const sig of [
      "public.finalize_pos_sale(uuid)",
      "public.clinic_post_invoice(uuid,text,jsonb,jsonb)",
      "public.clinic_edit_invoice_core(uuid,text,jsonb,jsonb)",
    ]) {
      expect(SQL).toContain(`('${sig}',`);
    }
    expect(SQL).toContain("definition := coalesce(pending ->> p.sig, pg_get_functiondef(signature));");
    expect(SQL).toContain("if (length(definition) - length(replace(definition, p.old_text, ''))) / length(p.old_text) <> 1 then");
    expect(SQL).toContain("raise exception 'Diskon manual: jangkar harus muncul tepat sekali di %: %', p.sig, left(p.old_text, 80);");
    expect(SQL).toContain("for k in select jsonb_object_keys(pending) loop");
  });

  it("memasang pemeriksaan di tiap kanal penjualan", () => {
    expect(SQL).toContain("perform public.assert_manual_discount_sale(sale.id);");
    expect(SQL).toContain("perform public.assert_manual_discount_clinic(p_invoice, p_lines);");
    expect(SQL).toContain("perform public.assert_manual_discount_clinic_edit(p_invoice_id,p_invoice,p_lines);");
  });

  it("diskon baris kasir dibandingkan dengan diskon default master, bukan dengan angka dari layar", () => {
    expect(SQL).toContain("left join public.items i on i.id = si.item_id");
    expect(SQL).toContain("si.item_discount_type = 'percent'");
    expect(SQL).toContain("coalesce(si.item_discount_value, 0) = coalesce(i.default_discount, 0)");
  });

  it("potongan nota tidak boleh melebihi yang bisa dijelaskan rinciannya", () => {
    expect(SQL).toContain("Potongan nota tidak cocok dengan rinciannya. Diskon manual hanya untuk akun berwenang");
    expect(SQL).toContain("Potongan tagihan tidak cocok dengan rinciannya. Diskon manual hanya untuk akun berwenang");
  });

  it("koreksi tagihan klinik hanya dilarang MENAIKKAN potongan (temuan S-4)", () => {
    expect(SQL).toContain("koreksi tidak boleh menaikkan potongan");
    expect(SQL).toContain("koreksi tidak boleh menaikkan diskon baris");
    expect(SQL).toContain("on ii.id = nullif(x.value ->> 'source_invoice_item_id', '')::uuid and ii.invoice_id = p_invoice_id");
  });

  it("gagal tertutup bila salah satu invarian hilang setelah migrasi", () => {
    expect(SQL).toContain("raise exception 'Finalisasi POS belum memeriksa diskon manual'");
    expect(SQL).toContain("raise exception 'Penerbitan tagihan klinik belum memeriksa diskon manual'");
    expect(SQL).toContain("raise exception 'Koreksi tagihan klinik belum memeriksa diskon manual'");
    // Faktur grosir sudah terkunci OWNER/FINANCE; migrasi hanya memastikan penjaganya masih ada.
    expect(SQL).toContain("Penjaga koreksi faktur grosir tidak lagi membatasi OWNER/FINANCE");
  });

  it("tidak mengubah migrasi lama dan tidak menyentuh rumus promo/voucher", () => {
    expect(SQL).not.toMatch(/drop function/i);
    expect(SQL).not.toMatch(/promo_items|serviceLinePromos|potonganVoucher/);
  });
});
