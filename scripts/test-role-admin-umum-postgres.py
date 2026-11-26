#!/usr/bin/env python3
"""Peran "Admin Umum" (ADMIN_UMUM), Andri 26 Nov 2026: admin umum yang membantu finance; akses bawaan SAMA seperti ADMIN, terpisah supaya diatur sendiri.

Migrasi: 20261214100000_admin_umum_enum.sql (nilai enum) + 20261214100100_admin_umum_role.sql (isi).
Dibuktikan di PostgreSQL 17 sungguhan (rantai penuh semua migrasi repo, kandidat dipasang TERAKHIR seperti hosted; data fiktif; tanpa jaringan):
  A  Struktur : hanya fungsi/kebijakan yang menyebut ADMIN (+ tambalan berjangkar) berubah; objek lain byte-identik; tidak ada sisa 'ADMIN' tak berpasangan.
  B  ACL      : fungsi/skema baru tidak bisa dipanggil peran API, search_path kosong, penjaga Admin Online ada.
  C  Matriks fungsi (dibuat otomatis dari pg_proc): untuk SETIAP fungsi yang menyebut 'ADMIN' (123): hasil sebagai ADMIN_UMUM == ADMIN (dua strategi argumen),
     ADMIN setelah == ADMIN sebelum, peran lain tidak berubah, ADMIN_ONLINE tetap ditolak.
  D  Matriks kebijakan RLS (dibuat otomatis dari pg_policies, tabel tiruan + baris sampel): untuk SETIAP kebijakan yang menyebut ADMIN: ADMIN_UMUM == ADMIN == ADMIN sebelum.
  E  Cabang & kemampuan: user_can_access_branch / has_role_capability / snapshot Akses Grup sama seperti ADMIN.
  F  Tiga aliran diferensial (jurnal manual buat/koreksi, koreksi pengeluaran, faktur pembelian langsung): ADMIN_UMUM == ADMIN == ADMIN sebelum kandidat.
  G  Tombol Jurnal Umum: bawaan, dicabut, koreksi izin khusus; peran lain tidak terpengaruh.
  H  Tidak lebih dari ADMIN: Akses Grup/akun/peran/koreksi jurnal tetap tertutup; Admin Online tetap ditolak.
  I  Rollback (ROLLBACK.sql -> digest sama dengan sebelum kandidat) dan idempotensi.
  --baseline : kandidat isi TIDAK dipasang (hanya enum): kasus fitur harus GAGAL (RED).
  --mutations: tiap mutan migrasi isi di database klon; semua mutan harus mati.
    python3 -I scripts/test-role-admin-umum-postgres.py [--pg-bin DIR] [--json out.json] [--baseline] [--mutations] [--dev-root SOCKETDIR --dev-template DB]
"""
import argparse, hashlib, importlib.util, json, os, re, subprocess, sys, tempfile
from pathlib import Path

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from native_postgres import NativePostgres  # noqa: E402

MIG = ROOT / "supabase/migrations"
ENUM = MIG / "20261214100000_admin_umum_enum.sql"
BODY = MIG / "20261214100100_admin_umum_role.sql"
ROLLBACK = Path(os.environ.get("UMUM_ROLLBACK", "/opt/data/kamo-cost-missing-evidence/ship-role-admin-umum/ROLLBACK.sql"))
RESULTS = []
SEED = ("insert into coa_accounts(code,name,type,normal_balance) select c,'Fiktif '||c,'BEBAN','D' from unnest(array['720002','720003','720004','740017','740005','720008','740021','740016','730002','720005','720006','720009','740002','740014','740013','740022','740012','760003']) c on conflict(code) do update set is_active=true,is_header=false;\n")
DATA_FIX = [f.read_text() for f in MIG.glob("*.sql") if any(k in f.name for k in ("koreksi_saldo_awal_fb", "ralat_saldo_awal", "sambung_jurnal_pengeluaran", "saldo_awal_kas_toko_ke_cabang"))]
PRELUDE = ("alter default privileges for role postgres in schema public grant all on functions to anon, authenticated, service_role;"
           "alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role;")

U = lambda n: f"a0a00000-0000-4000-8000-{n:012d}"
SUBJ, OWNER, ADMIN, UMUM, FIN, STAFF, AO, TARGET, CASHIER = (U(i) for i in range(1, 10))
BR_A, BR_B, BR_C = U(101), U(102), U(103)
DUMMY = U(999)
ROLES = ["OWNER", "ADMIN", "ADMIN_UMUM", "FINANCE", "STAFF", "DOCTOR", "ADMIN_ONLINE"]
FNS_MARK = "ADMIN"


def q(v):
    return "null" if v is None else "'" + str(v).replace("'", "''") + "'"


def check(name, ok, detail=None, sec=None):
    RESULTS.append(dict(case=name, status="PASS" if ok else "FAIL", detail=detail, sec=sec))
    print(RESULTS[-1]["status"], name, json.dumps(detail, default=str)[:260], flush=True)
    return ok


class Cl:
    """Satu klaster; psql per database lewat socket."""
    def __init__(self, root, psql):
        self.root, self.psql = str(root), psql

    def run(self, db, sql, check_rc=True):
        r = subprocess.run([self.psql, "-X", "-qAt", "-h", self.root, "-U", "postgres", "-d", db, "-v", "ON_ERROR_STOP=1"], input=sql, text=True,
                           capture_output=True, env={**os.environ, "PSQLRC": "/dev/null", "PGTZ": "Asia/Jakarta"})
        if r.returncode and check_rc:
            raise RuntimeError((r.stderr + r.stdout)[-3000:])
        return r.stdout.strip() if not r.returncode else "ERR:" + r.stderr.strip()

    def err(self, db, sql):
        try:
            self.run(db, sql); return None
        except RuntimeError as e:
            return str(e)

    def clone(self, src, dst):
        self.run("postgres", f"drop database if exists {dst};")
        self.run("postgres", f"create database {dst} template {src};")


class Db:
    """Satu database uji + pembantu menjalankan SQL sebagai pengguna API (peran authenticated + klaim JWT)."""
    def __init__(self, cl, name):
        self.cl, self.name = cl, name

    def sql(self, s):
        return self.cl.run(self.name, s)

    def val(self, s, user, role=None):
        pre = ""
        if role:
            pre = f"set local session_replication_role=replica;update public.profiles set role='{role}',is_active=true where id={q(user)};set local session_replication_role=origin;"
        out = self.cl.run(self.name, "begin;" + pre + "set local role authenticated;"
                          f"select set_config('request.jwt.claim.sub',{q(user)},true);"
                          f"select set_config('request.jwt.claims',{q(json.dumps(dict(sub=user, role='authenticated')))},true);"
                          "select set_config('request.jwt.claim.role','authenticated',true);select set_config('request.headers','{}',true);"
                          + s.rstrip().rstrip(";") + ";\nrollback;")
        lines = [x for x in out.splitlines() if x != ""]
        return lines[-1] if lines else ""

    def err(self, s, user, role=None):
        try:
            self.val(s, user, role); return None
        except RuntimeError as e:
            return str(e)

    def commit(self, s, user):
        """Seperti val tetapi di-COMMIT (untuk skenario bertahap)."""
        out = self.cl.run(self.name, "begin;set local role authenticated;"
                          f"select set_config('request.jwt.claim.sub',{q(user)},true);"
                          f"select set_config('request.jwt.claims',{q(json.dumps(dict(sub=user, role='authenticated')))},true);"
                          "select set_config('request.jwt.claim.role','authenticated',true);select set_config('request.headers','{}',true);"
                          + s.rstrip().rstrip(";") + ";\ncommit;")
        lines = [x for x in out.splitlines() if x != ""]
        return lines[-1] if lines else ""


def errmsg(e):
    t = str(e)
    m = re.findall(r"ERROR:\s+(.*)", t)
    return (m[0] if m else t.strip().splitlines()[-1])[:200]


def has(err, *words):
    return bool(err) and all(w in err for w in words)


# ---------------------------------------------------------------------------------------------------- rantai
class Hook:
    def __init__(self, db): self.db = db
    def __getattr__(self, k): return getattr(self.db, k)
    def sql(self, source):
        for f in (ENUM, BODY):
            if source == "begin;\n" + f.read_text() + "\ncommit;": return ""
        if source.startswith("begin;\n-- Kategori pengeluaran rinci"): source = SEED + source
        if any(t in source for t in DATA_FIX):
            try: return self.db.sql(source)
            except RuntimeError: return ""
        return self.db.sql(source)


def build_chain(pg):
    spec = importlib.util.spec_from_file_location("fixture", ROOT / "scripts/test-accurate-inventory-accounting-postgres.py")
    fixture = importlib.util.module_from_spec(spec); spec.loader.exec_module(fixture)
    fixture.DisposablePostgres.bootstrap(Hook(pg))
    pg.sql(PRELUDE)


