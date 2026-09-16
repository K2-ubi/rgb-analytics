#!/usr/bin/env python3
"""Резервный сборщик чата для rgb-analytics.

Что делает:
- сидит в каналах сквада/академии + extra-каналах (рейды и ручные из config/lurker/extra)
- пишет чат за 2 суток в chat-log/{YYYY-MM-DD}/{userId}/{msgId}
- пишет присутствие в all-viewers, all-viewers/{uid}/channels, viewer-history
- ловит рейды (raids/{date}/... + автодобавление рейдера в config/lurker/extra)
- чистит chat-log старше 2 дней и raids старше 7 дней, при нехватке места (402/413/403) чистит самые старые дни
- heartbeat в config/lurker/status/{login}

Запуск:  python3 main.py
Env:
  BOT_NUM         номер бота: 1 или 2 (по умолчанию 2)
  WORKER_URL      например https://quiet-hat-2de7.konstasil777.workers.dev
  FIREBASE_SECRET секрет Firebase (для ?auth=)
  TWITCH_TOKEN    OAuth-токен бота (если задан — WORKER_URL не нужен)
  TWITCH_LOGIN    логин бота (если TWITCH_TOKEN задан)
"""
import asyncio
import json
import os
import random
import time
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timedelta, timezone

BOT_NUM = int(os.environ.get("BOT_NUM", "2"))
WORKER_URL = os.environ.get("WORKER_URL", "https://quiet-hat-2de7.konstasil777.workers.dev")
FIREBASE_SECRET = os.environ.get("FIREBASE_SECRET", "")
TWITCH_TOKEN = os.environ.get("TWITCH_TOKEN", "")
TWITCH_LOGIN = os.environ.get("TWITCH_LOGIN", "")
DB_BASE = "https://rgbsquad-892a2-default-rtdb.europe-west1.firebasedatabase.app"
CHAT_TTL_DAYS = 2
RAID_TTL_DAYS = 7
SYNC_INTERVAL = 60
HEARTBEAT_INTERVAL = 300
FLUSH_INTERVAL = 15
TTL_INTERVAL = 3600

CHAT_QUEUE = []
VIEWER_META = {}


def day_str(offset_days=0, ts=None):
    ts = ts or time.time() * 1000
    d = datetime.fromtimestamp(ts / 1000, tz=timezone.utc) + timedelta(days=offset_days)
    return d.strftime("%Y-%m-%d")


def fb_url(path):
    q = urllib.parse.urlencode({"auth": FIREBASE_SECRET})
    return f"{DB_BASE}/{path}.json?{q}"


def http(method, path, data=None, timeout=10):
    req = urllib.request.Request(fb_url(path), method=method)
    if data is not None:
        req.add_header("Content-Type", "application/json")
        body = json.dumps(data).encode("utf-8")
    else:
        body = None
    try:
        with urllib.request.urlopen(req, body, timeout) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def fb_get(path):
    st, body = http("GET", path)
    if st != 200:
        return None
    try:
        return json.loads(body)
    except Exception:
        return None


def fb_patch(path, data, _retried=False):
    st, _ = http("PATCH", path, data)
    if st in (402, 413, 403) and not _retried:
        print(f"[quota] PATCH {st} на {path} -> чищу старые чаты", flush=True)
        if trim_chat_log(2):
            fb_patch(path, data, _retried=True)


def fb_put(path, data, _retried=False):
    st, _ = http("PUT", path, data)
    if st in (402, 413, 403) and not _retried:
        print(f"[quota] PUT {st} на {path} -> чищу старые чаты", flush=True)
        if trim_chat_log(2):
            fb_put(path, data, _retried=True)


def fb_delete(path):
    http("DELETE", path)


def trim_chat_log(days):
    freed = False
    keys = fb_get("chat-log?shallow=true")
    if keys:
        sorted_days = sorted(keys)
        keep = sorted_days[-1:]
        to_del = [d for d in sorted_days if d not in keep][-days:]
        for d in to_del:
            fb_delete(f"chat-log/{d}")
            print(f"[quota] chat-log/{d} удалён", flush=True)
            freed = True
    keys2 = fb_get("raids?shallow=true")
    if keys2:
        sorted_days = sorted(keys2)
        keep = sorted_days[-1:]
        to_del = [d for d in sorted_days if d not in keep][-days:]
        for d in to_del:
            fb_delete(f"raids/{d}")
            freed = True
    return freed


def cleanup_ttl():
    keys = fb_get("chat-log?shallow=true") or {}
    for d in keys:
        if d < day_str(-CHAT_TTL_DAYS):
            fb_delete(f"chat-log/{d}")
            print(f"[ttl] chat-log/{d} удалён", flush=True)
    keys2 = fb_get("raids?shallow=true") or {}
    for d in keys2:
        if d < day_str(-RAID_TTL_DAYS):
            fb_delete(f"raids/{d}")


def read_all_viewer(uid):
    return fb_get(f"all-viewers/{urllib.parse.quote(uid, safe='')}")


