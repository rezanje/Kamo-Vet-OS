create role authenticated;create role anon;create role service_role;
create schema auth;
create function auth.uid()returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create function auth.role()returns text language sql stable as $$select current_setting('request.jwt.claim.role',true)$$;
grant usage on schema public,auth to authenticated,anon;
create table profiles(id uuid primary key,role text,is_active boolean default true);
create table role_capabilities(role text primary key,all_branches boolean,create_accounts boolean);
create table role_modules(role text,module_id text);
create table branches(id uuid primary key,is_active boolean default true);
create table user_branches(user_id uuid,branch_id uuid);
create table visits(id uuid primary key,pet_id uuid,branch_id uuid,status text,checked_in_at timestamptz,service_started_at timestamptz,service_finished_at timestamptz,checked_out_at timestamptz,dokter text,doctor_id uuid,service_provider_id uuid,keluhan text);
create table medical_records(id uuid primary key,visit_id uuid references visits(id),diagnosis text,therapy text,anamnesis text,suhu numeric(5,2),berat numeric(6,2),gejala_klinis text,hasil_penunjang text,follow_up text,catatan_resep text,penunjang_urls text[],created_at timestamptz default now(),submission_key text,submission_hash text,submitted_by uuid);
create table invoices(id uuid primary key,visit_id uuid references visits(id),voided_at timestamptz,paid_status text);
create table prescription_items(id uuid primary key,medical_record_id uuid references medical_records(id),nama_obat text,qty int);
create table compounding_recipes(id uuid primary key,medical_record_id uuid references medical_records(id),status text);
create table stock(item_id uuid,qty numeric);create table journal_entries(id uuid,source text);
grant select,insert,update,delete on all tables in schema public to authenticated;
alter table visits enable row level security;alter table medical_records enable row level security;alter table invoices enable row level security;