# ---------------------------------------------------------------------------------------------------- fixture
def seed(db, reset_admin=True):
    users = [(SUBJ, "Subjek Matriks", "ADMIN"), (OWNER, "Owner Fiktif", "OWNER"), (ADMIN, "Admin Fiktif", "ADMIN"), (UMUM, "Admin Umum Fiktif", "ADMIN"),
             (FIN, "Finance Fiktif", "FINANCE"), (STAFF, "Staf Fiktif", "STAFF"), (AO, "Admin Online Fiktif", "ADMIN_ONLINE"),
             (TARGET, "Calon Akun", "STAFF"), (CASHIER, "Kasir Fiktif", "STAFF")]
    db.sql("create or replace function auth.umum_probe_platform() returns text language sql as $$ select 'ADMIN'::text $$;")
    db.sql("insert into auth.users(id,raw_user_meta_data) values " + ",".join(f"({q(u)},{q(json.dumps(dict(full_name=n)))}::jsonb)" for u, n, _ in users) + ";")
    db.sql("".join(f"update public.profiles set role={q(r)},is_active=true where id={q(u)};" for u, _, r in users))
    db.sql(f"""
insert into public.branches(id,code,name,type) values ({q(BR_A)},'UMA','Cabang Uji A','PETSHOP'),({q(BR_B)},'UMB','Cabang Uji B','PETSHOP'),({q(BR_C)},'UMC','Cabang Uji C','KLINIK');
insert into public.user_branches(user_id,branch_id) values ({q(SUBJ)},{q(BR_A)}),({q(OWNER)},{q(BR_A)}),({q(ADMIN)},{q(BR_A)}),({q(UMUM)},{q(BR_A)}),({q(FIN)},{q(BR_A)}),({q(STAFF)},{q(BR_A)}),({q(AO)},{q(BR_A)}),({q(CASHIER)},{q(BR_A)}),({q(TARGET)},{q(BR_A)});
insert into public.coa_accounts(code,name,type,normal_balance,is_header,is_active) values ('1105','Kas Uji','ASET','D',false,true),('5401','Beban Uji','BEBAN','D',false,true),('170001','Persediaan Uji','ASET','D',false,true),('311001','Hutang Uji','LIABILITAS','K',false,true),('182004','PPN Uji','ASET','D',false,true)
 on conflict(code) do update set is_active=true,is_header=false;
update public.coa_accounts set is_active=true,is_header=false where code in ('170001','160001','311003','110003','120002');
update public.accounting_locks set closed_until=null where id;
insert into public.suppliers(id,nama) values ({q(U(301))},'Pemasok Uji');
insert into public.warehouses(id,branch_id,code,name,type) values ({q(U(201))},{q(BR_A)},'UM-WH','Gudang Uji','VET');
insert into public.items(id,code,name,unit,item_type,track_expiry) values ({q(U(401))},'UM-SKU','Barang Uji','pcs','Persediaan',true);
insert into public.item_units(item_id,unit,factor) values ({q(U(401))},'box',10);
insert into public.cash_accounts(id,nama,jenis,coa_code,branch_id,is_active) values ({q(U(501))},'Kas Uji','Kas','1105',{q(BR_A)},true);
delete from public.payment_account_map where metode='Tunai';
insert into public.cashier_shifts(id,branch_id,opened_by,shift_type) values ({q(U(601))},{q(BR_A)},{q(CASHIER)},'petshop');
update public.company_settings set mode_pkp=true,ppn_rate=11;
""")
    if reset_admin:  # ADMIN tanpa konfigurasi Akses Grup tersimpan = bawaan kode: apel-ke-apel dengan ADMIN_UMUM
        db.sql("delete from public.role_modules where role='ADMIN'; delete from public.role_capabilities where role='ADMIN';"
               "delete from role_settings_private.action_policies where role='ADMIN'; delete from role_settings_private.submenu_policies where role='ADMIN';")


# ---------------------------------------------------------------------------------------------------- matriks fungsi
DUMMY_ARG = {"uuid": f"'{DUMMY}'::uuid", "text": "'x'::text", "int4": "0", "int8": "0::bigint", "int2": "0::smallint", "numeric": "0::numeric", "bool": "false",
             "date": "'2026-01-15'::date", "timestamptz": "'2026-01-15 00:00:00+00'::timestamptz", "timestamp": "'2026-01-15'::timestamp", "jsonb": "'{}'::jsonb",
             "json": "'{}'::json", "varchar": "'x'::varchar", "float8": "0::float8"}


def matrix_script(role, strat, sigs, subject=SUBJ):
    arr = "array[" + ",".join(q(s) for s in sigs) + "]"
    dummy = json.dumps(DUMMY_ARG).replace("'", "''")
    return f"""
begin;
set local session_replication_role=replica;
update public.profiles set role='{role}',is_active=true where id='{subject}';
set local session_replication_role=origin;
set local statement_timeout='8s';
create temp table umum_res(sig text primary key, outcome text);
do $m$
declare r record; call text; args text; v text; st text; msg text; det text; dm jsonb := '{dummy}'::jsonb; t record; one text;
begin
  perform set_config('request.jwt.claim.sub','{subject}',true);
  perform set_config('request.jwt.claims','{{"sub":"{subject}","role":"authenticated"}}',true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  perform set_config('request.headers','{{}}',true);
  for r in select p.oid, p.oid::regprocedure::text sig, p.oid::regproc::text fname, p.proargtypes::oid[] types from pg_proc p where p.oid::regprocedure::text = any({arr}) order by 2 loop
    args := '';
    for t in select u.ty, u.ord, format_type(u.ty, null) ft, (select typname from pg_type where oid=u.ty) tn from unnest(r.types) with ordinality u(ty, ord) order by u.ord loop
      one := case when '{strat}'='nul' then 'null::'||t.ft else coalesce(dm->>t.tn, 'null::'||t.ft) end;
      if '{strat}'<>'nul' and t.tn like '\\_%' then one := '''{{}}''::'||t.ft; end if;
      args := args || case when args='' then '' else ',' end || one;
    end loop;
    call := r.fname || '(' || args || ')';
    begin
      set local role authenticated;
      execute 'select coalesce(md5(string_agg(replace(x::text,''ADMIN_UMUM'',''ADMIN''), E''\\n'' order by replace(x::text,''ADMIN_UMUM'',''ADMIN''))),'''') from (select ' || call || ') x' into v;
      raise exception 'UMUM_OK' using errcode='XX999', detail=coalesce(v,'');
    exception when others then
      get stacked diagnostics st = returned_sqlstate, msg = message_text, det = pg_exception_detail;
      insert into umum_res values (r.sig, case when st='XX999' then 'OK:'||det else 'ERR:'||st||':'||left(msg,160) end);
    end;
  end loop;
end $m$;
select coalesce(jsonb_object_agg(sig, outcome), '{{}}'::jsonb)::text from umum_res;
rollback;
"""


def run_matrix(db, role, strat, sigs):
    out = db.sql(matrix_script(role, strat, sigs))
    return json.loads(out.splitlines()[-1])


# ---------------------------------------------------------------------------------------------------- matriks kebijakan
def policy_list(db):
    rows = db.sql("""select coalesce(jsonb_agg(jsonb_build_object('rel',pol.polrelid::regclass::text,'oid',pol.polrelid::oid,'name',pol.polname,'cmd',pol.polcmd::text,
        'q',pg_get_expr(pol.polqual,pol.polrelid),'wc',pg_get_expr(pol.polwithcheck,pol.polrelid)) order by pol.polrelid::regclass::text, pol.polname),'[]')::text
      from pg_policy pol where coalesce(pg_get_expr(pol.polqual,pol.polrelid),'')||coalesce(pg_get_expr(pol.polwithcheck,pol.polrelid),'') ~ 'ADMIN'""")
    return json.loads(rows.splitlines()[-1])


def sample_value(col, typ):
    n = col
    if typ == "uuid":
        if n == "branch_id": return f"'{BR_A}'"
        if n in ("actor_id", "updated_by", "created_by", "user_id", "profile_id", "cashier_id", "opened_by", "requested_by"): return f"'{SUBJ}'"
        return f"'{DUMMY}'"
    if typ in ("text", "citext") or typ.startswith("character varying") or typ.startswith("character("): return "'x'"
    if typ == "boolean": return "true"
    if typ in ("integer", "bigint", "smallint", "double precision", "real") or typ.startswith("numeric"): return "1"
    if typ == "date": return "'2026-01-15'"
    if typ.startswith("timestamp"): return "'2026-01-15 00:00:00+00'"
    if typ in ("jsonb", "json"): return "'{}'"
    if typ == "ARRAY": return "null"
    return "null"


def policy_script(db, pols, role, subject=SUBJ):
    """Tabel tiruan per kebijakan: kolom sama (boleh kosong), satu baris sampel, RLS menyala, kebijakan = ekspresi hidup (disalin)."""
    parts = []
    for i, p in enumerate(pols):
        cols = json.loads(db.sql(f"select coalesce(jsonb_agg(jsonb_build_object('c',a.attname,'t',case when t.typtype='e' then 'enum' else format_type(a.atttypid,null) end,'e',(select e.enumlabel from pg_enum e where e.enumtypid=t.oid order by e.enumsortorder limit 1)) order by a.attnum),'[]')::text "
                                 f"from pg_attribute a join pg_type t on t.oid=a.atttypid where a.attrelid={p['oid']} and a.attnum>0 and not a.attisdropped and a.attgenerated=''").splitlines()[-1])
        rel = p["rel"].split(".")[-1]
        tn = f"pc_{i}"
        vals = []
        for c in cols:
            t = c["t"]
            vals.append(f"'{c['e']}'" if t == "enum" else sample_value(c["c"], t))
        sub = lambda e: None if e is None else re.sub(r"\b" + re.escape(rel) + r"\.", tn + ".", e)
        qual, wc = sub(p["q"]), sub(p["wc"])
        using = qual if qual else wc
        check_ = wc if wc else qual
        parts.append(f"""
create temp table {tn} (like {p['rel']} including defaults);
do $a$ declare c record; begin for c in select attname from pg_attribute where attrelid='{tn}'::regclass and attnum>0 and not attisdropped loop execute format('alter table {tn} alter column %I drop not null', c.attname); end loop; end $a$;
insert into {tn} ({",".join('"'+c['c']+'"' for c in cols)}) values ({",".join(vals)});
alter table {tn} enable row level security;
grant all on {tn} to authenticated;
create policy pc on {tn} for all to authenticated using ({using}) with check ({check_});
""")
    body = "".join(parts)
    names = [f"pc_{i}" for i in range(len(pols))]
    return f"""
begin;
set local session_replication_role=replica;
update public.profiles set role='{role}',is_active=true where id='{subject}';
set local session_replication_role=origin;
{body}
create temp table pol_res(t text primary key, outcome text);
do $m$
declare n text; v text; st text; msg text; o text;
begin
  perform set_config('request.jwt.claim.sub','{subject}',true);
  perform set_config('request.jwt.claims','{{"sub":"{subject}","role":"authenticated"}}',true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  perform set_config('request.headers','{{}}',true);
  foreach n in array array[{",".join(q(x) for x in names)}] loop
    o := '';
    begin set local role authenticated; execute format('select count(*)::text from %I', n) into v; raise exception 'X' using errcode='XX999', detail=v;
    exception when others then get stacked diagnostics st = returned_sqlstate, msg = pg_exception_detail; o := o || 'sel=' || case when st='XX999' then msg else 'ERR'||st end; end;
    begin set local role authenticated; execute format('insert into %I select * from %I', n, n); raise exception 'X' using errcode='XX999', detail='ok';
    exception when others then get stacked diagnostics st = returned_sqlstate; o := o || ';ins=' || case when st='XX999' then 'ok' else 'ERR'||st end; end;
    insert into pol_res values (n, o);
  end loop;
end $m$;
select coalesce(jsonb_object_agg(t, outcome), '{{}}'::jsonb)::text from pol_res;
rollback;
"""


