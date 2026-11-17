-- Bayar hutang: sisa faktur bersen bisa dilunasi persis.
-- apply as ONE transaction (the Supabase CLI runs this file in one; there is no begin/commit in it).
--
-- Kasus 17 Nov: faktur ber-PPN bertotal Rp 3.585.410,98 dibayar Rp 3.585.410 → sisa Rp 0,98. Layar Pembayaran
-- Hutang tidak bisa melunasinya: nominal wajib rupiah bulat (min 1) padahal sisa maksimalnya 0,98, dan bayar Rp 1
-- ditolak "melebihi sisa". Faktur selamanya "Berjalan".
--
-- Aturan baru di pay_purchase_invoice_atomic:
--   * Nominal boleh bersen (2 desimal) HANYA bila sama persis dengan sisa faktur (melunasi). Cicilan tetap rupiah bulat.
--   * Jurnal pembayaran memakai nominal persis (bukan dibulatkan): faktur dijurnal dengan total bersen
--     (Cr 2101 3.585.410,98), jadi pelunasan Dr 2101 0,98 menutup saldo hutang pemasok tepat nol.
--     Untuk nominal rupiah bulat, round(p_amount) = p_amount, jadi pembayaran lama tidak berubah sama sekali.
--   * Porsi uang muka sudah bersen sejak 20261023121500 (jurnal & porsi uang muka di pembatalan sudah 2 desimal).
--   * cancel_purchase_payment: nominal pembayaran sumber kini boleh 2 desimal, supaya pelunasan sen tetap bisa dibatalkan
--     / dikoreksi (salah rekening) seperti pembayaran lain. Sebelumnya hanya rupiah bulat yang mungkin tersimpan.
-- Tidak ada fungsi yang ditulis ulang: tambalan berjangkar (jumlah kecocokan pasti atau migrasi berhenti) pada definisi
-- yang berjalan. Tidak ada baris data yang diubah.
set local lock_timeout='5s';
select pg_advisory_xact_lock(hashtextextended('vetos:bayar-hutang-sisa-sen',0));

create function pg_temp.patch_n(p_def text, p_old text, p_new text, p_label text, p_times integer) returns text
language plpgsql as $$
declare n integer;
begin
 if p_old is null or length(p_old)=0 then raise exception 'BAYAR_HUTANG_SEN_ANCHOR_EMPTY %',p_label; end if;
 n:=(length(p_def)-length(replace(p_def,p_old,'')))/length(p_old);
 if n<>p_times then raise exception 'BAYAR_HUTANG_SEN_ANCHOR % ditemukan % kali (seharusnya %); migrasi dihentikan',p_label,n,p_times; end if;
 return replace(p_def,p_old,p_new);
end $$;

do $patch$
declare v text;
begin
 v:=pg_get_functiondef('public.pay_purchase_invoice_atomic(text,uuid,date,numeric,text,text,uuid,uuid,uuid)'::regprocedure);
 -- 1. Validasi awal: terima 2 desimal (bukan sub-sen).
 v:=pg_temp.patch_n(v,$a$p_amount is null or p_amount<>round(p_amount) or p_amount<=0$a$,
  $b$p_amount is null or p_amount<>round(p_amount,2) or p_amount<=0$b$,'validasi sen',1);
 -- 2. Sen hanya untuk melunasi sisa persis.
 v:=pg_temp.patch_n(v,$a$ if p_amount>available then raise exception 'Nominal melebihi sisa faktur setelah pembayaran dan retur' using errcode='22003';end if;$a$,
  $b$ if p_amount>available then raise exception 'Nominal melebihi sisa faktur setelah pembayaran dan retur' using errcode='22003';end if;
 if p_amount<>round(p_amount,0) and p_amount<>available then raise exception 'Nominal bersen hanya untuk melunasi sisa faktur persis (sisa Rp %). Cicilan harus rupiah bulat.',available using errcode='22023';end if;$b$,'sen hanya pelunasan',1);
 -- 3. Jurnal memakai nominal persis (2101 debit, kas kredit).
 v:=pg_temp.patch_n(v,'round(p_amount)','p_amount','jurnal nominal persis',4);
 execute v;

 v:=pg_get_functiondef('public.cancel_purchase_payment(uuid,integer,text,text,date)'::regprocedure);
 v:=pg_temp.patch_n(v,' or amount<>round(amount) or dari_uang_muka<>',' or amount<>round(amount,2) or dari_uang_muka<>','batal sumber sen',1);
 execute v;
end
$patch$;
