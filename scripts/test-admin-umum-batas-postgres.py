#!/usr/bin/env python3
"""Batas peran Admin Umum (ADMIN_UMUM): migrasi 20261218200000_admin_umum_batas_peran.sql (perbaikan TINGGI-2 + SEDANG-1(orang)/2/3 review independen PR #594).

Dibuktikan di PostgreSQL 17 sungguhan (rantai penuh semua migrasi repo SEBELUM kandidat; kandidat dipasang TERAKHIR seperti hosted; data fiktif; tanpa jaringan).
Dua database dibandingkan: BASE (tanpa kandidat) dan CAND (kandidat dipasang). Tiap bagian mengumpulkan hasil pada keduanya lalu menegaskan:
  create   : preflight_employee_account + configure_employee_account, aktor x 7 peran x 3 keadaan Akses Grup. Admin Umum DITOLAK untuk FINANCE/OWNER/ADMIN/ADMIN_UMUM
             (pesan ADMIN_UMUM_ROLE_DIBATASI), tetap boleh STAFF/DOCTOR/ADMIN_ONLINE; semua aktor lain PERSIS sama dengan BASE (OWNER, ADMIN, FINANCE tak berubah).
  edit     : edit_user_account, get_user_account_for_edit (editable_roles), set_user_account_active, link_employee_account, set_user_branch_assignment.
  jurnal   : Jurnal Berulang (preview/create dari jurnal sumber) menghormati jurnal.buat_manual untuk Admin Umum; peran lain tak berubah.
  hris     : modul HRIS yang dicabut Owner dari Admin Umum berlaku di RPC penugasan cabang + epoch penggajian; ADMIN/OWNER/FINANCE tak berubah.
  setoran  : penyetuju Rekap Setoran = OWNER/FINANCE/ADMIN/ADMIN_UMUM (eksplisit, dikunci tes) + COMMENT.
  struktur : hanya 10 fungsi yang diubah + 5 fungsi pembantu baru; kebijakan/trigger/constraint/ACL lain byte-identik; admin_umum_private.diubah tak berubah;
             terapkan_semua(true) tidak melaporkan DIUBAH/SISA; pembantu tidak dapat dipanggil peran API.
  adminonline : Admin Online tetap ditolak di fungsi-fungsi ini.
  rollback : ROLLBACK (definisi BASE + hapus pembantu) -> digest sama dengan BASE; pasang ulang berhasil.
  --baseline : kandidat TIDAK dipasang (BASE vs BASE): kasus perbaikan harus GAGAL (RED).
  --mutations: tiap mutan migrasi dipasang di klon BASE; setiap mutan harus dimatikan oleh minimal satu kasus.
    python3 -I scripts/test-admin-umum-batas-postgres.py --dev-root SOCKETDIR [--dev-template DB] [--json out.json] [--baseline] [--mutations] [--only a,b]
"""
import argparse, importlib.util, json, re, sys, uuid
from pathlib import Path

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
_spec = importlib.util.spec_from_file_location("umum_old", ROOT / "scripts/test-role-admin-umum-postgres.py")
old = importlib.util.module_from_spec(_spec); sys.modules["umum_old"] = old; _spec.loader.exec_module(old)
Cl, Db, q, has, errmsg, U = old.Cl, old.Db, old.q, old.has, old.errmsg, old.U
SUBJ, OWNER, ADMIN, UMUM, FIN, STAFF, AO, TARGET, CASHIER = old.SUBJ, old.OWNER, old.ADMIN, old.UMUM, old.FIN, old.STAFF, old.AO, old.TARGET, old.CASHIER
BR_A, BR_B, DUMMY = old.BR_A, old.BR_B, old.DUMMY
MIG = ROOT / "supabase/migrations/20261218200000_admin_umum_batas_peran.sql"
EMP, EMP2, NEWP = U(701), U(702), U(703)
ROLES7 = ["OWNER", "ADMIN", "ADMIN_UMUM", "FINANCE", "DOCTOR", "STAFF", "ADMIN_ONLINE"]
PRIV = ["OWNER", "ADMIN", "ADMIN_UMUM", "FINANCE"]
SAFE = ["DOCTOR", "STAFF", "ADMIN_ONLINE"]
ACTORS = ["OWNER", "ADMIN", "ADMIN_UMUM", "FINANCE"]
DIB = "ADMIN_UMUM_ROLE_DIBATASI"
CHANGED_FN = {"preflight_employee_account(uuid,text,uuid[])", "configure_employee_account(uuid,uuid,text,text,uuid[])", "edit_user_account(uuid,text,text,uuid[],text,uuid)",
              "user_account_edit_allowed(uuid)", "get_user_account_for_edit(uuid)", "recurring_require_finance()", "reopen_employee_branch_assignments(uuid,uuid[],date)",
              "end_employee_branch_assignment(uuid,uuid,date,text)", "set_employee_primary_branches(uuid[],uuid,text)", "get_wholesale_payroll_epoch(text)"}
NEW_FN = {"admin_umum_private.peran_istimewa(text)", "admin_umum_private.aktor_admin_umum()", "admin_umum_private.tolak_peran_istimewa(text)",
          "admin_umum_private.tolak_edit_akun(uuid,text)", "admin_umum_private.wajib_modul(text)"}
COMMENTED = ["public.setoran_role()", "public.setoran_penyetuju()"]


def ck(name, ok, detail=None, sec=None):
    return old.check(name, ok, detail, sec)


def oc(db, sql, user=SUBJ, role=None, value=False):
    try:
        out = db.val(sql, user, role)
        return ("OK:" + out[:300]) if value else "OK"
    except RuntimeError as e:
        return "ERR:" + errmsg(e)[:110]


# ----------------------------------------------------------------------------------------------- fixture + keadaan Akses Grup
def seed2(db):
    db.sql(f"insert into auth.users(id,raw_user_meta_data) values ({q(NEWP)},'{{\"full_name\":\"Akun Baru Uji\"}}'::jsonb);")
    db.sql(f"insert into public.employees(id,nama,status,branch_id) values ({q(EMP)},'Karyawan Bebas','Aktif',{q(BR_A)}),({q(EMP2)},'Karyawan Bebas 2','Aktif',{q(BR_A)});")
    db.sql(f"set session_replication_role=replica; update public.profiles set role='STAFF',is_active=true where id={q(NEWP)}; set session_replication_role=origin;")
    db.sql(f"insert into public.user_branches(user_id,branch_id,role) values ({q(FIN)},{q(BR_A)},'SECONDARY') on conflict do nothing;")
    # jurnal manual sumber (dibuat OWNER, di-commit) untuk Jurnal Berulang
    out = db.commit(f"select (public.create_manual_journal_atomic('jb-src', current_date, 'Jurnal sumber uji', {q(BR_A)}::uuid, jsonb_build_array("
                    f"jsonb_build_object('account_id',{old.JRN_ACCTS.split(',')[0].strip()},'debit',100000,'credit',0), jsonb_build_object('account_id',{old.JRN_ACCTS.split(',')[1].strip()},'debit',0,'credit',100000)))->>'entry_id')", OWNER)
    return out.strip()


