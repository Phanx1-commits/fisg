-- Run once in the Supabase SQL Editor. The publishable key is safe for browser use
-- only because row-level security limits every row to its authenticated owner.
create table if not exists public.mt5_trades (
  user_id uuid not null references auth.users(id) on delete cascade,
  account_login text not null default 'manual',
  account_currency text not null default 'USD',
  ticket text not null,
  symbol text not null,
  type text not null default 'trade',
  volume numeric not null default 0,
  open_time timestamptz,
  close_time timestamptz not null,
  open_price numeric not null default 0,
  close_price numeric not null default 0,
  profit numeric not null default 0,
  swap numeric not null default 0,
  commission numeric not null default 0,
  net numeric not null default 0,
  created_at timestamptz not null default now(),
  primary key (user_id, account_login, ticket)
);
alter table public.mt5_trades add column if not exists account_login text not null default 'manual';
alter table public.mt5_trades add column if not exists account_currency text not null default 'USD';
alter table public.mt5_trades drop constraint if exists mt5_trades_pkey;
alter table public.mt5_trades add constraint mt5_trades_pkey primary key (user_id, account_login, ticket);

alter table public.mt5_trades enable row level security;
drop policy if exists "Users can read their own trades" on public.mt5_trades;
create policy "Users can read their own trades" on public.mt5_trades
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "Users can insert their own trades" on public.mt5_trades;
create policy "Users can insert their own trades" on public.mt5_trades
  for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "Users can update their own trades" on public.mt5_trades;
create policy "Users can update their own trades" on public.mt5_trades
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
drop policy if exists "Users can delete their own trades" on public.mt5_trades;
create policy "Users can delete their own trades" on public.mt5_trades
  for delete to authenticated using ((select auth.uid()) = user_id);

create table if not exists public.mt5_sync_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  mt5_login text not null,
  mt5_server text,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz,
  account_currency text
);
alter table public.mt5_sync_links add column if not exists account_currency text;
alter table public.mt5_sync_links add column if not exists account_balance numeric;
alter table public.mt5_sync_links add column if not exists account_equity numeric;
create unique index if not exists mt5_sync_links_user_login_key on public.mt5_sync_links(user_id, mt5_login);
alter table public.mt5_sync_links enable row level security;
drop policy if exists "Users can view their own MT5 links" on public.mt5_sync_links;
create policy "Users can view their own MT5 links" on public.mt5_sync_links
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "Users can create their own MT5 links" on public.mt5_sync_links;
create policy "Users can create their own MT5 links" on public.mt5_sync_links
  for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "Users can delete their own MT5 links" on public.mt5_sync_links;
create policy "Users can delete their own MT5 links" on public.mt5_sync_links
  for delete to authenticated using ((select auth.uid()) = user_id);

create table if not exists public.mt5_cashflows (
  user_id uuid not null references auth.users(id) on delete cascade,
  account_login text not null,
  account_currency text not null default 'USD',
  ticket text not null,
  flow_type text not null check (flow_type in ('deposit','withdrawal')),
  amount numeric not null,
  occurred_at timestamptz not null,
  primary key (user_id, account_login, ticket)
);
alter table public.mt5_cashflows enable row level security;
drop policy if exists "Users can read their own cashflows" on public.mt5_cashflows;
create policy "Users can read their own cashflows" on public.mt5_cashflows
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "Users can insert their own cashflows" on public.mt5_cashflows;
create policy "Users can insert their own cashflows" on public.mt5_cashflows
  for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "Users can update their own cashflows" on public.mt5_cashflows;
create policy "Users can update their own cashflows" on public.mt5_cashflows
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
drop policy if exists "Users can delete their own cashflows" on public.mt5_cashflows;
create policy "Users can delete their own cashflows" on public.mt5_cashflows
  for delete to authenticated using ((select auth.uid()) = user_id);
