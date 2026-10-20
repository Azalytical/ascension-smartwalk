// Node-only: an in-process social hub on node:sqlite for `npm run dev`, the Cloud Run container and tests.
// The Worker build never imports this file; in production the hub is a Durable Object.
import { DatabaseSync } from 'node:sqlite';
import { SocialHub } from './hub.mjs';

export function sqliteDb(filename = ':memory:') {
  const database = new DatabaseSync(filename);
  const statements = new Map();
  const prepared = query => {
    let statement = statements.get(query);
    if (!statement) { statement = database.prepare(query); statements.set(query, statement); }
    return statement;
  };
  return {
    all: (query, ...params) => prepared(query).all(...params),
    get: (query, ...params) => prepared(query).get(...params) ?? null,
    run: (query, ...params) => ({ changes: Number(prepared(query).run(...params).changes) }),
    close: () => database.close()
  };
}

export function localSocialHub(filename = ':memory:', options = {}) {
  const ctx = { storage: { getAlarm: async () => null, setAlarm: async () => {} } };
  const hub = new SocialHub(ctx, {}, sqliteDb(filename));
  if (options.now) hub.store.now = options.now;
  return hub;
}