# ---------------------------------------------------------------------------------------------------- digest struktur
DIGEST = r"""
select 'F|'||p.oid::regprocedure::text||'|'||md5(pg_get_functiondef(p.oid)||'|'||coalesce(p.proacl::text,'')||'|'||coalesce(p.proconfig::text,'')||'|'||pg_get_userbyid(p.proowner))
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where p.prokind in ('f','p') and n.nspname not in ('pg_catalog','information_schema','extensions','admin_umum_private','auth','storage','realtime','vault','graphql','graphql_public','pgsodium','supabase_functions','supabase_migrations','net','cron','pgbouncer')
  and not exists (select 1 from pg_depend e where e.classid='pg_proc'::regclass and e.objid=p.oid and e.deptype='e')
union all
select 'P|'||pol.polrelid::regclass::text||'.'||pol.polname||'|'||md5(coalesce(pg_get_expr(pol.polqual,pol.polrelid),'')||'#'||coalesce(pg_get_expr(pol.polwithcheck,pol.polrelid),'')||'#'||pol.polcmd::text||'#'||pol.polpermissive::text||'#'||pol.polroles::text)
from pg_policy pol
union all
select 'T|'||c.oid::regclass::text||'.'||t.tgname||'|'||md5(pg_get_triggerdef(t.oid)||t.tgenabled::text) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where not t.tgisinternal and n.nspname not in ('pg_catalog','information_schema')
union all
select 'C|'||conrelid::regclass::text||'.'||conname||'|'||md5(pg_get_constraintdef(oid)) from pg_constraint where connamespace not in ('pg_catalog'::regnamespace,'information_schema'::regnamespace)
union all
select 'R|'||c.oid::regclass::text||'|'||c.relrowsecurity::text||c.relforcerowsecurity::text||coalesce(c.relacl::text,'') from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind in ('r','p','v') and n.nspname not in ('pg_catalog','information_schema','pg_toast')
order by 1;
"""


def digest(db):
    d = {}
    for line in db.sql(DIGEST).splitlines():
        parts = line.split("|")
        if len(parts) >= 3: d[parts[0] + "|" + parts[1]] = parts[2]
    return d


# ---------------------------------------------------------------------------------------------------- aliran diferensial
JRN_ACCTS = "(select id from public.coa_accounts where code='5401'), (select id from public.coa_accounts where code='1105')"


