-- ============================================================
-- Supabase schema для RGB Analytics
-- Запускать в SQL Editor проекта Supabase (или psql).
-- Соответствует SUPABASE-MIGRATION.md.
-- ============================================================

-- ============================================================
-- chat_messages: чат за 2 суток (TTL-очистка, дедуп по msg_id)
-- ============================================================
create table if not exists chat_messages (
  msg_id       text primary key,             -- msgId из IRC-тегов (уникален, дедуп ботов)
  user_id      text not null,                -- Twitch user-id
  login        text not null,
  display_name text,
  channel      text not null,                -- канал без '#'
  message      text not null,                -- текст (≤300)
  ts           bigint not null,              -- ms epoch
  created_at   timestamptz not null default now()
);
create index if not exists chat_messages_user_idx on chat_messages (user_id, ts desc);
create index if not exists chat_messages_channel_idx on chat_messages (channel, ts desc);
create index if not exists chat_messages_ts_idx on chat_messages (ts);

-- ============================================================
-- viewers: профили зрителей (всё, что было в all-viewers)
-- ============================================================
create table if not exists viewers (
  user_id      text primary key,
  login        text,
  display_name text,
  first_seen   bigint,
  last_seen    bigint,
  meta         jsonb default '{}'::jsonb   -- profileImageUrl, createdAt, description, ...
);
create index if not exists viewers_login_idx on viewers (login);

-- каналы, где зритель замечен (all-viewers/{uid}/channels)
create table if not exists viewer_channels (
  user_id      text not null references viewers(user_id) on delete cascade,
  channel      text not null,
  first_seen   bigint,
  last_seen    bigint,
  last_message text,
  primary key (user_id, channel)
);
create index if not exists viewer_channels_channel_idx on viewer_channels (channel);

-- ============================================================
-- viewer_history: по каналам (то, что лежало в viewer-history/)
-- ============================================================
create table if not exists viewer_history (
  channel      text not null,
  user_id      text not null,
  login        text,
  display_name text,
  first_seen   bigint,
  last_seen    bigint,
  primary key (channel, user_id)
);
create index if not exists viewer_history_user_idx on viewer_history (user_id);

-- ============================================================
-- raids: рейды за 7 суток
-- ============================================================
create table if not exists raids (
  id          bigserial primary key,
  src_key     text unique,               -- YYYY-MM-DD/ключ из RTDB (для идемпотентного синка)
  from_login  text,
  from_name   text,
  to_channel  text,
  viewers     int,
  ts          bigint not null,
  created_at  timestamptz not null default now()
);
create index if not exists raids_ts_idx on raids (ts desc);

-- ============================================================
-- lurker_extra: каналы для слежки (рейды автоматически + вручную)
-- ============================================================
create table if not exists lurker_extra (
  channel   text primary key,
  added_at  bigint,
  source    text default 'manual',       -- 'raid' | 'manual'
  viewers   int,
  disabled  boolean default false
);

-- ============================================================
-- twitch_users: участники (сквад, академия, роли)
-- ============================================================
create table if not exists twitch_users (
  login        text primary key,
  display_name text,
  roles        jsonb default '{}'::jsonb,  -- { admin, squad, academy }
  meta         jsonb default '{}'::jsonb   -- twitchId, profileImageUrl, ...
);

-- ============================================================
-- stream_chunks: срезы онлайна смотрения
-- ============================================================
create table if not exists stream_chunks (
  login      text not null,
  day        text not null,               -- YYYY-MM-DD
  ts         bigint not null,
  viewers    int,
  updated_at bigint,
  primary key (login, day, ts)
);
create index if not exists stream_chunks_day_idx on stream_chunks (day);

-- ============================================================
-- config: оставшийся конфиг (ключ-значение jsonb)
-- ============================================================
create table if not exists config (
  key   text primary key,
  value jsonb
);

-- ============================================================
-- TTL-очистка: chat 2 суток, raids 7 суток, stream_chunks 90 дней
-- Вызывать из pg_cron или любым планировщиком раз в час.
-- ============================================================
create or replace function cleanup_ttl() returns void language plpgsql as $$
begin
  delete from chat_messages where ts < (extract(epoch from now() - interval '2 days') * 1000)::bigint;
  delete from raids where ts < (extract(epoch from now() - interval '7 days') * 1000)::bigint;
  delete from stream_chunks where ts < (extract(epoch from now() - interval '90 days') * 1000)::bigint;
end $$;

-- ============================================================
-- RLS: клиенты читают, пишут только сервисные боты (service role)
-- ============================================================
alter table chat_messages enable row level security;
alter table viewers enable row level security;
alter table viewer_channels enable row level security;
alter table viewer_history enable row level security;
alter table raids enable row level security;
alter table lurker_extra enable row level security;
alter table twitch_users enable row level security;
alter table stream_chunks enable row level security;
alter table config enable row level security;

-- чтение — авторизованным
create policy chat_messages_read on chat_messages for select to authenticated using (true);
create policy viewers_read on viewers for select to authenticated using (true);
create policy viewer_channels_read on viewer_channels for select to authenticated using (true);
create policy viewer_history_read on viewer_history for select to authenticated using (true);
create policy raids_read on raids for select to authenticated using (true);
create policy lurker_extra_read on lurker_extra for select to authenticated using (true);
create policy twitch_users_read on twitch_users for select to authenticated using (true);
create policy stream_chunks_read on stream_chunks for select to authenticated using (true);
create policy config_read on config for select to authenticated using (true);

-- запись — только service role (боты), клиентам запрещено.
-- service role идёт в обход RLS, поэтому просто НЕ создаём insert/update/delete политики.
-- (Если нужно дать клиенту писать — добавить отдельную политику по конкретным полям.)

-- опционально: разрешить клиенту читать только свой чат (строже, если захочешь)
-- create policy chat_messages_read_own on chat_messages
--   for select to authenticated using (user_id = auth.jwt() ->> 'sub');