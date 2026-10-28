import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Migrasi belum bisa dijalankan di sini (tidak ada database), jadi yang dikunci adalah
// bukti tekstualnya: jangkar gagal-tertutup, ACL, dan akun jurnal yang dipakai.
const SQL = readFileSync("supabase/migrations/20261030120000_faktur_jual_edit_penerimaan.sql", "utf8");
/** Tanpa baris komentar, supaya penjelasan tidak dibaca sebagai perintah. */
const PERINTAH = SQL.split("\n").filter((baris) => !baris.trimStart().startsWith("--")).join("\n");

describe("penerimaan penjualan dibalik, bukan dihapus", () => {
  it("menyimpan baris penerimaan lawan bernilai negatif, bukan menghapus barisnya", () => {
    expect(SQL).toMatch(/reversal_of is not null and jumlah<0 and dari_uang_muka between jumlah and 0/);
    expect(SQL).not.toMatch(/delete from public\.sales_receipts/);
  });
  it("tidak pernah menghapus baris jurnal; menulis jurnal pembalik bersumber sales-receipt-void", () => {
    expect(SQL).not.toMatch(/delete from public\.journal_lines|delete from public\.journal_entries/);
    expect(SQL).toMatch(/wholesale_write_journal\(today,inv\.branch_id,'sales-receipt-void'/);
  });
  it("mengembalikan pemakaian uang muka setelah membuktikan counternya cocok", () => {
    expect(SQL).toMatch(/adv\.terpakai is distinct from \(select coalesce\(sum\(dari_uang_muka\),0\) from public\.sales_receipts where advance_id=adv\.id\)/);
    expect(SQL).toMatch(/update public\.sales_advances set terpakai=terpakai-rc\.dari_uang_muka/);
  });
  it("menolak penerimaan yang sudah direkonsiliasi bank atau periodenya tertutup", () => {
    expect(SQL).toMatch(/bank_reconciliations br join public\.cash_accounts a on a\.id=br\.cash_account_id/);
    expect(SQL).toMatch(/Penerimaan sudah direkonsiliasi bank; tinjau rekonsiliasi dahulu/);
    expect(SQL).toMatch(/perform public\.wholesale_period\(rc\.tanggal,today\);/);
  });
  it("jurnal pembalik ikut keluarga jurnal grosir yang dilindungi dari tulisan klien", () => {
    expect(SQL).toMatch(/'sales-invoice'',''sales-delivery'',''sales-receipt'',''sales-receipt-void''/);
  });
});

describe("edit faktur per baris", () => {
  it("menolak edit selama faktur masih punya penerimaan", () => {
    expect(SQL).toMatch(/if inv\.carried_paid<>0 or exists\(select 1 from public\.sales_receipts where invoice_id=inv\.id and voided_at is null and reversal_of is null\) then/);
    expect(SQL).toMatch(/Hapus penerimaan dulu/);
  });
  it("memposting ulang piutang, pendapatan bruto, diskon 4102 dan PPN keluaran", () => {
    expect(SQL).toMatch(/jsonb_build_object\('code','1201','debit',dpp\+tax,'credit',0\),jsonb_build_object\('code','4101','debit',0,'credit',gross\)/);
    expect(SQL).toMatch(/if disc>0 then lines:=lines\|\|jsonb_build_array\(jsonb_build_object\('code','4102','debit',disc,'credit',0\)\);end if;/);
    expect(SQL).toMatch(/jsonb_build_object\('code','2201','debit',0,'credit',tax\)/);
  });
  it("tidak menyentuh stok atau lapisan stok: stok grosir milik pengiriman", () => {
    expect(PERINTAH).not.toMatch(/stock_layers|stock_moves|update public\.stock\b/);
  });
  it("menghitung ulang alokasi HPP dari pengiriman yang belum terpakai faktur aktif", () => {
    expect(SQL).toMatch(/join public\.sales_invoices av on av\.id=ai\.invoice_id where a\.delivery_item_id=di\.id and av\.status<>'batal'/);
    expect(SQL).toMatch(/update public\.sales_order_items set qty_faktur=qty_faktur\+item\.qty where id=item\.order_item_id;/);
  });
  it("membalik jurnal faktur lama lalu menerbitkan faktur pengganti bernomor baru", () => {
    expect(SQL).toMatch(/wholesale_write_journal\(p_tanggal,inv\.branch_id,'wholesale-invoice-void'/);
    expect(SQL).toMatch(/new_no:=public\.sales_next_number\(case when v_type='KLINIK' then 'FJK' else 'FJ' end,p_tanggal\);/);
    expect(SQL).toMatch(/update public\.sales_invoices set status='batal',voided_on=p_tanggal/);
  });
  it("menuntut pratinjau dan revisi yang cocok sebelum menyimpan", () => {
    expect(SQL).toMatch(/Buka pratinjau dampak sebelum menyimpan perubahan/);
    expect(SQL).toMatch(/Faktur sudah berubah sejak pratinjau/);
  });
  it("menyimpan jejak audit siapa, kapan, alasan, dan nilai sebelum/sesudah", () => {
    expect(SQL).toMatch(/insert into public\.wholesale_invoice_corrections\(id,invoice_id,replacement_id,action,kind,reason,tanggal,before_value,after_value/);
  });
});

describe("gaya tambalan gagal tertutup dan ACL", () => {
  it("menghitung jangkar dan berhenti tanpa mengubah apa pun bila tidak cocok", () => {
    expect(SQL).toMatch(/jangkar harus muncul % kali di %/);
    expect(SQL).toMatch(/definition:=pg_get_functiondef\(signature\);/);
  });
  it("memeriksa ulang hasil tambalan setelah diterapkan", () => {
    expect(SQL).toMatch(/tambalan fungsi berjalan tidak lengkap/);
  });
  it("hanya RPC publik yang diberi hak eksekusi ke peran authenticated", () => {
    const granted = [...SQL.matchAll(/grant execute on function public\.([a-z_]+)\(/g)].map((m) => m[1]);
    expect(new Set(granted)).toEqual(new Set([
      "get_wholesale_operation", "correct_wholesale_invoice",
      "preview_wholesale_invoice_lines", "correct_wholesale_invoice_lines", "cancel_wholesale_receipt",
    ]));
    expect(SQL).toMatch(/revoke all on function public\.wholesale_invoice_line_edit_run\(uuid,date,date,text,jsonb,text,text,jsonb,boolean\) from public,anon,authenticated,service_role;/);
  });
  it("tabel audit baru hanya bisa dibaca lewat fakturnya", () => {
    expect(SQL).toMatch(/revoke all on public\.sales_receipt_cancellations from public,anon,authenticated,service_role;/);
    expect(SQL).toMatch(/create policy sales_receipt_cancellations_read on public\.sales_receipt_cancellations for select to authenticated\s+using\(exists\(select 1 from public\.sales_invoices i where i\.id=invoice_id\)\);/);
  });
  it("berhenti bila batas nilai penerimaan lama di production tidak dikenali", () => {
    expect(SQL).toMatch(/batas nilai penerimaan lama tidak dikenali; periksa production sebelum apply/);
    expect(SQL).toMatch(/batas jenis permintaan grosir tidak dikenali; periksa production sebelum apply/);
  });
});
