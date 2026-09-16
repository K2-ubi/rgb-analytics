# Миграция на Supabase (почва для переноса)

Этот документ описывает, как текущие данные Firebase RTDB лягут на Supabase (PostgreSQL),
чтобы перенос был предсказуемым и не требовал переписывания всего фронтенда.

## Почему Supabase

- Открытый аналог Firebase (Apache 2.0, можно хостить самому)
- Ядро — PostgreSQL: SQL, индексы, сложные запросы, полнотекст
- Realtime — через logical replication (WebSocket), аналог RTDB-стримов
- Плоская цена: Free — 500MB, Pro — $25/мес за 8GB, без оплаты за операцию
- Firebase RTDB на Spark лимитирован (100 одновременных, 1GB) — для чата на 2 суток
  и рейдов это впритык; Supabase снимает страх за лимиты и позволяет TTL-чистки SQL'ом
- `pg_dump` → никакого вендор-лока

## Ключевое правило

Весь фронтенд ходит в данные ТОЛЬКО через `js/data-layer.js`.
Сейчас он читает RTDB, потом — Supabase REST (PostgREST) с теми же сигнатурами:
`getUserMessages(userId, days)`, `getUserChatByChannel(userId, days)`, `getRaids(days)`.
Боты (render/, lurker/, justrunmeapp1/2, worker) пишут в провайдер через слой записи.
Никакие другие файлы (tracker.js, main.js, admin.js) не знают, откуда данные.

## Маппинг путей RTDB → таблицы Postgres

### chat-log (сообщения за 2 суток, TTL-очистка)

RTDB:
```
chat-log/{YYYY-MM-DD}/{userId}/{msgId}
  { c: канал, l: логин, n: displayName, m: текст(≤300), t: ts }
```

Supabase:
```sql
create table chat_messages (
  msg_id    text primary key,          -- msgId из IRC-тегов (дедуп ботов)
  user_id   text not null,             -- Twitch user-id
  login     text not null,
  display_name text,
  channel   text not null,             -- c
  message   text not null,             -- m
  ts        bigint not null,           -- t (ms epoch)
  day       date generated always as (to_timestamp(ts/1000)::date) stored
);
create index chat_messages_user_idx on chat_messages (user_id, ts desc);
create index chat_messages_day_idx  on chat_messages (day);
```
TTL вместо DELETE по дням:
```sql
delete from chat_messages where ts < extract(epoch from now() - interval '2 days') * 1000;
-- cron / pg_cron раз в час
```

### all-viewers (профили зрителей)

RTDB:
```
all-viewers/{userId}/{login, displayName, firstSeen, lastSeen, ...}
all-viewers/{userId}/channels/{channel}/{firstSeen, lastSeen, lastMessage}
```

Supabase:
```sql
create table viewers (
  user_id      text primary key,
  login        text,
  display_name text,
  first_seen   bigint,
  last_seen    bigint,
  meta         jsonb          -- profileImageUrl, createdAt, description, categories...
);
create table viewer_channels (
  user_id      text references viewers(user_id) on delete cascade,
  channel      text,
  first_seen   bigint,
  last_seen    bigint,
  last_message text,
  primary key (user_id, channel)
);
create index viewer_channels_channel_idx on viewer_channels (channel);
```

### viewer-history (по каналам)

RTDB: `viewer-history/{channel}/{userId}/{login, displayName, firstSeen, lastSeen}`

Supabase — можно объединить с `viewer_channels`, добавив колонку `login/display_name`
или отдельную таблицу:
```sql
create table viewer_history (
  channel      text,
  user_id      text,
  login        text,
  display_name text,
  first_seen   bigint,
  last_seen    bigint,
  primary key (channel, user_id)
);
create index viewer_history_user_idx on viewer_history (user_id);
```

### raids (7 суток)

RTDB: `raids/{YYYY-MM-DD}/{key}` → `{ from, fromName, to, viewers, ts }`

Supabase:
```sql
create table raids (
  id        bigserial primary key,
  from_login text,
  from_name text,
  to_channel text,
  viewers   int,
  ts        bigint
);
create index raids_ts_idx on raids (ts desc);
```

### config / config.lurker

RTDB: `config/lurker/extra/{channel}` → `{ addedAt, source:'raid'|'manual', viewers, ts, disabled? }`

Supabase:
```sql
create table lurker_extra (
  channel  text primary key,
  added_at bigint,
  source   text,
  viewers  int,
  disabled boolean default false
);
```
Остальной config (bot, tg-chat-id, commands...) — обычная таблица `config` (key/value jsonb)
или остаётся в RTDB до конца.

### Служебные (twitch-users, stream-chunks, stats)

- `twitch-users/{login}` → таблица `twitch_users` (login pk, roles jsonb, displayName...)
- `stream-chunks` → `stream_chunks (login, date, ts, viewers, updatedAt)` — as-is
- `userStats`, `stats`, `stream-cache` → отдельные таблицы по мере надобности
- `squad`, `creators` → `squad_members` / `creators`

## Аутентификация и RLS

- Auth — Supabase Auth (GoTrue), есть провайдеры Google/Email; Twitch OAuth идёт через
  наш worker, в Supabase храним только uid/роли
- RLS: `enable row level security` на всех таблицах
  - `select` — для авторизованных (как сейчас `.read: auth.uid !== null`)
  - `insert/update/delete` — только для сервисного ключа ботов (RLS запрещает клиенту)
  - админ-действия (роли) — через отдельную функцию с `security definer` по проверке роли

## План перехода (поэтапно, без даунтайма)

1. `js/data-layer.js` уже вынесен общий доступ на фронте — фронт не знает провайдера.
2. Поднять Supabase-проект, создать таблицы (DDL выше), включить RLS.
3. Написать сервис синка: читает RTDB (chat-log, all-viewers, raids) → пишет в Postgres один раз.
4. Фронт переключается на PostgREST через `dataLayer` (аналогичные методы), RTDB остаётся для записи.
5. Боты пишут в оба источника на время перехода, потом RTDB отключается.

## Лимиты и цены (актуально на 2026)

| | Firebase RTDB (Spark) | Supabase Free | Supabase Pro |
|---|---|---|---|
| База | 1GB (ужмётся на чате) | 500MB | 8GB ($25/мес flat) |
| Realtime | + | + (logical replication) | + |
| Оплата за операцию | есть (Blaze) | нет | нет |
| Самохостинг | нет | да (Docker/K8s) | да |