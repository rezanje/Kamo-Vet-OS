-- J02 lanjutan (keputusan Owner 29 Okt): koreksi Tunai<->Transfer pada penjualan POS
-- boleh dilakukan OWNER dan FINANCE, termasuk sesudah shift kasir ditutup.
--
-- * Shift yang sudah ditutup TIDAK dibuka ulang dan angka penutupannya
--   (expected_cash, closing_breakdown, selisih) tidak diubah. Barisnya hanya dikunci
--   FOR UPDATE agar koreksi tidak berlomba dengan proses tutup shift, lalu statusnya
--   dicatat di jejak koreksi (source_shift_status).
-- * Jurnal pembalik + pengganti tetap bertanggal hari koreksi (WIB). Aturan periode
--   tidak berubah: ditolak bila tanggal sumber ATAU tanggal koreksi berada di periode
--   yang sudah ditutup (check_period_lock memblokir jurnal bertanggal <= closed_until).
-- * Penolakan lain (kembalian tunai, fee Tunai/Transfer, sumber legacy, retur/refund,
--   rekonsiliasi bank, revisi basi, peta akun berubah) tetap berlaku.
--
-- Fungsi diganti dengan patch berjangkar: signature, SECURITY DEFINER, search_path,
-- lock_timeout dan grant tetap. Jangkar yang tidak ditemukan tepat satu kali
-- menggagalkan migrasi.
alter table public.sale_payment_corrections add column if not exists source_shift_status text;

do $patch$
declare
 signature regprocedure:='public.correct_pos_sale_payment(uuid,integer,text,text,numeric,numeric)'::regprocedure;
 body text;
 anchors text[]:=array[
  -- 1. variabel status shift
  $a$ audit uuid:=gen_random_uuid();$a$,
  -- 2. peran OWNER saja + modul penjualan -> OWNER/FINANCE + akses cabang
  $a$ perform 1 from public.profiles where id=actor and is_active and role='OWNER' for share;
 if not found then raise exception 'Hanya Owner aktif dapat mengoreksi metode pembayaran' using errcode='42501';end if;
 perform public.sales_assert_access(s.branch_id);$a$,
  -- 3. shift wajib open -> shift dikunci, status dicatat
  $a$ if s.shift_id is not null then
  perform 1 from public.cashier_shifts where id=s.shift_id and branch_id=s.branch_id and status='open' for update;
  if not found then raise exception 'Shift kasir sudah ditutup; rekonsiliasi shift diperlukan';end if;
 end if;$a$,
  -- 4. jejak koreksi menyimpan status shift sumber
  $a$original_journal_id,reversal_journal_id,replacement_journal_id,created_by)
  values(audit,s.id,s.branch_id,s.revision+1,btrim(p_reason),to_jsonb(s),before_payments,after_payments,
   source_journal.id,reversal,replacement,actor);$a$,
  -- 5. hasil RPC menyebut status shift sumber
  $a$'reversal_journal_id',reversal,'replacement_journal_id',replacement);$a$
 ];
 replacements text[]:=array[
  $r$ audit uuid:=gen_random_uuid();shift_status text;$r$,
  $r$ perform 1 from public.profiles where id=actor and is_active and role in('OWNER','FINANCE') for share;
 if not found then raise exception 'Hanya Owner atau Finance aktif dapat mengoreksi metode pembayaran' using errcode='42501';end if;
 if not public.user_can_access_branch(s.branch_id) then
  raise exception 'Dokumen penjualan tidak ditemukan atau tidak dapat diakses.' using errcode='42501';end if;$r$,
  $r$ -- J02_AFTER_SHIFT: shift ditutup tidak dibuka ulang; angka penutupannya tidak disentuh.
 if s.shift_id is not null then
  select status into shift_status from public.cashier_shifts where id=s.shift_id and branch_id=s.branch_id for update;
  if not found then raise exception 'Shift kasir sumber tidak ditemukan; rekonsiliasi shift diperlukan';end if;
 end if;$r$,
  $r$original_journal_id,reversal_journal_id,replacement_journal_id,created_by,source_shift_status)
  values(audit,s.id,s.branch_id,s.revision+1,btrim(p_reason),to_jsonb(s),before_payments,after_payments,
   source_journal.id,reversal,replacement,actor,shift_status);$r$,
  $r$'reversal_journal_id',reversal,'replacement_journal_id',replacement,'source_shift_status',shift_status);$r$
 ];
 i integer;
begin
 body:=pg_get_functiondef(signature);
 if position('J02_AFTER_SHIFT' in body)>0 then
  raise exception 'J02_AFTER_SHIFT patch already present; verify migration history';end if;
 for i in 1..array_length(anchors,1) loop
  if (length(body)-length(replace(body,anchors[i],'')))/length(anchors[i])<>1 then
   raise exception 'J02_AFTER_SHIFT anchor % not found exactly once; review correct_pos_sale_payment',i;end if;
  body:=replace(body,anchors[i],replacements[i]);
 end loop;
 execute body;
end $patch$;

-- Grant tidak berubah oleh CREATE OR REPLACE; ditegaskan ulang agar kontraknya terlihat.
revoke all on function public.correct_pos_sale_payment(uuid,integer,text,text,numeric,numeric)
 from public,anon,authenticated,service_role;
grant execute on function public.correct_pos_sale_payment(uuid,integer,text,text,numeric,numeric) to authenticated;

-- Jejak koreksi dibaca OWNER dan FINANCE pada cabang yang boleh diakses.
drop policy if exists sale_payment_corrections_owner_read on public.sale_payment_corrections;
create policy sale_payment_corrections_finance_read on public.sale_payment_corrections for select to authenticated using (
 exists(select 1 from public.profiles p where p.id=auth.uid() and p.is_active and p.role in('OWNER','FINANCE'))
 and public.user_can_access_branch(branch_id)
);
