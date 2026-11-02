-- Shared HUD gallery (docs/SHARED-HUDS.md).
-- Run once in the Supabase dashboard: SQL Editor > New query > paste > Run. Safe to run again.
--
-- Visitors can only read the shared_huds view (which never shows edit_key) and call the
-- functions below. Authors prove ownership with the secret their browser generated (its SHA-256
-- is stored as edit_key); the admin is the signed-in account with the e-mail in hud_is_admin().

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.huds (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 40),
  author text not null check (char_length(author) between 1 and 24),
  cfg text not null check (octet_length(cfg) <= 204800 and cfg like '%hud\_%'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  edit_key text not null
);

create unique index if not exists huds_name_unique on public.huds (lower(name));
create index if not exists huds_edit_key on public.huds (edit_key);
create index if not exists huds_created_at on public.huds (created_at);

-- No direct table access: reads go through the view, writes through the functions.
alter table public.huds enable row level security;
revoke all on table public.huds from anon, authenticated;

create or replace view public.shared_huds as
  select id, name, author, cfg, created_at, updated_at from public.huds;
revoke all on public.shared_huds from anon, authenticated;
grant select on public.shared_huds to anon, authenticated;

-- ---------------------------------------------------------------- helpers (not callable by visitors)

create or replace function public.hud_key_hash(p_secret text) returns text
language sql immutable set search_path = '' as $$
  select encode(extensions.digest(coalesce(p_secret, ''), 'sha256'), 'hex')
$$;

create or replace function public.hud_is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from auth.users
    where id = auth.uid() and lower(email) = 'mushis@gmail.com' and email_confirmed_at is not null
  )
$$;

-- ---------------------------------------------------------------- author functions

-- Publishes a HUD; returns its id. At most 30 new HUDs per hour overall.
create or replace function public.share_hud(p_name text, p_author text, p_cfg text, p_secret text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if char_length(coalesce(p_secret, '')) < 20 then
    raise exception 'invalid key';
  end if;
  if (select count(*) from huds where created_at > now() - interval '1 hour') >= 30 then
    raise exception 'rate limit';
  end if;
  insert into huds (name, author, cfg, edit_key)
  values (btrim(p_name), btrim(p_author), p_cfg, hud_key_hash(p_secret))
  returning id into v_id;
  return v_id;
end
$$;

-- Changes name, author and/or cfg (null = keep). Allowed with the author's secret, or for the admin.
create or replace function public.update_hud(p_id uuid, p_secret text, p_name text, p_author text, p_cfg text) returns void
language plpgsql security definer set search_path = public as $$
begin
  update huds set
    name = coalesce(btrim(p_name), name),
    author = coalesce(btrim(p_author), author),
    cfg = coalesce(p_cfg, cfg),
    updated_at = now()
  where id = p_id and (edit_key = hud_key_hash(p_secret) or hud_is_admin());
  if not found then
    raise exception 'not allowed';
  end if;
end
$$;

create or replace function public.delete_hud(p_id uuid, p_secret text) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from huds where id = p_id and (edit_key = hud_key_hash(p_secret) or hud_is_admin());
  if not found then
    raise exception 'not allowed';
  end if;
end
$$;

-- Ids of the HUDs shared with this secret (marks "yours", and restores them from a recovery code).
create or replace function public.my_huds(p_secret text) returns setof uuid
language sql stable security definer set search_path = public as $$
  select id from huds where edit_key = hud_key_hash(p_secret)
$$;

-- ---------------------------------------------------------------- admin functions

create or replace function public.admin_status() returns boolean
language sql stable security definer set search_path = public as $$
  select hud_is_admin()
$$;

create or replace function public.admin_delete_author(p_author text) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_count integer;
begin
  if not hud_is_admin() then
    raise exception 'not allowed';
  end if;
  delete from huds where lower(author) = lower(btrim(p_author));
  get diagnostics v_count = row_count;
  return v_count;
end
$$;

create or replace function public.admin_delete_all() returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_count integer;
begin
  if not hud_is_admin() then
    raise exception 'not allowed';
  end if;
  delete from huds where true;
  get diagnostics v_count = row_count;
  return v_count;
end
$$;

-- ---------------------------------------------------------------- permissions

revoke all on function public.hud_key_hash(text) from public, anon, authenticated;
revoke all on function public.hud_is_admin() from public, anon, authenticated;
revoke all on function public.share_hud(text, text, text, text) from public;
revoke all on function public.update_hud(uuid, text, text, text, text) from public;
revoke all on function public.delete_hud(uuid, text) from public;
revoke all on function public.my_huds(text) from public;
revoke all on function public.admin_status() from public;
revoke all on function public.admin_delete_author(text) from public, anon;
revoke all on function public.admin_delete_all() from public, anon;

grant execute on function public.share_hud(text, text, text, text) to anon, authenticated;
grant execute on function public.update_hud(uuid, text, text, text, text) to anon, authenticated;
grant execute on function public.delete_hud(uuid, text) to anon, authenticated;
grant execute on function public.my_huds(text) to anon, authenticated;
grant execute on function public.admin_status() to anon, authenticated;
grant execute on function public.admin_delete_author(text) to authenticated;
grant execute on function public.admin_delete_all() to authenticated;
