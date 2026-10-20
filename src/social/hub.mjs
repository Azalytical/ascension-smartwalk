import { SocialStore } from './store.mjs';

/** Adapter over the Durable Object SQLite API. */
function durableDb(sql) {
  return {
    all: (query, ...params) => sql.exec(query, ...params).toArray(),
    get: (query, ...params) => sql.exec(query, ...params).toArray()[0] ?? null,
    run: (query, ...params) => { const cursor = sql.exec(query, ...params); cursor.toArray(); return { changes: cursor.rowsWritten }; }
  };
}

/**
 * One SQLite-backed Durable Object per city holds friends, location shares, meetups and events.
 * The Worker talks to it with POST /run { op, token, input, meta }.
 */
export class SocialHub {
  constructor(ctx, env, db = null) {
    this.ctx = ctx;
    this.env = env;
    this.store = new SocialStore(db ?? durableDb(ctx.storage.sql), { schedule: at => { this.wakeAt(at).catch(() => {}); } });
  }

  async wakeAt(at) {
    const current = await this.ctx.storage.getAlarm?.();
    if (!current || at < current) await this.ctx.storage.setAlarm?.(at);
  }

  async fetch(request) {
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
    const { op, token, input, meta } = await request.json();
    const result = await this.store.handle(String(op), token, input, meta);
    return Response.json(result);
  }

  /** Expired location points are deleted on time even when nobody opens the app. */
  async alarm() {
    const next = this.store.purge();
    if (next) await this.ctx.storage.setAlarm(Math.max(next, Date.now() + 1000));
  }
}