def norm(s):
    s = re.sub(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", "<uuid>", s)
    s = re.sub(r"JRN[.\-/][A-Za-z0-9.\-/]+", "<jrn>", s)
    s = re.sub(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[.\d]*[+-]\d{2}(:\d{2})?", "<ts>", s)
    s = re.sub(r"[A-Z]{2,5}[.\-/][A-Z0-9.\-/]*\d{3,}", "<no>", s)
    return s


def flow_journal(db, role, grant_koreksi=False):
    """Buat jurnal manual lalu koreksi; kembalikan ringkasan (galat ikut sebagai teks)."""
    s1 = f"""select coalesce((select create_manual_journal_atomic('jk1', current_date, 'Uji jurnal Admin Umum', {q(BR_A)}::uuid,
        jsonb_build_array(jsonb_build_object('account_id',{JRN_ACCTS.split(',')[0].strip()},'debit',100000,'credit',0), jsonb_build_object('account_id',{JRN_ACCTS.split(',')[1].strip()},'debit',0,'credit',100000)))::text),'')"""
    out = {}
    try:
        out["buat"] = norm(db.val(s1, SUBJ, role))
    except RuntimeError as e:
        out["buat"] = "ERR:" + norm(errmsg(e))
    # koreksi: butuh jurnal manual yang ada -> buat sebagai OWNER lebih dulu dalam transaksi yang sama
    s2 = f"""
select set_config('request.jwt.claim.sub',{q(OWNER)},true);
reset role; set local role authenticated;
select set_config('request.jwt.claim.sub',{q(OWNER)},true), set_config('request.jwt.claims','{{"sub":"{OWNER}","role":"authenticated"}}',true);
create temp table jk_entry as select (create_manual_journal_atomic('jk-owner', current_date, 'Jurnal asal', {q(BR_A)}::uuid,
  jsonb_build_array(jsonb_build_object('account_id',{JRN_ACCTS.split(',')[0].strip()},'debit',50000,'credit',0), jsonb_build_object('account_id',{JRN_ACCTS.split(',')[1].strip()},'debit',0,'credit',50000)))->>'entry_id')::uuid id;
grant all on jk_entry to authenticated;
select set_config('request.jwt.claim.sub',{q(SUBJ)},true), set_config('request.jwt.claims','{{"sub":"{SUBJ}","role":"authenticated"}}',true);
select revise_manual_journal('jk-rev',(select id from jk_entry),0,'void','{{}}'::jsonb,'[]'::jsonb,'Salah catat')::text"""
    try:
        out["koreksi"] = norm(db.val(s2, SUBJ, role))
    except RuntimeError as e:
        out["koreksi"] = "ERR:" + norm(errmsg(e))
    return out


def flow_expense(db, role):
    """Pengeluaran dicatat kasir (shift buka), lalu role mengoreksi; sesudah shift ditutup dicoba lagi."""
    out = {}
    pay = lambda amt: f"jsonb_build_object('tanggal',(now() at time zone 'Asia/Jakarta')::date,'kategori','Operasional','jumlah',{amt},'metode_bayar','Tunai','deskripsi','Uji')"
    att = "'[{\"path\":\"pengeluaran/uji.jpg\",\"nama\":\"uji.jpg\",\"mime\":\"image/jpeg\",\"ukuran\":100}]'::jsonb"
    edit = "jsonb_build_object('tanggal',(now() at time zone 'Asia/Jakarta')::date,'kategori','Operasional','deskripsi','Koreksi','jumlah',30000,'metode_bayar','Transfer')"
    head = f"""
reset role; set local role authenticated;
select set_config('request.jwt.claim.sub',{q(CASHIER)},true), set_config('request.jwt.claims','{{"sub":"{CASHIER}","role":"authenticated"}}',true);
create temp table ex_res as select (post_expense_atomic('ex-1','cashier',null,{pay(25000)},{att})->>'expense_id')::uuid id;
grant all on ex_res to authenticated;
select set_config('request.jwt.claim.sub',{q(SUBJ)},true), set_config('request.jwt.claims','{{"sub":"{SUBJ}","role":"authenticated"}}',true);
"""
    try:
        out["buka"] = norm(db.val(head + f"select revise_expense_atomic('ex-r1',(select id from ex_res),0,'edit',{edit},'Salah nominal')::text", SUBJ, role))
    except RuntimeError as e:
        out["buka"] = "ERR:" + norm(errmsg(e))
    closed = head.replace("reset role; set local role authenticated;", "reset role; set local role authenticated;") + "reset role;update public.cashier_shifts set status='closed',closed_at=now(),closing_balance=100,expected_cash=100,selisih=0 where id=" + q(U(601)) + ";set local role authenticated;" + f"select set_config('request.jwt.claim.sub',{q(SUBJ)},true), set_config('request.jwt.claims','{{\"sub\":\"{SUBJ}\",\"role\":\"authenticated\"}}',true);"
    try:
        out["tutup"] = norm(db.val(closed + f"select revise_expense_atomic('ex-r2',(select id from ex_res),0,'edit',{edit},'Salah nominal')::text", SUBJ, role))
    except RuntimeError as e:
        out["tutup"] = "ERR:" + norm(errmsg(e))
    return out


def purchase_payload(tag="UM"):
    return (f"jsonb_build_object('supplier_id','{U(301)}','warehouse_id','{U(201)}','tanggal',current_date,'jatuh_tempo',current_date+30,'no_faktur_pemasok','SUP-{tag}','surat_jalan','SJ-{tag}',"
            f"'keterangan','Uji faktur','lampiran','[]'::jsonb,'replaces_invoice_id',null,'items',jsonb_build_array(jsonb_build_object('item_id','{U(401)}','qty',1,'harga',111,'satuan','box','exp_date',current_date+365)))")


def flow_purchase(db, role):
    try:
        r = db.val(f"select (select create_direct_purchase_invoice('pi-1',{purchase_payload()}))::text", SUBJ, role)
        j = json.loads(r)
        for k in ("invoice_id", "no_faktur", "id"):
            j.pop(k, None)
        return norm(json.dumps(j, sort_keys=True))
    except RuntimeError as e:
        return "ERR:" + norm(errmsg(e))
    except json.JSONDecodeError:
        return "RAW:" + norm(r)[:300]


def effects_purchase(db, role):
    s = (f"begin;set local session_replication_role=replica;update public.profiles set role='{role}' where id='{SUBJ}';set local session_replication_role=origin;set local role authenticated;"
         f"select set_config('request.jwt.claim.sub','{SUBJ}',true),set_config('request.jwt.claims','{{\"sub\":\"{SUBJ}\",\"role\":\"authenticated\"}}',true),set_config('request.jwt.claim.role','authenticated',true),set_config('request.headers','{{}}',true);"
         f"select create_direct_purchase_invoice('pi-fx',{purchase_payload('FX')})::text;reset role;"
         "select jsonb_build_object('lines',(select coalesce(jsonb_agg(jsonb_build_array(a.code,l.debit,l.credit) order by a.code,l.debit,l.credit),'[]') from public.journal_lines l join public.coa_accounts a on a.id=l.account_id join public.journal_entries j on j.id=l.entry_id where j.created_at>=now()),"
         f"'layers',(select coalesce(jsonb_agg(jsonb_build_array(qty_in,unit_cost) order by unit_cost),'[]') from public.stock_layers where item_id='{U(401)}'),'stock',(select coalesce(sum(qty),0) from public.stock where item_id='{U(401)}'))::text;rollback;")
    return db.sql(s).splitlines()[-1]


# ---------------------------------------------------------------------------------------------------- bagian uji
def cfg(db, role="ADMIN_UMUM"):
    return json.loads(db.val(f"select public.get_role_access_config({q(role)})::text", OWNER))


def save_custom(db, role, actions, modules=None, reason="uji akses grup"):
    c = cfg(db, role)
    mods = modules if modules is not None else c["modules"]
    caps = json.dumps(c["capabilities"])
    import uuid
    return db.commit(f"select public.save_role_access_config({q(role)},{q(c['revision'])},{q(str(uuid.uuid4()))}::uuid,'custom',{q(json.dumps(mods))}::jsonb,{q(caps)}::jsonb,{q(reason)},{q(json.dumps(actions))}::jsonb,null)::text", OWNER)


def reset_cfg(db, role="ADMIN_UMUM"):
    c = cfg(db, role)
    import uuid
    return db.commit(f"select public.save_role_access_config({q(role)},{q(c['revision'])},{q(str(uuid.uuid4()))}::uuid,'reset','[]'::jsonb,null,'reset uji',null,null)::text", OWNER)


def enforced_actions(db):
    return db.sql("select coalesce(string_agg(id,',' order by id),'') from role_settings_private.action_catalog where enforced and id not like 'jurnal.%'").split(",")


def sec_struktur(db, base_dig, ctx):
    S = "struktur"
    new = digest(db)
    base_fn = ctx["base_fn_sigs"]
    changed = {k for k in base_dig if k in new and base_dig[k] != new[k]}
    added = {k for k in new if k not in base_dig}
    gone = {k for k in base_dig if k not in new}
    chg_f = {k[2:] for k in changed if k.startswith("F|")}
    chg_p = {k for k in changed if k.startswith("P|")}
    expected_f = set(base_fn) | {"activity_log_reader_guard(text,text[],boolean,uuid[])", "create_manual_journal_atomic(text,date,text,uuid,jsonb)",
                                 "revise_manual_journal(text,uuid,integer,text,jsonb,jsonb,text)"}
    check("struktur: fungsi yang berubah == fungsi yang menyebut 'ADMIN' + 3 tambalan berjangkar (nol lebih, nol kurang)", chg_f == expected_f,
          dict(lebih=sorted(chg_f - expected_f)[:5], kurang=sorted(expected_f - chg_f)[:5], n=len(chg_f)), S)
    check("struktur: 44 kebijakan RLS berubah tepat = yang menyebut ADMIN", len(chg_p) == len(ctx["pols_base"]) and len(chg_p) >= 44, len(chg_p), S)
    check("struktur: objek baru hanya jurnal_aksi_diizinkan + jurnal_izin", {k for k in added if not k.startswith("R|")} == {"F|jurnal_aksi_diizinkan(text)", "F|jurnal_izin()"}, sorted(added)[:6], S)
    check("struktur: tidak ada objek yang hilang", not gone, sorted(gone)[:5], S)
    check("struktur: pemicu dan constraint byte-identik", not [k for k in changed if k[0] in "TC"] and not [k for k in added if k[0] in "TC"], None, S)
    other = [k for k in base_dig if k[0] == "F" and k not in changed]
    check("struktur: >= 800 fungsi lain byte-identik (definisi+ACL+config+pemilik)", len(other) >= 800, len(other), S)
    check("struktur: relasi (RLS menyala/ACL tabel) identik", not [k for k in changed if k[0] == "R"], None, S)
    res = db.sql("select jenis||':'||status||':'||count(*) from admin_umum_private.terapkan_semua(true) group by jenis,status order by 1")
    check("struktur: terapkan_semua(dry) sesudah pasang: 0 DIUBAH, 0 SISA (idempoten)", "DIUBAH" not in res and "SISA" not in res and "kebijakan:SUDAH:44" in res and int(re.search(r"fungsi:SUDAH:(\d+)", res).group(1)) >= 100, res, S)
    sisa = db.sql("""select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname not in ('pg_catalog','information_schema','extensions','admin_umum_private','auth','storage','realtime','vault','graphql','graphql_public','pgsodium','supabase_functions','supabase_migrations','net','cron','pgbouncer') and admin_umum_private.sisa(pg_get_functiondef(p.oid)) > 0 and p.prokind in ('f','p')""")
    check("struktur: nol fungsi memuat 'ADMIN' tanpa pasangan ADMIN_UMUM (kecuali penanda tertulis)", sisa == "0", sisa, S)
    again = db.sql("select count(*) from admin_umum_private.terapkan_semua(false) where status='DIUBAH'")
    check("struktur: jalan ulang terapkan_semua tidak mengubah apa pun (idempotensi)", again == "0", again, S)
    rt = db.sql("""select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname not in ('pg_catalog','information_schema','extensions','admin_umum_private','auth','storage','realtime','vault','graphql','graphql_public','pgsodium','supabase_functions','supabase_migrations','net','cron','pgbouncer') and p.prokind in ('f','p')
       and p.prosrc ~ 'ADMIN_UMUM' and admin_umum_private.tulis_ulang(admin_umum_private.kembalikan(pg_get_functiondef(p.oid),'fn'),'fn') <> pg_get_functiondef(p.oid)""")
    check("struktur: tulis_ulang(kembalikan(x)) == x untuk semua fungsi (pulang-pergi persis)", rt == "0", rt, S)
    check("struktur: enum user_role = 6 nilai + ADMIN_UMUM terakhir", db.sql("select string_agg(e.enumlabel,',' order by e.enumsortorder) from pg_enum e join pg_type t on t.oid=e.enumtypid where t.typname='user_role'")
          == "OWNER,ADMIN,FINANCE,STAFF,DOCTOR,ADMIN_ONLINE,ADMIN_UMUM", None, S)
    cat = db.sql("select string_agg(id||':'||enforced::text||':'||module_id,',' order by id) from role_settings_private.action_catalog c join role_settings_private.action_modules m using (id) where id like 'jurnal.%'")
    check("struktur: 4 tombol jurnal.* di katalog (enforced) dipetakan ke modul buku-besar",
          cat == "jurnal.buat_manual:true:buku-besar,jurnal.koreksi_manual:true:buku-besar,jurnal.lihat:true:buku-besar,jurnal.lihat_semua_sumber:true:buku-besar", cat, S)
    pp = db.sql("select (prosrc !~ 'ADMIN_UMUM')::text from pg_proc where oid='auth.umum_probe_platform()'::regprocedure").splitlines()[-1]
    check("struktur: fungsi di skema platform (auth) yang menyebut 'ADMIN' TIDAK diubah (kode Supabase tidak disentuh)", pp == "true", pp, S)
    check("struktur: baris epoch ADMIN_UMUM ada (0) dan epoch_guard menyala", db.sql("select epoch::text from role_settings_private.epochs where role='ADMIN_UMUM'") == "0"
          and db.sql("select tgenabled from pg_trigger where tgname='epoch_guard'") == "O", None, S)
    check("struktur: tak ada akun ber-peran ADMIN_UMUM di data (migrasi tidak memberi peran ke siapa pun)", db.sql("select count(*) from public.profiles where role='ADMIN_UMUM'") == "0", None, S)


def sec_acl(db, ctx):
    S = "acl"
    f = lambda sig, who: db.sql(f"select has_function_privilege('{who}', '{sig}', 'execute')::text")
    check("acl: jurnal_aksi_diizinkan tidak bisa dipanggil authenticated/anon/service_role", all(f("public.jurnal_aksi_diizinkan(text)", w) == "false" for w in ("authenticated", "anon", "service_role")), None, S)
    check("acl: jurnal_izin hanya untuk authenticated", f("public.jurnal_izin()", "authenticated") == "true" and f("public.jurnal_izin()", "anon") == "false" and f("public.jurnal_izin()", "service_role") == "false", None, S)
    check("acl: admin_umum_private.* tidak bisa diakses peran API (fungsi dan skema)",
          all(f(s, w) == "false" for s in ("admin_umum_private.terapkan_semua(boolean)", "admin_umum_private.kembalikan_semua()", "admin_umum_private.tulis_ulang(text,text)")
              for w in ("authenticated", "anon", "service_role")) and db.sql("select has_schema_privilege('authenticated','admin_umum_private','usage')::text") == "false", None, S)
    cfgs = db.sql("select string_agg(proname||'='||coalesce(proconfig::text,''),';' order by proname) from pg_proc where proname in ('jurnal_izin','jurnal_aksi_diizinkan')")
    check("acl: kedua fungsi jurnal SECURITY DEFINER dengan search_path kosong", db.sql("select bool_and(prosecdef) from pg_proc where proname in ('jurnal_izin','jurnal_aksi_diizinkan')") == "t" and db.sql("select bool_and(proconfig = array['search_path=\"\"']) from pg_proc where proname in ('jurnal_izin','jurnal_aksi_diizinkan')") == "t", cfgs, S)
    check("acl: jurnal_izin berpenjaga deny_admin_online", "deny_admin_online" in db.sql("select prosrc from pg_proc where proname='jurnal_izin'"), None, S)
    check("acl: pemilik fungsi baru = postgres", db.sql("select string_agg(distinct pg_get_userbyid(proowner),',') from pg_proc where proname in ('jurnal_izin','jurnal_aksi_diizinkan')") == "postgres", None, S)
    anon = db.err("select public.jurnal_izin()", AO)
    check("acl: Admin Online ditolak memanggil jurnal_izin", has(anon, "ADMIN_ONLINE") or has(anon, "denied") or has(anon, "ditolak") or bool(anon), (anon or "")[:120], S)


def sec_matriks(db, ctx, roles=None, strategies=("nul", "dummy")):
    S = "matriks"
    sigs = ctx["base_fn_sigs"]
    base = ctx["mx_base"]
    unstable = ctx["unstable"]
    bad_parity, bad_regress, bad_other, informative = [], [], [], 0
    cand = {}
    for strat in strategies:
        for role in (roles or ROLES):
            cand[(strat, role)] = run_matrix(db, role, strat, sigs)
    for sig in sigs:
        par, reg, oth = True, True, True
        inf = False
        for strat in strategies:
            a, u = cand[(strat, "ADMIN")][sig], cand[(strat, "ADMIN_UMUM")][sig]
            if sig not in unstable and a != u: par = False
            if sig not in unstable and base[(strat, "ADMIN")][sig] != a: reg = False
            if sig not in unstable and base[(strat, "ADMIN")][sig] != u: par = False
            if any(cand[(strat, r)][sig] != a for r in ("STAFF", "FINANCE", "OWNER") if (strat, r) in cand): inf = True
            if roles is None:
                for r in ("OWNER", "FINANCE", "STAFF", "DOCTOR", "ADMIN_ONLINE"):
                    if sig not in unstable and base[(strat, r)][sig] != cand[(strat, r)][sig]: oth = False
        if inf: informative += 1
        if not par: bad_parity.append(sig)
        if not reg: bad_regress.append(sig)
        if not oth: bad_other.append(sig)
        check(f"matriks[{sig}]: ADMIN_UMUM == ADMIN (dua strategi) dan ADMIN sama seperti sebelum kandidat", par and reg, dict(informatif=inf, stabil=sig not in unstable), S)
    check("matriks: jumlah fungsi dalam matriks >= 123 (dibangkitkan dari pg_proc)", len(sigs) >= 123, len(sigs), S)
    check("matriks: >= 50 fungsi INFORMATIF (hasil ADMIN berbeda dari STAFF/FINANCE/OWNER; bukan sekadar galat argumen yang sama)", informative >= 50, informative, S)
    check("matriks: peran lain (OWNER/FINANCE/STAFF/DOCTOR/ADMIN_ONLINE) tidak berubah sama sekali", not bad_other if roles is None else True, bad_other[:6], S)
    ao_ok = True
    if roles is None:
        ao = [s for s in sigs if cand[("nul", "ADMIN_ONLINE")][s] == cand[("nul", "ADMIN")][s] and not cand[("nul", "ADMIN")][s].startswith("ERR:42501") and s not in unstable]
        # ADMIN_ONLINE ditolak: hasilnya tidak boleh OK pada fungsi yang ADMIN-nya OK dan datanya nyata
        ao_ok = all(not cand[("nul", "ADMIN_ONLINE")][s].startswith("OK:") or base[("nul", "ADMIN_ONLINE")][s] == cand[("nul", "ADMIN_ONLINE")][s] for s in sigs)
    check("matriks: Admin Online tidak mendapat hasil baru dari fungsi mana pun (sama seperti sebelum kandidat)", ao_ok, None, S)
    ctx["cand_mx"] = cand
    return cand


def sec_kebijakan(db, ctx):
    S = "kebijakan"
    pols = policy_list(db)
    base = ctx["pol_base"]
    names = [f"{p['rel']}.{p['name']}" for p in pols]
    check("kebijakan: jumlah kebijakan yang menyebut ADMIN == 44 (dibangkitkan dari pg_policies)", len(pols) == 44, len(pols), S)
    cand = {role: json.loads(db.sql(policy_script(db, pols, role)).splitlines()[-1]) for role in ("ADMIN", "ADMIN_UMUM", "STAFF", "FINANCE", "OWNER")}
    informative = 0
    for i, n in enumerate(names):
        k = f"pc_{i}"
        a, u = cand["ADMIN"][k], cand["ADMIN_UMUM"][k]
        b = base["ADMIN"][k]
        if any(cand[r][k] != a for r in ("STAFF", "FINANCE", "OWNER")): informative += 1
        check(f"kebijakan[{n}]: ADMIN_UMUM == ADMIN == ADMIN sebelum kandidat", a == u == b, dict(admin=a, umum=u, sebelum=b), S)
    check("kebijakan: >= 25 kebijakan INFORMATIF (ADMIN berbeda dari peran lain pada baris sampel)", informative >= 25, informative, S)
    bad_other = [n for i, n in enumerate(names) for r in ("STAFF", "FINANCE", "OWNER") if cand[r][f"pc_{i}"] != base[r][f"pc_{i}"]]
    check("kebijakan: perilaku STAFF/FINANCE/OWNER pada baris sampel tak berubah di semua 44 kebijakan", not bad_other, bad_other[:5], S)
    pb = {f"{p['rel']}.{p['name']}": p for p in ctx["pols_base"]}
    bad_rt = []
    for p in pols:
        b = pb.get(f"{p['rel']}.{p['name']}")
        for key in ("q", "wc"):
            if p[key] is None and (b or {}).get(key) is None: continue
            back = db.sql(f"select md5(admin_umum_private.kembalikan({q(p[key])},'pol'))").splitlines()[-1]
            if b is None or back != hashlib.md5(b[key].encode()).hexdigest(): bad_rt.append(f"{p['rel']}.{p['name']}:{key}")
    check("kebijakan: ungkapan tiap kebijakan, dikembalikan ke bentuk lama, persis sama dengan sebelum kandidat (hanya ADMIN_UMUM yang ditambahkan)", not bad_rt, bad_rt[:5], S)
    ctx["pol_cand"] = cand


def sec_cabang(db, ctx):
    S = "cabang"
    for br, nama in ((BR_A, "A"), (BR_B, "B"), (BR_C, "C")):
        a = db.val(f"select public.user_can_access_branch({q(br)})::text", SUBJ, "ADMIN")
        u = db.val(f"select public.user_can_access_branch({q(br)})::text", SUBJ, "ADMIN_UMUM")
        check(f"cabang: user_can_access_branch({nama}) ADMIN_UMUM == ADMIN (true: semua cabang)", a == u == "true", (a, u), S)
    for cap in ("all_branches", "create_accounts"):
        a = db.val(f"select public.has_role_capability('{cap}')::text", SUBJ, "ADMIN")
        u = db.val(f"select public.has_role_capability('{cap}')::text", SUBJ, "ADMIN_UMUM")
        check(f"cabang: has_role_capability({cap}) ADMIN_UMUM == ADMIN (bawaan true)", a == u == "true", (a, u), S)
    c_a = json.loads(db.val("select public.get_role_access_config('ADMIN')::text", OWNER))
    c_u = cfg(db, "ADMIN_UMUM")
    strip = lambda c: {k: c[k] for k in ("modules", "capabilities", "source")} | {"actions": c["actions"]}
    check("cabang: snapshot Akses Grup ADMIN_UMUM (bawaan) == ADMIN (bawaan): semua modul, semua cabang, buat akun, sumber 'defaults'", strip(c_a) == strip(c_u) and c_u["source"] == "defaults"
          and len(c_u["modules"]) == 17, dict(u=strip(c_u)), S)
    st = db.val("select (select count(*) from public.profiles where id=%s and role='ADMIN_UMUM')::text" % q(SUBJ), SUBJ, "ADMIN_UMUM")
    check("cabang: Admin Umum dengan satu penugasan cabang tetap memakai 'semua cabang' bawaan ADMIN", st == "1", st, S)
    # cabang dibatasi lewat Akses Grup: simpan kemampuan all_branches=false -> user_can_access_branch hanya cabang penugasan
    c = cfg(db, "ADMIN_UMUM")
    import uuid
    db.commit(f"select public.save_role_access_config('ADMIN_UMUM',{q(c['revision'])},{q(str(uuid.uuid4()))}::uuid,'custom',{q(json.dumps(c['modules']))}::jsonb,'{{\"all_branches\":false,\"create_accounts\":false}}'::jsonb,'batasi cabang uji',null,null)::text", OWNER)
    b1 = db.val(f"select public.user_can_access_branch({q(BR_B)})::text", SUBJ, "ADMIN_UMUM")
    b2 = db.val(f"select public.user_can_access_branch({q(BR_A)})::text", SUBJ, "ADMIN_UMUM")
    b3 = db.val(f"select public.user_can_access_branch({q(BR_B)})::text", SUBJ, "ADMIN")
    check("cabang: bila Owner mematikan 'semua cabang' untuk ADMIN_UMUM: hanya cabang penugasan; ADMIN tidak terpengaruh (diatur terpisah)", (b1, b2, b3) == ("false", "true", "true"), (b1, b2, b3), S)
    reset_cfg(db, "ADMIN_UMUM")
    c2 = cfg(db, "ADMIN_UMUM")
    check("cabang: reset mengembalikan ADMIN_UMUM ke bawaan (source defaults)", c2["source"] == "defaults" and c2["capabilities"]["all_branches"] is True, c2["source"], S)
    # require_employee_scope memakai `<> 'ADMIN'` (jalur pemicu karyawan): bandingkan ADMIN vs ADMIN_UMUM vs STAFF lewat UPDATE nyata (dibatalkan)
    emp = "70707070-0000-4000-8000-000000000001"
    db.sql(f"insert into public.employees(id,nama,branch_id) values ('{emp}','Karyawan Uji Cakupan',{q(BR_A)}) on conflict (id) do nothing;")
    outs = {}
    for who in ("ADMIN", "ADMIN_UMUM", "STAFF", "OWNER"):
        upd = f"with u as (update public.employees set nama='Karyawan Uji Cakupan Baru', branch_id={q(BR_B)} where id='{emp}' returning 1) select count(*)::text from u"
        e = db.err(upd, SUBJ, who)
        outs[who] = "ERR:" + norm(errmsg(e)) if e else db.val(upd, SUBJ, who)
    check("cabang: pemicu karyawan (require_employee_scope '<>ADMIN'): ADMIN_UMUM == ADMIN, dan hasilnya nyata (ADMIN berhasil memindahkan, STAFF ditolak)",
          outs["ADMIN"] == outs["ADMIN_UMUM"] and outs["ADMIN"] == "1" and outs["STAFF"] != "1" and outs["OWNER"] == "1", outs, S)


def sec_aliran(db, ctx):
    S = "aliran"
    b = ctx["flows_base"]
    fa, fu = flow_journal(db, "ADMIN"), flow_journal(db, "ADMIN_UMUM")
    check("aliran 1a: buat jurnal manual: ADMIN_UMUM == ADMIN == ADMIN sebelum kandidat (jurnal terbuat)", fa["buat"] == fu["buat"] == b["jurnal"]["buat"] and "entry_id" in fa["buat"], fu["buat"][:120], S)
    check("aliran 1b: koreksi/batalkan jurnal manual ditolak: ADMIN_UMUM == ADMIN == sebelum (hanya Super Admin)", fa["koreksi"] == fu["koreksi"] == b["jurnal"]["koreksi"] and "Super Admin" in fu["koreksi"], fu["koreksi"][:140], S)
    ea, eu = flow_expense(db, "ADMIN"), flow_expense(db, "ADMIN_UMUM")
    check("aliran 2a: koreksi pengeluaran (shift buka): ADMIN_UMUM == ADMIN == sebelum", ea["buka"] == eu["buka"] == b["expense"]["buka"], eu["buka"][:140], S)
    check("aliran 2b: koreksi pengeluaran sesudah shift ditutup: ditolak identik (Owner/Finance saja)", ea["tutup"] == eu["tutup"] == b["expense"]["tutup"] and "Owner atau Finance" in eu["tutup"], eu["tutup"][:140], S)
    pa, pu = flow_purchase(db, "ADMIN"), flow_purchase(db, "ADMIN_UMUM")
    check("aliran 3: faktur pembelian langsung: ADMIN_UMUM == ADMIN == sebelum (hasil, bukan galat)", pa == pu == b["purchase"] and not pa.startswith("ERR"), pu[:160], S)
    ex_a, ex_u = effects_purchase(db, "ADMIN"), effects_purchase(db, "ADMIN_UMUM")
    check("aliran 3b: efek data faktur (jurnal per akun, lapisan stok, stok) identik ADMIN vs ADMIN_UMUM dan bukan kosong", ex_a == ex_u and '"lines": []' not in ex_a, ex_u[:200], S)
    ex_b = ctx["flows_base"]["purchase_fx"]
    check("aliran 3c: efek data faktur ADMIN_UMUM == ADMIN sebelum kandidat", ex_u == ex_b, ex_b[:120], S)


def sec_jurnal(db, ctx):
    S = "jurnal"
    jizin = lambda role: json.loads(db.val("select public.jurnal_izin()::text", SUBJ, role))
    check("jurnal: bawaan ADMIN_UMUM: lihat, buat manual, lihat semua sumber = ya; koreksi/batalkan = TIDAK (sama seperti ADMIN hari ini)",
          jizin("ADMIN_UMUM") == dict(lihat=True, buat_manual=True, koreksi_manual=False, lihat_semua_sumber=True), jizin("ADMIN_UMUM"), S)
    check("jurnal: OWNER semua ya", jizin("OWNER") == dict(lihat=True, buat_manual=True, koreksi_manual=True, lihat_semua_sumber=True), jizin("OWNER"), S)
    check("jurnal: ADMIN (tak terpengaruh tombol): lihat/buat/lihat-semua ya, koreksi tidak", jizin("ADMIN") == dict(lihat=True, buat_manual=True, koreksi_manual=False, lihat_semua_sumber=True), jizin("ADMIN"), S)
    check("jurnal: FINANCE: buat ya, koreksi tidak", jizin("FINANCE") == dict(lihat=True, buat_manual=True, koreksi_manual=False, lihat_semua_sumber=True), jizin("FINANCE"), S)
    check("jurnal: STAFF: buat tidak, koreksi tidak (perilaku lama)", jizin("STAFF")["buat_manual"] is False and jizin("STAFF")["koreksi_manual"] is False, jizin("STAFF"), S)
    # akun nonaktif: semua izin False (gagal tertutup), peran apa pun
    for r in ("ADMIN_UMUM", "OWNER", "ADMIN"):
        out = db.sql(f"begin;set local session_replication_role=replica;update public.profiles set role='{r}',is_active=false where id={q(SUBJ)};set local session_replication_role=origin;set local role authenticated;"
                     f"select set_config('request.jwt.claim.sub',{q(SUBJ)},true),set_config('request.jwt.claims',{q(json.dumps(dict(sub=SUBJ, role='authenticated')))},true),set_config('request.jwt.claim.role','authenticated',true);"
                     "select public.jurnal_izin()::text;rollback;").splitlines()[-1]
        check(f"jurnal: akun {r} NONAKTIF: semua izin jurnal False", json.loads(out) == dict(lihat=False, buat_manual=False, koreksi_manual=False, lihat_semua_sumber=False), out, S)
    # aksi tak dikenal ditolak bahkan untuk OWNER (fungsi dipanggil sebagai pemilik; klaim JWT disetel)
    sj = (f"begin;set local session_replication_role=replica;update public.profiles set role='OWNER',is_active=true where id={q(SUBJ)};set local session_replication_role=origin;"
          f"select set_config('request.jwt.claim.sub',{q(SUBJ)},true),set_config('request.jwt.claims',{q(json.dumps(dict(sub=SUBJ, role='authenticated')))},true),set_config('request.jwt.claim.role','authenticated',true);")
    unk = db.sql(sj + "select public.jurnal_aksi_diizinkan('jurnal.tidak_ada')::text||'|'||public.jurnal_aksi_diizinkan('x')::text||'|'||coalesce(public.jurnal_aksi_diizinkan(null)::text,'null')||'|'||public.jurnal_aksi_diizinkan('jurnal.lihat')::text;rollback;").splitlines()[-1]
    check("jurnal: jurnal_aksi_diizinkan menolak aksi tak dikenal / null (false) dan menerima yang dikenal untuk OWNER", unk == "false|false|false|true", unk, S)
    ec = cfg(db, "ADMIN_UMUM")
    cat = {a["id"] for a in ec["action_catalog"]}
    check("jurnal: katalog Akses Grup ADMIN_UMUM memuat 4 tombol jurnal.*", {"jurnal.lihat", "jurnal.buat_manual", "jurnal.koreksi_manual", "jurnal.lihat_semua_sumber"} <= cat, sorted(cat)[:3], S)
    for r in ("ADMIN", "FINANCE", "STAFF", "DOCTOR"):
        c = json.loads(db.val(f"select public.get_role_access_config('{r}')::text", OWNER))
        check(f"jurnal: katalog Akses Grup {r} TIDAK memuat jurnal.* (hanya ADMIN_UMUM)", not [a for a in c["action_catalog"] if a["id"].startswith("jurnal.")], None, S)
    e = db.err(f"select public.save_role_access_config('ADMIN','{ctx['rev_admin']}',gen_random_uuid(),'custom','[\"dashboard\"]','{{\"all_branches\":true,\"create_accounts\":true}}','uji','[\"jurnal.buat_manual\"]',null)", OWNER)
    check("jurnal: menyimpan jurnal.* untuk ADMIN ditolak (ROLE_ACTION_INVALID)", has(e, "ROLE_ACTION_INVALID"), (e or "")[-100:], S)
    # buat manual dicabut dari kebijakan ADMIN_UMUM
    acts = [a for a in enforced_actions(db) if a]
    save_custom(db, "ADMIN_UMUM", [a for a in acts] + ["jurnal.lihat", "jurnal.lihat_semua_sumber"], reason="cabut buat manual")
    ji = jizin("ADMIN_UMUM")
    check("jurnal: setelah Owner mencabut 'buat jurnal manual': izin buat=False, koreksi=False, lihat=True", ji["buat_manual"] is False and ji["koreksi_manual"] is False and ji["lihat"] is True, ji, S)
    fl = flow_journal(db, "ADMIN_UMUM")
    check("jurnal: create_manual_journal_atomic menolak ADMIN_UMUM tanpa izin (pesan jelas); ADMIN tak terpengaruh", "Izin Buat jurnal manual" in fl["buat"] and "entry_id" in flow_journal(db, "ADMIN")["buat"], fl["buat"][:140], S)
    # kebijakan ADMIN custom tanpa jurnal.buat_manual: ADMIN tetap bisa (non-regresi untuk peran lama dengan kebijakan tersimpan)
    c_ad = json.loads(db.val("select public.get_role_access_config('ADMIN')::text", OWNER))
    import uuid
    db.commit(f"select public.save_role_access_config('ADMIN',{q(c_ad['revision'])},{q(str(uuid.uuid4()))}::uuid,'custom','[\"dashboard\",\"buku-besar\",\"kas-bank\"]','{{\"all_branches\":true,\"create_accounts\":true}}','uji','[]',null)::text", OWNER)
    check("jurnal: ADMIN dengan kebijakan tersimpan (tanpa jurnal.*) tetap bisa buat jurnal manual (tidak ada regresi peran lama)", "entry_id" in flow_journal(db, "ADMIN")["buat"], None, S)
    db.sql("delete from public.role_modules where role='ADMIN'; delete from public.role_capabilities where role='ADMIN'; delete from role_settings_private.action_policies where role='ADMIN';")
    # koreksi: izin khusus (harus dicentang eksplisit)
    save_custom(db, "ADMIN_UMUM", acts + ["jurnal.lihat", "jurnal.buat_manual", "jurnal.lihat_semua_sumber"], reason="tanpa koreksi")
    check("jurnal: kebijakan tersimpan tanpa 'koreksi' tetap menolak koreksi", "Super Admin" in flow_journal(db, "ADMIN_UMUM")["koreksi"], None, S)
    save_custom(db, "ADMIN_UMUM", acts + ["jurnal.lihat", "jurnal.buat_manual", "jurnal.koreksi_manual", "jurnal.lihat_semua_sumber"], reason="izinkan koreksi")
    ji = jizin("ADMIN_UMUM")
    fk = flow_journal(db, "ADMIN_UMUM")["koreksi"]
    check("jurnal: sesudah Owner mencentang 'koreksi/batalkan jurnal manual': izin koreksi=True dan revise_manual_journal berhasil", ji["koreksi_manual"] is True and "reversal_journal_id" in fk, fk[:140], S)
    check("jurnal: ADMIN tetap TIDAK bisa koreksi (hanya ADMIN_UMUM yang bisa diberi)", "Super Admin" in flow_journal(db, "ADMIN")["koreksi"], None, S)
    # modul buku-besar dicabut: lihat/buat/koreksi ikut hilang
    save_custom(db, "ADMIN_UMUM", acts + ["jurnal.lihat", "jurnal.buat_manual", "jurnal.koreksi_manual", "jurnal.lihat_semua_sumber"], modules=[m for m in ec["modules"] if m != "buku-besar"], reason="tanpa modul")
    ji = jizin("ADMIN_UMUM")
    check("jurnal: modul Buku Besar dicabut -> semua izin jurnal False (role_action_allowed memeriksa modul)", not any(ji.values()), ji, S)
    check("jurnal: modul Buku Besar dicabut -> create_manual_journal_atomic ditolak 'Akses Buku Besar diperlukan' (pagar lama, sama seperti ADMIN)", "Buku Besar" in flow_journal(db, "ADMIN_UMUM")["buat"], None, S)
    reset_cfg(db, "ADMIN_UMUM")
    check("jurnal: reset -> bawaan kembali", jizin("ADMIN_UMUM") == dict(lihat=True, buat_manual=True, koreksi_manual=False, lihat_semua_sumber=True), None, S)


def sec_batas(db, ctx):
    S = "batas"
    db.sql(f"set session_replication_role=replica; update public.profiles set role='ADMIN_UMUM' where id={q(UMUM)}; set session_replication_role=origin;")
    # ADMIN_UMUM tidak lebih dari ADMIN
    for who in ("ADMIN", "ADMIN_UMUM"):
        e = db.err(f"select public.save_role_access_config('FINANCE','{ctx['rev_fin']}',gen_random_uuid(),'custom','[\"dashboard\"]','{{\"all_branches\":true,\"create_accounts\":false}}','uji','[]',null)", SUBJ, who)
        check(f"batas: {who} tidak bisa menyimpan Akses Grup (hanya OWNER)", has(e, "ROLE_OWNER_REQUIRED"), (e or "")[-90:], S)
        rd = json.loads(db.val("select public.get_role_access_config('ADMIN_UMUM')::text", SUBJ, who))
        check(f"batas: {who} hanya MEMBACA konfigurasi (riwayat audit tersembunyi); mengubahnya tetap hanya OWNER", rd["audit"] == [] and rd["source"] in ("defaults", "custom"), rd["audit"], S)
        rev_target = db.val(f"select public.get_user_account_for_edit({q(TARGET)})::text", SUBJ, who)
        roles = json.loads(rev_target)["editable_roles"]
        check(f"batas: {who} hanya boleh menetapkan peran non-istimewa (tanpa OWNER/ADMIN/ADMIN_UMUM)", "OWNER" not in roles and "ADMIN" not in roles and "ADMIN_UMUM" not in roles and "STAFF" in roles, roles, S)
        e = db.err(f"select public.edit_user_account({q(TARGET)},'Calon Akun','ADMIN_UMUM',array[{q(BR_A)}]::uuid[],(public.get_user_account_for_edit({q(TARGET)})->>'version'),gen_random_uuid())", SUBJ, who)
        check(f"batas: {who} tidak bisa menjadikan akun lain ADMIN_UMUM (ACCOUNT_EDIT_DENIED: melampaui kewenangan)", has(e, "ACCOUNT_EDIT_DENIED"), (e or "")[-110:], S)
        e = db.err(f"select public.get_user_account_for_edit({q(ADMIN)})", SUBJ, who)
        check(f"batas: {who} tidak bisa membuka/mengubah akun ADMIN lain", has(e, "ACCOUNT_EDIT_DENIED"), (e or "")[-90:], S)
        e = db.err(f"select public.get_user_account_for_edit({q(UMUM)})", SUBJ, who)
        check(f"batas: {who} tidak bisa membuka akun ADMIN_UMUM lain (peran istimewa)", has(e, "ACCOUNT_EDIT_DENIED"), (e or "")[-90:], S)
    ro = json.loads(db.val(f"select public.get_user_account_for_edit({q(TARGET)})::text", OWNER))["editable_roles"]
    check("batas: OWNER dapat memilih ADMIN_UMUM sebagai peran (urutan: setelah ADMIN)", "ADMIN_UMUM" in ro and ro.index("ADMIN_UMUM") == ro.index("ADMIN") + 1, ro, S)
    out = db.commit(f"select public.edit_user_account({q(TARGET)},'Calon Akun','ADMIN_UMUM',array[{q(BR_A)}]::uuid[],(public.get_user_account_for_edit({q(TARGET)})->>'version'),gen_random_uuid())::text", OWNER)
    r = db.sql(f"select role::text from public.profiles where id={q(TARGET)}")
    check("batas: OWNER berhasil menetapkan peran ADMIN_UMUM lewat edit_user_account (di klon uji, akun fiktif)", r == "ADMIN_UMUM", (r, out[:80]), S)
    db.sql(f"update public.profiles set role='STAFF' where id={q(TARGET)}")
    try:
        rr = db.val(f"update public.profiles set role='OWNER' where id={q(SUBJ)}; select role::text from public.profiles where id={q(SUBJ)}", SUBJ, "ADMIN_UMUM")
    except RuntimeError as ex:
        rr = "ERR"
    check("batas: ADMIN_UMUM tidak bisa menaikkan perannya sendiri lewat UPDATE profiles (peran tetap ADMIN_UMUM atau ditolak)", rr in ("ERR", "ADMIN_UMUM"), rr, S)
    jid = db.commit(f"select (public.create_manual_journal_atomic('jb-1', current_date, 'Jurnal batas', {q(BR_A)}::uuid, jsonb_build_array(jsonb_build_object('account_id',{JRN_ACCTS.split(',')[0].strip()},'debit',1000,'credit',0), jsonb_build_object('account_id',{JRN_ACCTS.split(',')[1].strip()},'debit',0,'credit',1000)))->>'entry_id')", OWNER)
    for who in ("ADMIN", "ADMIN_UMUM"):
        e = db.err(f"select public.revise_manual_journal('jb-r',{q(jid)}::uuid,0,'void','{{}}','[]','alasan')", SUBJ, who)
        check(f"batas: {who} tidak bisa koreksi/batalkan jurnal manual secara bawaan (hanya Super Admin)", has(e, "Super Admin"), errmsg(e) if e else None, S)
    # Admin Online tetap ditolak
    ao_tab = db.val("select count(*)::text from public.journal_entries", AO)
    check("batas: Admin Online tetap tidak bisa membaca tabel (pagar baca); ADMIN_UMUM bisa (bukan Admin Online)", ao_tab == "0" and db.val("select (admin_online_private.is_admin_online())::text", SUBJ, "ADMIN_UMUM") == "false"
          and db.val("select (admin_online_private.is_admin_online())::text", AO) == "true", ao_tab, S)
    e = db.err("insert into public.company_settings default values", AO)
    check("batas: Admin Online tetap tidak bisa menulis (pagar tulis)", has(e, "ADMIN_ONLINE_WRITE_DENIED"), (e or "")[-100:], S)
    e = db.err(f"select public.create_manual_journal_atomic('ao1', current_date, 'x', {q(BR_A)}::uuid, '[]'::jsonb)", AO)
    check("batas: Admin Online ditolak membuat jurnal manual", bool(e), (e or "")[-100:], S)
    e = db.err("select public.role_action_allowed('jurnal.lihat')", AO)
    check("batas: Admin Online ditolak role_action_allowed", bool(e), (e or "")[-80:], S)
    check("batas: fence_all() dan guard_all() tidak menemukan apa pun yang belum terpagar (0 baru)", db.sql("select admin_online_private.fence_all()::text||'/'||admin_online_private.guard_all()::text").splitlines()[-1] == "0/0", None, S)
    tbl = db.sql("select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind in ('r','p') and n.nspname='public'")
    fen = db.sql("select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where t.tgname='zz_admin_online_write_fence' and n.nspname='public'")
    check("batas: setiap tabel public tetap berpemicu pagar tulis Admin Online", tbl == fen and int(tbl) > 300, (tbl, fen), S)
    nofence = db.sql("select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind in ('r','p') and n.nspname='public' and c.relname not in ('profiles','user_branches') and not exists (select 1 from pg_policy p where p.polrelid=c.oid and p.polname='admin_online_fence_r')")
    check("batas: setiap tabel public tetap berpagar baca RESTRICTIVE Admin Online", nofence == "0", nofence, S)


def sec_rollback(cl, tpl_name, cand_db, ctx):
    S = "rollback"
    cl.clone(cand_db, "rb_u2")
    d = Db(cl, "rb_u2")
    d.sql("set session_replication_role=replica; update public.profiles set role='ADMIN' where role='ADMIN_UMUM'; set session_replication_role=origin;")
    d.sql(ROLLBACK.read_text())
    after = digest(d)
    base = ctx["base_dig"]
    diff = [k for k in base if after.get(k) != base[k]]
    extra = [k for k in after if k not in base]
    check("rollback: ROLLBACK.sql mengembalikan semua fungsi/kebijakan/pemicu/constraint/relasi ke digest SEBELUM kandidat (0 beda)", not diff and not extra, dict(beda=diff[:4], lebih=extra[:4]), S)
    check("rollback: schema admin_umum_private & fungsi jurnal & katalog jurnal & epoch hilang", d.sql("select (to_regnamespace('admin_umum_private') is null)::text||(to_regprocedure('public.jurnal_izin()') is null)::text||(select count(*) from role_settings_private.action_catalog where id like 'jurnal.%')::text||(select count(*) from role_settings_private.epochs where role='ADMIN_UMUM')::text") == "truetrue00", None, S)
    e = cl.err("rb_u2", ROLLBACK.read_text())
    check("rollback: jalan ulang ROLLBACK.sql ditolak bersih (sudah dibalik)", has(e, "ROLLBACK_BLOCKED"), (e or "")[-80:], S)
    cl.clone(cand_db, "rb_u3")
    d3 = Db(cl, "rb_u3")
    d3.sql(f"set session_replication_role=replica; update public.profiles set role='ADMIN_UMUM' where id={q(UMUM)}; set session_replication_role=origin;")
    e = cl.err("rb_u3", ROLLBACK.read_text())
    check("rollback: ditolak selama masih ada akun ber-peran ADMIN_UMUM", has(e, "ROLLBACK_BLOCKED"), (e or "")[-80:], S)
    cl.run("postgres", "drop database if exists rb_u2;drop database if exists rb_u3;")


def sec_aktivitas(db, ctx):
    S = "aktivitas"
    ent = db.sql("select entity from public.activity_log_sources where 'ADMIN' = any(reader_roles) and 'FINANCE' <> all(reader_roles) order by entity limit 1")
    a = db.val(f"select public.activity_log_reader_guard({q(ent)}, array['OWNER','ADMIN']::text[], false, '{{}}'::uuid[])::text", SUBJ, "ADMIN")
    u = db.val(f"select public.activity_log_reader_guard({q(ent)}, array['OWNER','ADMIN']::text[], false, '{{}}'::uuid[])::text", SUBJ, "ADMIN_UMUM")
    s = db.val(f"select public.activity_log_reader_guard({q(ent)}, array['OWNER','ADMIN']::text[], false, '{{}}'::uuid[])::text", SUBJ, "STAFF")
    check("aktivitas: pembaca log berbasis data: ADMIN_UMUM membaca baris berperan ADMIN seperti ADMIN; STAFF tidak", (a, u, s) == ("true", "true", "false"), (ent, a, u, s), S)
    u2 = db.val(f"select public.activity_log_reader_guard({q(ent)}, array['OWNER']::text[], false, '{{}}'::uuid[])::text", SUBJ, "ADMIN_UMUM")
    check("aktivitas: baris khusus OWNER tetap tertutup bagi ADMIN_UMUM", u2 == "false", u2, S)
    r = db.val("select public.activity_log_readable('global','global','{}'::uuid[])::text", SUBJ, "ADMIN_UMUM")
    check("aktivitas: activity_log_readable ADMIN_UMUM == ADMIN", r == db.val("select public.activity_log_readable('global','global','{}'::uuid[])::text", SUBJ, "ADMIN"), r, S)


# ---------------------------------------------------------------------------------------------------- orkestrasi
def prepare_base(cl, tpl):
    """Hitung acuan SEBELUM kandidat dari database templat (hanya enum): digest, matriks, kebijakan, aliran."""
    d = Db(cl, tpl)
    ctx = {"base_dig": digest(d)}
    sigs = d.sql("""select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname not in ('pg_catalog','information_schema','extensions','auth','storage','realtime','vault','graphql','graphql_public','pgsodium','supabase_functions','supabase_migrations','net','cron','pgbouncer') and p.prokind in ('f','p') and p.prosrc ~ '''ADMIN''(?![A-Za-z_0-9])'
       and not exists (select 1 from pg_depend e where e.classid='pg_proc'::regclass and e.objid=p.oid and e.deptype='e') order by 1""").splitlines()
    ctx["base_fn_sigs"] = list(sigs)
    ctx["pols_base"] = policy_list(d)
    ctx["mx_base"], ctx["unstable"] = {}, set()
    for strat in ("nul", "dummy"):
        for role in ROLES:
            ctx["mx_base"][(strat, role)] = run_matrix(d, role, strat, ctx["base_fn_sigs"])
    for strat in ("nul", "dummy"):
        again = run_matrix(d, "ADMIN", strat, ctx["base_fn_sigs"])
        ctx["unstable"] |= {s for s in ctx["base_fn_sigs"] if again[s] != ctx["mx_base"][(strat, "ADMIN")][s]}
    ctx["pol_base"] = {role: json.loads(d.sql(policy_script(d, ctx["pols_base"], role)).splitlines()[-1]) for role in ("ADMIN", "ADMIN_UMUM", "STAFF", "FINANCE", "OWNER")}
    ctx["flows_base"] = {"jurnal": flow_journal(d, "ADMIN"), "expense": flow_expense(d, "ADMIN"), "purchase": flow_purchase(d, "ADMIN"), "purchase_fx": effects_purchase(d, "ADMIN")}
    return ctx


def install_candidate(cl, name, body_text=None):
    """Seperti hosted: enum sudah ada (di templat); isi dipasang dalam satu transaksi."""
    Db(cl, name).sql("begin;\n" + (body_text if body_text is not None else BODY.read_text()) + "\ncommit;")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pg-bin", default="/opt/data/kamo-pg-harness/bin")
    ap.add_argument("--json")
    ap.add_argument("--baseline", action="store_true")
    ap.add_argument("--mutations", action="store_true")
    ap.add_argument("--only", default="")
    ap.add_argument("--dev-root"); ap.add_argument("--dev-template", default="postgres")
    args = ap.parse_args()
    if args.dev_root:
        os.environ["PGHOST"] = args.dev_root
        cl = Cl(args.dev_root, args.pg_bin + "/psql"); pg = None
        cl.run("postgres", f"drop database if exists umum_tpl;"); cl.clone(args.dev_template, "umum_tpl")
        run_all(cl, args)
    else:
        with NativePostgres(args.pg_bin) as pg:
            build_chain(pg)
            cl = Cl(pg.root, pg.psql)
            cl.run("postgres", "create database umum_tpl template postgres;")
            run_all(cl, args)


def run_all(cl, args):
    tpl = Db(cl, "umum_tpl")
    tpl.sql(ENUM.read_text())
    seed(tpl)
    ctx = prepare_base(cl, "umum_tpl")
    ctx["rev_admin"] = json.loads(tpl.val("select public.get_role_access_config('ADMIN')::text", OWNER))["revision"]
    ctx["rev_fin"] = json.loads(tpl.val("select public.get_role_access_config('FINANCE')::text", OWNER))["revision"]
    if args.mutations:
        return mutations(cl, ctx, args)
    cl.clone("umum_tpl", "umum_cand")
    cand = Db(cl, "umum_cand")
    if not args.baseline:
        install_candidate(cl, "umum_cand")
    else:
        # RED: kasus fitur harus gagal pada rantai tanpa isi
        cand.sql("select 1")
    run_sections(cl, cand, ctx, args, full=True)
    if not args.baseline:
        sec_rollback(cl, "umum_tpl", "umum_cand", ctx)
    finish(args)


def run_sections(cl, cand, ctx, args, full=True, only=None):
    def go(name, fn):
        if only and name not in only: return
        try:
            fn()
        except Exception as e:  # noqa: BLE001
            check(f"{name}: tidak crash", False, repr(e)[:300], name)
    go("struktur", lambda: sec_struktur(cand, ctx["base_dig"], ctx))
    go("acl", lambda: sec_acl(cand, ctx))
    go("matriks", lambda: sec_matriks(cand, ctx, roles=ctx.get("mx_roles")))
    go("kebijakan", lambda: sec_kebijakan(cand, ctx))
    go("cabang", lambda: sec_cabang(cand, ctx))
    go("aliran", lambda: sec_aliran(cand, ctx))
    go("aktivitas", lambda: sec_aktivitas(cand, ctx))
    go("jurnal", lambda: sec_jurnal(cand, ctx))
    go("batas", lambda: sec_batas(cand, ctx))


MUTANTS = []  # diisi oleh berkas mutan (scripts/test-role-admin-umum-mutants.py) lewat --mutations


def mutations(cl, ctx, args):
    spec = importlib.util.spec_from_file_location("mutants", ROOT / "scripts/test-role-admin-umum-mutants.py")
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
    body = BODY.read_text()
    only = [x for x in args.only.split(",") if x]
    survived, killed = [], []
    for i, (name, edit, sections) in enumerate(m.build(body)):
        if only and name not in only: continue
        text = body
        for a, b in edit:
            assert text.count(a) == 1, f"jangkar mutan {name}: {text.count(a)} kemunculan [{a[:50]}]"
            text = text.replace(a, b)
        cl.clone("umum_tpl", f"umum_m{i}")
        d = Db(cl, f"umum_m{i}")
        crash = None
        try:
            install_candidate(cl, f"umum_m{i}", text)
        except RuntimeError as e:
            crash = str(e)[-300:]
        before = len(RESULTS)
        if crash is None:
            try:
                run_sections(cl, d, ctx, args, only=set(sections))
            except Exception as e:  # noqa: BLE001
                RESULTS.append(dict(case="crash", status="FAIL", detail=repr(e)[:200]))
        fails = [r for r in RESULTS[before:] if r["status"] == "FAIL"]
        del RESULTS[before:]
        if crash and re.search(r"ADMIN_UMUM_(SISA|CHECK|ANCHOR)", crash):
            killed.append(name); print("MUTAN", name, "MATI oleh pemeriksa pasang-sendiri milik migrasi:", re.search(r"ADMIN_UMUM_\w+", crash).group(0), flush=True)
        elif crash:
            survived.append((name, "CRASH-APPLY " + crash[:120]))
            print("MUTAN", name, "CRASH (tidak sah sebagai pembunuhan)", crash[:120], flush=True)
        elif fails:
            killed.append(name); print("MUTAN", name, "MATI oleh", fails[0]["case"][:100], flush=True)
        else:
            survived.append((name, "SELAMAT")); print("MUTAN", name, "SELAMAT", flush=True)
        cl.run("postgres", f"drop database if exists umum_m{i};")
    check(f"mutan: semua {len(killed) + len(survived)} mutan mati", not survived, dict(hidup=survived, mati=len(killed)))
    check("mutan: jumlah mutan >= 25", len(killed) + len(survived) >= 25 or bool(only), len(killed) + len(survived))
    finish(args)


def finish(args):
    n = len(RESULTS); f = [r for r in RESULTS if r["status"] == "FAIL"]
    print(f"\nRINGKAS: {n - len(f)} PASS / {len(f)} FAIL dari {n}", flush=True)
    if args.json:
        Path(args.json).write_text(json.dumps(RESULTS, indent=1, default=str))
    sys.exit(1 if f else 0)


if __name__ == "__main__":
    main()
