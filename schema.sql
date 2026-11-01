-- Ejecutar en SQL Editor de Supabase. No modifica tablas de Solicitudes.
create table if not exists public.mmhd_library_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create table if not exists public.mmhd_library_items (
  id text primary key,
  item jsonb not null,
  version bigint not null default 1,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);
create table if not exists public.mmhd_library_meta (
  id integer primary key default 1 check (id=1),
  revision bigint not null default 0,
  updated_at timestamptz not null default now()
);
insert into public.mmhd_library_meta (id,revision) values (1,0) on conflict(id) do nothing;
alter table public.mmhd_library_admins enable row level security;
alter table public.mmhd_library_items enable row level security;
alter table public.mmhd_library_meta enable row level security;
-- Sin políticas públicas: solamente las APIs de servidor con service_role acceden a estas tablas.
revoke all on public.mmhd_library_admins, public.mmhd_library_items, public.mmhd_library_meta from anon, authenticated;

create or replace function public.mmhd_library_apply(p_changes jsonb, p_actor uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c jsonb; k text; ev bigint; current_v bigint; conflict_ids jsonb := '[]'::jsonb; cnt integer := 0;
begin
  perform pg_advisory_xact_lock(20261031, 1001);
  if jsonb_typeof(p_changes) <> 'array' or jsonb_array_length(p_changes) > 1000 then
    raise exception 'Lista de cambios inválida';
  end if;
  for c in select value from jsonb_array_elements(p_changes) loop
    k := c->>'id';
    if k is null or length(k)>120 or not (c ? 'expectedVersion') or (c ? 'item' and jsonb_typeof(c->'item') not in ('object','null')) then
      raise exception 'Cambio inválido';
    end if;
    select version into current_v from public.mmhd_library_items where id=k;
    ev := nullif(c->>'expectedVersion','')::bigint;
    if current_v is distinct from ev then conflict_ids := conflict_ids || to_jsonb(k); end if;
    cnt := cnt+1;
  end loop;
  if jsonb_array_length(conflict_ids)>0 then return jsonb_build_object('ok',false,'conflicts',conflict_ids); end if;
  for c in select value from jsonb_array_elements(p_changes) loop
    k := c->>'id';
    if (c->'item') is null or c->'item'='null'::jsonb then
      delete from public.mmhd_library_items where id=k;
    else
      insert into public.mmhd_library_items(id,item,version,updated_by)
      values (k,c->'item',1,p_actor)
      on conflict(id) do update set item=excluded.item,version=public.mmhd_library_items.version+1,updated_by=p_actor,updated_at=now();
    end if;
  end loop;
  if cnt>0 then update public.mmhd_library_meta set revision=revision+1,updated_at=now() where id=1; end if;
  return jsonb_build_object('ok',true,'count',cnt);
end $$;

create or replace function public.mmhd_library_seed(p_items jsonb,p_actor uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare it jsonb; ident text; cnt int := 0;
begin
  perform pg_advisory_xact_lock(20261031,1001);
  if exists(select 1 from public.mmhd_library_items limit 1) then return jsonb_build_object('ok',false,'reason','not_empty'); end if;
  if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)>5000 then raise exception 'Biblioteca inválida'; end if;
  for it in select value from jsonb_array_elements(p_items) loop
    ident:=it->>'id';
    if ident is null or length(ident)>120 or jsonb_typeof(it)<>'object' then raise exception 'Título inválido'; end if;
    insert into public.mmhd_library_items(id,item,version,updated_by) values(ident,it,1,p_actor);
    cnt:=cnt+1;
  end loop;
  update public.mmhd_library_meta set revision=revision+1,updated_at=now() where id=1;
  return jsonb_build_object('ok',true,'count',cnt);
end $$;
revoke execute on function public.mmhd_library_apply(jsonb,uuid) from public,anon,authenticated;
revoke execute on function public.mmhd_library_seed(jsonb,uuid) from public,anon,authenticated;
grant execute on function public.mmhd_library_apply(jsonb,uuid) to service_role;
grant execute on function public.mmhd_library_seed(jsonb,uuid) to service_role;

-- DESPUÉS de crear 2 usuarios en Supabase > Authentication > Users:
-- Sustituye los correos por los DOS correos verificados de tus administradores.
-- insert into public.mmhd_library_admins(user_id)
-- select id from auth.users where email in ('admin1@ejemplo.com','admin2@ejemplo.com')
-- on conflict(user_id) do nothing;
