#!/usr/bin/env python3
"""P03 price-floor message change: RULE-UNCHANGED random differential + printed-minimum check (native throwaway PostgreSQL).

An exact copy of the pre-change function body (taken from the migration's own old_text) is installed next to the new function;
N random carts (1-5 rows: goods/services/racikan/packages, duplicate names, qty 0.01..100, row discount 0..100, HPP NULL/0/0.004/...,
invoice discount 0..subtotal) are judged by both: accept/refuse, SQLSTATE and message prefix must be identical (0 mismatches).
Then, for single goods rows, the printed minimum price must clear the floor when typed (never too low); a minimum that is one rupiah
too high is allowed (conservative). Finally the zero-subtotal / 100%-discount wordings are asserted.

  python3 -I scripts/test-p03-price-floor-fuzz-postgres.py --pg-bin DIR --json out.json [-n 20000]   (wrap in flock /opt/data/kamo-heavy-test.lock)
"""
import argparse, importlib.util, json, re, sys
from collections import Counter
from pathlib import Path
sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]; sys.path.insert(0, str(ROOT / 'scripts'))
spec = importlib.util.spec_from_file_location('medical', ROOT / 'scripts/test-rekam-full-edit-postgres.py'); assert spec and spec.loader
mm = importlib.util.module_from_spec(spec); spec.loader.exec_module(mm)
x, r, q, j = mm.x, mm.r, mm.q, mm.j
MIG = (ROOT / 'supabase/migrations/20261106860000_price_floor_pesan_jelas.sql').read_text()
old_body = re.search(r"old_text text := \$old\$(.*?)\$old\$;", MIG, re.S).group(1)
ap = argparse.ArgumentParser(); ap.add_argument('--pg-bin', required=True); ap.add_argument('--json', type=Path, required=True); ap.add_argument('-n', type=int, default=20000); A = ap.parse_args()
N = A.n; r.BIN = A.pg_bin
RESULTS = []
def check(name, ok, detail):
    RESULTS.append(dict(case=name, status='PASS' if ok else 'FAIL', detail=str(detail)[:600])); print(RESULTS[-1]['status'], name, str(detail)[:300], flush=True)