def seed_viewer_meta(uid, login, display_name, now):
    if uid not in VIEWER_META:
        v = read_all_viewer(uid) or {}
        channels = {}
        for ch, cd in (v.get("channels") or {}).items():
            channels[ch] = {"firstSeen": cd.get("firstSeen", 0), "lastSeen": cd.get("lastSeen", 0)}
        VIEWER_META[uid] = {
            "login": login, "displayName": display_name,
            "firstSeen": v.get("firstSeen", 0), "lastSeen": v.get("lastSeen", 0),
            "channels": channels,
        }
    return VIEWER_META[uid]


def trim(s, n):
    return s[:n] if s and len(s) > n else s


def capture_message(channel, userstate, message, self):
    if self:
        return
    msg_id = userstate.get("id")
    uid = userstate.get("user-id")
    login = (userstate.get("username") or "").lower()
    display_name = userstate.get("display-name") or login
    ch_login = channel.lstrip("#").lower()
    if not msg_id or not uid or not login or not ch_login:
        return
    now = int(time.time() * 1000)
    CHAT_QUEUE.append({
        "date": day_str(), "uid": uid, "msgId": msg_id,
        "entry": {"c": ch_login, "l": login, "n": display_name, "m": trim(message, 300), "t": now},
        "chLogin": ch_login, "login": login, "displayName": display_name, "now": now,
    })


async def flush_chat_queue():
    if not CHAT_QUEUE:
        return
    batch = CHAT_QUEUE[:]
    CHAT_QUEUE.clear()
    by_day_uid = {}
    presence = {}
    for it in batch:
        key = f"{it['date']}|{it['uid']}"
        by_day_uid.setdefault(key, {})[it["msgId"]] = it["entry"]
        meta = seed_viewer_meta(it["uid"], it["login"], it["displayName"], it["now"])
        ch = meta["channels"].setdefault(it["chLogin"], {"firstSeen": it["now"], "lastSeen": it["now"]})
        ch["firstSeen"] = min(ch["firstSeen"] or it["now"], it["now"])
        ch["lastSeen"] = max(ch["lastSeen"] or 0, it["now"])
        meta["firstSeen"] = min(meta["firstSeen"] or it["now"], it["now"])
        meta["lastSeen"] = max(meta["lastSeen"] or 0, it["now"])
        presence.setdefault(it["uid"], {})[it["chLogin"]] = {
            "firstSeen": ch["firstSeen"], "lastSeen": ch["lastSeen"],
            "lastMessage": trim(it["entry"]["m"], 120),
            "login": it["login"], "displayName": it["displayName"],
        }
    for key, msgs in by_day_uid.items():
        date, uid = key.split("|", 1)
        await asyncio.to_thread(fb_patch, f"chat-log/{date}/{uid}", msgs)
    for uid, chs in presence.items():
        meta = VIEWER_META[uid]
        await asyncio.to_thread(fb_patch, f"all-viewers/{uid}",
                                {"login": meta["login"], "displayName": meta["displayName"],
                                 "firstSeen": meta["firstSeen"], "lastSeen": meta["lastSeen"]})
        for ch, p in chs.items():
            await asyncio.to_thread(fb_patch, f"all-viewers/{urllib.parse.quote(uid, safe='')}/channels/{ch}",
                                    {"firstSeen": p["firstSeen"], "lastSeen": p["lastSeen"], "lastMessage": p["lastMessage"]})
            await asyncio.to_thread(fb_patch, f"viewer-history/{ch}/{urllib.parse.quote(uid, safe='')}",
                                    {"login": p["login"], "displayName": p["displayName"],
                                     "firstSeen": p["firstSeen"], "lastSeen": p["lastSeen"]})


def get_target_channels():
    channels = set()
    users = fb_get("twitch-users")
    if users:
        for login, info in users.items():
            roles = info.get("roles") or {}
            if roles.get("squad") is True or roles.get("academy") is True:
                channels.add(login.lower())
    extra = fb_get("config/lurker/extra")
    if extra:
        for login, info in extra.items():
            if not (info and info.get("disabled")):
                channels.add(login.lower())
    return sorted(channels)


def capture_raid(userstate, channel):
    if userstate.get("msg-id") != "raid":
        return
    from_login = (userstate.get("msg-param-login") or userstate.get("msg-param-displayName") or "").lower()
    from_name = userstate.get("msg-param-displayName") or from_login
    to_channel = channel.lstrip("#").lower()
    viewers = int(userstate.get("msg-param-viewerCount") or 0) or 0
    now = int(time.time() * 1000)
    fb_put(f"raids/{day_str()}/{now}_{uuid.uuid4().hex[:6]}",
           {"from": from_login, "fromName": from_name, "to": to_channel, "viewers": viewers, "ts": now})
    if from_login:
        fb_patch(f"config/lurker/extra/{from_login}",
                 {"addedAt": now, "source": "raid", "viewers": viewers, "ts": now})
    print(f"[raid] {from_login or '?'} -> {to_channel} ({viewers} зр.)", flush=True)


