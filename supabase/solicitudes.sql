-- Ejecutar una vez en el SQL Editor de Supabase.
create table if not exists public.content_requests (
 id bigint generated always as identity primary key,
 media_type text not null check(media_type in ('movie','tv')),
 tmdb_id bigint not null check(tmdb_id>0),
 title text not null,
 release_year text,
 poster_path text,
 votes integer not null default 1 check(votes>=1),
 status text not null default 'pending' check(status in ('pending','progress','added')),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(media_type,tmdb_id)
);
create table if not exists public.content_request_events (
 id bigint generated always as identity primary key,
 fingerprint text not null,
 media_type text not null,
 tmdb_id bigint not null,
 requested_on date not null default (now() at time zone 'utc')::date,
 created_at timestamptz not null default now(),
 unique(fingerprint,requested_on,media_type,tmdb_id)
);
create index if not exists request_events_rate_idx on public.content_request_events(fingerprint,requested_on);
alter table public.content_requests enable row level security;
alter table public.content_request_events enable row level security;
revoke all on public.content_requests from anon,authenticated;
revoke all on public.content_request_events from anon,authenticated;
create or replace function public.mmhd_submit_request(p_type text,p_tmdb_id bigint,p_title text,p_year text,p_poster text,p_fingerprint text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare n integer; present boolean; today date=(now() at time zone 'utc')::date;
begin
 if p_type not in ('movie','tv') or p_tmdb_id<1 or length(p_title)<1 or length(p_title)>200 or length(p_fingerprint)<>64 then
  raise exception 'Solicitud inválida';
 end if;
 -- Serializa peticiones de la misma huella para impedir saltarse el cupo con envíos paralelos.
 perform pg_advisory_xact_lock(hashtextextended(p_fingerprint,0));
 select count(*) into n from public.content_request_events where fingerprint=p_fingerprint and requested_on=today;
 select exists(select 1 from public.content_request_events where fingerprint=p_fingerprint and requested_on=today and media_type=p_type and tmdb_id=p_tmdb_id) into present;
 if present then return jsonb_build_object('duplicate',true,'limited',false);end if;
 if n>=5 then return jsonb_build_object('duplicate',false,'limited',true);end if;
 insert into public.content_request_events(fingerprint,media_type,tmdb_id,requested_on) values(p_fingerprint,p_type,p_tmdb_id,today);
 insert into public.content_requests(media_type,tmdb_id,title,release_year,poster_path)
 values(p_type,p_tmdb_id,p_title,p_year,p_poster)
 on conflict(media_type,tmdb_id) do update set votes=content_requests.votes+1,updated_at=now();
 return jsonb_build_object('duplicate',false,'limited',false);
end $$;
revoke execute on function public.mmhd_submit_request(text,bigint,text,text,text,text) from public,anon,authenticated;
grant execute on function public.mmhd_submit_request(text,bigint,text,text,text,text) to service_role;
-- Opcional: purgar huellas antiguas periódicamente. No elimina el total agregado.
-- delete from public.content_request_events where requested_on < current_date - 14;
