# Seruen на Google ADK

Агент на [Agent Development Kit](https://google.github.io/adk-docs/): Gemini планирует прогулки по Астане через MCP-сервер Seruen (`/mcp`). Те же 5 инструментов, что у агента на сайте: `plan_walk`, `search_places`, `place_details`, `build_route`, `get_weather`.

## Запуск на своём компьютере

```bash
cd integrations/adk
python -m venv .venv && . .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp seruen_agent/.env.example seruen_agent/.env   # вписать GOOGLE_API_KEY из aistudio.google.com/apikey
adk web        # или: adk run seruen_agent
```

Спросить: «Я у Хан Шатыра, у нас с ребёнком 2 часа, на улице ветрено».

## Деплой в Vertex AI Agent Engine

Когда будет проект Google Cloud с Vertex AI и бакетом:

```bash
adk deploy agent_engine --project <PROJECT_ID> --region europe-west1 --staging_bucket gs://<BUCKET> seruen_agent
```

Агенту нужен только доступ в интернет к `SERUEN_MCP_URL`; данные и логика остаются в Seruen.
