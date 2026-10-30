-- J02 Koreksi metode pembayaran: jurnal balik & jurnal pengganti ikut dikunci.
--
-- Jurnal asli penjualan POS sudah dijaga pos_sale_protect_journal (lewat
-- pos_sale_journal_protected). Jurnal yang dibuat correct_pos_sale_payment
-- (source 'sale-payment-reversal' dan 'sale-payment-repost') belum masuk daftar,
-- sehingga pengguna dengan akses cabang bisa menghapus/mengubah barisnya atau
-- menandainya batal lewat API biasa. Bila baris jurnal balik dihapus, jurnal asli
-- dan jurnal pengganti sama-sama hidup: pendapatan, PPN, dan kas/bank tercatat dua kali.
--
-- Perubahan hanya memperluas fungsi penanda yang sudah dipakai trigger yang ada.
-- Data lama tidak diubah. RPC koreksi berjalan sebagai pemilik fungsi, jadi tidak
-- terhalang trigger ini.
do $$ begin
 if to_regclass('public.sale_payment_corrections') is null
  or to_regclass('public.pos_sale_postings') is null
  or to_regprocedure('public.pos_sale_journal_protected(uuid)') is null
  or to_regprocedure('public.pos_sale_protect_journal()') is null
 then raise exception 'J02_GUARD_SOURCE_CHANGED: review POS journal protection contract';end if;
end $$;

create or replace function public.pos_sale_journal_protected(p_entry uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.pos_sale_postings where revenue_journal_id=p_entry or hpp_journal_id=p_entry)
 or exists(select 1 from public.journal_entries e where e.id=p_entry and e.source in('sale','sale-hpp','sale-online','sale-online-hpp','sale-void','sale-void-hpp','sale-payment-reversal','sale-payment-repost'))
 or exists(select 1 from public.sale_payment_corrections c where c.reversal_journal_id=p_entry or c.replacement_journal_id=p_entry)
$$;
