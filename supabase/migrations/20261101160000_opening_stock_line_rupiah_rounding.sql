-- M04/M01 keputusan pemilik 29 Okt: nilai persediaan awal dibulatkan ke rupiah penuh PER BARIS
-- saat batch disiapkan; selisih total terhadap nilai sumber dicatat di batch.
-- Hanya fungsi persiapan (batch yang belum diposting) yang berubah. Preview/posting,
-- kunci posting sekali (20261021123000), dan semua batch yang sudah tersimpan/diposting tidak disentuh.
-- Jurnal tetap Dr 1301 / Cr ekuitas sebesar nilai yang diposting (seimbang sendiri), jadi tidak
-- perlu akun selisih pembulatan; selisih terhadap sumber tersimpan di summary.valuation batch dan
-- ikut tersalin ke bukti posting (accurate_inventory_accounting.preview.evidence.summary).
create function pg_temp.patch_line_rounding(p_function regprocedure,p_old text,p_new text)
returns void language plpgsql as $patch$
declare definition text:=pg_get_functiondef(p_function);
begin
 if (length(definition)-length(replace(definition,p_old,'')))/length(p_old)<>1 then
  raise exception 'Line rounding anchor mismatch: % / %',p_function,left(p_old,100);
 end if;
 execute replace(definition,p_old,p_new);
end;
$patch$;

select pg_temp.patch_line_rounding('public.prepare_accurate_initial_stock(text,text,uuid,uuid,date,jsonb,text)'::regprocedure,
$old$ n int:=0; skipped int:=0; rejected int:=0; total_qty numeric:=0; has_history int:=0;$old$,
$new$ n int:=0; skipped int:=0; rejected int:=0; total_qty numeric:=0; has_history int:=0;
 line_value numeric; hi_qty numeric; source_lines int:=0; split_lines int:=0;$new$);

select pg_temp.patch_line_rounding('public.prepare_accurate_initial_stock(text,text,uuid,uuid,date,jsonb,text)'::regprocedure,
$old$ or p_policy not in ('STRICT','HALF_UP_BATCH_V1') or p_policy is null$old$,
$new$ or p_policy not in ('STRICT','HALF_UP_BATCH_V1','ROUND_LINE_RUPIAH_V1') or p_policy is null$new$);

select pg_temp.patch_line_rounding('public.prepare_accurate_initial_stock(text,text,uuid,uuid,date,jsonb,text)'::regprocedure,
$old$   payload:=payload||jsonb_build_object('base_qty',row_qty::text,'base_unit_cost',rate::text,
    'source_value',row_source::text,'original_base_unit_cost',rate::text,'normalization_policy',p_policy);
   source_value:=source_value+row_source;posted_value:=posted_value+row_qty*rate;total_qty:=total_qty+row_qty;n:=n+1;$old$,
$new$   if p_policy='ROUND_LINE_RUPIAH_V1' then
    -- Nilai baris = round(qty*HPP sumber) HALF_UP ke rupiah penuh; HPP dasar diturunkan dari nilai itu.
    line_value:=round(row_source,0);
    payload:=payload||jsonb_build_object('source_value',row_source::text,'line_value',line_value::text,
     'line_rounding',(line_value-row_source)::text,'line_qty',row_qty::text,
     'original_base_unit_cost',rate::text,'normalization_policy',p_policy);
    rate:=trunc(line_value::numeric(200,100)/row_qty,60);
    if row_qty*rate<>line_value then
     -- Nilai/qty tanpa desimal berhingga (mis. Rp10/3): baris dibawa tepat oleh dua layer lot yang sama
     -- dengan HPP sen r+0,01 dan r. Keduanya memakai source_row yang sama dan ditandai line_part.
     rate:=round(floor((line_value*100)::numeric(200,100)/row_qty)/100,2);
     hi_qty:=line_value*100-row_qty*rate*100;
     if hi_qty<=0 or hi_qty>=row_qty or hi_qty*(rate+0.01)+(row_qty-hi_qty)*rate<>line_value then
      raise exception 'Nilai baris % tidak dapat dibawa tepat dalam rupiah penuh. Perbaiki nilai sumber.',x->>'source_row' using errcode='22023';end if;
     prepared:=prepared||jsonb_build_array(x||jsonb_build_object('payload',payload||jsonb_build_object(
      'base_qty',hi_qty::text,'base_unit_cost',(rate+0.01)::text,'line_part',1)));
     n:=n+1;split_lines:=split_lines+1;
     payload:=payload||jsonb_build_object('base_qty',(row_qty-hi_qty)::text,'base_unit_cost',rate::text,'line_part',2);
    else
     payload:=payload||jsonb_build_object('base_qty',row_qty::text,'base_unit_cost',rate::text);
    end if;
    source_value:=source_value+row_source;posted_value:=posted_value+line_value;total_qty:=total_qty+row_qty;n:=n+1;
   else
   payload:=payload||jsonb_build_object('base_qty',row_qty::text,'base_unit_cost',rate::text,
    'source_value',row_source::text,'original_base_unit_cost',rate::text,'normalization_policy',p_policy);
   source_value:=source_value+row_source;posted_value:=posted_value+row_qty*rate;total_qty:=total_qty+row_qty;n:=n+1;
   end if;
   source_lines:=source_lines+1;$new$);

select pg_temp.patch_line_rounding('public.prepare_accurate_initial_stock(text,text,uuid,uuid,date,jsonb,text)'::regprocedure,
$old$ 'control','computed_from_source_not_authoritative')))$old$,
$new$ 'control','computed_from_source_not_authoritative',
 'rounding_difference',(posted_value-source_value)::text,'source_lines',source_lines,
 'line_rounding',case when p_policy='ROUND_LINE_RUPIAH_V1' then jsonb_build_object('unit','1','mode','HALF_UP','split_lines',split_lines) end)))$new$);
