-- Mesa Leve v0.7: central de efeitos e chat.
-- Execute no SQL Editor do Supabase para atualizar uma instalação existente.
alter table public.mesas add column if not exists efeitos jsonb not null default '[]'::jsonb;

create table if not exists public.chat (
  id bigint generated always as identity primary key,
  mesa text not null references public.mesas(id) on delete cascade,
  dados jsonb not null
);
create index if not exists chat_mesa_idx on public.chat (mesa, id);
alter table public.chat enable row level security;
grant usage on schema public to service_role;
grant all on public.chat to service_role;
grant all on sequence public.chat_id_seq to service_role;
