-- C05 follow-up (audit 29 Oct): campaign codes in clinic group payment (pembayaran rombongan).
-- The back-office POS (/pos/transaksi) needs no database change: it writes sales rows, which the
-- existing C05 triggers already guard and count (cap at write + authoritative re-check at payment).
--
-- Rule for a group payment: one owner (customer) paying several visits in one go on one day
-- (Asia/Jakarta) uses a campaign code ONCE, like the voucher in that flow ("satu kedatangan =
-- satu kali pakai kode"). Every group invoice that carries the code also carries
-- campaign_group = '<customer_id>:<YYYY-MM-DD WIB>'; usage counts DISTINCT groups, so:
--   * the first group invoice takes one use (cap checked as usual, row lock serializes it);
--   * later invoices of the same group join that use and are not refused by the cap;
--   * a retry (same request key) replays the stored invoice and adds nothing; a new attempt for
--     the remaining pets on the same day joins the same group;
--   * a void frees the use only when no live invoice of that group still carries the code;
--     a clinic void+reissue inherits the group (never counted twice).
-- The group key is not free text: the database accepts only the key derived from the invoice's
-- own visit owner and today's WIB date, so a key cannot be borrowed to dodge the cap.
-- Per-visit checkouts and POS receipts keep one use per document (campaign_group stays null).

alter table public.invoices add column if not exists campaign_group varchar(60);
comment on column public.invoices.campaign_group is
  'C05: group-payment key (<customer_id>:<YYYY-MM-DD WIB>) shared by invoices of one rombongan payment; the group counts as one campaign-code use.';
do $c$
begin
  if not exists (select 1 from pg_constraint where conname = 'invoices_campaign_group_needs_code'
                 and conrelid = 'public.invoices'::regclass) then
    alter table public.invoices add constraint invoices_campaign_group_needs_code
      check (campaign_group is null or campaign_code is not null);
  end if;
end
$c$;
create index if not exists invoices_campaign_group_idx on public.invoices (campaign_code, campaign_group)
  where campaign_group is not null;

-- Anchored patches: each anchor must appear exactly once in the C05 definition, otherwise the
-- migration stops (someone changed the function; review before release). Re-runs are no-ops.
do $patch$
declare
  d text;
  a_old text; a_new text;
  anchors text[][];
  i int;
begin
  -- 1) Usage = finalized receipts + DISTINCT live invoice groups (an ungrouped invoice is its own group).
  d := pg_get_functiondef('public.campaign_code_used(text)'::regprocedure);
  if position('campaign_group' in d) = 0 then
    a_old := '+ (select count(*) from public.invoices i where i.campaign_code = p_code and i.voided_at is null)';
    a_new := '+ (select count(distinct coalesce(i.campaign_group, i.id::text)) from public.invoices i where i.campaign_code = p_code and i.voided_at is null)';
    if (length(d) - length(replace(d, a_old, ''))) / length(a_old) <> 1 then
      raise exception 'C05_GROUP_DRIFT: campaign_code_used changed; review before release';
    end if;
    execute replace(d, a_old, a_new);
  end if;

  -- 2) Guard: immutable group, reissue inherits it, derived key only, group members share one use.
  d := pg_get_functiondef('public.guard_campaign_code_use()'::regprocedure);
  if position('campaign_group' in d) = 0 then
    anchors := array[
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
    for i in 1 .. array_length(anchors, 1) loop
      if (length(d) - length(replace(d, anchors[i][1], ''))) / length(anchors[i][1]) <> 1 then
        raise exception 'C05_GROUP_DRIFT: guard_campaign_code_use anchor % changed; review before release', i;
      end if;
    end loop;
    for i in 1 .. array_length(anchors, 1) loop
      d := replace(d, anchors[i][1], anchors[i][2]);
    end loop;
    execute d;
  end if;

  -- 3) Clinic posting stores the group key inside its own atomic invoice insert (next to C05's code).
  d := pg_get_functiondef('public.clinic_post_invoice(uuid,text,jsonb,jsonb)'::regprocedure);
  if position('campaign_group' in d) = 0 then
    a_old := 'paid_status, metode_bayar, paid_at, shift_id, voucher_code, salesperson_id, service_pricing_version, campaign_code';
    a_new := E'nullif(p_invoice->>''campaign_code'','''')';
    if (length(d) - length(replace(d, a_old, ''))) / length(a_old) <> 1
       or (length(d) - length(replace(d, a_new, ''))) / length(a_new) <> 1 then
      raise exception 'C05_GROUP_DRIFT: clinic_post_invoice changed; review before release';
    end if;
    d := replace(d, a_old, a_old || ', campaign_group');
    d := replace(d, a_new, a_new || E', nullif(p_invoice->>''campaign_group'','''')');
    execute d;
  end if;
end
$patch$;

-- The group key is immutable like the code itself: the guard must also see updates of it.
drop trigger if exists c05_invoice_campaign_code on public.invoices;
create trigger c05_invoice_campaign_code before insert or update of campaign_code, voucher_code, campaign_group
  on public.invoices for each row execute function public.guard_campaign_code_use();
