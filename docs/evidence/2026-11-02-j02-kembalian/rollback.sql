-- ROLLBACK migrasi 20261106040000_j02_koreksi_metode_kembalian (jalankan HANYA bila perlu dibatalkan).
-- Membalik patch berjangkar: setiap teks pengganti dikembalikan ke teks asal. Bila ada jangkar yang tidak
-- ditemukan sesuai jumlahnya, rollback gagal tanpa mengubah apa pun.
-- md5(pg_get_functiondef) di Production SEBELUM migrasi (2 Nov 2026), untuk verifikasi sesudah rollback:
--   correct_pos_sale_payment            32ee7df61009f3229a857eb6feaad322
--   pos_sale_protect_header             66d7fca00e8f54e6151a2b53d9eede36
--   unit_posted_sale_source_immutable   2368a7641fd578420d47898666bfbf88
-- Koreksi yang sudah tercatat tidak dibatalkan oleh rollback ini.
begin;
do $patch$
declare
 targets text[]:=array[
  'public.correct_pos_sale_payment(uuid,integer,text,text,numeric,numeric)',
  'public.correct_pos_sale_payment(uuid,integer,text,text,numeric,numeric)',
  'public.correct_pos_sale_payment(uuid,integer,text,text,numeric,numeric)',
  'public.pos_sale_protect_header()',
  'public.pos_sale_protect_header()',
  'public.unit_posted_sale_source_immutable()',
  'public.unit_posted_sale_source_immutable()'
 ];
 replacements text[]:=array[
  -- 1. syarat sumber: kembalian tidak lagi ditolak
  $a$ or s.total<=0 or s.kembali<>0 then$a$,
  -- 2. pesan penolakan tidak lagi menyebut kembalian
  $a$'Sumber POS belum memenuhi syarat koreksi metode; kembalian tunai dan sumber legacy memerlukan rekonsiliasi'$a$,
  -- 3. header: Tunai dikosongkan -> kembalian nol, bayar = total
  $a$  revision=revision+1 where id=s.id;$a$,
  -- 4. penjaga header: bentuk bayar/kembali yang sah saat koreksi
  $a$    or new.revision is distinct from old.revision+1
$a$,
  -- 5. penjaga header: bayar/kembali dikecualikan dari pembanding snapshot (2 kemunculan)
  $a$array['payment_plan','metode_bayar','revision']$a$,
  -- 6. penjaga snapshot terposting: bentuk bayar/kembali yang sah saat koreksi
  $a$    and new.revision is not distinct from old.revision+1
$a$,
  -- 7. penjaga snapshot terposting: bayar/kembali dikecualikan (2 kemunculan)
  $a$array['payment_plan','metode_bayar','revision']$a$
 ];
 expected integer[]:=array[1,1,1,1,2,1,2];
 anchors text[]:=array[
  $r$ or s.total<=0 then$r$,
  $r$'Sumber POS belum memenuhi syarat koreksi metode; sumber legacy memerlukan rekonsiliasi'$r$,
  $r$  revision=revision+1,
  -- J02_KEMBALIAN: tanpa uang tunai tidak ada kembalian; selisih bayar-kembali tetap = total.
  bayar=case when p_cash_amount>0 then bayar else total end,
  kembali=case when p_cash_amount>0 then kembali else 0 end where id=s.id;$r$,
  $r$    or new.revision is distinct from old.revision+1
    -- J02_KEMBALIAN: bayar/kembali tetap, atau kembalian dihapus dengan bayar = total.
    or not coalesce((new.bayar,new.kembali) is not distinct from (old.bayar,old.kembali)
     or (new.kembali=0 and new.bayar=old.total),false)
$r$,
  $r$array['payment_plan','metode_bayar','revision','bayar','kembali']$r$,
  $r$    and new.revision is not distinct from old.revision+1
    -- J02_KEMBALIAN: bayar/kembali tetap, atau kembalian dihapus dengan bayar = total.
    and coalesce((new.bayar,new.kembali) is not distinct from (old.bayar,old.kembali)
     or (new.kembali=0 and new.bayar=old.total),false)
$r$,
  $r$array['payment_plan','metode_bayar','revision','bayar','kembali']$r$
 ];
 fn text;body text;found_count integer;i integer;
begin
 foreach fn in array array['public.correct_pos_sale_payment(uuid,integer,text,text,numeric,numeric)',
  'public.pos_sale_protect_header()','public.unit_posted_sale_source_immutable()'] loop
  body:=pg_get_functiondef(fn::regprocedure);
  if position('J02_KEMBALIAN' in body)=0 then
   raise exception 'J02_KEMBALIAN patch not present in %; nothing to roll back',fn;end if;
  for i in 1..array_length(anchors,1) loop
   continue when targets[i]<>fn;
   found_count:=(length(body)-length(replace(body,anchors[i],'')))/length(anchors[i]);
   if found_count<>expected[i] then
    raise exception 'J02_KEMBALIAN anchor % found % time(s) in %, expected %',i,found_count,fn,expected[i];end if;
   body:=replace(body,anchors[i],replacements[i]);
  end loop;
  execute body;
 end loop;
end $patch$;
delete from supabase_migrations.schema_migrations where version='20261106040000';
commit;
