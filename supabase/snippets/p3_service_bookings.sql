-- Phase 3 (P3) services: bookings + deposits + revenue separation
-- Apply in Supabase SQL editor (or via migrations).
--
-- Creates:
-- - public.service_bookings table (offline-first sync target)
-- - public.orders.sale_type ("product" | "service")
-- - public.orders.booking_id (link to service bookings; intentionally no FK for offline sync safety)

-- 1) Service bookings table (minimal fields)
create table if not exists public.service_bookings (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null,
  service_name text not null,
  customer_name text,
  booking_date_time timestamptz not null,
  deposit_amount numeric not null default 0,
  total_price numeric not null,
  status text not null default 'booked' check (status in ('booked','completed','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2) updated_at trigger helper (idempotent)
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists set_updated_at_service_bookings on public.service_bookings;
create trigger set_updated_at_service_bookings
before update on public.service_bookings
for each row execute function public.set_updated_at();

create index if not exists service_bookings_status_datetime_idx
  on public.service_bookings (status, booking_date_time);

-- 3) Orders: sale_type + booking_id
alter table public.orders
  add column if not exists sale_type text not null default 'product',
  add column if not exists booking_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'orders_sale_type_check'
  ) then
    alter table public.orders
      add constraint orders_sale_type_check
      check (sale_type in ('product','service'));
  end if;
end $$;

create index if not exists orders_sale_type_idx on public.orders (sale_type);
create index if not exists orders_booking_id_idx on public.orders (booking_id);