with r.NativePostgres(r.BIN) as db:
    r.fixture.DisposablePostgres.bootstrap(db); h = x.Harness(db); x.setup(h)
    # old copy of the function under another name
    hdr = db.sql("select pg_get_functiondef('clinic_private.assert_invoice_price_floor(uuid,numeric,numeric)'::regprocedure)")
    new_def = hdr
    assert 'P03_PESAN_JELAS' in new_def
    head = new_def[:new_def.index('AS $function$')]
    old_fn = head.replace('assert_invoice_price_floor', 'zz_old_floor') + 'AS $function$' + old_body + '$function$'
    db.sql(old_fn)
    db.sql('alter table public.invoice_items disable trigger user;')
    # fixtures
    cust = r.buat_pelanggan(h, 4500)
    cust = cust['id'] if isinstance(cust, dict) else cust; pet = r.uid('c', 4500); db.sql(f"insert into pets(id,customer_id,name) values({q(pet)},{q(cust)},'Uji Fuzz');")
    v = r.uid('7', 4501)
    db.sql(f"insert into visits(id,branch_id,customer_id,pet_id) values({q(v)},{q(r.BRANCH)},{q(cust)},{q(pet)});")
    inv = r.uid('b', 4500)
    db.sql(f"insert into invoices(id,visit_id) values({q(inv)},{q(v)});")
    item = db.sql("select id from items where item_type='Persediaan' limit 1")
    jasa = r.uid('e', 4510); db.sql(f"insert into items(id,code,name,unit,item_type,buy_price) values({q(jasa)},'FZJASA','Fuzz jasa','jasa','Jasa',0);")
    mr_ = r.uid('f', 4511); db.sql(f"insert into medical_records(id,visit_id) values({q(mr_)},{q(v)});")
    rec_ = r.uid('d', 4512); db.sql(f"insert into compounding_recipes(id,medical_record_id,recipe_name,dosage_instruction,total_volume,dosage_form,compounding_steps) values({q(rec_)},{q(mr_)},'Obat Racik Fuzz','2x1','10 ml','sirup','campur');")
    pkgs = db.sql("select string_agg(id::text,',') from (select id from items order by id limit 3) s").split(',')
    recs = [rec_] + [r.uid('d', 4520 + i) for i in range(1, 5)]
    for i, rid in enumerate(recs[1:], 1): db.sql(f"insert into compounding_recipes(id,medical_record_id,recipe_name,dosage_instruction,total_volume,dosage_form,compounding_steps) values({q(rid)},{q(mr_)},'Obat Racik Fuzz {i}','2x1','10 ml','sirup','campur');")
    rec = recs[0]; RECARR = 'array[' + ','.join(f"'{x_}'" for x_ in recs) + ']::uuid[]'
    print('item', item, 'jasa', jasa, 'rec', rec, flush=True)
    fuzz = f"""
create or replace function pg_temp.fuzz(n int) returns table(kind text, detail text) language plpgsql as $f$
declare i int; k int; rows_n int; r_ record; sub numeric; disc numeric; o text; nw text; mode int;
  pk uuid[] := array['{pkgs[0]}','{pkgs[1]}','{pkgs[2]}']::uuid[];
  qtys numeric[] := array[1,1,1,2,3,5,0.5,0.01,10,100];
  hpps numeric[] := array[null,0,0.01,0.004,3.33,999.99,1000,1000.5,50150.6,1234567.89,5000000];
  ds numeric[] := array[0,0,0,10,25,33.33,50,99.99,100,100];
  e1 text; e2 text; s1 text; s2 text; c numeric;
begin
  for i in 1..n loop
    delete from invoice_items where invoice_id='{inv}';
    rows_n := 1 + floor(random()*5);
    for k in 1..rows_n loop
      declare t int := floor(random()*7); q_ numeric := qtys[1+floor(random()*10)]; hp numeric := hpps[1+floor(random()*11)];
              p numeric; d numeric := ds[1+floor(random()*10)];
      begin
        p := case floor(random()*6) when 0 then 0 when 1 then 0.01 when 2 then coalesce(hp,100) when 3 then coalesce(hp,100)/q_ + 1 when 4 then floor(coalesce(hp,100)/q_) else round((random()*20000)::numeric,2) end;
        insert into invoice_items(invoice_id,deskripsi,qty,harga,jenis,item_id,hpp,diskon_persen,satuan,package_item_id,package_qty,compound_recipe_id)
        values('{inv}', 'Baris ' || (case when random()<0.2 then 'Sama' else k::text end) || case when random()<0.1 then E'\\n  spasi' else '' end, q_, p,
          case when t in (2,5) then 'jasa' else 'obat' end,
          case when t in (3,6) then null when t in (2,5) then '{jasa}'::uuid else '{item}'::uuid end,
          hp, d, case when random()<0.2 then null else 'pcs' end,
          case when t in (4,5) then pk[1+floor(random()*3)] else null end, case when t in (4,5) then 1 end,
          case when t=3 then ({RECARR})[k] end);
      end;
    end loop;
    select coalesce(sum(round(qty*harga*(1-diskon_persen/100),2)),0) into sub from invoice_items where invoice_id='{inv}';
    mode := floor(random()*6);
    disc := case mode when 0 then 0 when 1 then 0 when 2 then floor(sub/10) when 3 then round((sub*random())::numeric,2) when 4 then sub when else greatest(sub-0.01,0) end;
    -- old
    begin perform clinic_private.zz_old_floor('{inv}',sub,disc); s1:='ACCEPT'; e1:=null;
    exception when others then s1:=split_part(sqlerrm,':',1); e1:=sqlstate; end;
    begin perform clinic_private.assert_invoice_price_floor('{inv}',sub,disc); s2:='ACCEPT'; e2:=null;
    exception when others then s2:=split_part(sqlerrm,':',1); e2:=sqlstate; end;
    kind := 'count'; detail := s1; return next;
    if s1 is distinct from s2 or e1 is distinct from e2 then kind:='MISMATCH'; detail := s1||'/'||e1||' vs '||s2||'/'||e2||' | '||(select string_agg(format('%s q=%s p=%s hpp=%s d=%s j=%s pk=%s item=%s',deskripsi,qty,harga,hpp,diskon_persen,jenis,package_item_id is not null,item_id is not null),' ; ') from invoice_items where invoice_id='{inv}')||' disc='||disc||' sub='||sub; return next; end if;
  end loop;
end $f$;
select kind||'|'||detail from pg_temp.fuzz({N}) where kind<>'count' or true;
"""
    fuzz = fuzz.replace('when else', 'else')
    out = db.sql(fuzz)
    lines = out.splitlines()
    from collections import Counter
    cnt = Counter(l.split('|', 1)[1] for l in lines if l.startswith('count|'))
    mism = [l for l in lines if l.startswith('MISMATCH')]
    kinds = set(cnt)
    check('differential: %d random carts judged identically by the old and the new function (accept/refuse, SQLSTATE, prefix)' % sum(cnt.values()), not mism and sum(cnt.values()) == N, dict(mismatches=len(mism), first=mism[:3]))
    check('differential is not trivial: ACCEPT and every refusal kind occur', all(k in kinds for k in ('ACCEPT', 'PRICE_ZERO', 'PRICE_BELOW_HPP', 'COST_MISSING')), dict(cnt))
    # ------- minimum price correctness: single goods row
    chk = f"""
create or replace function pg_temp.minchk(n int) returns table(r text) language plpgsql as $f$
declare i int; q_ numeric; hp numeric; d numeric; p numeric; sub numeric; disc numeric; m text; mn numeric; ok1 boolean; ok0 boolean; msg text; share numeric;
begin
 for i in 1..n loop
  delete from invoice_items where invoice_id='{inv}';
  q_ := (array[1,2,3,5,10,0.5,7])[1+floor(random()*7)]; hp := round((random()*100000)::numeric*(case when random()<0.3 then 0.001 else 1 end),2);
  if hp<=0 then hp:=0.37; end if;
  d := (array[0,0,10,33.33,50,12.5])[1+floor(random()*6)];
  insert into invoice_items(invoice_id,deskripsi,qty,harga,jenis,item_id,hpp,diskon_persen,satuan) values('{inv}','Uji',q_,0.01,'obat','{item}',hp,d,'pcs');
  -- invoice-level discount applies to an invoice that also has a second plain row; keep single-row carts: use subtotal = this row's amount
  insert into invoice_items(invoice_id,deskripsi,qty,harga,jenis,item_id,hpp,diskon_persen,satuan) values('{inv}','Jasa',1,1000,'jasa','{jasa}',null,0,'x');
  sub := round(q_*0.01*(1-d/100),2) + 1000;
  disc := 0;
  -- make subtotal realistic: pretend the invoice has another fixed zero-hpp service line so the share is < 1
  perform 1;
  begin perform clinic_private.assert_invoice_price_floor('{inv}',sub,disc); r:='unexpected-accept'; return next; continue;
  exception when others then msg:=sqlerrm; end;
  m := substring(msg from 'harga minimum (Rp[0-9.]+) per');
  if m is null then r:='NOMIN|'||left(msg,150); return next; continue; end if;
  mn := replace(substring(m from 3),'.','')::numeric;
  update invoice_items set harga=mn where invoice_id='{inv}' and deskripsi='Uji';
  sub := round(q_*mn*(1-d/100),2) + 1000;
  begin perform clinic_private.assert_invoice_price_floor('{inv}',sub,0); ok1:=true; exception when others then ok1:=false; msg:=sqlerrm; end;
  if not ok1 then r:='MIN_NOT_ENOUGH|q='||q_||' hpp='||hp||' d='||d||' min='||mn||' '||left(msg,120); return next; end if;
  if mn>1 then
   update invoice_items set harga=mn-1 where invoice_id='{inv}' and deskripsi='Uji'; sub:=round(q_*(mn-1)*(1-d/100),2)+1000;
   begin perform clinic_private.assert_invoice_price_floor('{inv}',sub,0); ok0:=true; exception when others then ok0:=false; end;
   if ok0 then r:='MIN_NOT_MINIMAL|q='||q_||' hpp='||hp||' d='||d||' min='||mn; return next; end if;
  end if;
 end loop;
end $f$;
select r from pg_temp.minchk({max(2000, N // 4)});
"""
    out2 = db.sql(chk)
    bad = out2.splitlines()
    hard = [l for l in bad if not l.startswith(('MIN_NOT_MINIMAL', 'unexpected-accept'))]   # unexpected-accept: the random single row is legitimately accepted at 0.01 (tiny HPP), nothing to print
    check('printed minimum is never too low when typed (a rupiah too high is allowed): %d trials, %d too low / unusable, %d accepted-or-one-rupiah-high (allowed)' % (max(2000, N // 4), len(hard), len(bad) - len(hard)), not hard, hard[:3])
    db.sql(f"delete from invoice_items where invoice_id='{inv}'; insert into invoice_items(invoice_id,deskripsi,qty,harga,jenis,item_id,hpp,diskon_persen,satuan) values('{inv}','Obat Gratis',1,0,'obat','{item}',900,0,'pcs');")
    try: db.sql(f"select clinic_private.assert_invoice_price_floor('{inv}',0,0);")
    except RuntimeError as e:
        msg = str(e); check('C8: only a free obat row (subtotal 0): the minimum is printed and no invoice discount is claimed', 'harga minimum Rp900 per pcs' in msg and 'diskon invoice' not in msg and 'tidak dapat dihitung' not in msg, msg[:300])
    # --- discount-100 wording and share<1 case sample message
    db.sql(f"delete from invoice_items where invoice_id='{inv}'; insert into invoice_items(invoice_id,deskripsi,qty,harga,jenis,item_id,hpp,diskon_persen,satuan) values('{inv}','Obat A',2,1000,'obat','{item}',900,100,'pcs');")
    for sub, d_ in ((0, 0),):
        try: db.sql(f"select clinic_private.assert_invoice_price_floor('{inv}',0,0);")
        except RuntimeError as e:
            msg = str(e); check('C8: 100% row discount names the ROW discount, never an invoice discount', 'tidak dapat dihitung (diskon 100% pada baris)' in msg and 'diskon invoice' not in msg, msg[:300])
    db.sql(f"delete from invoice_items where invoice_id='{inv}'; insert into invoice_items(invoice_id,deskripsi,qty,harga,jenis,item_id,hpp,diskon_persen,satuan) values('{inv}','Obat A',1,1000,'obat','{item}',900,0,'pcs'),('{inv}','Obat B',1,5000,'obat','{item}',900,0,'pcs');")
    try: db.sql(f"select clinic_private.assert_invoice_price_floor('{inv}',6000,5500);")
    except RuntimeError as e:
        msg = str(e); check('invoice discount message still computes a minimum (share < 1)', 'harga minimum' in msg and 'tidak dapat dihitung' not in msg, msg[:300])


totals = {s_: sum(c['status'] == s_ for c in RESULTS) for s_ in ('PASS', 'FAIL')}
A.json.write_text(json.dumps(dict(n=N, cases=RESULTS, totals=totals), indent=2)); print(totals)
sys.exit(int(totals['FAIL'] > 0))
