-- Hotfix 10 Nov 2026: nomor jurnal bulanan JRN-YYYYMM-NNNN habis di 9999.
-- November sudah >10.000 jurnal (2 jurnal per transaksi kasir, semua cabang),
-- sehingga sales_next_number('JRN') menolak dengan "Urutan nomor dokumen penuh"
-- dan semua penjualan kasir/grosir/kas yang memakai jalur ini gagal.
--
-- Perbaikan: untuk seri JRN, urutan dibaca dari seluruh angka di depan sufiks
-- (bukan hanya 4 karakter) dan nomor boleh tumbuh jadi 5+ digit
-- (JRN-202611-10006, ...). Ini sama dengan perilaku clinic_write_journal,
-- receive_purchase_order dan post_recurring_journal_period yang sudah lebih dulu
-- menembus 9999. Seri DO/FJ/FJK/SO tidak berubah.
create or replace function public.sales_next_number(p_kind text, p_date date)
returns text
language plpgsql
security definer
set search_path to ''
as $function$
declare v_prefix text; v_digits integer; v_table text; v_column text; v_seq bigint; begin
  if p_kind not in ('DO','FJ','FJK','SO','JRN') then raise exception 'Seri dokumen tidak valid'; end if;
  if p_kind='JRN' then
    v_prefix:='JRN-'||to_char(p_date,'YYYYMM')||'-'; v_digits:=4; v_table:='journal_entries'; v_column:='no_jurnal';
  else
    select pola,digit into v_prefix,v_digits from public.document_numbering where jenis=p_kind;
    v_prefix:=coalesce(v_prefix,p_kind||'.{YYYY}.{MM}.'); v_digits:=coalesce(v_digits,5);
    v_prefix:=replace(replace(replace(replace(v_prefix,'{YYYY}',to_char(p_date,'YYYY')),'{YY}',to_char(p_date,'YY')),'{MM}',to_char(p_date,'MM')),'{DD}',to_char(p_date,'DD'));
    v_table:=case p_kind when 'DO' then 'sales_deliveries' when 'SO' then 'sales_orders' else 'sales_invoices' end;
    v_column:=case p_kind when 'DO' then 'no_kirim' when 'SO' then 'no_pesanan' else 'no_faktur' end;
  end if;
  if v_digits not between 1 and 8 or length(v_prefix)+v_digits>(case when p_kind='JRN' then 24 else 30 end) then raise exception 'Format nomor terlalu panjang'; end if;
  if p_kind='JRN' then lock table public.journal_entries in row exclusive mode; end if;
  -- Shared lock namespace with existing atomic journal RPCs.
  perform pg_advisory_xact_lock(hashtext(case when p_kind='JRN' then 'vetos:journal:' else 'vetos:sales-number:' end||v_prefix)::bigint);
  if p_kind='JRN' then
    -- Ambil semua digit di depan sufiks: 0510, 0510-4KJY dan 10000 sama-sama terbaca.
    select coalesce(max((substring(substring(e.no_jurnal from length(v_prefix)+1) from '^[0-9]{1,12}'))::bigint),0)+1
      into v_seq from public.journal_entries e where left(e.no_jurnal,length(v_prefix))=v_prefix;
    if length(v_prefix)+length(v_seq::text)>24 then raise exception 'Urutan nomor dokumen penuh'; end if;
    return v_prefix||lpad(v_seq::text,greatest(v_digits,length(v_seq::text)),'0');
  end if;
  execute format('select coalesce(max(substring(%I from $1 for $2)::bigint),0)+1 from public.%I where left(%I,$3)=$4 and substring(%I from $1 for $2) ~ ''^[0-9]+$''',v_column,v_table,v_column,v_column)
    into v_seq using length(v_prefix)+1,v_digits,length(v_prefix),v_prefix;
  if length(v_seq::text)>v_digits then raise exception 'Urutan nomor dokumen penuh'; end if;
  return v_prefix||lpad(v_seq::text,v_digits,'0');
end $function$;
