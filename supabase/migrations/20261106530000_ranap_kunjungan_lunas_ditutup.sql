-- Kunjungan rawat inap yang sudah lunas dan sudah pulang tetap "Pembayaran" (4 Nov 2026).
--
-- Laporan Anisa (TKI): CHLOE (TKI-A003, 1 Nov) dan CHEETOZ (TKI-A001, 2 Nov) masih minta
-- Bayar di Antrian padahal seluruh tagihannya Lunas. Production 4 Nov: 8 kunjungan rawat
-- inap (TKI 2, Cimanggu 6) dalam keadaan sama. Dua jalur yang meninggalkannya terbuka:
--
-- 1. Bayar SEBELUM pulang. clinic_receive_visit_payment hanya menutup kunjungan bila tidak
--    ada rawat inap aktif. Pasien yang dibayar lunas lalu dipulangkan beberapa menit/jam
--    kemudian tidak pernah ditutup, karena clinic_change_inpatient_condition (satu-satunya
--    penulis discharged_at) tidak menyentuh status kunjungan.
-- 2. "Simpan & bayar" tagihan rawat inap (clinic_bill_and_pay_inpatient) SESUDAH pulang.
--    Kwitansi diterima lebih dulu, saat tahap barunya belum terbit: uangnya menjadi uang
--    muka pemilik dan tidak ada tagihan yang lunas di langkah itu. Tahap baru lalu terbit
--    dan dilunasi dari uang muka tersebut, tetapi tidak ada langkah yang menutup kunjungan.
--
-- Perbaikan: satu aturan penutupan, dipanggil di akhir kedua jalur itu.
-- Kunjungan ditutup (status 'Selesai') hanya bila SEMUA ini benar:
--   - belum Selesai dan tidak diarsipkan;
--   - tidak ada rawat inap yang belum pulang;
--   - ada minimal satu tagihan aktif, semuanya Lunas, tidak ada yang menunggu koreksi;
--   - tidak ada baris rekam medis yang belum ditagih (baris yang dikeluarkan kasir dari
--     keranjang, billing_withdrawn_at, tidak dihitung; predikatnya sama dengan
--     clinic_private.inpatient_payment_quote). Jadi tarif rawat inap otomatis yang dibuat
--     saat pulang tetap membuat pasien muncul di Bayar sampai ditagih.
-- Sama seperti penutupan di clinic_receive_visit_payment, yang diubah hanya status;
-- checked_out_at dibiarkan.
--
-- Fungsi yang ditambal memakai pola anchored replace: gagal keras bila definisinya sudah
-- berubah dari teks yang ditinjau. Signature, SECURITY DEFINER, search_path dan grant tetap.
-- Aman dijalankan ulang: tambalan yang sudah terpasang dilewati.

create or replace function clinic_private.close_settled_visit(p_visit_id uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  update public.visits v set status = 'Selesai'
  where v.id = p_visit_id
    and v.status <> 'Selesai'
    and v.archived_at is null
    and not exists (select 1 from public.inpatient_records r
      where r.visit_id = v.id and r.discharged_at is null)
    and exists (select 1 from public.invoices i
      where i.visit_id = v.id and i.voided_at is null)
    and not exists (select 1 from public.invoices i
      where i.visit_id = v.id and i.voided_at is null
        and (i.paid_status <> 'Lunas' or i.correction_pending))
    and not exists (select 1 from public.prescription_items pi
      join public.medical_records mr on mr.id = pi.medical_record_id
      where mr.visit_id = v.id and pi.billing_withdrawn_at is null
        and not exists (select 1 from public.invoice_items ii
          join public.invoices i on i.id = ii.invoice_id
          where ii.prescription_item_id = pi.id and i.voided_at is null));
  return found;
end $$;
revoke all on function clinic_private.close_settled_visit(uuid)
  from public, anon, authenticated, service_role;

do $ranap_tutup$
declare
  p record;
  definition text;
begin
  for p in select * from (values
    -- Jalur 1: pulang sesudah lunas.
    ('public.clinic_change_inpatient_condition(uuid,text,text)',
     E'  return true;\nend;',
     E'  -- RANAP_CLOSE_SETTLED: pulang sesudah lunas menutup kunjungan.\n'
     || E'  if v_discharged_at is not null then\n'
     || E'    perform clinic_private.close_settled_visit(v_record.visit_id);\n'
     || E'  end if;\n'
     || E'  return true;\nend;'),
    -- Jalur 2: simpan & bayar yang melunasi tahap terakhir lewat uang muka.
    ('public.clinic_bill_and_pay_inpatient(uuid,uuid,text,date,jsonb,text,boolean,text)',
     E'  result:=jsonb_build_object(''status'',''SAVED'',',
     E'  -- RANAP_CLOSE_SETTLED: tahap terakhir lunas dan pasien sudah pulang.\n'
     || E'  perform clinic_private.close_settled_visit(p_visit_id);\n'
     || E'  result:=jsonb_build_object(''status'',''SAVED'',')
  ) as patches(sig, old_text, new_text) loop
    definition := pg_get_functiondef(p.sig::regprocedure);
    if position('RANAP_CLOSE_SETTLED' in definition) > 0 then
      continue;
    end if;
    if (length(definition) - length(replace(definition, p.old_text, ''))) / length(p.old_text) <> 1 then
      raise exception 'RANAP_CLOSE_DRIFT: % changed; review before release', p.sig;
    end if;
    execute replace(definition, p.old_text, p.new_text);
  end loop;
end $ranap_tutup$;
revoke all on function public.clinic_change_inpatient_condition(uuid,text,text)
  from public, anon, service_role;
grant execute on function public.clinic_change_inpatient_condition(uuid,text,text) to authenticated;
revoke all on function public.clinic_bill_and_pay_inpatient(uuid,uuid,text,date,jsonb,text,boolean,text)
  from public, anon, service_role;
grant execute on function public.clinic_bill_and_pay_inpatient(uuid,uuid,text,date,jsonb,text,boolean,text)
  to authenticated;

-- Pemulihan data: kunjungan rawat inap yang sudah memenuhi aturan di atas tetapi masih
-- terbuka. Production 4 Nov: 8 kunjungan, semuanya sudah pulang dan seluruh tagihannya
-- Lunas; baris yang belum tertagih hanyalah baris yang dikeluarkan kasir dari keranjang.
-- Hanya kunjungan yang punya rawat inap; rawat jalan tidak disentuh.
do $ranap_pulihkan$
declare
  v_id uuid;
  v_closed integer := 0;
begin
  for v_id in
    select v.id from public.visits v
    where v.status <> 'Selesai'
      and exists (select 1 from public.inpatient_records r where r.visit_id = v.id)
    order by v.created_at, v.id
  loop
    if clinic_private.close_settled_visit(v_id) then
      v_closed := v_closed + 1;
    end if;
  end loop;
  raise notice 'RANAP_CLOSE_SETTLED: % kunjungan rawat inap lunas ditutup', v_closed;
end $ranap_pulihkan$;
