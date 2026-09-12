-- ============================================================
-- Mariellas Wunschliste – Erweiterung 2
--   1. Bemerkungsfeld (z. B. Größe, Farbe)
--   2. Reservierungen mit eigenem Passwort
-- Komplett in den SQL Editor einfügen und ausführen.
-- ============================================================

-- ---------- 1. Bemerkung ------------------------------------

alter table public.wishes add column if not exists note text;

-- ---------- 2. Reservierungs-Passwörter ---------------------
-- Eigene Tabelle, damit der Hash nie über die API mitgelesen wird.

create table if not exists public.wish_locks (
  wish_id       uuid primary key references public.wishes(id) on delete cascade,
  password_hash text not null,
  created_at    timestamptz not null default now()
);

alter table public.wish_locks enable row level security;
revoke all on table public.wish_locks from anon, authenticated;

-- ---------- Alte Funktionen ablösen -------------------------

drop function if exists public.add_wish(text, text, text, text, text);
drop function if exists public.edit_wish(text, uuid, text, text, text, text);
drop function if exists public.set_reserved(uuid, boolean);

-- ---------- Wunsch anlegen (Admin) --------------------------

create or replace function public.add_wish(
  pw text, p_title text, p_link text, p_price text, p_image_url text, p_note text
) returns public.wishes
language plpgsql security definer
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

  insert into public.wishes (title, link, price, image_url, note)
  values (
    trim(p_title),
    nullif(trim(coalesce(p_link, '')), ''),
    nullif(trim(coalesce(p_price, '')), ''),
    nullif(trim(coalesce(p_image_url, '')), ''),
    nullif(trim(coalesce(p_note, '')), '')
  )
  returning * into w;
  return w;
end;
$$;

-- ---------- Wunsch bearbeiten (Admin) -----------------------

create or replace function public.edit_wish(
  pw text, p_id uuid, p_title text, p_link text, p_price text, p_image_url text, p_note text
) returns public.wishes
language plpgsql security definer
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
    image_url = nullif(trim(coalesce(p_image_url, '')), ''),
    note      = nullif(trim(coalesce(p_note, '')), '')
  where id = p_id
  returning * into w;
  return w;
end;
$$;

-- ---------- Reservieren -------------------------------------
-- Jede:r mit dem Link. Das gewählte Passwort wird als bcrypt-Hash abgelegt.

create or replace function public.reserve_wish(p_id uuid, pw text)
returns public.wishes
language plpgsql security definer
set search_path = public, extensions
as $$
declare w public.wishes;
begin
  if length(coalesce(trim(pw), '')) < 3 then
    raise exception 'Passwort zu kurz' using errcode = '22023';
  end if;

  select * into w from public.wishes where id = p_id for update;
  if not found then
    raise exception 'Wunsch nicht gefunden' using errcode = '02000';
  end if;
  if w.reserved then
    raise exception 'Schon reserviert' using errcode = '55006';
  end if;

  insert into public.wish_locks (wish_id, password_hash)
  values (p_id, extensions.crypt(trim(pw), extensions.gen_salt('bf')))
  on conflict (wish_id) do update
    set password_hash = excluded.password_hash, created_at = now();

  update public.wishes set reserved = true, reserved_at = now()
  where id = p_id returning * into w;
  return w;
end;
$$;

-- ---------- Reservierung aufheben ---------------------------
-- Nur mit demselben Passwort, das beim Reservieren gewählt wurde.

create or replace function public.release_wish(p_id uuid, pw text)
returns public.wishes
language plpgsql security definer
set search_path = public, extensions
as $$
declare w public.wishes; h text;
begin
  select password_hash into h from public.wish_locks where wish_id = p_id;
  if h is null or h <> extensions.crypt(coalesce(trim(pw), ''), h) then
    raise exception 'Falsches Passwort' using errcode = '28000';
  end if;

  delete from public.wish_locks where wish_id = p_id;
  update public.wishes set reserved = false, reserved_at = null
  where id = p_id returning * into w;
  return w;
end;
$$;

-- ---------- Notfall-Freigabe (Admin) ------------------------
-- Damit ein vergessenes Passwort keinen Wunsch dauerhaft blockiert.

create or replace function public.admin_release(pw text, p_id uuid)
returns public.wishes
language plpgsql security definer
set search_path = public, extensions
as $$
declare w public.wishes;
begin
  if not public.check_password(pw) then
    raise exception 'Falsches Passwort' using errcode = '28000';
  end if;
  delete from public.wish_locks where wish_id = p_id;
  update public.wishes set reserved = false, reserved_at = null
  where id = p_id returning * into w;
  return w;
end;
$$;

-- ---------- Rechte ------------------------------------------

grant execute on function public.add_wish(text, text, text, text, text, text)        to anon, authenticated;
grant execute on function public.edit_wish(text, uuid, text, text, text, text, text) to anon, authenticated;
grant execute on function public.reserve_wish(uuid, text)                            to anon, authenticated;
grant execute on function public.release_wish(uuid, text)                            to anon, authenticated;
grant execute on function public.admin_release(text, uuid)                           to anon, authenticated;
