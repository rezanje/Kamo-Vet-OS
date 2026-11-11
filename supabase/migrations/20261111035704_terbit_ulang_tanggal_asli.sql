-- Nota klinik yang di-"void & terbitkan ulang" tetap tercatat di tanggal transaksi aslinya.
--
-- Sebelumnya nota pengganti mendapat created_at = waktu terbit ulang, sehingga di daftar faktur,
-- laporan penjualan, komisi, dan omzet tutup shift transaksinya pindah ke hari koreksi. Sementara itu
-- pembukuan tetap menaruh pendapatannya di tanggal asli (jurnal batal dan jurnal terbit ulang di hari
-- koreksi saling meniadakan). Laporan dan pembukuan jadi tidak cocok. (Laporan user Cimanggu, 11 Nov 2026.)
--
-- Perubahan: nota pengganti memakai created_at nota sumber + 1 milidetik (urutan riwayat tetap: sumber lalu
-- pengganti) dan paid_at nota sumber bila lunas. Waktu sebenarnya terbit ulang tetap tercatat di
-- invoices.voided_at nota sumber, invoice_edit_log, invoice_payments.tanggal, dan jurnal (current_date).
-- Jurnal tidak diubah.
do $patch$
declare
  signature regprocedure := to_regprocedure('public.clinic_void_reissue_invoice_core(uuid,text,text)');
  definition text;
  p record;
begin
  if signature is null then raise exception 'clinic_void_reissue_invoice_core tidak ditemukan'; end if;
  definition := pg_get_functiondef(signature);
  for p in select * from (values
    ('reissued_from,request_key,request_hash,correction_pending,shift_cash_carry,service_pricing_version)',
     'reissued_from,request_key,request_hash,correction_pending,shift_cash_carry,service_pricing_version,created_at)'),
    ('v_key,v_hash,true,v_shift_cash,v_invoice.service_pricing_version)',
     'v_key,v_hash,true,v_shift_cash,v_invoice.service_pricing_version,v_invoice.created_at + interval ''1 millisecond'')'),
    ('case when v_paid=v_invoice.total then now() else null end',
     'case when v_paid=v_invoice.total then coalesce(v_invoice.paid_at,now()) else null end')
  ) as t(old_text,new_text) loop
    if (length(definition)-length(replace(definition,p.old_text,'')))/length(p.old_text) <> 1 then
      raise exception 'Jangkar tidak tunggal di clinic_void_reissue_invoice_core: %', p.old_text;
    end if;
    definition := replace(definition,p.old_text,p.new_text);
  end loop;
  execute definition;
end $patch$;

-- Satu-satunya nota terbit ulang sebelum perbaikan ini (INV-202611-0746 dari INV-202611-0707): samakan tanggalnya.
update public.invoices n
   set created_at = o.created_at + interval '1 millisecond',
       paid_at = case when n.paid_status='Lunas' then coalesce(o.paid_at, n.paid_at) else n.paid_at end
  from public.invoices o
 where o.id = n.reissued_from
   and (n.created_at at time zone 'Asia/Jakarta')::date <> (o.created_at at time zone 'Asia/Jakarta')::date;

do $check$
declare d text := pg_get_functiondef('public.clinic_void_reissue_invoice_core(uuid,text,text)'::regprocedure);
begin
  if position('v_invoice.created_at + interval' in d)=0 or position('coalesce(v_invoice.paid_at,now())' in d)=0
     or position('SECURITY DEFINER' in d)=0 then
    raise exception 'Terbit ulang belum memakai tanggal asli';
  end if;
  if exists(select 1 from public.invoices n join public.invoices o on o.id=n.reissued_from
            where (n.created_at at time zone 'Asia/Jakarta')::date <> (o.created_at at time zone 'Asia/Jakarta')::date) then
    raise exception 'Masih ada nota terbit ulang di tanggal berbeda';
  end if;
end $check$;
