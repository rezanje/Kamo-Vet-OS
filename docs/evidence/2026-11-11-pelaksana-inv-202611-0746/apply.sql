-- Koreksi data: pelaksana nota klinik INV-202611-0746 (terbit ulang dari INV-202611-0707, Kamo Pets Clinic Cimanggu).
-- Permintaan user lewat Reza (11 Nov 2026): dokter = drh. Novia. Non-dokter tidak disebut, jadi dibiarkan kosong.
-- Layar koreksi belum bisa mengganti pelaksana (dikerjakan di PR yang sama, poin B), jadi diisi langsung.
-- Snapshot dibentuk lewat normalize_service_performers (cek karyawan aktif, cabang, dan jabatan dokter).
-- Trigger service_line_performers menolak UPDATE atribusi; trigger itu dimatikan hanya di dalam transaksi ini.
do $$
declare v_inv constant uuid := 'add8d30a-a058-4e86-924c-5331cf05fc24'; v_pf jsonb; n int;
begin
  perform 1 from invoices where id=v_inv and invoice_no='INV-202611-0746' and voided_at is null for update;
  if not found then raise exception 'Nota berubah'; end if;
  if exists(select 1 from invoice_items where invoice_id=v_inv
      and (nullif(service_performers->>'doctor_id','') is not null or nullif(service_performers->>'staff_id','') is not null)) then
    raise exception 'Sudah ada pelaksana terisi; periksa ulang';
  end if;
  v_pf := public.normalize_service_performers(
    jsonb_build_object('doctor_id','77d1ecea-4ddd-4f0c-8fe6-cac1a692baf7','staff_id',null),
    '3c9fa638-c99d-4bb7-925b-e28b6bdb4564');
  alter table public.invoice_items disable trigger service_line_performers;
  update invoice_items set service_performers=v_pf where invoice_id=v_inv;
  get diagnostics n=row_count; if n<>7 then raise exception 'baris %',n; end if;
  alter table public.invoice_items enable trigger service_line_performers;
end $$;
