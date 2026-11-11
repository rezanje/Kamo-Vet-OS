-- Batch 2 (11 Nov 2026, permintaan user Cimanggu lewat Reza): isi dokter di nota lunas tanpa void.
--   INV-202611-0708 -> drh. Cornelia Istyani Hapsari
--   INV-202611-0710 -> drh. Heppy Fani Krismaningrum
--   INV-202611-0711 -> drh. Nurseta Rais Mahendra ("rais mahendra")
-- Non-dokter tidak disebut, jadi dibiarkan kosong. Metode sama dengan apply.sql.
do $$
declare r record; v_pf jsonb; n int;
begin
  alter table public.invoice_items disable trigger service_line_performers;
  for r in select * from (values
    ('f0597f23-f455-4afe-b470-7a7d3ef3ee41'::uuid,'INV-202611-0708','24e9dc1e-0833-4a4f-afd7-6c218081855e',6),
    ('20dade5f-b454-439e-9350-a91eb85cca9b'::uuid,'INV-202611-0710','85eaa739-c588-4acf-a3c6-4fb5d9989c01',6),
    ('19b57074-8f89-446f-92d6-c594c3e93b92'::uuid,'INV-202611-0711','1485fb6b-0803-4c11-8224-f8ff3d54e56c',3)
  ) as t(inv,no,doctor,lines) loop
    perform 1 from invoices where id=r.inv and invoice_no=r.no and voided_at is null and not correction_pending for update;
    if not found then raise exception 'Nota % berubah', r.no; end if;
    if exists(select 1 from invoice_items where invoice_id=r.inv
        and (nullif(service_performers->>'doctor_id','') is not null or nullif(service_performers->>'staff_id','') is not null)) then
      raise exception 'Nota % sudah punya pelaksana', r.no;
    end if;
    v_pf := public.normalize_service_performers(jsonb_build_object('doctor_id',r.doctor,'staff_id',null),
      '3c9fa638-c99d-4bb7-925b-e28b6bdb4564');
    update invoice_items set service_performers=v_pf where invoice_id=r.inv;
    get diagnostics n=row_count; if n<>r.lines then raise exception 'Nota % baris %', r.no, n; end if;
  end loop;
  alter table public.invoice_items enable trigger service_line_performers;
end $$;
