-- shopapi migration 001: the schema PostgREST serves, a read-only web role
-- and a few rows. Idempotent: the Job runs it on every `pulumi up`.
create schema if not exists api;

create table if not exists api.items (
  id serial primary key,
  name text not null unique,
  price_cents integer not null check (price_cents >= 0),
  stock integer not null default 0
);

insert into api.items (name, price_cents, stock) values
  ('stimpak', 7500, 12),
  ('rad-away', 4000, 6),
  ('nuka-cola', 2000, 48)
on conflict (name) do nothing;

-- web_anon (nologin, granted to app) is made by pgcluster's initdb
-- postInitSQL: the app owner has no CREATEROLE.

grant usage on schema api to web_anon;
grant select on api.items to web_anon;

create table if not exists public.schema_migrations (version text primary key, applied_at timestamptz not null default now());
insert into public.schema_migrations (version) values ('001-shop') on conflict do nothing;
