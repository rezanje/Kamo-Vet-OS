#!/usr/bin/env python3
"""LOCAL real GoTrue/PostgREST fallback when the Supabase DB image cannot fit.

Real GoTrue creates its auth schema. Storage is an explicit empty schema shim;
no storage API/service is claimed. Every project migration runs on PostgreSQL16.
This does NOT equal a clean Supabase CLI reset or a complete Supabase stack.
"""
from pathlib import Path
import argparse
import base64
import hashlib
import hmac
import json
import os
import subprocess
import time

RUNTIME = Path('/workspace/hris-local-runtime')
ROOT = Path(__file__).resolve().parents[1]
DOCKER = ['docker', '--host=unix:///var/run/docker.sock']
ENV = {k:v for k,v in os.environ.items() if k not in ['DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH']}


def docker(*args):
    result=subprocess.run([*DOCKER,*args],env=ENV,text=True,capture_output=True)
    if result.returncode:raise RuntimeError(result.stderr)
    return result.stdout.strip()


def sql(query):
    result=subprocess.run([*DOCKER,'exec','-i','supabase_db_vetos_hris_acceptance','psql','-U','postgres','-v','ON_ERROR_STOP=1'],input=query,text=True,env=ENV,capture_output=True)
    if result.returncode:raise RuntimeError(result.stderr)
    return result


def jwt(role, secret):
    def encode(value):
        return base64.urlsafe_b64encode(json.dumps(value,separators=(',',':')).encode()).rstrip(b'=')
    parts=encode({'alg':'HS256','typ':'JWT'})+b'.'+encode({'role':role,'iss':'supabase','iat':int(time.time()),'exp':int(time.time())+86400*7})
    return (parts+b'.'+base64.urlsafe_b64encode(hmac.new(secret.encode(),parts,hashlib.sha256).digest()).rstrip(b'=')).decode()


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--reset',action='store_true',help='Discard only the named fictional LOCAL containers/data')
    args=parser.parse_args()
    RUNTIME.mkdir(parents=True,exist_ok=True)
    if args.reset:
        for name in ['hris_local_auth','hris_local_rest','supabase_db_vetos_hris_acceptance']:
            subprocess.run([*DOCKER,'rm','-f',name],env=ENV,capture_output=True)
    networks=docker('network','ls','--format','{{.Name}}').splitlines()
    if 'vetos_hris_local' not in networks:docker('network','create','vetos_hris_local')
    containers=docker('ps','-a','--format','{{.Names}}').splitlines()
    if 'supabase_db_vetos_hris_acceptance' not in containers:
        docker('run','--name','supabase_db_vetos_hris_acceptance','--rm','-d','--network','vetos_hris_local','-p127.0.0.1:55422:5432','-e','POSTGRES_PASSWORD=fiction-local-only','postgres:16')
    for _ in range(100):
        ready=subprocess.run([*DOCKER,'exec','supabase_db_vetos_hris_acceptance','pg_isready','-h','127.0.0.1','-U','postgres'],env=ENV,capture_output=True)
        if ready.returncode==0:break
        time.sleep(.1)
    else:raise RuntimeError('Fictional local DB unavailable')
    secret='fiction-local-hris-acceptance-jwt-key-never-production'
    config={'API_URL':'http://127.0.0.1:55421','ANON_KEY':jwt('anon',secret),'SERVICE_ROLE_KEY':jwt('service_role',secret)}
    target=RUNTIME/'local-auth.json';target.write_text(json.dumps(config));target.chmod(0o600)
    sql("""create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;
      create role authenticator login noinherit password 'fiction-local-only';
      grant anon,authenticated,service_role to authenticator;
      create schema auth;create schema extensions;
      create extension if not exists pgcrypto with schema extensions;
      create schema storage;
      create table storage.buckets(id text primary key,name text,public boolean default false);
      create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,owner uuid);
      alter table storage.objects enable row level security;
      create publication supabase_realtime;
      grant usage on schema public,auth to anon,authenticated,service_role;
      alter default privileges for role postgres in schema public grant all on tables to anon,authenticated,service_role;
      alter default privileges for role postgres in schema public grant all on sequences to anon,authenticated,service_role;
      alter default privileges for role postgres in schema public grant execute on functions to anon,authenticated,service_role;
      create function auth.uid()returns uuid language sql stable as $$select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid$$;
      create function auth.role()returns text language sql stable as $$select nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role'$$;
    """)
    auth_env={
      'GOTRUE_API_HOST':'0.0.0.0','GOTRUE_API_PORT':'9999',
      'API_EXTERNAL_URL':config['API_URL'],'GOTRUE_SITE_URL':'http://127.0.0.1:3108',
      'GOTRUE_DB_DRIVER':'postgres','GOTRUE_DB_DATABASE_URL':'postgres://postgres:fiction-local-only@supabase_db_vetos_hris_acceptance:5432/postgres?search_path=auth',
      'GOTRUE_JWT_SECRET':secret,'GOTRUE_JWT_EXP':'3600','GOTRUE_JWT_AUD':'authenticated',
      'GOTRUE_JWT_ADMIN_ROLES':'service_role','GOTRUE_JWT_DEFAULT_GROUP_NAME':'authenticated',
      'GOTRUE_EXTERNAL_EMAIL_ENABLED':'true','GOTRUE_MAILER_AUTOCONFIRM':'true','GOTRUE_DISABLE_SIGNUP':'true',
    }
    args=['run','--rm','-d','--name','hris_local_auth','--network','vetos_hris_local','-p127.0.0.1:55424:9999']
    for k,v in auth_env.items():args.extend(['-e',f'{k}={v}'])
    docker(*args,'public.ecr.aws/supabase/gotrue:v2.186.0')
    rest_env={'PGRST_DB_URI':'postgres://authenticator:fiction-local-only@supabase_db_vetos_hris_acceptance:5432/postgres','PGRST_DB_SCHEMAS':'public','PGRST_DB_ANON_ROLE':'anon','PGRST_JWT_SECRET':secret,'PGRST_DB_EXTRA_SEARCH_PATH':'public,extensions','PGRST_DB_MAX_ROWS':'1000'}
    args=['run','--rm','-d','--name','hris_local_rest','--network','vetos_hris_local','-p127.0.0.1:55425:3000']
    for k,v in rest_env.items():args.extend(['-e',f'{k}={v}'])
    docker(*args,'public.ecr.aws/supabase/postgrest:v14.3')
    print('Started real LOCAL GoTrue:55424 and PostgREST:55425; gateway:55421 required. Empty STORAGE SHIM; explicit legacy default grants. No remote credentials read.')


if __name__=='__main__':main()
