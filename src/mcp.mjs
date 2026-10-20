// Ulger as a remote MCP server (Streamable HTTP, stateless, JSON responses) at /mcp.
// Gemini CLI, Google ADK agents, Claude and other MCP clients call the same tools as the Ulger agent.
import { TOOLS, runTool, ToolError } from './tools.mjs';

const VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const SERVER = { name: 'ulger', title: 'Ulger — прогулки по Астане', version: '2.0.0',
  websiteUrl: 'https://ascension-smartwalk.azamatbreach.workers.dev' };
const INSTRUCTIONS = 'Ulger подбирает прогулки по Астане ровно на время человека. Начинайте с plan_walk (нужны lat и lon старта; если человек назвал место, '
  + 'найдите его координаты через search_places). Для 2–3 мест подряд используйте build_route, для подробностей place_details, для погоды get_weather. '
  + 'Факты о местах берите только из ответов инструментов и называйте источник из поля dataSource (OpenStreetMap или Overture Maps); не утверждайте «открыто сейчас», если hours.status не open. '
  + 'Время пешком — оценка, не обещание.';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version, Authorization', 'Access-Control-Expose-Headers': 'Mcp-Session-Id' };
const HEADERS = { ...CORS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };

const buckets = new Map();
function allowed(ip) {
  const minute = Math.floor(Date.now() / 60000);
  const key = `${minute}:${ip}`;
  const used = (buckets.get(key) || 0) + 1;
  buckets.set(key, used);
  if (buckets.size > 5000) for (const old of buckets.keys()) if (!old.startsWith(`${minute}:`)) buckets.delete(old);
  return used <= 60;
}

const listed = TOOLS.map(({ name, title, description, inputSchema, network }) => ({ name, title, description, inputSchema,
  annotations: { title, readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: Boolean(network) } }));

const reply = (id, result) => ({ jsonrpc: '2.0', id, result });
const fail = (id, code, message) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

async function handleMessage(message, context) {
  if (!message || typeof message !== 'object' || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
    return 'id' in (message || {}) && !('result' in message || 'error' in message) ? fail(message.id, -32600, 'Invalid Request') : null;
  }
  const isRequest = 'id' in message && message.id !== null;
  if (!isRequest) return null; // notifications/initialized, notifications/cancelled and other notifications need no answer
  const { id, method, params = {} } = message;
  switch (method) {
    case 'initialize': {
      const asked = params.protocolVersion;
      return reply(id, { protocolVersion: VERSIONS.includes(asked) ? asked : VERSIONS[0], capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER, instructions: INSTRUCTIONS });
    }
    case 'ping': return reply(id, {});
    case 'tools/list': return reply(id, { tools: listed });
    case 'prompts/list': return reply(id, { prompts: [] });
    case 'resources/list': return reply(id, { resources: [] });
    case 'resources/templates/list': return reply(id, { resourceTemplates: [] });
    case 'tools/call': {
      if (typeof params.name !== 'string') return fail(id, -32602, 'params.name is required');
      if (!TOOLS.some(tool => tool.name === params.name)) return fail(id, -32602, `Unknown tool: ${params.name}`);
      try {
        const result = await runTool(params.name, params.arguments, context);
        return reply(id, { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result, isError: false });
      } catch (error) {
        if (!(error instanceof ToolError)) {
          console.error(JSON.stringify({ event: 'mcp_tool_error', tool: params.name, message: String(error?.message || 'Unknown').slice(0, 200) }));
        }
        return reply(id, { content: [{ type: 'text', text: error instanceof ToolError ? error.message : 'Инструмент временно недоступен.' }], isError: true });
      }
    }
    default: return fail(id, -32601, `Method not found: ${method}`);
  }
}

export async function handleMcp(request, env = {}, dataset = [], { fetchImpl } = {}) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (request.method !== 'POST') {
    // No server-initiated stream: the spec asks for 405 on GET. The body helps a person who opens the address in a browser.
    return new Response(JSON.stringify({ name: SERVER.title, transport: 'MCP Streamable HTTP (POST)', tools: TOOLS.map(tool => tool.name),
      geminiCli: 'gemini extensions install https://github.com/Azalytical/ascension-smartwalk' }), { status: 405, headers: { ...HEADERS, Allow: 'POST, OPTIONS' } });
  }
  const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For')?.split(',')[0].trim() || 'anonymous';
  if (!env.LOCAL_DEVELOPMENT && !allowed(ip)) return new Response(JSON.stringify(fail(null, -32000, 'Слишком много запросов. Попробуйте через минуту.')), { status: 429, headers: { ...HEADERS, 'Retry-After': '60' } });
  if (Number(request.headers.get('Content-Length')) > 65536) return new Response(JSON.stringify(fail(null, -32600, 'Request too large')), { status: 413, headers: HEADERS });
  const raw = await request.text();
  if (raw.length > 65536) return new Response(JSON.stringify(fail(null, -32600, 'Request too large')), { status: 413, headers: HEADERS });
  let body;
  try { body = JSON.parse(raw); } catch { return new Response(JSON.stringify(fail(null, -32700, 'Parse error')), { status: 400, headers: HEADERS }); }
  const context = { dataset, env, ...(fetchImpl ? { fetchImpl } : {}) };
  // Batches were dropped in 2025-06-18 but older clients may still send them.
  const messages = Array.isArray(body) ? body.slice(0, 20) : [body];
  const answers = (await Promise.all(messages.map(message => handleMessage(message, context)))).filter(Boolean);
  if (!answers.length) return new Response(null, { status: 202, headers: CORS });
  return new Response(JSON.stringify(Array.isArray(body) ? answers : answers[0]), { status: 200, headers: HEADERS });
}
