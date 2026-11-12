-- Saldo awal hutang/piutang per faktur: FINANCE boleh memposting (keputusan Reza 31 Okt 2026).
--
-- Sebelumnya hanya OWNER yang bisa memposting; FINANCE hanya memeriksa. Sekarang FINANCE aktif
-- juga boleh memposting dengan syarat yang sama seperti saat memeriksa: berhak seluruh cabang dan,
-- bila Akses Grup FINANCE diatur, modul Buku Besar masih dibuka. ADMIN tetap hanya memeriksa.
-- Pengaman lain tidak berubah: alasan audit wajib, file harus sama dengan yang diperiksa (hash),
-- posting ganda ditolak, dan pencatat batch = akun yang memposting.
--
-- Hanya baris pemeriksaan peran yang diganti (jangkar teks), supaya isi fungsi lain — termasuk
-- kode akun yang sudah ditulis ulang oleh migrasi bagan akun baru — tetap persis seperti di database.
do $$ declare def text;
 old_check text:=$a$ if not found or actor.role<>'OWNER' then raise exception 'Hanya OWNER aktif yang dapat memposting saldo awal per faktur' using errcode='42501';end if;$a$;
 new_check text:=$b$ if not found or actor.role not in ('OWNER','FINANCE') or not public.has_role_capability('all_branches') then raise exception 'Hanya OWNER/FINANCE aktif yang dapat memposting saldo awal per faktur' using errcode='42501';end if;
 if actor.role<>'OWNER' and exists(select 1 from public.role_modules where role=actor.role)
  and not exists(select 1 from public.role_modules where role=actor.role and module_id='buku-besar') then raise exception 'Akses Buku Besar diperlukan' using errcode='42501';end if;$b$;
begin
 def:=pg_get_functiondef('public.post_opening_invoices(jsonb,text,text)'::regprocedure);
 if strpos(def,new_check)>0 then return;end if; -- sudah diterapkan
 if (length(def)-length(replace(def,old_check,'')))/length(old_check)<>1 then
  raise exception 'OPENING_INVOICE_FINANCE_ANCHOR: pemeriksaan peran posting saldo awal per faktur tidak dikenali';end if;
 execute replace(def,old_check,new_check);
end $$;

revoke all on function public.post_opening_invoices(jsonb,text,text) from public,anon,authenticated,service_role;
grant execute on function public.post_opening_invoices(jsonb,text,text) to authenticated;
