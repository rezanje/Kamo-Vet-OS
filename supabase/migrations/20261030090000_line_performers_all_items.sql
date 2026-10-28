-- Atribusi per baris "Dokter + Non-dokter" berlaku untuk SEMUA baris transaksi,
-- bukan hanya item Jasa (permintaan Andri). Baris barang biasa (obat, pakan, barang)
-- kini boleh menyimpan service_performers, dinormalisasi lewat normalize_service_performers
-- persis seperti baris jasa.
--
-- Tidak ada backfill: baris lama tetap NULL, dan baris barang tanpa pelaksana tetap NULL
-- supaya atribusi dokumen lama (salesperson_id invoice/struk) tidak berubah artinya.
-- Migrasi lama tidak diubah; definisi berjalan ditambal dengan jangkar eksak dan
-- gagal tertutup bila definisinya tidak seperti yang diharapkan.
do $patch$
declare p record; definition text; signature regprocedure;
begin
 for p in select * from (values
 -- 1. Baris non-jasa tidak lagi ditolak; lanjut ke penanganan sumber & normalisasi di bawah.
 ('public.guard_service_line_performers()',
  E' if coalesce(v_service,false)=false then\n  if nullif(new.service_performers->>''doctor_id'','''') is not null or nullif(new.service_performers->>''staff_id'','''') is not null then\n   raise exception using errcode=''P0001'',message=''CARE_INVALID: pelaksana per baris hanya untuk item Jasa'';\n  end if;\n  new.service_performers:=null;return new;\n end if;\n if tg_table_name=''invoice_items'' then',
  E' if tg_table_name=''invoice_items'' then'),
 -- 2. Koreksi/terbit ulang mewarisi baris sumber yang sejenis, bukan selalu jasa.
 ('public.guard_service_line_performers()',
  E'    and jenis=''jasa'' for share;',
  E'    and jenis=new.jenis for share;'),
 -- 3. Normalisasi untuk semua jenis baris; racikan mengambil pelaksana dari RPC-nya.
 ('public.guard_service_line_performers()',
  E' new.service_performers:=public.normalize_service_performers(new.service_performers,v_branch);',
  E' if coalesce(v_service,false)=false then\n  if tg_table_name=''prescription_items'' then\n   -- Baris racikan dibuat di dalam RPC racikan; atribusinya dititipkan lewat setelan transaksi.\n   if new.service_performers is null and new.item_id is null and new.satuan=''racikan'' then\n    begin new.service_performers:=nullif(current_setting(''kamo.clinic_compound_performers'',true),'''')::jsonb;\n    exception when invalid_text_representation then\n     raise exception using errcode=''P0001'',message=''CARE_INVALID: pelaksana racikan tidak valid'';\n    end;\n   end if;\n  end if;\n  -- Baris barang tanpa nama pelaksana tetap NULL seperti sebelum fitur ini.\n  if nullif(new.service_performers->>''doctor_id'','''') is null and nullif(new.service_performers->>''staff_id'','''') is null then\n   new.service_performers:=null;return new;\n  end if;\n end if;\n new.service_performers:=public.normalize_service_performers(new.service_performers,v_branch);'),
 -- 4-7. RPC rekam medis & rawat inap menitipkan pelaksana racikan seperti penjual racikan.
 ('public.clinic_save_initial_record(uuid,uuid,jsonb,jsonb,jsonb,jsonb,uuid,uuid,text,text,text)',
  E'perform set_config(''kamo.clinic_compound_seller'',coalesce(v_row->>''salesperson_id'',''''),true);',
  E'perform set_config(''kamo.clinic_compound_seller'',coalesce(v_row->>''salesperson_id'',''''),true);\n    perform set_config(''kamo.clinic_compound_performers'',coalesce(v_row->>''service_performers'',''''),true);'),
 ('public.clinic_save_initial_record(uuid,uuid,jsonb,jsonb,jsonb,jsonb,uuid,uuid,text,text,text)',
  E'perform set_config(''kamo.clinic_compound_seller'','''',true);',
  E'perform set_config(''kamo.clinic_compound_seller'','''',true);\n    perform set_config(''kamo.clinic_compound_performers'','''',true);'),
 ('public.clinic_save_inpatient_log(uuid,uuid,jsonb,jsonb,jsonb,text)',
  E'perform set_config(''kamo.clinic_compound_seller'',coalesce(v_row->>''salesperson_id'',''''),true);',
  E'perform set_config(''kamo.clinic_compound_seller'',coalesce(v_row->>''salesperson_id'',''''),true);\n    perform set_config(''kamo.clinic_compound_performers'',coalesce(v_row->>''service_performers'',''''),true);'),
 ('public.clinic_save_inpatient_log(uuid,uuid,jsonb,jsonb,jsonb,text)',
  E'perform set_config(''kamo.clinic_compound_seller'','''',true);',
  E'perform set_config(''kamo.clinic_compound_seller'','''',true);\n    perform set_config(''kamo.clinic_compound_performers'','''',true);')
 ) as patches(sig,old_text,new_text) loop
  signature:=to_regprocedure(p.sig);
  if signature is null then raise exception 'Atribusi per baris: RPC wajib tidak ada: %',p.sig;end if;
  definition:=pg_get_functiondef(signature);
  if (length(definition)-length(replace(definition,p.old_text,'')))/length(p.old_text)<>1 then
   raise exception 'Atribusi per baris: jangkar harus muncul tepat sekali di %; periksa definisi sebelum menerapkan',p.sig;
  end if;
  execute replace(definition,p.old_text,p.new_text);
 end loop;
end $patch$;

-- ACL tetap seperti definisi aslinya: fungsi hanya dipanggil oleh trigger/RPC-nya sendiri.
revoke all on function public.guard_service_line_performers() from public,anon,authenticated,service_role;

do $check$
begin
 if position('pelaksana per baris hanya untuk item Jasa' in pg_get_functiondef('public.guard_service_line_performers()'::regprocedure))>0 then
  raise exception 'Atribusi per baris: penolakan item non-Jasa masih tersisa';
 end if;
end $check$;
