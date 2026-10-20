# Как запустить и задеплоить Aidem

Живая версия уже работает: **https://ascension-smartwalk.azamatbreach.workers.dev** (часы: `/watch`, агент Gemini: `/agent`). Эта страница для тех, кто хочет поднять свою копию: на своём компьютере, на Cloudflare Workers (так работает демо) или в Google Cloud Run.

## Что понадобится

- **Node.js 22 или новее.** Нужен встроенный `node:sqlite` для друзей и встреч.
- **Ключ Gemini API** из [Google AI Studio](https://aistudio.google.com/apikey). Он необязателен: без ключа поиск, расчёт времени, карта и часы работают, а ответ честно помечен как собранный без модели.
- Для деплоя: бесплатный аккаунт Cloudflare или проект Google Cloud.

Секреты задаются только в окружении процесса или в хранилище секретов платформы. В репозиторий и в браузерный код они не попадают; в `.env.example` перечислены одни имена.

## На своём компьютере

```sh
git clone https://github.com/Azalytical/ascension-smartwalk
cd ascension-smartwalk
npm install
npm test          # все автотесты, без сети и без ключей
npm run dev       # http://localhost:8789
```

С ответами Gemini:

```sh
GEMINI_API_KEY=ваш_ключ npm run dev               # macOS, Linux
$env:GEMINI_API_KEY="ваш_ключ"; npm run dev        # Windows PowerShell
```

Откройте `http://localhost:8789` (сайт), `/watch` (часы) и `/agent` (агент Gemini с шагами). Локальный сервер (`scripts/dev.mjs`) использует тот же код API, что и Worker: друзья и встречи хранятся в SQLite в памяти (или в файле из `SOCIAL_DB`), напоминания часов и афиша тоже в памяти.

## Cloudflare Workers (так работает демо)

Бесплатного тарифа Workers хватает. Один раз войдите: `npx wrangler login`. Дальше:

```sh
npm run build                              # собирает dist/: Worker, приложение и базу мест
npx wrangler secret put GEMINI_API_KEY     # спросит значение ключа, один раз
npx wrangler deploy
```

> **Сначала всегда `npm run build`.** `wrangler deploy` берёт уже собранный `dist/`, и без сборки уйдёт старая версия. Удобнее одной командой: `npm run build && npx wrangler deploy`.

Что Cloudflare делает сам по `wrangler.jsonc`, без ручных шагов:

- **Durable Objects** `SocialHub` (друзья, встречи, оценки), `WatchPush` (напоминания «пора обратно» на часы) и `CityEventsStore` (афиша). Миграции `social-v1`, `watch-v1`, `events-v1` применяются при первом `deploy`.
- **Cron** `50 0 * * *`: в 05:50 по Астане Worker сам собирает афишу sxodim.com. До первого сбора показывается копия из `data/events.json`.
- **Размещение** `gcp:europe-west1`: Worker работает рядом с Google, потому что из точки Cloudflare в Астане Gemini API недоступен.
- **Переменные** `GEMINI_MODEL=gemini-3.5-flash-lite` (500 бесплатных запросов в сутки), `WEATHER=1` (погода Open-Meteo), `MEMORY_BUDGET=1` (лимит: 8 ответов модели в минуту с адреса и 500 в сутки).
- **Логи** только того, что пишет код. Журнал запросов выключен, чтобы точка из вопроса Siri не оседала в логах.

### Проверить, что всё поднялось

```sh
curl https://<ваш-адрес>.workers.dev/api/status
```

В ответе должны быть `"generationAvailable": true` и `"generationProvider": "gemini"` (если ключ задан), `"poiCount": 2058` (места после сведения дублей; сырые записи в `sourceRecords`) и `"version"`. Афиша и состояние последнего сбора: `/api/events?days=7` (поле `collection`); этот ответ Worker держит в памяти до 5 минут, поэтому новый сбор виден не сразу.

## Google Cloud Run

`Dockerfile` собирает тот же сервер на Node 22: ставит только карту и шрифты из npm, готовит приложение и запускает `scripts/dev.mjs` в режиме продакшена (порт 8080, погода включена, тот же лимит запросов в памяти). Друзья, встречи и афиша в этом режиме живут в памяти контейнера, поэтому нужен один экземпляр.

```sh
gcloud services enable run.googleapis.com cloudbuild.googleapis.com secretmanager.googleapis.com
printf '%s' "$GEMINI_API_KEY" | gcloud secrets create gemini-api-key --data-file=-
gcloud run deploy aidem --source . --region europe-west1 --allow-unauthenticated \
  --max-instances 1 --set-secrets GEMINI_API_KEY=gemini-api-key:latest
```

Сервисному аккаунту Cloud Run нужна роль `Secret Manager Secret Accessor` на этот секрет. Проверить образ локально: `docker build -t aidem . && docker run -p 8080:8080 -e GEMINI_API_KEY=... aidem`, затем `http://localhost:8080/api/status`.

## Настройки

| Имя | Где | Зачем |
|---|---|---|
| `GEMINI_API_KEY` | секрет | Ответы, агент, голос, фото и смысловой поиск Gemini |
| `GEMINI_MODEL` | переменная | Модель ответов. В коде по умолчанию `gemini-3.8-flash`, на демо `gemini-3.5-flash-lite` |
| `OPENAI_API_KEY`, `OPENAI_MODEL` | секрет, переменная | Запасной провайдер, если ключа Gemini нет |
| `WEATHER` | переменная | `1` включает погоду Open-Meteo (без ключа) |
| `GEMINI_AGENT_MODEL`, `GEMINI_EMBEDDING_MODEL`, `GEMINI_TTS_MODEL`, `GEMINI_TTS_VOICE` | переменные | Другие модели для агента, эмбеддингов и голоса, если нужно |
| `AGENT_DAILY_LIMIT` | переменная | Сколько запросов к агенту в сутки идут через модель (по умолчанию 150; каждый до 5 обращений) |
| `SOCIAL_SALT` | секрет | Соль для обезличенного лимита по адресу в друзьях и оценках |
| `TELEGRAM_WEBHOOK_SECRET` | секрет | Только для Telegram-бота |
| `PORT`, `SOCIAL_DB` | переменные локального сервера | Порт (8789) и файл SQLite для друзей |

На Cloudflare секреты задаются `npx wrangler secret put <ИМЯ>`, переменные лежат в `vars` в `wrangler.jsonc`. В Cloud Run: `--set-secrets` и `--update-env-vars`.

## Telegram-бот (необязательно)

Код и тесты готовы, на демо бот не подключён: нужен токен от @BotFather. Бот отвечает через вебхук `/telegram/webhook` того же сервиса; точка пользователя хранится в памяти 30 минут и не уходит в модель.

1. Создайте бота у @BotFather и придумайте секрет вебхука (буквы и цифры).
2. Задайте сервису `TELEGRAM_WEBHOOK_SECRET`.
3. Зарегистрируйте вебхук: `TELEGRAM_BOT_TOKEN=... TELEGRAM_WEBHOOK_SECRET=... node scripts/telegram-setup.mjs https://<адрес сервиса>`.

## Обновить данные

База мест собирается скриптами, без ручной правки:

```sh
python scripts/import_osm_pois.py     # OpenStreetMap через Overpass
python scripts/fetch_overture.py      # Overture Maps, нужен pyarrow
python scripts/build_places.py        # сведение дублей в data/places.json, без сети
```

Афишу Worker собирает сам. Запасная копия: строки с [sxodim.com/astana/afisha](https://sxodim.com/astana/afisha) в `data/events-sxodim.txt`, затем `node scripts/build_events.mjs`.

## Протокол сценариев и PDF

```sh
node scripts/scenario-protocol.mjs                  # 15 сценариев на локальной базе
node scripts/scenario-protocol.mjs --live <адрес>   # те же сценарии на живом сайте
python3 scripts/build_protocol_pdf.py               # deliverables/ascension-smartwalk-tests-and-limitations.pdf
```
