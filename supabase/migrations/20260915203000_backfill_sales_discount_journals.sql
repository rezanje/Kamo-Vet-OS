-- Jurnal POS lama mencatat pendapatan setelah diskon. Ubah hanya jurnal non-PKP
-- yang masih persis neto dan belum punya baris diskon, supaya migrasi aman diulang.
begin;

with jurnal_lama as (
  select
    je.id as entry_id,
    greatest(0, s.subtotal - s.total) as diskon,
    akun_diskon.id as discount_account_id
  from sales s
  join journal_entries je
    on je.source = 'sale' and je.source_ref = s.no_struk
  join journal_lines pendapatan on pendapatan.entry_id = je.id
  join coa_accounts akun_pendapatan
    on akun_pendapatan.id = pendapatan.account_id and akun_pendapatan.code = '4101'
  cross join coa_accounts akun_diskon
  where akun_diskon.code = '4102'
    and s.subtotal > s.total
    and pendapatan.debit = 0
    and pendapatan.credit = s.total
    and not exists (
      select 1
      from journal_lines sudah
      where sudah.entry_id = je.id and sudah.account_id = akun_diskon.id
    )
)
insert into journal_lines (entry_id, account_id, debit, credit)
select entry_id, discount_account_id, diskon, 0
from jurnal_lama
where diskon > 0;

with jurnal_lama as (
  select
    je.id as entry_id,
    pendapatan.id as revenue_line_id,
    greatest(0, s.subtotal - s.total) as diskon
  from sales s
  join journal_entries je
    on je.source = 'sale' and je.source_ref = s.no_struk
  join journal_lines pendapatan on pendapatan.entry_id = je.id
  join coa_accounts akun_pendapatan
    on akun_pendapatan.id = pendapatan.account_id and akun_pendapatan.code = '4101'
  where s.subtotal > s.total
    and pendapatan.debit = 0
    and pendapatan.credit = s.total
    and exists (
      select 1
      from journal_lines diskon
      join coa_accounts akun_diskon on akun_diskon.id = diskon.account_id
      where diskon.entry_id = je.id
        and akun_diskon.code = '4102'
        and diskon.debit = greatest(0, s.subtotal - s.total)
        and diskon.credit = 0
    )
)
update journal_lines pendapatan
set credit = pendapatan.credit + jurnal_lama.diskon
from jurnal_lama
where pendapatan.id = jurnal_lama.revenue_line_id;

commit;
