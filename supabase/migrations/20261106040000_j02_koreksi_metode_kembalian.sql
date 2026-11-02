-- J02 lanjutan (laporan klinik 2 Nov): penjualan POS tunai yang memakai kembalian
-- (mis. total 19.000, dibayar 50.000, kembali 31.000) tidak bisa dikoreksi metodenya.
-- Penolakan "kembalian tunai memerlukan rekonsiliasi" dicabut karena:
--
-- * Jurnal penjualan, alokasi sale_payments dan hitungan laci shift semuanya memakai
--   angka bersih (Tunai = total), bukan uang yang diserahkan. Kembalian hanya tampil
--   di struk dan halaman detail; tidak ada jurnal atau saldo laci yang membacanya.
-- * Aturan saat checkout: bayar - kembali = total, dan kembalian > 0 hanya boleh bila
--   ada bagian Tunai. Koreksi menjaga keduanya:
--     - bagian Tunai masih ada  -> bayar/kembali tidak diubah (selisihnya tetap = total);
--     - Tunai dikosongkan        -> kembali = 0 dan bayar = total (tidak ada uang tunai
--       yang diterima, jadi tidak ada kembalian).
--   Nilai bayar/kembali sebelum koreksi tetap tersimpan di jejak koreksi (before_sale).
--
-- Dua penjaga header (pos_sale_protect_header, unit_posted_sale_source_immutable) hanya
-- melonggarkan bayar/kembali di dalam gerbang koreksi resmi dan hanya ke dua bentuk di atas.
-- Semua patch berjangkar: jangkar yang tidak ditemukan tepat sesuai jumlahnya menggagalkan
-- migrasi. Signature, SECURITY, search_path, lock_timeout dan grant tidak berubah.
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
 anchors text[]:=array[
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
 replacements text[]:=array[
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
  if position('J02_KEMBALIAN' in body)>0 then
   raise exception 'J02_KEMBALIAN patch already present in %; verify migration history',fn;end if;
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

-- Grant tidak berubah oleh CREATE OR REPLACE; ditegaskan ulang agar kontraknya terlihat.
revoke all on function public.correct_pos_sale_payment(uuid,integer,text,text,numeric,numeric)
 from public,anon,authenticated,service_role;
grant execute on function public.correct_pos_sale_payment(uuid,integer,text,text,numeric,numeric) to authenticated;
