"""Mutants of 20261107890000_role_submenu_access.sql for scripts/test-role-submenu-postgres.py --mutations.
Each anchor must occur EXACTLY once in the migration (the harness asserts it); every mutant must fail >= 1 case."""

SAVE_WRITES_RESET = """if p_mode='reset' then
   delete from role_settings_private.submenu_policies where role::text=p_role;"""
PRUNE = """   delete from role_settings_private.submenu_policies s where s.role::text=p_role
   and not exists(select 1 from jsonb_array_elements_text(p_modules) m where m=s.module_id);"""
FULLSET_WHERE = """
   where (select count(*) from role_settings_private.submenu_catalog c where c.module_id=e.key)<>jsonb_array_length(e.value);"""
HASH_PART = """|| coalesce((select jsonb_build_object('submenus',jsonb_object_agg(s.module_id,to_jsonb(s.allowed) order by s.module_id)) from role_settings_private.submenu_policies s where s.role::text=p_role having count(*)>0),'{}'::jsonb)"""
OUT_PART = """|| jsonb_build_object('submenus',coalesce((select jsonb_object_agg(s.module_id,to_jsonb(s.allowed) order by s.module_id) from role_settings_private.submenu_policies s where s.role::text=p_role),'{}'::jsonb)) from effective e;"""
TRIGGER = """create trigger submenu_policy_guard before insert or update or delete on role_settings_private.submenu_policies
 for each row execute function role_settings_private.config_guard();"""
DUP = """or (select count(*)<>count(distinct x) from jsonb_array_elements(case when jsonb_typeof(e.value)='array' then e.value else '[]'::jsonb end) x)"""
GRANTED = """
     or not exists(select 1 from jsonb_array_elements_text(p_modules) m where m=e.key)"""
CROSS = """where jsonb_typeof(x)<>'string' or not exists(select 1 from role_settings_private.submenu_catalog c where c.id=x#>>'{}' and c.module_id=e.key))"""

MUTANTS = [
    ('read RPC returns every role\'s rows', "on s.role=p.role", "on true"),
    ('read RPC ignores inactive profile', "where p.id=auth.uid() and p.is_active and p.role<>'OWNER'", "where p.id=auth.uid() and p.role<>'OWNER'"),
    ('read RPC not bound to the caller', "where p.id=auth.uid() and p.is_active and p.role<>'OWNER'", "where p.is_active and p.role<>'OWNER'"),
    ('read RPC granted to anon', "grant execute on function public.get_my_submenu_policy() to authenticated;", "grant execute on function public.get_my_submenu_policy() to authenticated, anon;"),
    ('validation: id may belong to another module', CROSS, "where jsonb_typeof(x)<>'string' or not exists(select 1 from role_settings_private.submenu_catalog c where c.id=x#>>'{}'))"),
    ('validation: module need not be granted', GRANTED, ""),
    ('validation: duplicates allowed', DUP, "or false"),
    ('canonical: fully ticked module stored as a row', FULLSET_WHERE, ";"),
    ('older page save does not prune removed modules', PRUNE, "   null;"),
    ('reset keeps the sub-menu policy', SAVE_WRITES_RESET, "if p_mode='reset' then\n   null;"),
    ('reset accepts p_submenus', "or p_submenus is not null then", "then"),
    ('request payload ignores sub-menus (replay hash)', " || case when p_submenus is null then '{}'::jsonb else jsonb_build_object('submenus',p_submenus) end;", ";"),
    ('revision hash ignores sub-menu policy', HASH_PART, "|| '{}'::jsonb"),
    ('snapshot output omits submenus', OUT_PART, "from effective e;"),
    ('policy table has no guard trigger', TRIGGER, ""),
    ('catalog is missing one id', "('klinik.antrian','klinik'),\n", ""),
    ('old 8-argument save overload kept (ambiguous RPC)', "drop function public.save_role_access_config(text,text,uuid,text,jsonb,jsonb,text,jsonb);", ""),
    ('OWNER may hold a policy row', "role public.user_role not null check (role<>'OWNER'),", "role public.user_role not null,"),
]
