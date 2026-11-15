-- J02 lanjutan (laporan Anisa, 12 Nov 2026): "ubah metode payment juga blm bisa".
-- Struk POS-20261104-0086 (Granada, Rp 11.000, Tunai) ditolak dengan
-- 'Akun sumber berubah dari peta rekening; cocokkan sebelum koreksi'.
--
-- Penyebab: sejak 20261107010000_kas_tunai_per_cabang_pencairan_online, Tunai tiap cabang
-- dipetakan ke "Kas Toko <cabang>" (110004–110012). Struk petshop 1–6 Nov tetap tercatat di
-- 110003 Kas Kecil (migrasi itu sengaja tidak menulis ulang jurnal lama). Koreksi metode
-- mewajibkan akun bagian Tunai/Transfer lama SAMA dengan peta SEKARANG, jadi ±1.230 struk
-- tunai 1–6 Nov tidak bisa dikoreksi sama sekali.
--
-- Perbaikan (gaya "Batalkan penerimaan", yang juga membalik ke akun tercatat):
--  * Bagian Tunai/Transfer lama boleh berada di akun mana pun asalkan konsisten: snapshot akun
--    = kode akun tercatat, rekening Kas/Bank di snapshot memang memakai kode itu, dan akunnya
--    aset detail aktif bersaldo normal debit. Jurnal aktif tetap dicocokkan baris per baris
--    dengan alokasi tercatat (pemeriksaan lama, tidak diubah).
--  * Metode yang SUDAH ADA di struk tetap di akun tercatatnya (mis. sisa Tunai tetap di Kas
--    Kecil), jadi koreksi hanya memindahkan selisih yang benar-benar pindah metode — tidak ada
--    pemindahan diam-diam antar akun kas. Metode yang BARU muncul memakai peta sekarang.
--  * Pagar rekonsiliasi bank otomatis ikut mencakup akun tercatat (variabel kode akun yang
--    dipakai pagar itu kini berisi akun tercatat bila metodenya sudah ada).
-- Signature, SECURITY, search_path, lock_timeout dan grant tidak berubah. Patch berjangkar:
-- jangkar yang tidak ditemukan tepat sesuai jumlahnya menggagalkan migrasi.
do $patch$
declare
 fn constant text:='public.correct_pos_sale_payment(uuid,integer,text,text,numeric,numeric)';
 anchors text[]:=array[
  -- 1. variabel akun tercatat
  $a$ cash_code text;transfer_code text;closed date;$a$,
  -- 2. pemeriksaan akun bagian lama: bukan lagi "harus sama dengan peta sekarang"
  $a$  if old_part.coa_code is distinct from (case when old_part.method='Tunai' then cash_code else transfer_code end)
   or (old_part.account_snapshot->>'code') is distinct from old_part.coa_code
   or (old_part.account_snapshot->>'cash_account_id') is distinct from
     (case when old_part.method='Tunai' then cash_account.id else transfer_account.id end)::text then
   raise exception 'Akun sumber berubah dari peta rekening; cocokkan sebelum koreksi';end if;
 end loop;
$a$
 ];
 replacements text[]:=array[
  $r$ cash_code text;transfer_code text;old_cash_code text;old_transfer_code text;old_cash_account uuid;old_transfer_account uuid;closed date;$r$,
  $r$  -- J02_AKUN_LAMA: bagian lama boleh di akun tercatatnya (mis. 110003 Kas Kecil sebelum peta kas per cabang),
  -- asalkan snapshot, rekening Kas/Bank dan akun COA-nya saling cocok dan masih aset detail aktif.
  if old_part.coa_code is null or (old_part.account_snapshot->>'code') is distinct from old_part.coa_code
   or (old_part.account_snapshot->>'cash_account_id') is null
   or not exists(select 1 from public.cash_accounts a where a.id::text=old_part.account_snapshot->>'cash_account_id'
    and a.coa_code=old_part.coa_code)
   or not exists(select 1 from public.coa_accounts a where a.code=old_part.coa_code and a.is_active and not a.is_header
    and a.type='ASET' and a.normal_balance='D')
   or (old_part.method='Tunai' and old_cash_code is not null and old_cash_code<>old_part.coa_code)
   or (old_part.method='Transfer' and old_transfer_code is not null and old_transfer_code<>old_part.coa_code) then
   raise exception 'Akun sumber pembayaran tidak lengkap atau tidak konsisten; cocokkan sebelum koreksi';end if;
  if old_part.method='Tunai' then
   old_cash_code:=old_part.coa_code;old_cash_account:=(old_part.account_snapshot->>'cash_account_id')::uuid;
  else
   old_transfer_code:=old_part.coa_code;old_transfer_account:=(old_part.account_snapshot->>'cash_account_id')::uuid;
  end if;
 end loop;
 -- J02_AKUN_LAMA: metode yang sudah ada tetap di akun tercatatnya; metode baru memakai peta sekarang.
 if old_cash_code is not null then
  cash_code:=old_cash_code;
  select * into cash_account from public.cash_accounts where id=old_cash_account for share;
 end if;
 if old_transfer_code is not null then
  transfer_code:=old_transfer_code;
  select * into transfer_account from public.cash_accounts where id=old_transfer_account for share;
 end if;
 if cash_code=transfer_code then
  raise exception 'Akun Tunai dan Transfer sumber sama; rekonsiliasi diperlukan sebelum koreksi';end if;
$r$
 ];
 body text;found_count integer;i integer;
begin
 body:=pg_get_functiondef(fn::regprocedure);
 if position('J02_AKUN_LAMA' in body)>0 then
  raise exception 'J02_AKUN_LAMA patch already present in %; verify migration history',fn;end if;
 for i in 1..array_length(anchors,1) loop
  found_count:=(length(body)-length(replace(body,anchors[i],'')))/length(anchors[i]);
  if found_count<>1 then
   raise exception 'J02_AKUN_LAMA anchor % found % time(s) in %, expected 1',i,found_count,fn;end if;
  body:=replace(body,anchors[i],replacements[i]);
 end loop;
 execute body;
end $patch$;

-- Grant tidak berubah oleh CREATE OR REPLACE; ditegaskan ulang agar kontraknya terlihat.
revoke all on function public.correct_pos_sale_payment(uuid,integer,text,text,numeric,numeric)
 from public,anon,authenticated,service_role;
grant execute on function public.correct_pos_sale_payment(uuid,integer,text,text,numeric,numeric) to authenticated;