def post_seed(db):
    """Sesudah kandidat terpasang (migrasi menolak bila sudah ada akun ADMIN_UMUM, seperti di hosted): satu akun ADMIN_UMUM lain sebagai target uji."""
    db.sql(f"set session_replication_role=replica; update public.profiles set role='ADMIN_UMUM',is_active=true where id={q(UMUM)}; set session_replication_role=origin;")


def acts_all(db):
    return old.enforced_actions(db) + ["jurnal.lihat", "jurnal.buat_manual", "jurnal.lihat_semua_sumber"]


def save_cfg(db, role, actions, modules, caps=None):
    c = old.cfg(db, role)
    caps = caps if caps is not None else c["capabilities"]
    return db.commit(f"select public.save_role_access_config({q(role)},{q(c['revision'])},{q(str(uuid.uuid4()))}::uuid,'custom',{q(json.dumps(modules))}::jsonb,{q(json.dumps(caps))}::jsonb,'uji batas',{q(json.dumps(actions))}::jsonb,null)::text", OWNER)


def reset_all(db):
    for r in ("ADMIN_UMUM", "ADMIN"):
        try:
            old.reset_cfg(db, r)
        except RuntimeError:
            pass


def set_state(db, st):
    reset_all(db)
    allmods = old.cfg(db, "ADMIN_UMUM")["modules"]
    if st == "default":
        return
    acts = acts_all(db)
    if st == "umum_lebar":      # Owner menyimpan konfigurasi terlebar eksplisit
        save_cfg(db, "ADMIN_UMUM", acts, allmods, {"all_branches": True, "create_accounts": True})
    elif st == "admin_hosted":  # ADMIN seperti di hosted: tanpa modul pengaturan/hris/buku-besar
        mods = [m for m in old.cfg(db, "ADMIN")["modules"] if m not in ("pengaturan", "hris", "buku-besar", "perusahaan")]
        save_cfg(db, "ADMIN", [a for a in acts if not a.startswith("jurnal.")], mods)
    elif st == "umum_nohris":
        save_cfg(db, "ADMIN_UMUM", acts, [m for m in allmods if m != "hris"])
    elif st == "umum_hris":
        save_cfg(db, "ADMIN_UMUM", acts, allmods if "hris" in allmods else allmods + ["hris"])
    elif st == "umum_tanpa_buat":
        save_cfg(db, "ADMIN_UMUM", [a for a in acts if a != "jurnal.buat_manual"], allmods)
    elif st == "umum_tanpa_bukubesar":
        save_cfg(db, "ADMIN_UMUM", acts, [m for m in allmods if m != "buku-besar"])
    else:
        raise ValueError(st)


# ----------------------------------------------------------------------------------------------- pengumpul hasil
def col_create(db, ctx):
    r = {}
    fast = ctx.get("fast")
    for st in (("default",) if fast else ("default", "umum_lebar", "admin_hosted")):
        set_state(db, st)
        for a in (("ADMIN", "ADMIN_UMUM") if fast else ACTORS):
            for ro in ROLES7:
                r[f"{st}|{a}|pre|{ro}"] = oc(db, f"select public.preflight_employee_account({q(EMP)},{q(ro)},array[{q(BR_A)}]::uuid[])", SUBJ, a)
                r[f"{st}|{a}|cfg|{ro}"] = oc(db, f"select public.configure_employee_account({q(NEWP)},{q(EMP)},'Nama Baru',{q(ro)},array[{q(BR_A)}]::uuid[])", SUBJ, a)
    reset_all(db)
    return r


def col_edit(db, ctx):
    r = {}
    ver = lambda t: f"(public.get_user_account_for_edit({q(t)})->>'version')"
    fast = ctx.get("fast")
    for st in (("default",) if fast else ("default", "umum_lebar", "admin_hosted")):
        set_state(db, st)
        for a in (("ADMIN", "ADMIN_UMUM") if fast else ("OWNER", "ADMIN", "ADMIN_UMUM")):
            k = f"{st}|{a}|"
            r[k + "er"] = oc(db, f"select (public.get_user_account_for_edit({q(TARGET)})->'editable_roles')::text", SUBJ, a, value=True)
            for ro in ROLES7:
                r[k + f"edit>{ro}"] = oc(db, f"select public.edit_user_account({q(TARGET)},'Calon Akun',{q(ro)},array[{q(BR_A)}]::uuid[],{ver(TARGET)},gen_random_uuid())::text", SUBJ, a)
            r[k + "edit-FIN"] = oc(db, f"select public.edit_user_account({q(FIN)},'Finance Fiktif','FINANCE',array[{q(BR_A)}]::uuid[],'versi-x',gen_random_uuid())::text", SUBJ, a)
            r[k + "edit-FIN>STAFF"] = oc(db, f"select public.edit_user_account({q(FIN)},'Finance Fiktif','STAFF',array[{q(BR_A)}]::uuid[],'versi-x',gen_random_uuid())::text", SUBJ, a)
            r[k + "get-FIN"] = oc(db, f"select public.get_user_account_for_edit({q(FIN)})::text", SUBJ, a)
            r[k + "get-ADMIN"] = oc(db, f"select public.get_user_account_for_edit({q(ADMIN)})::text", SUBJ, a)
            r[k + "get-STAFFtarget"] = oc(db, f"select (public.get_user_account_for_edit({q(TARGET)})->>'full_name')", SUBJ, a)
            r[k + "aktif-FIN"] = oc(db, f"select public.set_user_account_active({q(FIN)},false)", SUBJ, a)
            r[k + "link-FIN"] = oc(db, f"select public.link_employee_account({q(FIN)},{q(EMP2)})", SUBJ, a)
            r[k + "cabang-FIN"] = oc(db, f"select public.set_user_branch_assignment({q(FIN)},{q(BR_B)},'SECONDARY',false)::text", SUBJ, a)
            r[k + "aktif-STAFF"] = oc(db, f"select public.set_user_account_active({q(TARGET)},true)", SUBJ, a)
            r[k + "link-STAFF"] = oc(db, f"select public.link_employee_account({q(TARGET)},{q(EMP2)})", SUBJ, a)
            r[k + "cabang-STAFF"] = oc(db, f"select public.set_user_branch_assignment({q(TARGET)},{q(BR_B)},'SECONDARY',false)::text", SUBJ, a)
            r[k + "self"] = oc(db, f"select public.edit_user_account({q(SUBJ)},'Nama Sendiri Baru','{a}',array[{q(BR_A)}]::uuid[],{ver(SUBJ)},gen_random_uuid())::text", SUBJ, a)
    reset_all(db)
    return r


