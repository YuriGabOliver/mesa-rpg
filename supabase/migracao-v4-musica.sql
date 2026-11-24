-- Mesa Leve v0.4 (música sincronizada).
-- PARA QUEM JÁ TEM O BANCO: cole tudo no SQL Editor do Supabase e clique em Run. Pode rodar mais de uma vez.
-- (Quem está começando do zero usa só o schema.sql, que já inclui isto.)

alter table public.mesas add column if not exists musica jsonb;  -- faixa atual da mesa (nula = nada tocando)
