╔══════════════════════════════════════════════════════════════╗
║         RGB ANALYTICS — ИНСТРУКЦИЯ ПО БЕЗОПАСНОСТИ         ║
╚══════════════════════════════════════════════════════════════╝

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 1. ЧТО БЫЛО ИСПРАВЛЕНО
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ УЯЗВИМОСТЬ 1: Открытая Firebase
   — Создан firebase-rules.json с правилами доступа:
     * /admins — только админы (читают и пишут)
     * /twitch-users — читают все авторизованные, пишет админ или владелец
     * /config/localhost-password — никто не читает, пишет только админ
     * /banned, /iptracker — никто не читает
     * /stats — пишут все авторизованные (гости сохраняют результаты)

✅ УЯЗВИМОСТЬ 2: Пароль администратора в JS
   — ADMIN_PASSWORD был удалён из кода полностью
   — Админка теперь только по UID из Firebase (/admins)

✅ УЯЗВИМОСТЬ 3 + 4: Токен Telegram на клиенте
   — Создан прокси-сервер Vercel (/api/telegram.js)
   — Токен TG_BOT_TOKEN теперь только в env Vercel
   — Клиент отправляет { action, chat_id, text } на /api/telegram
   — Прокси проверяет белый список методов (sendMessage, sendPhoto)
   — Прокси проверяет белый список chat_id
   — Все прямые fetch('https://api.telegram.org/...') удалены

✅ УЯЗВИМОСТЬ 5: Firebase Admin SDK (Vercel)
   — Создан /api/firebase-proxy.js — серверное API для Firebase
   — Использует firebase-admin через FIREBASE_SERVICE_ACCOUNT (base64)

✅ УЯЗВИМОСТЬ 6: IP-бан и бан по нику
   — Создан /api/check-banned.js (проверка на сервере по x-forwarded-for)

✅ УЯЗВИМОСТЬ 7: Подозрительные попытки
   — Обработка осталась на клиенте (?admin, Ctrl+Shift+A → уведомление в TG)

✅ Хардкод секретов:
   — import-sullygnome.js: удалён FIREBASE_DB_SECRET, теперь через env
   — worker/src/index.js: TWITCH_CLIENT_ID теперь env.TWITCH_CLIENT_ID
   — index.html: TG_BOT_TOKEN удалён, теперь только через прокси

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 2. ЧТО НУЖНО СДЕЛАТЬ НА VERCEL
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ШАГ 1: Залей проект на Vercel
   — Подключи репозиторий GitHub к Vercel
   — Framework: Other
   — Root directory: / (корень проекта)
   — Build command: оставь пустым
   — Output directory: оставь пустым

ШАГ 2: Установи переменные окружения в Vercel (Settings → Environment Variables):

   ┌──────────────────────────────────────┬────────────────────────────────────┐
   │         Variable Name                │            Value                   │
   ├──────────────────────────────────────┼────────────────────────────────────┤
   │ TG_BOT_TOKEN                         │ 8708472197:AAGqoPzMM8tL5cadNPj... │
   │ TG_CHAT_ALLOWED                      │ 123456789,987654321 (ID чатов)    │
   │ FIREBASE_SERVICE_ACCOUNT             │ base64 от serviceAccountKey.json  │
   │ BANNED_IPS                           │ (опционально, через запятую)      │
   │ BANNED_USERS                         │ (опционально, через запятую)      │
   └──────────────────────────────────────┴────────────────────────────────────┘

   ⚠️ Получить FIREBASE_SERVICE_ACCOUNT:
     1. Firebase Console → Project Settings → Service Accounts
     2. Generate New Private Key → скачать JSON
     3. В терминале: cat serviceAccountKey.json | base64
     4. Скопировать результат → вставить в Vercel

ШАГ 3: Deploy

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 3. ЧТО НУЖНО СДЕЛАТЬ В FIREBASE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ЗАЙДИ В Firebase Console → Realtime Database → Rules

ВСТАВЬ СОДЕРЖИМОЕ firebase-rules.json целиком и нажми PUBLISH

ВАЖНО:
  — Нужно создать хотя бы одного админа вручную через Firebase Console:
    /admins/<UID-пользователя>: true
  — UID можно узнать: Authentication → пользователь → UID

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 4. ЧТО НУЖНО СДЕЛАТЬ В СLOUDFLARE WORKER
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

В worker/wrangler.toml уже указаны переменные.
Дополнительно установи секреты:

   wrangler secret put CLIENT_SECRET
   wrangler secret put FIREBASE_DB_SECRET (если нужен)
   wrangler secret put TG_BOT_TOKEN (если worker отправляет в TG)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 5. ЧТО УДАЛИТЬ ИЗ РЕПОЗИТОРИЯ (git)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Эти файлы содержат секреты — их НЕЛЬЗЯ пушить в GitHub:

   ❌ worker/.wrangler/cache/wrangler-account.json
      (Cloudflare account email и ID)
   ❌ import-sullygnome.js (раньше содержал Firebase secret)
   ❌ worker-code.txt (старый бэкап, может содержать секреты)
   ❌ .idea/ (IDEA workspace)

✅ .gitignore уже настроен — node_modules/, .env, .DS_Store, .wrangler/, .idea/

После очистки сделай:
   git add .
   git commit -m "fix: security patches - remove secrets, add proxy, add firebase rules"
   git push

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 6. НАСТРОЙКА TG PROXY URL В АДМИНКЕ
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

   После деплоя на Vercel зайди в админку → раздел Telegram
   В поле "URL прокси для Telegram" укажи:
     https://<твой-проект>.vercel.app/api/telegram
   Или оставь пустым — будет использоваться /api/telegram (относительный)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 7. ПРОВЕРКА БЕЗОПАСНОСТИ
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

После деплоя:
   √ Открой DevTools → Network — нет запросов к api.telegram.org
   √ Нет TG_BOT_TOKEN в JavaScript файлах
   √ Нет ADMIN_PASSWORD в коде
   √ Firebase Rules применены
   √ Vercel env переменные скрыты

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 СОЗДАННЫЕ ФАЙЛЫ:
   api/telegram.js        — Прокси для Telegram (скрывает токен)
   api/check-banned.js    — Проверка бана по IP/username на сервере
   api/firebase-proxy.js  — Firebase Admin SDK через Vercel
   firebase-rules.json    — Правила доступа к Firebase
   vercel.json            — Конфигурация Vercel
   package.json           — firebase-admin dependency
   .gitignore             — Игнорирование секретов
   SAVE_README.txt        — Этот файл
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