def col_jurnal(db, ctx):
    r = {}
    eid = ctx["entry_id"]
    fast = ctx.get("fast")
    for st in (("default", "umum_tanpa_buat") if fast else ("default", "umum_tanpa_buat", "umum_tanpa_bukubesar")):
        set_state(db, st)
        for a in (("ADMIN_UMUM", "ADMIN") if fast else ("ADMIN_UMUM", "ADMIN", "FINANCE", "OWNER", "STAFF")):
            k = f"{st}|{a}|"
            r[k + "preview-dummy"] = oc(db, f"select public.preview_recurring_journal_source({q(DUMMY)}::uuid)::text", SUBJ, a)
            r[k + "hasil-dummy"] = oc(db, "select coalesce(public.get_recurring_journal_source_result('k1')::text,'null')", SUBJ, a)
            r[k + "buat-dummy"] = oc(db, f"select public.create_recurring_journal_from_source('rk-d',{q(DUMMY)}::uuid,'{{}}'::jsonb,'Uji','2027-01',15,3,null,false,true)::text", SUBJ, a)
            r[k + "e2e"] = oc(db, f"select public.create_recurring_journal_from_source('rk-1',{q(eid)}::uuid,public.preview_recurring_journal_source({q(eid)}::uuid),'Uji berulang','2027-01',15,3,null,false,true)::text", SUBJ, a, value=True)[:140]
    reset_all(db)
    return r


def col_hris(db, ctx):
    r = {}
    calls = {
        "epoch": "select public.get_wholesale_payroll_epoch('2026-01')::text",
        "akhiri": f"select public.end_employee_branch_assignment({q(EMP)},{q(BR_B)},current_date,'alasan uji')::text",
        "utama": f"select public.set_employee_primary_branches(array[{q(EMP2)}]::uuid[],{q(BR_B)},'alasan uji')::text",
        "buka-lagi": f"select public.reopen_employee_branch_assignments({q(EMP)},array[{q(BR_B)}]::uuid[],current_date)::text",
        "tambah": f"select public.assign_employee_secondary_branches({q(EMP)},array[{q(BR_B)}]::uuid[],current_date)::text",
    }
    fast = ctx.get("fast")
    for st in (("default", "umum_nohris") if fast else ("default", "umum_nohris", "umum_hris")):
        set_state(db, st)
        for a in (("ADMIN_UMUM", "ADMIN") if fast else ("ADMIN_UMUM", "ADMIN", "OWNER", "FINANCE")):
            for n, s in calls.items():
                r[f"{st}|{a}|{n}"] = oc(db, s, SUBJ, a, value=True)[:130]
    reset_all(db)
    return r


def col_setoran(db, ctx):
    r = {}
    for ro in ROLES7 + ["STAFF"]:
        sj = (f"begin;set local session_replication_role=replica;update public.profiles set role='{ro}',is_active=true where id={q(SUBJ)};set local session_replication_role=origin;"
              f"select set_config('request.jwt.claim.sub',{q(SUBJ)},true),set_config('request.jwt.claims',{q(json.dumps(dict(sub=SUBJ, role='authenticated')))},true),set_config('request.jwt.claim.role','authenticated',true);"
              "select coalesce(public.setoran_role(),'-')||'|'||public.setoran_penyetuju()::text;rollback;")
        r[ro] = db.sql(sj).splitlines()[-1]
    r["comment_role"] = db.sql("select coalesce(obj_description('public.setoran_role()'::regprocedure),'')")
    r["comment_penyetuju"] = db.sql("select coalesce(obj_description('public.setoran_penyetuju()'::regprocedure),'')")
    return r


def col_ao(db, ctx):
    r = {}
    calls = {
        "pre": f"select public.preflight_employee_account({q(EMP)},'STAFF',array[{q(BR_A)}]::uuid[])",
        "cfg": f"select public.configure_employee_account({q(NEWP)},{q(EMP)},'Nama Baru','STAFF',array[{q(BR_A)}]::uuid[])",
        "edit": f"select public.edit_user_account({q(TARGET)},'Calon Akun','STAFF',array[{q(BR_A)}]::uuid[],'v',gen_random_uuid())::text",
        "get": f"select public.get_user_account_for_edit({q(TARGET)})::text",
        "epoch": "select public.get_wholesale_payroll_epoch('2026-01')::text",
        "buka": f"select public.reopen_employee_branch_assignments({q(EMP)},array[{q(BR_B)}]::uuid[],current_date)::text",
        "preview": f"select public.preview_recurring_journal_source({q(DUMMY)}::uuid)::text",
    }
    for n, s in calls.items():
        r[n] = oc(db, s, AO)
    return r


DIGEST_X = r"""
select 'F|'||p.oid::regprocedure::text||'|'||md5(pg_get_functiondef(p.oid)||'|'||coalesce(p.proacl::text,'')||'|'||coalesce(p.proconfig::text,'')||'|'||pg_get_userbyid(p.proowner)||'|'||coalesce(obj_description(p.oid,'pg_proc'),''))
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where p.prokind in ('f','p') and n.nspname not in ('pg_catalog','information_schema','extensions','auth','storage','realtime','vault','graphql','graphql_public','pgsodium','supabase_functions','supabase_migrations','net','cron','pgbouncer')
  and not exists (select 1 from pg_depend e where e.classid='pg_proc'::regclass and e.objid=p.oid and e.deptype='e')
union all
select 'P|'||pol.polrelid::regclass::text||'.'||pol.polname||'|'||md5(coalesce(pg_get_expr(pol.polqual,pol.polrelid),'')||'#'||coalesce(pg_get_expr(pol.polwithcheck,pol.polrelid),'')||'#'||pol.polcmd::text||'#'||pol.polpermissive::text||'#'||pol.polroles::text) from pg_policy pol
union all
select 'T|'||c.oid::regclass::text||'.'||t.tgname||'|'||md5(pg_get_triggerdef(t.oid)||t.tgenabled::text) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where not t.tgisinternal and n.nspname not in ('pg_catalog','information_schema')
union all
select 'C|'||conrelid::regclass::text||'.'||conname||'|'||md5(pg_get_constraintdef(oid)) from pg_constraint where connamespace not in ('pg_catalog'::regnamespace,'information_schema'::regnamespace)
union all
select 'R|'||c.oid::regclass::text||'|'||c.relrowsecurity::text||c.relforcerowsecurity::text||coalesce(c.relacl::text,'') from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind in ('r','p','v') and n.nspname not in ('pg_catalog','information_schema','pg_toast')
union all
select 'D|diubah|'||coalesce(md5(string_agg(jenis||':'||nama, ',' order by jenis, nama)),'-') from admin_umum_private.diubah
order by 1;
"""


def digest_x(db):
    d = {}
    for line in db.sql(DIGEST_X).splitlines():
        parts = line.split("|")
        if len(parts) >= 3:
            d[parts[0] + "|" + parts[1]] = parts[2]
    return d


