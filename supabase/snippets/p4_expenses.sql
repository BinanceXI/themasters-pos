-- Phase 4 (P4) expenses + owner drawings (offline-first) + reporting support
-- Apply in Supabase SQL editor (or via migrations).

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),

  business_id uuid null,
  created_by uuid null default auth.uid(),
  source text not null default 'pos',

  occurred_at timestamptz not null default now(),
  category text not null,
  notes text null,
  amount numeric not null check (amount > 0),
  payment_method text null,
  expense_type text not null check (expense_type in ('expense','owner_drawing')),

  synced_at timestamptz null
);

create index if not exists expenses_occurred_at_idx on public.expenses (occurred_at);
create index if not exists expenses_expense_type_idx on public.expenses (expense_type);
create index if not exists expenses_category_idx on public.expenses (category);

alter table public.expenses enable row level security;

-- Minimal RLS (consistent with current app: Supabase session is minted when online).
-- If you later add a business/org model, tighten these policies to business_id.
drop policy if exists expenses_read_authenticated on public.expenses;
create policy expenses_read_authenticated
on public.expenses
for select
to authenticated
using (true);

drop policy if exists expenses_crud_authenticated on public.expenses;
create policy expenses_crud_authenticated
on public.expenses
for insert, update, delete
to authenticated
using (true)
with check (true);

