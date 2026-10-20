"""Aidem agent on Google ADK: Gemini plans walks in Astana through the Aidem MCP server.

Run locally:  adk web   (from integrations/adk, with GOOGLE_API_KEY in ulger_agent/.env)
Deploy later: adk deploy agent_engine ulger_agent   (needs a Google Cloud project with Vertex AI)
"""
import os

from google.adk.agents import Agent
from google.adk.tools.mcp_tool import McpToolset, StreamableHTTPConnectionParams

MCP_URL = os.getenv("ULGER_MCP_URL", "https://ascension-smartwalk.azamatbreach.workers.dev/mcp")

root_agent = Agent(
    name="aidem",
    model=os.getenv("ULGER_MODEL", "gemini-3.5-flash-lite"),
    description="Plans walks around Astana that fit the visitor's time, from OpenStreetMap and Overture Maps places.",
    instruction=(
        "Ты агент Aidem: подбираешь прогулку по Астане ровно под время человека. "
        "Если человек назвал место (например, «я у Байтерека»), найди его координаты через search_places и передай их в plan_walk как lat и lon. "
        "Перед прогулкой по улице проверь get_weather. Для 2–3 мест подряд используй build_route. "
        "Отвечай на языке человека: 1–3 варианта, у каждого почему, сколько минут и что делать, и ссылка links.googleMapsWalk. "
        "Факты о местах только из ответов инструментов, источник из поля dataSource; «открыто» только если hours.status = open; минуты — оценка."
    ),
    tools=[McpToolset(connection_params=StreamableHTTPConnectionParams(url=MCP_URL, timeout=20))],
)