def col_struct(db, ctx):
    r = {"digest": digest_x(db)}
    r["terapkan"] = db.sql("select coalesce(string_agg(distinct status, ',' order by status),'') from admin_umum_private.terapkan_semua(true)")
    r["terapkan_ubah"] = db.sql("select count(*)::text from admin_umum_private.terapkan_semua(true) where status in ('DIUBAH','SISA_TAK_DIKENAL')")
    r["helper_fn"] = db.sql("select coalesce(string_agg(p.oid::regprocedure::text,',' order by p.oid::regprocedure::text),'') from pg_proc p where p.pronamespace='admin_umum_private'::regnamespace and p.proname in ('peran_istimewa','aktor_admin_umum','tolak_peran_istimewa','tolak_edit_akun','wajib_modul')")
    r["acl"] = db.sql("select coalesce(string_agg(f||'='||(has_function_privilege('anon',f,'execute')::text||has_function_privilege('authenticated',f,'execute')::text||has_function_privilege('service_role',f,'execute')::text),';' order by f),'') "
                      "from unnest(array['admin_umum_private.peran_istimewa(text)','admin_umum_private.aktor_admin_umum()','admin_umum_private.tolak_peran_istimewa(text)','admin_umum_private.tolak_edit_akun(uuid,text)','admin_umum_private.wajib_modul(text)']) f "
                      "where to_regprocedure(f) is not null")
    r["schema_usage"] = db.sql("select has_schema_privilege('authenticated','admin_umum_private','usage')::text||has_schema_privilege('anon','admin_umum_private','usage')::text")
    r["cfg"] = db.sql("select count(*) filter (where p.proconfig = array['search_path=\"\"'])::text||'/'||count(*) filter (where p.prosecdef)::text from pg_proc p where p.pronamespace='admin_umum_private'::regnamespace and p.proname in ('peran_istimewa','aktor_admin_umum','tolak_peran_istimewa','tolak_edit_akun','wajib_modul')")
    chk = {"preflight_employee_account(uuid,text,uuid[])": r"perform admin_umum_private\.tolak_peran_istimewa\(p_role\)", "configure_employee_account(uuid,uuid,text,text,uuid[])": r"perform admin_umum_private\.tolak_peran_istimewa\(p_role\)",
           "edit_user_account(uuid,text,text,uuid[],text,uuid)": r"perform admin_umum_private\.tolak_edit_akun\(p_profile_id,p_role\)", "user_account_edit_allowed(uuid)": r"admin_umum_private\.peran_istimewa\(target\.role::text\)",
           "get_user_account_for_edit(uuid)": r"admin_umum_private\.peran_istimewa\(candidate\)", "recurring_require_finance()": r"public\.jurnal_aksi_diizinkan\('jurnal\.buat_manual'\)",
           "reopen_employee_branch_assignments(uuid,uuid[],date)": r"perform admin_umum_private\.wajib_modul\('hris'\)", "end_employee_branch_assignment(uuid,uuid,date,text)": r"perform admin_umum_private\.wajib_modul\('hris'\)",
           "set_employee_primary_branches(uuid[],uuid,text)": r"perform admin_umum_private\.wajib_modul\('hris'\)", "get_wholesale_payroll_epoch(text)": r"perform admin_umum_private\.wajib_modul\('hris'\)"}
    r["callsites"] = ",".join(sig for sig, rx in chk.items() if db.sql(f"select (prosrc ~ {q(rx)})::text from pg_proc where oid='public.{sig}'::regprocedure") != "true")
    r["akun_umum"] = db.sql("select count(*)::text from public.profiles where role::text='ADMIN_UMUM' and id<>" + q(UMUM))
    return r


COLLECT = {"create": col_create, "edit": col_edit, "jurnal": col_jurnal, "hris": col_hris, "setoran": col_setoran, "adminonline": col_ao, "struktur": col_struct}


# ----------------------------------------------------------------------------------------------- penegasan (BASE vs CAND)
def diffs(B, C, keys):
    return [k for k in keys if k in C and B.get(k) != C.get(k)]


def sts(C):
    return {k.split("|")[0] for k in C}


def acts_in(C, st):
    return {k.split("|")[1] for k in C if k.startswith(st + "|")}


def a_create(B, C):
    S = "create"
    for st in [x for x in ("default", "umum_lebar", "admin_hosted") if x in sts(C)]:
        for kind in ("pre", "cfg"):
            bad_priv = [ro for ro in PRIV if DIB not in C[f"{st}|ADMIN_UMUM|{kind}|{ro}"]]
            ck(f"create/{kind}/{st}: Admin Umum DITOLAK (pesan ADMIN_UMUM_ROLE_DIBATASI) untuk FINANCE, OWNER, ADMIN, ADMIN_UMUM", not bad_priv, {ro: C[f'{st}|ADMIN_UMUM|{kind}|{ro}'][:70] for ro in bad_priv}, S)
            same_safe = diffs(B, C, [f"{st}|ADMIN_UMUM|{kind}|{ro}" for ro in SAFE])
            ck(f"create/{kind}/{st}: Admin Umum tetap boleh STAFF/DOCTOR/ADMIN_ONLINE (hasil sama dengan sebelum perbaikan)", not same_safe, same_safe, S)
            for a in [x for x in ("OWNER", "ADMIN", "FINANCE") if x in acts_in(C, st)]:
                dd = diffs(B, C, [f"{st}|{a}|{kind}|{ro}" for ro in ROLES7])
                ck(f"create/{kind}/{st}: {a} TIDAK berubah (7 peran, hasil persis sama dengan sebelum perbaikan)", not dd, dd, S)
    ck("create: kontrol positif: Admin Umum bawaan boleh membuat STAFF/DOCTOR/ADMIN_ONLINE (preflight OK)", all(C[f"default|ADMIN_UMUM|pre|{ro}"] == "OK" for ro in SAFE), [C[f"default|ADMIN_UMUM|pre|{ro}"] for ro in SAFE], S)
    ck("create: kontrol positif: configure STAFF oleh Admin Umum bawaan berhasil", C["default|ADMIN_UMUM|cfg|STAFF"] == "OK", C["default|ADMIN_UMUM|cfg|STAFF"], S)
    if "default|OWNER|pre|FINANCE" in C:
        ck("create: OWNER tetap bisa membuat semua peran", all(C[f"default|OWNER|pre|{ro}"] == "OK" for ro in ROLES7), [C[f"default|OWNER|pre|{ro}"] for ro in ROLES7], S)
    ck("create: LUBANG LAMA terbukti pada BASE: Admin Umum bawaan lolos preflight FINANCE (bukti RED sebelum perbaikan)", B["default|ADMIN_UMUM|pre|FINANCE"] == "OK", B["default|ADMIN_UMUM|pre|FINANCE"], S)
    if "umum_lebar|ADMIN_UMUM|pre|FINANCE" in C:
        ck("create: Admin Umum dengan konfigurasi terlebar (semua modul + create_accounts) tetap ditolak FINANCE (aturan keras, bukan konfigurasi)", DIB in C["umum_lebar|ADMIN_UMUM|pre|FINANCE"] and DIB in C["umum_lebar|ADMIN_UMUM|cfg|FINANCE"], C["umum_lebar|ADMIN_UMUM|pre|FINANCE"][:80], S)
    ck("create: pesan penolakan berbahasa Indonesia yang jelas", "Admin Umum tidak boleh" in C["default|ADMIN_UMUM|pre|FINANCE"], C["default|ADMIN_UMUM|pre|FINANCE"][:110], S)


