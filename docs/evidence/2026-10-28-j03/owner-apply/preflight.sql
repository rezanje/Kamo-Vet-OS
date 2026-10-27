-- J03 PREFLIGHT — READ ONLY. Run as one query; every row must show ok = true.
with checks(name, ok) as (values
 ('source core still has the original line filter (K02 text)',
  position($o$or x.compound_recipe_id is not null or x.bmhp_components is not null or(x.jenis='obat'and(x.item_id is null or x.faktor is null$o$
   in pg_get_functiondef('public.clinic_refund_source_core(uuid)'::regprocedure))>0),
 ('source core still has the original stock loop',
  position($o$where invoice_id=i.id and jenis='obat'group by item_id loop$o$ in pg_get_functiondef('public.clinic_refund_source_core(uuid)'::regprocedure))>0),
 ('petshop quote still refuses point sources (to be lifted)',
  position($o$raise exception 'Transaksi berpoin memerlukan rekonsiliasi pembalikan poin. Refund baru belum diposting';$o$
   in pg_get_functiondef('public.sales_refund_quote(uuid,jsonb,uuid)'::regprocedure))>0),
 ('petshop payout insert text unchanged',
  position($o$values(p_doc,p_sale.id,p_sale.branch_id,method,expense,request.id,to_jsonb(account),p_total,auth.uid());$o$
   in pg_get_functiondef('public.pos_sale_post_refund_selected(public.sales,uuid,text,date,numeric,jsonb,text,jsonb)'::regprocedure))>0),
 ('customer spending clinic loop unchanged',
  position($o$for s in select i.total from public.invoices i join public.visits v on v.id=i.visit_id$o$
   in pg_get_functiondef('public.refresh_customer_spending(uuid)'::regprocedure))>0),
 ('J03 tables not installed yet', to_regclass('public.clinic_refunds') is null and to_regclass('public.clinic_refund_requests') is null),
 ('required accounts active (4201 4102 2201 1301 5101 5902)',
  (select count(*) from public.coa_accounts where code in('4201','4102','2201','1301','5101','5902') and is_active and not is_header)=6),
 ('Tunai mapped to an active cash account',
  exists(select 1 from public.payment_account_map m join public.cash_accounts a on a.id=m.cash_account_id where m.metode='Tunai' and a.is_active and a.jenis='Kas')),
 ('helpers present', to_regprocedure('public.stock_in_fifo(uuid,uuid,numeric,numeric,text,text,date,date)') is not null
   and to_regprocedure('public.clinic_write_journal(date,text,text,text,uuid,jsonb)') is not null
   and to_regprocedure('public.expense_assert_access(uuid,boolean)') is not null)
)
select name, ok from checks
union all select 'SUMMARY: '||count(*) filter(where not ok)||' failed', count(*) filter(where not ok)=0 from checks;
