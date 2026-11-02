-- Visitor counter shown in About.
-- Run once in the Supabase dashboard: SQL Editor > New query > paste > Run. Safe to run again.
--
-- Each browser counts itself once (the editor remembers it in localStorage); later visits only
-- read the total. Visitors can't touch the table, only call the two functions.

create table if not exists public.visits (
  id integer primary key default 1 check (id = 1), -- a single row
  total bigint not null default 0
);
insert into public.visits (id) values (1) on conflict (id) do nothing;

alter table public.visits enable row level security;
revoke all on table public.visits from anon, authenticated;

-- Counts a new visitor; returns the new total.
create or replace function public.count_visitor() returns bigint
language sql security definer set search_path = '' as $$
  update public.visits set total = total + 1 where id = 1 returning total
$$;

create or replace function public.visitor_count() returns bigint
language sql stable security definer set search_path = '' as $$
  select total from public.visits where id = 1
$$;

revoke all on function public.count_visitor() from public;
revoke all on function public.visitor_count() from public;
grant execute on function public.count_visitor() to anon, authenticated;
grant execute on function public.visitor_count() to anon, authenticated;