def a_edit(B, C):
    S = "edit"
    for st in [x for x in ("default", "umum_lebar", "admin_hosted") if x in sts(C)]:
        k = f"{st}|ADMIN_UMUM|"
        er = C[k + "er"]
        ck(f"edit/{st}: editable_roles Admin Umum TANPA FINANCE/OWNER/ADMIN/ADMIN_UMUM; ada STAFF, DOCTOR, ADMIN_ONLINE",
           all(f'"{x}"' not in er for x in PRIV) and all(f'"{x}"' in er for x in SAFE), er[:140], S)
        bad = [ro for ro in PRIV if DIB not in C[k + f"edit>{ro}"]]
        ck(f"edit/{st}: edit_user_account ke FINANCE/OWNER/ADMIN/ADMIN_UMUM oleh Admin Umum ditolak dengan pesan jelas", not bad, {ro: C[k + f'edit>{ro}'][:80] for ro in bad}, S)
        dd = diffs(B, C, [k + f"edit>{ro}" for ro in SAFE])
        ck(f"edit/{st}: ubah peran ke STAFF/DOCTOR/ADMIN_ONLINE oleh Admin Umum sama dengan BASE", not dd, dd, S)
        for name in ("edit-FIN", "edit-FIN>STAFF"):
            ck(f"edit/{st}: Admin Umum tidak bisa mengedit akun FINANCE orang lain ({name}; pesan jelas)", DIB in C[k + name], C[k + name][:100], S)
        for name in ("get-FIN", "aktif-FIN", "link-FIN", "cabang-FIN"):
            ck(f"edit/{st}: Admin Umum ditolak untuk akun FINANCE: {name}", C[k + name].startswith("ERR:") and "ACCOUNT_EDIT_DENIED" in C[k + name], C[k + name][:100], S)
        dd = diffs(B, C, [k + n for n in ("get-STAFFtarget", "aktif-STAFF", "link-STAFF", "cabang-STAFF", "self", "get-ADMIN")])
        ck(f"edit/{st}: akun STAFF, akun sendiri, akun ADMIN: Admin Umum sama dengan BASE (tidak ada pelebaran/penyempitan lain)", not dd, dd, S)
        for a in [x for x in ("OWNER", "ADMIN") if x in acts_in(C, st)]:
            dd = diffs(B, C, [kk for kk in B if kk.startswith(f"{st}|{a}|")])
            ck(f"edit/{st}: {a} TIDAK berubah (semua operasi edit persis sama dengan BASE)", not dd, dd, S)
    ck("edit: kontrol positif: Admin Umum bawaan: edit STAFF->DOCTOR berhasil, ubah nama sendiri berhasil", C["default|ADMIN_UMUM|edit>DOCTOR"] == "OK" and C["default|ADMIN_UMUM|self"] == "OK", [C["default|ADMIN_UMUM|edit>DOCTOR"], C["default|ADMIN_UMUM|self"]], S)
    if "default|OWNER|get-FIN" in C:
        ck("edit: kontrol positif: OWNER mengedit akun FINANCE (get-FIN) dan menetapkan FINANCE", C["default|OWNER|get-FIN"] == "OK" and C["default|OWNER|edit>FINANCE"] == "OK", [C["default|OWNER|get-FIN"], C["default|OWNER|edit>FINANCE"]], S)
    ck("edit: LUBANG LAMA pada BASE: Admin Umum bawaan melihat/mengedit akun FINANCE (get-FIN OK) dan FINANCE ada di editable_roles", B["default|ADMIN_UMUM|get-FIN"] == "OK" and '"FINANCE"' in B["default|ADMIN_UMUM|er"], [B["default|ADMIN_UMUM|get-FIN"], B["default|ADMIN_UMUM|er"][:100]], S)


def a_jurnal(B, C):
    S = "jurnal"
    k = "umum_tanpa_buat|ADMIN_UMUM|"
    for n in ("preview-dummy", "hasil-dummy", "buat-dummy", "e2e"):
        ck(f"jurnal berulang: Admin Umum tanpa izin jurnal.buat_manual DITOLAK ({n}) dengan pesan jelas", "Izin Buat jurnal manual belum diberikan" in C[k + n], C[k + n][:110], S)
    ck("jurnal berulang: LUBANG LAMA pada BASE: tanpa izin buat_manual, Admin Umum lolos gerbang (preview-dummy bukan galat izin)", "Izin Buat jurnal manual" not in B[k + "preview-dummy"], B[k + "preview-dummy"][:90], S)
    for st in [x for x in ("default", "umum_tanpa_bukubesar") if x in sts(C)]:
        dd = diffs(B, C, [kk for kk in B if kk.startswith(st + "|")])
        ck(f"jurnal berulang/{st}: semua peran sama dengan BASE (bawaan Admin Umum tetap boleh; pesan modul Buku Besar tetap yang pertama)", not dd, dd, S)
    dd = diffs(B, C, [kk for kk in B if kk.startswith("umum_tanpa_buat|") and "|ADMIN_UMUM|" not in kk])
    ck("jurnal berulang: peran lain (ADMIN, FINANCE, OWNER, STAFF) tidak berubah walau Admin Umum dicabut", not dd, dd, S)
    if "default|ADMIN_UMUM|e2e" in C:
        ck("jurnal berulang: kontrol positif: Admin Umum bawaan lolos gerbang dan membuat jadwal dari jurnal sumber", C["default|ADMIN_UMUM|e2e"].startswith("OK:"), C["default|ADMIN_UMUM|e2e"][:120], S)
        ck("jurnal berulang: pesan modul Buku Besar tetap pertama bagi Admin Umum yang modulnya dicabut", "Akses Buku Besar diperlukan" in C["umum_tanpa_bukubesar|ADMIN_UMUM|preview-dummy"], C["umum_tanpa_bukubesar|ADMIN_UMUM|preview-dummy"][:90], S)


def a_hris(B, C):
    S = "hris"
    calls = ("epoch", "akhiri", "utama", "buka-lagi", "tambah")
    for n in calls:
        ck(f"hris: Admin Umum tanpa modul HRIS ditolak di database ({n}; ROLE_ACTION_DENIED)", "ROLE_ACTION_DENIED" in C[f"umum_nohris|ADMIN_UMUM|{n}"], C[f"umum_nohris|ADMIN_UMUM|{n}"][:100], S)
        ck(f"hris: LUBANG LAMA pada BASE: tanpa modul HRIS Admin Umum lolos gerbang ({n})", "ROLE_ACTION_DENIED" not in B[f"umum_nohris|ADMIN_UMUM|{n}"], B[f"umum_nohris|ADMIN_UMUM|{n}"][:100], S)
    for st in [x for x in ("default", "umum_hris") if x in sts(C)]:
        dd = diffs(B, C, [f"{st}|ADMIN_UMUM|{n}" for n in calls])
        ck(f"hris/{st}: Admin Umum (bawaan atau modul HRIS dibuka) sama dengan BASE", not dd, dd, S)
    for a in [x for x in ("ADMIN", "OWNER", "FINANCE") if any(f"|{x}|" in kk for kk in C)]:
        dd = diffs(B, C, [kk for kk in B if f"|{a}|" in kk])
        ck(f"hris: {a} TIDAK berubah di semua keadaan (termasuk saat modul HRIS Admin Umum dicabut)", not dd, dd, S)
    if "default|ADMIN_UMUM|utama" in C:
        ck("hris: kontrol positif: Admin Umum bawaan menjalankan penugasan utama (utama OK)", C["default|ADMIN_UMUM|utama"].startswith("OK:"), C["default|ADMIN_UMUM|utama"][:90], S)