def get_bot_credentials():
    if TWITCH_TOKEN and TWITCH_LOGIN:
        return TWITCH_TOKEN, TWITCH_LOGIN
    req = urllib.request.Request(
        f"{WORKER_URL}/api/token?bot={BOT_NUM}",
        headers={"X-Auth-Secret": FIREBASE_SECRET},
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            info = json.loads(r.read())
        return info["token"], info["login"]
    except Exception as e:
        raise RuntimeError(f"Не получил токен бота {BOT_NUM} из worker: {e}")


def heartbeat(login, channels):
    fb_put(f"config/lurker/status/{login}", {
        "ts": int(time.time() * 1000), "connected": True,
        "channels": list(channels), "version": f"justrunmeapp{BOT_NUM}-py",
    })


def parse_msg(line):
    """Минимальный парсер IRC. Возвращает (userstate, channel, message, tags)."""
    tags = {}
    rest = line
    if rest.startswith("@"):
        tags_raw, _, rest = rest[1:].partition(" ")
        for part in tags_raw.split(";"):
            if "=" in part:
                k, _, v = part.partition("=")
                tags[k] = v.replace("\\s", " ").replace("\\:", ";").replace("\\\\", "\\")
    prefix = None
    if rest.startswith(":"):
        prefix, _, rest = rest[1:].partition(" ")
    params = []
    if " :" in rest:
        before, _, after = rest.partition(" :")
        params = before.split(" ")[1:] if before else []
        params.append(after)
    else:
        parts = rest.split(" ")
        params = parts[1:]
    return prefix, params, tags


def make_userstate(tags, nick):
    return {
        "id": tags.get("id"),
        "user-id": tags.get("user-id"),
        "username": (nick or "").lower(),
        "display-name": tags.get("display-name") or nick or "",
        "msg-id": tags.get("msg-id"),
        "msg-param-login": tags.get("msg-param-login"),
        "msg-param-displayName": tags.get("msg-param-displayName"),
        "msg-param-viewerCount": tags.get("msg-param-viewerCount"),
    }


def main_loop():
    token, login = get_bot_credentials()
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    loop.run_until_complete(run_bot(token, login))


async def run_bot(token, login):
    import websockets

    channels = set()
    connected_clients = set()

    async def irc_loop():
        url = "wss://irc-ws.chat.twitch.tv:443"
        while True:
            try:
                async with websockets.connect(url, ping_interval=30, ping_timeout=10) as ws:
                    print(f"[{login}] connected", flush=True)
                    await ws.send("CAP REQ :twitch.tv/tags twitch.tv/commands")
                    await ws.send(f"PASS oauth:{token}")
                    await ws.send(f"NICK {login}")
                    await ws.send("JOIN " + " ".join("#" + c for c in channels))
                    async for raw in ws:
                        for line in raw.split("\r\n"):
                            if not line:
                                continue
                            if line.startswith("PING"):
                                await ws.send("PONG :tmi.twitch.tv")
                                continue
                            prefix, params, tags = parse_msg(line)
                            cmd = params[0] if params else ""
                            if cmd == "PRIVMSG":
                                nick = prefix.split("!")[0] if prefix else ""
                                userstate = make_userstate(tags, nick)
                                capture_message(params[0].lstrip("#"), userstate, " ".join(params[1:]), False)
                            elif cmd == "USERNOTICE":
                                nick = prefix.split("!")[0] if prefix else ""
                                userstate = make_userstate(tags, nick)
                                capture_raid(userstate, params[0])
                print(f"[{login}] disconnected, reconnecting", flush=True)
            except Exception as e:
                print(f"[{login}] error: {e}, reconnecting in 5s", flush=True)
            await asyncio.sleep(5)

    async def sync_loop():
        nonlocal channels
        while True:
            try:
                new_ch = set(get_target_channels())
                if new_ch != channels:
                    removed = channels - new_ch
                    added = new_ch - channels
                    channels = new_ch
                    print(f"[{login}] channels: {len(channels)} (+{len(added)} -{len(removed)})", flush=True)
            except Exception as e:
                print(f"[sync] error: {e}", flush=True)
            await asyncio.sleep(SYNC_INTERVAL)

    async def flush_loop():
        while True:
            await asyncio.sleep(FLUSH_INTERVAL)
            try:
                await flush_chat_queue()
            except Exception as e:
                print(f"[flush] error: {e}", flush=True)

    async def ttl_loop():
        await asyncio.sleep(TTL_INTERVAL)
        while True:
            try:
                cleanup_ttl()
            except Exception as e:
                print(f"[ttl] error: {e}", flush=True)
            await asyncio.sleep(TTL_INTERVAL)

    async def hb_loop():
        await asyncio.sleep(10)
        while True:
            try:
                asyncio.get_event_loop().run_in_executor(None, heartbeat, login, channels)
            except Exception as e:
                print(f"[hb] error: {e}", flush=True)
            await asyncio.sleep(HEARTBEAT_INTERVAL)

    await asyncio.gather(irc_loop(), sync_loop(), flush_loop(), ttl_loop(), hb_loop())


if __name__ == "__main__":
    import urllib.error
    while True:
        try:
            main_loop()
        except Exception as e:
            print(f"CRIT {e}, рестарт через 10s", flush=True)
            time.sleep(10)