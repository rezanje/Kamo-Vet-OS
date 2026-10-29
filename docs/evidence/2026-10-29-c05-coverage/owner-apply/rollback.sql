-- C05 follow-up rollback. WRITES. Run only if the owner decides to undo this step (the base C05 step stays).
-- Restores campaign_code_used, guard_campaign_code_use and clinic_post_invoice byte-for-byte to their
-- pre-apply text and the invoice trigger to its C05 column list. The group-key column is archived
-- (renamed) when it holds data, unless the owner sets the explicit flag below in the same session:
--   select set_config('vetos.rollback_drop_data', 'yes', false);
-- Consequence after rollback: invoices of an earlier group payment count one use EACH again, so a capped
-- code may show more uses than its cap (no new use is accepted until enough are voided or the cap raised).
begin;

drop trigger if exists c05_invoice_campaign_code on public.invoices;
create trigger c05_invoice_campaign_code before insert or update of campaign_code, voucher_code on public.invoices
  for each row execute function public.guard_campaign_code_use();

do $restore$
declare
  d text;
  pairs text[][] := array[
    array['src_id uuid; src_code text; src_voucher text;',
          'src_id uuid; src_code text; src_voucher text; src_group text; v_group_live boolean := false;'],
    array[E'    if new.campaign_code is distinct from old.campaign_code then\n',
          E'    if to_jsonb(new) ->> ''campaign_group'' is distinct from to_jsonb(old) ->> ''campaign_group'' then\n'
       || E'      raise exception ''KODE_KAMPANYE: Grup pemakaian kode kampanye tidak boleh diubah'' using errcode = ''23514'';\n'
       || E'    end if;\n'
       || E'    if new.campaign_code is distinct from old.campaign_code then\n'],
    array[E'    select i.campaign_code, i.voucher_code into src_code, src_voucher\n',
          E'    select i.campaign_code, i.voucher_code, i.campaign_group into src_code, src_voucher, src_group\n'],
    array[E'    if new.campaign_code is null then new.campaign_code := src_code; end if;\n',
          E'    if new.campaign_code is null then new.campaign_code := src_code; end if;\n'
       || E'    if new.campaign_group is null then new.campaign_group := src_group; end if;\n'
       || E'    if new.campaign_group is distinct from src_group then\n'
       || E'      raise exception ''KODE_KAMPANYE: Penerbitan ulang tidak boleh mengganti grup kode kampanye'' using errcode = ''23514'';\n'
       || E'    end if;\n'],
    array[E'  if k.max_uses is not null then\n    v_used := public.campaign_code_used(k.code);\n',
          E'  -- Group payment (C05 follow-up): the key must be this visit owner''s key for today (WIB);\n'
       || E'  -- a group that already holds a live invoice with this code has already taken its use.\n'
       || E'  if to_jsonb(new) ->> ''campaign_group'' is not null then\n'
       || E'    if new.campaign_group is distinct from ((select v.customer_id::text from public.visits v where v.id = new.visit_id)\n'
       || E'         || '':'' || to_char(now() at time zone ''Asia/Jakarta'', ''YYYY-MM-DD'')) then\n'
       || E'      raise exception ''KODE_KAMPANYE: Grup pembayaran kode % tidak cocok dengan pemilik atau tanggal hari ini'', k.code\n'
       || E'        using errcode = ''23514'';\n'
       || E'    end if;\n'
       || E'    v_group_live := exists (select 1 from public.invoices i where i.campaign_code = new.campaign_code\n'
       || E'      and i.campaign_group = new.campaign_group and i.voided_at is null);\n'
       || E'  end if;\n'
       || E'  if k.max_uses is not null and not v_group_live then\n    v_used := public.campaign_code_used(k.code);\n']
  ];
  i int;
begin
  d := pg_get_functiondef('public.guard_campaign_code_use()'::regprocedure);
  if position('campaign_group' in d) > 0 then
    for i in reverse array_length(pairs, 1) .. 1 loop
      if position(pairs[i][2] in d) = 0 then
        raise exception 'C05_GROUP_ROLLBACK_DRIFT: guard_campaign_code_use piece % not found; restore manually', i;
      end if;
      d := replace(d, pairs[i][2], pairs[i][1]);
    end loop;
    execute d;
  end if;

  d := pg_get_functiondef('public.campaign_code_used(text)'::regprocedure);
  if position('campaign_group' in d) > 0 then
    execute replace(d,
      '+ (select count(distinct coalesce(i.campaign_group, i.id::text)) from public.invoices i where i.campaign_code = p_code and i.voided_at is null)',
      '+ (select count(*) from public.invoices i where i.campaign_code = p_code and i.voided_at is null)');
  end if;

  d := pg_get_functiondef('public.clinic_post_invoice(uuid,text,jsonb,jsonb)'::regprocedure);
  if position('campaign_group' in d) > 0 then
    d := replace(d, 'service_pricing_version, campaign_code, campaign_group', 'service_pricing_version, campaign_code');
    d := replace(d, E', nullif(p_invoice->>''campaign_group'','''')', '');
    execute d;
  end if;
end
$restore$;

drop index if exists public.invoices_campaign_group_idx;
alter table public.invoices drop constraint if exists invoices_campaign_group_needs_code;
do $data$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'invoices'
             and column_name = 'campaign_group') then
    if exists (select 1 from public.invoices where campaign_group is not null)
       and coalesce(current_setting('vetos.rollback_drop_data', true), '') <> 'yes' then
      alter table public.invoices rename column campaign_group to campaign_group_archived_c05cov;
      raise notice 'kept data: public.invoices.campaign_group renamed to campaign_group_archived_c05cov';
    else
      alter table public.invoices drop column campaign_group;
    end if;
  end if;
end
$data$;

commit;