def a_setoran(B, C):
    S = "setoran"
    expect = {"OWNER": "OWNER|true", "FINANCE": "FINANCE|true", "ADMIN": "ADMIN|true", "ADMIN_UMUM": "ADMIN_UMUM|true", "STAFF": "STAFF|false", "DOCTOR": "-|false", "ADMIN_ONLINE": "-|false"}
    ck("setoran: penyetuju EKSPLISIT = OWNER, FINANCE, ADMIN, ADMIN_UMUM; STAFF masuk tapi bukan penyetuju; DOCTOR/ADMIN_ONLINE tidak masuk", all(C[r] == v for r, v in expect.items()), {r: C[r] for r in expect if C[r] != expect[r]}, S)
    ck("setoran: perilaku tidak berubah dibanding BASE (hanya COMMENT ditambah)", all(B[r] == C[r] for r in expect), None, S)
    ck("setoran: COMMENT mendokumentasikan penyetuju (menyebut ADMIN_UMUM dan 'SENGAJA') pada kedua fungsi", "ADMIN_UMUM" in C["comment_penyetuju"] and "SENGAJA" in C["comment_penyetuju"] and "ADMIN_UMUM" in C["comment_role"], [C["comment_penyetuju"][:60], C["comment_role"][:60]], S)


def a_ao(B, C):
    S = "adminonline"
    ck("adminonline: Admin Online tetap ditolak di preflight/configure/edit/get/epoch/penugasan/jurnal berulang (ADMIN_ONLINE_..._DENIED)", all(v.startswith("ERR:") and "ADMIN_ONLINE" in v for v in C.values()), {k: v[:70] for k, v in C.items() if not (v.startswith('ERR:') and 'ADMIN_ONLINE' in v)}, S)
    ck("adminonline: hasil sama dengan BASE", C == B, [k for k in C if C[k] != B.get(k)], S)


def a_struct(B, C, base_only=False):
    S = "struktur"
    bd, cd = B["digest"], C["digest"]
    changed = {k for k in bd if k in cd and bd[k] != cd[k]}
    added = {k for k in cd if k not in bd}
    gone = {k for k in bd if k not in cd}
    chg_f = {k[2:] for k in changed if k.startswith("F|")}
    exp = CHANGED_FN | {"setoran_role()", "setoran_penyetuju()"}
    chg_norm = {s.replace("public.", "", 1) if s.startswith("public.") else s for s in chg_f}
    ck("struktur: tepat 10 fungsi berubah + 2 fungsi setoran (hanya COMMENT), tidak ada yang lain", chg_norm == exp, sorted(chg_norm ^ exp), S)
    ck("struktur: kebijakan, trigger, constraint, RLS/ACL tabel, catatan admin_umum_private.diubah: TIDAK berubah", not [k for k in changed if k[0] in "PTCRD"] and not [k for k in added | gone if k[0] in "PTCRD"], sorted(k for k in changed | added | gone if k[0] in "PTCRD")[:6], S)
    new_f = {k[2:] for k in added if k.startswith("F|")}
    ck("struktur: fungsi baru hanya 5 pembantu di admin_umum_private", new_f == NEW_FN and not gone, sorted(new_f ^ NEW_FN), S)
    ck("struktur: ke-10 fungsi memanggil pembatas yang benar (bukan hanya kata kunci di komentar)", C["callsites"] == "", C["callsites"], S)
    ck("struktur: penulis ulang peran Admin Umum (terapkan_semua(true)) tidak melaporkan DIUBAH/SISA_TAK_DIKENAL (semantik tabel catatan terjaga)", C["terapkan_ubah"] == "0", (C["terapkan"], C["terapkan_ubah"]), S)
    ck("struktur: pembantu tidak dapat dipanggil anon/authenticated/service_role; skema tanpa USAGE", all(v.endswith("=falsefalsefalse") for v in C["acl"].split(";")) and len(C["acl"].split(";")) == 5 and C["schema_usage"] == "falsefalse", (C["acl"], C["schema_usage"]), S)
    ck("struktur: pembantu SECURITY DEFINER (kecuali peran_istimewa) dengan search_path kosong", C["cfg"] == "5/4", C["cfg"], S)
    ck("struktur: tidak ada akun ADMIN_UMUM baru yang diberikan oleh migrasi (jumlah akun ber-peran ini sama dengan BASE)", C["akun_umum"] == B["akun_umum"], (B["akun_umum"], C["akun_umum"]), S)


ASSERT = {"create": a_create, "edit": a_edit, "jurnal": a_jurnal, "hris": a_hris, "setoran": a_setoran, "adminonline": a_ao, "struktur": a_struct}


# ----------------------------------------------------------------------------------------------- rollback
def make_rollback(base_db):
    """SQL yang mengembalikan 10 fungsi ke definisi BASE (apa adanya), menghapus komentar, dan membuang 5 pembantu."""
    parts = ["begin;"]
    for sig in sorted(CHANGED_FN):
        d = base_db.sql(f"select pg_get_functiondef('public.{sig}'::regprocedure)")
        parts.append(d.rstrip() + ";")
    for f in COMMENTED:
        parts.append(f"comment on function {f} is null;")
    parts.append("comment on schema admin_umum_private is null;")
    for f in sorted(NEW_FN, reverse=True):
        parts.append(f"drop function {f};")
    parts.append("commit;")
    return "\n".join(parts)


def sec_rollback(cl, base_name, cand_name, ctx):
    S = "rollback"
    base, cand = Db(cl, base_name), Db(cl, cand_name)
    rb = make_rollback(base)
    (ctx["evidence"] / "ROLLBACK-native.sql").write_text(rb)
    cl.clone(cand_name, "auf_rb")
    Db(cl, "auf_rb").sql(rb)
    d0, d1 = digest_x(base), digest_x(Db(cl, "auf_rb"))
    diff = sorted(k for k in set(d0) | set(d1) if d0.get(k) != d1.get(k))
    ck("rollback: ROLLBACK (definisi BASE + hapus 5 pembantu) mengembalikan digest persis sama dengan sebelum migrasi", not diff, diff[:6], S)
    Db(cl, "auf_rb").sql("begin;\n" + MIG.read_text() + "\ncommit;")
    d2, dc = digest_x(Db(cl, "auf_rb")), digest_x(cand)
    diff2 = sorted(k for k in set(d2) | set(dc) if d2.get(k) != dc.get(k))
    ck("rollback: pasang ulang migrasi sesudah rollback berhasil dan hasilnya sama dengan pemasangan pertama", not diff2, diff2[:6], S)
    e = cl.err("auf_rb", "begin;\n" + MIG.read_text() + "\ncommit;")
    ck("rollback: pemasangan ganda ditolak (fungsi pembantu sudah ada: gagal tertutup, tidak setengah terpasang)", has(e, "ADMIN_UMUM_BATAS_PRECONDITION"), (e or "")[-120:], S)
    cl.run("postgres", "drop database if exists auf_rb;")


