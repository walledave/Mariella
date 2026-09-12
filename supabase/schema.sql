-- ============================================================
-- Mariellas Wunschliste – Supabase Schema
-- Einmal komplett in den SQL Editor einfügen und ausführen.
-- WICHTIG: unten bei 'HIER-DEIN-PASSWORT' dein Wunschpasswort eintragen.
-- ============================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------- Tabellen ----------------------------------------

create table if not exists public.wishes (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  title       text not null,
  link        text,
  price       text,
  image_url   text,
  reserved    boolean not null default false,
  reserved_at timestamptz
);

create table if not exists public.app_secret (
  id            int primary key default 1,
  password_hash text not null
);

-- ---------- Passwort setzen ---------------------------------
-- Ersetze HIER-DEIN-PASSWORT durch dein eigenes Passwort.

insert into public.app_secret (id, password_hash)
values (1, extensions.crypt('HIER-DEIN-PASSWORT', extensions.gen_salt('bf')))
on conflict (id) do update
  set password_hash = excluded.password_hash;

-- ---------- Row Level Security ------------------------------
-- wishes: jeder darf LESEN, niemand direkt schreiben.
-- app_secret: gar keine Policy -> über die API unlesbar.

alter table public.wishes     enable row level security;
alter table public.app_secret enable row level security;

drop policy if exists "wishes_public_read" on public.wishes;
create policy "wishes_public_read"
  on public.wishes for select
  to anon, authenticated
  using (true);

-- ---------- Funktionen --------------------------------------

create or replace function public.check_password(pw text)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare h text;
begin
  select password_hash into h from public.app_secret where id = 1;
  return h is not null and h = extensions.crypt(pw, h);
end;
$$;

-- Wunsch hinzufügen – nur mit Passwort
create or replace function public.add_wish(
  pw text, p_title text, p_link text, p_price text, p_image_url text
) returns public.wishes
language plpgsql
security definer
set search_path = public, extensions
as $$
declare w public.wishes;
begin
  if not public.check_password(pw) then
    raise exception 'Falsches Passwort' using errcode = '28000';
  end if;
  if coalesce(trim(p_title), '') = '' then
    raise exception 'Titel fehlt' using errcode = '22023';
  end if;

  insert into public.wishes (title, link, price, image_url)
  values (
    trim(p_title),
    nullif(trim(coalesce(p_link, '')), ''),
    nullif(trim(coalesce(p_price, '')), ''),
    nullif(trim(coalesce(p_image_url, '')), '')
  )
  returning * into w;
  return w;
end;
$$;

-- Wunsch löschen – nur mit Passwort
create or replace function public.delete_wish(pw text, p_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if not public.check_password(pw) then
    raise exception 'Falsches Passwort' using errcode = '28000';
  end if;
  delete from public.wishes where id = p_id;
end;
$$;

-- Wunsch bearbeiten – nur mit Passwort
create or replace function public.edit_wish(
  pw text, p_id uuid, p_title text, p_link text, p_price text, p_image_url text
) returns public.wishes
language plpgsql
security definer
set search_path = public, extensions
as $$
declare w public.wishes;
begin
  if not public.check_password(pw) then
    raise exception 'Falsches Passwort' using errcode = '28000';
  end if;

  update public.wishes set
    title     = trim(p_title),
    link      = nullif(trim(coalesce(p_link, '')), ''),
    price     = nullif(trim(coalesce(p_price, '')), ''),
    image_url = nullif(trim(coalesce(p_image_url, '')), '')
  where id = p_id
  returning * into w;
  return w;
end;
$$;

-- Reservieren / freigeben – ohne Passwort, jeder mit dem Link
create or replace function public.set_reserved(p_id uuid, p_value boolean)
returns public.wishes
language plpgsql
security definer
set search_path = public
as $$
declare w public.wishes;
begin
  update public.wishes set
    reserved    = p_value,
    reserved_at = case when p_value then now() else null end
  where id = p_id
  returning * into w;
  return w;
end;
$$;

-- ---------- Rechte ------------------------------------------
-- check_password darf NICHT direkt aufrufbar sein (sonst Rateversuche).

revoke all on function public.check_password(text) from public, anon, authenticated;

grant execute on function public.set_reserved(uuid, boolean) to anon, authenticated;
grant execute on function public.add_wish(text, text, text, text, text) to anon, authenticated;
grant execute on function public.delete_wish(text, uuid) to anon, authenticated;
grant execute on function public.edit_wish(text, uuid, text, text, text, text) to anon, authenticated;
