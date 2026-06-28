-- VetOS Fase 1 — core/master schema (PRD §05, §13)

create type branch_type as enum ('PETSHOP','KLINIK','BOTH','DC','ONLINE','OFFICE');
create type warehouse_type as enum ('RETAIL','VET','EXPIRED','TRANSIT','ONLINE','DC');
create type user_role as enum ('OWNER','ADMIN','FINANCE','STAFF','DOCTOR');
create type branch_assignment_role as enum ('PRIMARY','SECONDARY');

create table branches (
  id uuid primary key default gen_random_uuid(),
  code varchar(15) not null unique,
  name varchar(100) not null,
  type branch_type not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table warehouses (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references branches(id) on delete restrict,
  code varchar(20) not null unique,
  name varchar(100) not null,
  type warehouse_type not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create index on warehouses(branch_id);

-- profiles.id == auth.users.id (Supabase standard)
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name varchar(100),
  role user_role not null default 'STAFF',
  created_at timestamptz not null default now()
);

-- multi-branch assignment (PRD §11.1 — dokter floating)
create table user_branches (
  user_id uuid not null references profiles(id) on delete cascade,
  branch_id uuid not null references branches(id) on delete cascade,
  role branch_assignment_role not null default 'PRIMARY',
  effective_date date not null default current_date,
  primary key (user_id, branch_id)
);

create table item_categories (
  id uuid primary key default gen_random_uuid(),
  name varchar(100) not null unique,
  track_expiry boolean not null default false,
  track_batch boolean not null default false
);

create table items (
  id uuid primary key default gen_random_uuid(),
  code varchar(50) not null unique,
  name varchar(200) not null,
  category_id uuid references item_categories(id) on delete set null,
  upc varchar(50),
  unit varchar(20) not null default 'pcs',
  sell_price numeric(15,2) not null default 0,
  buy_price numeric(15,2) not null default 0,
  min_stock numeric(15,4) not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table customers (
  id uuid primary key default gen_random_uuid(),
  name varchar(100) not null,
  phone varchar(30) not null,
  email varchar(120),
  dob date,
  address text,
  tier varchar(20) not null default 'New',
  points integer not null default 0,
  total_spending numeric(15,2) not null default 0,
  created_at timestamptz not null default now()
);
create index on customers(phone);

create table pets (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  name varchar(100) not null,
  species varchar(50),
  breed varchar(50),
  dob date,
  gender varchar(10),
  weight numeric(6,2),
  photo_url text,
  created_at timestamptz not null default now()
);
create index on pets(customer_id);

-- auto-create a profile row whenever an auth user is created
create function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, new.raw_user_meta_data ->> 'full_name');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