# ----------------------------------------------------------------------------------------------- mutan
def mutants(text):
    """(nama, [(lama, baru)], bagian). Tiap `lama` harus muncul TEPAT 1 kali. Kata kunci pemeriksa pasca-pasang dipertahankan lewat komentar."""
    P = "perform admin_umum_private.tolak_peran_istimewa(p_role);"
    M = []
    m = lambda n, e, s: M.append((n, e, s))
    m("preflight-tanpa-tolak", [(P + "\n if not exists(select 1 from public.profiles where id=auth.uid() and is_active and role='OWNER') and (", "/* tolak_peran_istimewa */\n if not exists(select 1 from public.profiles where id=auth.uid() and is_active and role='OWNER') and (")], ["create"])
    m("configure-tanpa-tolak", [(P + "\n if not exists(select 1 from public.profiles where id=auth.uid() and is_active and role='OWNER') then", "/* tolak_peran_istimewa */\n if not exists(select 1 from public.profiles where id=auth.uid() and is_active and role='OWNER') then")], ["create", "struktur"])
    m("edit-tanpa-tolak-edit-akun", [("perform admin_umum_private.tolak_edit_akun(p_profile_id,p_role);\n if not public.user_account_edit_allowed", "/* tolak_edit_akun */\n if not public.user_account_edit_allowed")], ["edit"])
    m("edit-allowed-tanpa-target-finance", [(" if actor.role='ADMIN_UMUM' and target.id<>actor.id and admin_umum_private.peran_istimewa(target.role::text) then return false;end if;", " /* peran_istimewa */")], ["edit"])
    m("editable-roles-tanpa-pengecualian", [("not (actor.role='ADMIN_UMUM' and admin_umum_private.peran_istimewa(candidate)) and (not candidate_all", "/* peran_istimewa */ (not candidate_all")], ["edit"])
    m("peran-istimewa-tanpa-finance", [("p_role in ('OWNER','ADMIN','ADMIN_UMUM','FINANCE'), false)", "p_role in ('OWNER','ADMIN','ADMIN_UMUM'), false)")], ["create", "edit"])
    m("peran-istimewa-tanpa-admin-umum", [("p_role in ('OWNER','ADMIN','ADMIN_UMUM','FINANCE'), false)", "p_role in ('OWNER','ADMIN','FINANCE'), false)")], ["create", "edit"])
    m("peran-istimewa-ditambah-doctor", [("p_role in ('OWNER','ADMIN','ADMIN_UMUM','FINANCE'), false)", "p_role in ('OWNER','ADMIN','ADMIN_UMUM','FINANCE','DOCTOR'), false)")], ["create", "edit"])
    m("aktor-berlaku-untuk-admin-juga", [("p.is_active and p.role::text = 'ADMIN_UMUM')\n$f$;", "p.is_active and p.role::text in ('ADMIN_UMUM','ADMIN'))\n$f$;")], ["create", "edit", "hris"])
    m("tolak-edit-akun-tanpa-pengecualian-diri", [("or p_profile_id is not distinct from auth.uid() then return; end if;", "then return; end if;")], ["edit"])
    m("tolak-edit-akun-tanpa-cek-target", [("  if exists (select 1 from public.profiles t where t.id = p_profile_id and admin_umum_private.peran_istimewa(t.role::text)) then", "  if false then")], ["edit"])
    m("tolak-edit-akun-tanpa-cek-peran-baru", [("  perform admin_umum_private.tolak_peran_istimewa(p_role);\n  if exists (select 1 from public.profiles t", "  if exists (select 1 from public.profiles t")], ["edit"])
    m("tolak-pesan-bukan-dibatasi", [("raise exception 'ADMIN_UMUM_ROLE_DIBATASI: Admin Umum tidak boleh membuat, memberikan, atau mengubah akun berperan Finance, Admin, Admin Umum, atau Super Admin (Owner). Hanya Super Admin yang boleh. Tidak ada yang disimpan.' using errcode = '42501';\n  end if;\nend $f$;\n\n-- Edit akun", "raise exception 'ACCOUNT_ROLE_NOT_ALLOWED' using errcode = '42501';\n  end if;\nend $f$;\n\n-- Edit akun")], ["create", "edit"])
    m("recurring-tanpa-cek", [("if v_actor.role='ADMIN_UMUM' and not public.jurnal_aksi_diizinkan('jurnal.buat_manual') then\n    raise exception 'Izin Buat jurnal manual belum diberikan untuk peran Admin Umum' using errcode='42501';\n  end if;\n  return v_actor.id;", "/* jurnal_aksi_diizinkan */\n  return v_actor.id;")], ["jurnal"])
    m("recurring-kunci-salah", [("not public.jurnal_aksi_diizinkan('jurnal.buat_manual') then\n    raise exception 'Izin Buat jurnal manual belum diberikan untuk peran Admin Umum'", "not public.jurnal_aksi_diizinkan('jurnal.koreksi_manual') then\n    raise exception 'Izin Buat jurnal manual belum diberikan untuk peran Admin Umum'")], ["jurnal"])
    m("hris-reopen-tanpa-gerbang", [("select pg_temp.batas_patch('public.reopen_employee_branch_assignments(uuid,uuid[],date)',\n  $a$perform admin_online_private.deny_admin_online();$a$,\n  $a$perform admin_online_private.deny_admin_online();\n  perform admin_umum_private.wajib_modul('hris');$a$);", "select pg_temp.batas_patch('public.reopen_employee_branch_assignments(uuid,uuid[],date)',\n  $a$perform admin_online_private.deny_admin_online();$a$,\n  $a$perform admin_online_private.deny_admin_online();\n  /* wajib_modul */$a$);")], ["hris"])
    m("hris-akhiri-tanpa-gerbang", [("select pg_temp.batas_patch('public.end_employee_branch_assignment(uuid,uuid,date,text)',\n  $a$perform admin_online_private.deny_admin_online();$a$,\n  $a$perform admin_online_private.deny_admin_online();\n  perform admin_umum_private.wajib_modul('hris');$a$);", "select pg_temp.batas_patch('public.end_employee_branch_assignment(uuid,uuid,date,text)',\n  $a$perform admin_online_private.deny_admin_online();$a$,\n  $a$perform admin_online_private.deny_admin_online();\n  /* wajib_modul */$a$);")], ["hris"])
    m("hris-utama-tanpa-gerbang", [("select pg_temp.batas_patch('public.set_employee_primary_branches(uuid[],uuid,text)',\n  $a$perform admin_online_private.deny_admin_online();$a$,\n  $a$perform admin_online_private.deny_admin_online();\n  perform admin_umum_private.wajib_modul('hris');$a$);", "select pg_temp.batas_patch('public.set_employee_primary_branches(uuid[],uuid,text)',\n  $a$perform admin_online_private.deny_admin_online();$a$,\n  $a$perform admin_online_private.deny_admin_online();\n  /* wajib_modul */$a$);")], ["hris"])
    m("hris-epoch-tanpa-gerbang", [("select pg_temp.batas_patch('public.get_wholesale_payroll_epoch(text)',\n  $a$perform admin_online_private.deny_admin_online();$a$,\n  $a$perform admin_online_private.deny_admin_online();\n  perform admin_umum_private.wajib_modul('hris');$a$);", "select pg_temp.batas_patch('public.get_wholesale_payroll_epoch(text)',\n  $a$perform admin_online_private.deny_admin_online();$a$,\n  $a$perform admin_online_private.deny_admin_online();\n  /* wajib_modul */$a$);")], ["hris"])
    m("hris-modul-salah", [("perform admin_umum_private.wajib_modul('hris');$a$);\nselect pg_temp.batas_patch('public.end_employee_branch_assignment", "perform admin_umum_private.wajib_modul('pengaturan');$a$);\nselect pg_temp.batas_patch('public.end_employee_branch_assignment")], ["hris"])
    m("wajib-modul-tanpa-konfigurasi-tersimpan", [("     and exists (select 1 from public.role_modules m where m.role = 'ADMIN_UMUM')\n", "")], ["hris"])
    m("wajib-modul-tanpa-cek-aktor", [("  if admin_umum_private.aktor_admin_umum()\n     and exists (select 1 from public.role_modules m where m.role = 'ADMIN_UMUM')", "  if true\n     and exists (select 1 from public.role_modules m where m.role = 'ADMIN_UMUM')")], ["hris"])
    m("wajib-modul-selalu-lolos", [("and not exists (select 1 from public.role_modules m where m.role = 'ADMIN_UMUM' and m.module_id = p_module) then", "and false then")], ["hris"])
    m("comment-setoran-dihapus", [("Penyetuju Rekap Setoran SENGAJA: OWNER, FINANCE, ADMIN, ADMIN_UMUM (Admin Umum sama seperti ADMIN, bukan lebih)", "Penyetuju Rekap Setoran (lama)")], ["setoran"])
    return M


