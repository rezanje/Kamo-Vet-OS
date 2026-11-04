-- Koreksi pengeluaran sesudah shift ditutup (keputusan Owner 4 Nov, opsi C).
-- Mengikuti pola J02 (koreksi metode bayar penjualan sesudah shift ditutup):
--
-- * OWNER dan FINANCE aktif boleh mengedit / membatalkan pengeluaran kasir walau
--   shift sumbernya sudah ditutup. ADMIN tetap hanya boleh selama shift masih buka.
-- * Shift yang sudah ditutup TIDAK dibuka ulang dan angka penutupannya
--   (expected_cash, closing_breakdown, selisih) tidak diubah. Barisnya tetap dikunci
--   FOR UPDATE agar koreksi tidak berlomba dengan proses tutup shift, lalu statusnya
--   dicatat di jejak koreksi (expense_revisions.source_shift_status).
-- * Aturan periode tidak berubah: ditolak bila tanggal sumber ATAU tanggal baru
--   berada di periode akuntansi yang sudah ditutup.
-- * Penolakan lain (refund retur, jurnal sumber tidak terhubung, revisi basi) tetap.
--
-- Fungsi diganti dengan patch berjangkar: signature, SECURITY DEFINER, search_path
-- dan grant tetap. Jangkar yang tidak ditemukan tepat satu kali menggagalkan migrasi.
alter table public.expense_revisions add column if not exists source_shift_status text;

do $patch$
declare
 signature regprocedure:='public.revise_expense_atomic(text,uuid,integer,text,jsonb,text)'::regprocedure;
 body text;
 anchors text[]:=array[
  -- 1. shift wajib open -> OWNER/FINANCE boleh sesudah shift ditutup
  $a$ if exp.shift_id is not null then
   select status into shift_status from public.cashier_shifts where id=exp.shift_id for update;
   if shift_status is distinct from 'open' then raise exception 'Shift sudah ditutup. Koreksi memerlukan rekonsiliasi kas terlebih dahulu.';end if;
 end if;$a$,
  -- 2. jejak koreksi menyimpan status shift sumber
  $a$original_journal_id,created_by)
 values(audit,exp.id,exp.branch_id,p_action,btrim(p_reason),before_value,before_value,original,auth.uid());$a$,
  -- 3. hasil RPC menyebut status shift sumber
  $a$result:=jsonb_build_object('expense_id',exp.id,'journal_id',coalesce(replacement,reversal),'revision_id',audit);$a$
 ];
 replacements text[]:=array[
  $r$ -- EXPENSE_AFTER_SHIFT: shift ditutup tidak dibuka ulang; angka penutupannya tidak disentuh.
 if exp.shift_id is not null then
   select status into shift_status from public.cashier_shifts where id=exp.shift_id for update;
   if not found then raise exception 'Shift kasir sumber tidak ditemukan; rekonsiliasi shift diperlukan';end if;
   if shift_status is distinct from 'open' then
     perform 1 from public.profiles where id=auth.uid() and is_active and role in('OWNER','FINANCE') for share;
     if not found then raise exception 'Shift sudah ditutup. Hanya Owner atau Finance yang dapat mengoreksi pengeluaran ini.' using errcode='42501';end if;
   end if;
 end if;$r$,
  $r$original_journal_id,created_by,source_shift_status)
 values(audit,exp.id,exp.branch_id,p_action,btrim(p_reason),before_value,before_value,original,auth.uid(),shift_status);$r$,
  $r$result:=jsonb_build_object('expense_id',exp.id,'journal_id',coalesce(replacement,reversal),'revision_id',audit,'source_shift_status',shift_status);$r$
 ];
 i integer;
begin
 body:=pg_get_functiondef(signature);
 if position('EXPENSE_AFTER_SHIFT' in body)>0 then
  raise exception 'EXPENSE_AFTER_SHIFT patch already present; verify migration history';end if;
 for i in 1..array_length(anchors,1) loop
  if (length(body)-length(replace(body,anchors[i],'')))/length(anchors[i])<>1 then
   raise exception 'EXPENSE_AFTER_SHIFT anchor % not found exactly once; review revise_expense_atomic',i;end if;
  body:=replace(body,anchors[i],replacements[i]);
 end loop;
 execute body;
end $patch$;

-- Grant tidak berubah oleh CREATE OR REPLACE; ditegaskan ulang agar kontraknya terlihat.
revoke all on function public.revise_expense_atomic(text,uuid,integer,text,jsonb,text) from public,anon;
grant execute on function public.revise_expense_atomic(text,uuid,integer,text,jsonb,text) to authenticated;
