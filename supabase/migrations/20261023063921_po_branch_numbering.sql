-- N02: new PO numbers identify the authoritative destination branch.
-- Patch only the guarded creator body; retain signature/owner/ACL/access/replay.
-- No existing number, numbering setting, branch code or financial row is changed.
do $migration$
declare
 body text:=pg_get_functiondef('public.create_purchase_order_atomic(text,text,integer,uuid,uuid,uuid,date,jsonb)'::regprocedure);
 declaration text:='  v_qty numeric; v_price numeric; v_factor numeric; v_unit_name text;';
 anchor text:=$old$  if p_no_po_prefix is null or length(p_no_po_prefix)=0 or length(p_no_po_prefix)+p_no_po_digits>30 then raise exception 'Format nomor PO tidak valid'; end if;$old$;
 replacement text:=$new$  if p_no_po_prefix is null or length(p_no_po_prefix)=0 then raise exception 'Format nomor PO tidak valid'using errcode='22023';end if;
  -- Exact request replay already returned above. Read and lock the current code
  -- only for a genuinely new request; concurrent master edits serialize here.
  select code into v_branch_code from public.branches where id=p_branch_id and is_active for share;
  if not found or v_branch_code!~'[^[:space:]]'or v_branch_code~'[[:cntrl:]]'then
    raise exception 'Kode cabang PO kosong atau tidak valid; periksa master cabang'using errcode='22023';
  end if;
  -- Existing allocation uses left(...)=prefix, not LIKE: master punctuation
  -- such as underscore and percent is literal and must not be renamed/rejected.
  p_no_po_prefix:=p_no_po_prefix||v_branch_code||'-';
  if length(p_no_po_prefix)+p_no_po_digits>30 then
    raise exception 'Nomor PO dengan kode cabang melebihi 30 karakter; pendekkan awalan atau jumlah digit pada Penomoran Dokumen'using errcode='22023';
  end if;$new$;
begin
 if(length(body)-length(replace(body,declaration,'')))/length(declaration)<>1
 or(length(body)-length(replace(body,anchor,'')))/length(anchor)<>1 then
  raise exception 'PO creator definition differs from reviewed baseline; inspect before N02 migration';
 end if;
 body:=replace(body,declaration,declaration||E'\n  v_branch_code text;');
 body:=replace(body,anchor,replacement);
 execute body;
end;
$migration$;