def apply_mut(cl, base_name, name, text, edits):
    t = text
    for old_s, new_s in edits:
        n = t.count(old_s)
        if n != 1:
            return None, f"jangkar mutan muncul {n}x: {old_s[:70]!r}"
        t = t.replace(old_s, new_s)
    cl.clone(base_name, name)
    err = cl.err(name, "begin;\n" + t + "\ncommit;")
    if not err:
        post_seed(Db(cl, name))
    return (t, err)


def run_mutations(cl, base_name, ctx, args, base_res):
    text = MIG.read_text()
    base_name = "auf_tpl"  # klon dari templat (belum ada akun ADMIN_UMUM) supaya pemeriksa pasca-pasang migrasi lolos; post_seed dijalankan sesudah pasang
    killed, survived, broken = [], [], []
    for i, (name, edits, sections) in enumerate(mutants(text)):
        if args.mutant and name not in args.mutant.split(","):
            continue
        mdb = f"auf_m{i}"
        t, err = apply_mut(cl, base_name, mdb, text, edits)
        if t is None:
            broken.append((name, err)); print("MUTAN-RUSAK", name, err, flush=True); continue
        if err:
            broken.append((name, "galat pasang: " + err[-160:])); print("MUTAN-GALAT-PASANG", name, err[-160:], flush=True); continue
        before = len([r for r in old.RESULTS if r["status"] == "FAIL"])
        d = Db(cl, mdb); ctx["fast"] = True
        for s in sections:
            try:
                res = COLLECT[s](d, ctx)
                ASSERT[s](base_res[s], res)
            except Exception as e:  # noqa: BLE001
                old.RESULTS.append(dict(case=f"mutan {name}: crash {s}", status="FAIL", detail=repr(e)[:200], sec=s))
        after = len([r for r in old.RESULTS if r["status"] == "FAIL"])
        (killed if after > before else survived).append(name)
        print(("MUTAN-MATI " if after > before else "MUTAN-HIDUP ") + name, f"(+{after - before} gagal)", flush=True)
        cl.run("postgres", f"drop database if exists {mdb};")
    return killed, survived, broken


# ----------------------------------------------------------------------------------------------- utama
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pg-bin", default="/opt/data/kamo-pg-harness/bin")
    ap.add_argument("--dev-root", required=True)
    ap.add_argument("--dev-template", default="postgres")
    ap.add_argument("--json")
    ap.add_argument("--baseline", action="store_true")
    ap.add_argument("--mutations", action="store_true")
    ap.add_argument("--only", default="")
    ap.add_argument("--mutant", default="")
    ap.add_argument("--evidence", default="/opt/data/kamo-cost-missing-evidence/ship-admin-umum-fix")
    args = ap.parse_args()
    import os
    os.environ["PGHOST"] = args.dev_root
    cl = Cl(args.dev_root, args.pg_bin + "/psql")
    ctx = {"evidence": Path(args.evidence)}
    cl.run("postgres", "drop database if exists auf_tpl;"); cl.clone(args.dev_template, "auf_tpl")
    tpl = Db(cl, "auf_tpl")
    old.seed(tpl)
    ctx["entry_id"] = seed2(tpl)
    only = [x for x in args.only.split(",") if x] or list(COLLECT)
    cl.clone("auf_tpl", "auf_base"); cl.clone("auf_tpl", "auf_cand")
    if not args.baseline:
        Db(cl, "auf_cand").sql("begin;\n" + MIG.read_text() + "\ncommit;")
    base, cand = Db(cl, "auf_base"), Db(cl, "auf_cand")
    post_seed(base); post_seed(cand)
    base_res = {}
    for s in only:
        try:
            base_res[s] = COLLECT[s](base, ctx)
        except Exception as e:  # noqa: BLE001
            old.check(f"{s}: pengumpulan BASE tidak crash", False, repr(e)[:300], s); raise
    (ctx["evidence"] / "native-base-outcomes.json").write_text(json.dumps(base_res, indent=1, default=str))
    if args.mutations:
        killed, survived, broken = run_mutations(cl, "auf_base", ctx, args, base_res)
        ck(f"mutan: semua {len(killed) + len(survived)} mutan MATI", not survived and not broken, dict(hidup=survived, rusak=broken), "mutan")
        print(json.dumps(dict(killed=killed, survived=survived, broken=broken)))
        old.finish(args)
    for s in only:
        try:
            res = COLLECT[s](cand, ctx)
            ASSERT[s](base_res[s], res)
        except Exception as e:  # noqa: BLE001
            old.check(f"{s}: tidak crash", False, repr(e)[:300], s)
    if not args.baseline and (not only or "struktur" in only):
        sec_rollback(cl, "auf_base", "auf_cand", ctx)
    old.finish(args)


if __name__ == "__main__":
    main()
