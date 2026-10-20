// Friends, consent-based location sharing, meetups and city events.
// All state lives in one SQLite database (a Durable Object in production, node:sqlite locally and in tests).
// Every operation after authentication is synchronous, so inside a Durable Object it runs atomically.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const EMOJIS = ['🦊', '🐻', '🐼', '🐨', '🐯', '🦁', '🐸', '🐵', '🦄', '🐙', '🦉', '🐧', '🐳', '🦋', '🌻', '🌵', '🍀', '⚡', '🔥', '🌙', '⭐', '🎧', '🎨', '⚽', '🚲', '☕', '📚', '🏔'];
const COLORS = ['#e8684a', '#1f8a78', '#6d5bd0', '#d38b1f', '#2b74d9', '#c4477a', '#4f9d3a', '#8a6a4b'];
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const SHARE_MINUTES = [15, 60, 480];
const SHARE_MODES = ['approximate', 'precise'];
const MEMBER_STATUSES = ['going', 'maybe', 'declined', 'on_way', 'arrived'];
export const EVENT_CATEGORIES = ['walk', 'sport', 'food', 'culture', 'study', 'kids', 'other'];
// Generous box around Astana and its suburbs: meetups and events are for this city.
const CITY = { minLat: 50.85, maxLat: 51.45, minLon: 70.95, maxLon: 71.95 };
const REPORTS_TO_HIDE = 3;

export class SocialError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
const fail = (status, code, message) => { throw new SocialError(status, code, message); };

export const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL, emoji TEXT NOT NULL, color TEXT NOT NULL, created_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS tokens (hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS tokens_user ON tokens(user_id)`,
  `CREATE TABLE IF NOT EXISTS invites (code TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, uses INTEGER NOT NULL DEFAULT 0, max_uses INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS invites_user ON invites(user_id)`,
  `CREATE TABLE IF NOT EXISTS friendships (low TEXT NOT NULL, high TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (low, high))`,
  `CREATE INDEX IF NOT EXISTS friendships_high ON friendships(high)`,
  `CREATE TABLE IF NOT EXISTS blocks (blocker TEXT NOT NULL, blocked TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (blocker, blocked))`,
  // One row per person: the latest point only. There is no location history table.
  `CREATE TABLE IF NOT EXISTS shares (user_id TEXT PRIMARY KEY, mode TEXT NOT NULL, audience TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', granted_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, lat REAL, lon REAL, accuracy REAL, updated_at INTEGER)`,
  `CREATE INDEX IF NOT EXISTS shares_expiry ON shares(expires_at)`,
  `CREATE TABLE IF NOT EXISTS share_recipients (user_id TEXT NOT NULL, recipient_id TEXT NOT NULL, PRIMARY KEY (user_id, recipient_id))`,
  `CREATE TABLE IF NOT EXISTS meetups (id TEXT PRIMARY KEY, host_id TEXT NOT NULL, title TEXT NOT NULL, note TEXT NOT NULL, place_name TEXT NOT NULL, place_id TEXT, lat REAL NOT NULL, lon REAL NOT NULL, starts_at INTEGER NOT NULL, status TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS meetups_start ON meetups(starts_at)`,
  `CREATE TABLE IF NOT EXISTS meetup_members (meetup_id TEXT NOT NULL, user_id TEXT NOT NULL, status TEXT NOT NULL, seen_revision INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL, PRIMARY KEY (meetup_id, user_id))`,
  `CREATE INDEX IF NOT EXISTS meetup_members_user ON meetup_members(user_id)`,
  `CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, meetup_id TEXT NOT NULL, user_id TEXT NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS messages_meetup ON messages(meetup_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, host_id TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL, category TEXT NOT NULL, place_name TEXT NOT NULL, place_id TEXT, lat REAL NOT NULL, lon REAL NOT NULL, starts_at INTEGER NOT NULL, ends_at INTEGER NOT NULL, capacity INTEGER, visibility TEXT NOT NULL, status TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS events_end ON events(ends_at)`,
  `CREATE TABLE IF NOT EXISTS event_members (event_id TEXT NOT NULL, user_id TEXT NOT NULL, status TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (event_id, user_id))`,
  `CREATE INDEX IF NOT EXISTS event_members_user ON event_members(user_id)`,
  `CREATE TABLE IF NOT EXISTS event_reports (event_id TEXT NOT NULL, user_id TEXT NOT NULL, reason TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (event_id, user_id))`,
  `CREATE TABLE IF NOT EXISTS notifications (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, type TEXT NOT NULL, actor_id TEXT, entity_id TEXT, text TEXT NOT NULL, created_at INTEGER NOT NULL, read_at INTEGER)`,
  `CREATE INDEX IF NOT EXISTS notifications_user ON notifications(user_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS link_codes (code TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS counters (bucket TEXT PRIMARY KEY, used INTEGER NOT NULL, expires_at INTEGER NOT NULL)`
];

function randomString(length, alphabet) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const byte of bytes) out += alphabet[byte % alphabet.length];
  return out;
}

export function newToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function sha256(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value)));
  return [...new Uint8Array(digest)].map(n => n.toString(16).padStart(2, '0')).join('');
}

function text(value, { field, min = 0, max, fallback = '' }) {
  if (value === undefined || value === null) value = fallback;
  if (typeof value !== 'string') fail(400, 'INVALID_INPUT', `Поле «${field}» должно быть текстом`);
  // Control characters and bidi overrides are removed; whitespace is collapsed.
  const clean = value.replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩]/g, ' ').replace(/\s+/g, ' ').trim();
  if (clean.length < min) fail(400, 'INVALID_INPUT', min === 1 ? `Заполните поле «${field}»` : `Поле «${field}»: не короче ${min} символов`);
  if (clean.length > max) fail(400, 'INVALID_INPUT', `Поле «${field}»: не длиннее ${max} символов`);
  return clean;
}

function timestamp(value, field) {
  const ms = typeof value === 'number' ? value : typeof value === 'string' ? Date.parse(value) : NaN;
  if (!Number.isFinite(ms)) fail(400, 'INVALID_INPUT', `Укажите ${field}`);
  return Math.round(ms);
}

function place(value) {
  if (!value || typeof value !== 'object') fail(400, 'INVALID_INPUT', 'Выберите место');
  const lat = Number(value.lat), lon = Number(value.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < CITY.minLat || lat > CITY.maxLat || lon < CITY.minLon || lon > CITY.maxLon) {
    fail(400, 'INVALID_INPUT', 'Место должно быть в Астане');
  }
  const id = value.id === undefined || value.id === null || value.id === '' ? null : text(String(value.id), { field: 'id места', max: 80 });
  return { name: text(value.name, { field: 'Место', min: 1, max: 80 }), id, lat: Math.round(lat * 1e6) / 1e6, lon: Math.round(lon * 1e6) / 1e6 };
}

function idList(value, max, field = 'друзья') {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some(id => typeof id !== 'string' || id.length > 64)) fail(400, 'INVALID_INPUT', `Некорректный список: ${field}`);
  const unique = [...new Set(value)];
  if (unique.length > max) fail(400, 'INVALID_INPUT', `Не больше ${max}: ${field}`);
  return unique;
}

function pair(a, b) { return a < b ? [a, b] : [b, a]; }

function colorFor(id) {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return COLORS[hash % COLORS.length];
}

const publicUser = row => row ? { id: row.id, name: row.name, emoji: row.emoji, color: row.color } : null;

export class SocialStore {
  /**
   * @param db adapter with all(sql, ...params) → rows, get(sql, ...params) → row | null, run(sql, ...params) → { changes }
   * @param options.now clock, options.schedule(ms) asks the host to wake up and purge at that time
   */
  constructor(db, { now = () => Date.now(), schedule = () => {} } = {}) {
    this.db = db;
    this.now = now;
    this.schedule = schedule;
    this.lastPurge = 0;
    for (const statement of SCHEMA) db.run(statement);
  }

  /** Hashing is asynchronous, so it happens before the synchronous, atomic part of an operation. */
  async prepare(op, token) {
    const tokenHash = typeof token === 'string' && token.length >= 20 && token.length <= 100 ? await sha256(token) : null;
    let fresh = null;
    if (op === 'register' || op === 'claimDevice') {
      const value = newToken();
      fresh = { token: value, hash: await sha256(value) };
    }
    return { tokenHash, fresh };
  }

  async handle(op, token, input = {}, meta = {}) {
    const prepared = await this.prepare(op, token);
    return this.execute(op, prepared, input ?? {}, meta);
  }

  /** Synchronous: returns { status, body }. */
  execute(op, { tokenHash, fresh }, input, meta) {
    try {
      const now = this.now();
      if (now - this.lastPurge > MINUTE) this.purge(now);
      if (!Object.hasOwn(PUBLIC_OPS, op) && !Object.hasOwn(USER_OPS, op)) fail(404, 'UNKNOWN_OPERATION', 'Неизвестное действие');
      if (Object.hasOwn(PUBLIC_OPS, op)) {
        const viewer = tokenHash ? this.userByToken(tokenHash, now) : null;
        return { status: 200, body: PUBLIC_OPS[op].call(this, { input, meta, now, fresh, viewer, tokenHash }) };
      }
      const user = tokenHash ? this.userByToken(tokenHash, now) : null;
      if (!user) fail(401, 'UNAUTHORIZED', 'Создайте профиль, чтобы пользоваться друзьями и встречами');
      return { status: 200, body: USER_OPS[op].call(this, { user, input, meta, now, fresh, tokenHash }) };
    } catch (error) {
      if (error instanceof SocialError) return { status: error.status, body: { error: error.message, code: error.code } };
      throw error;
    }
  }

  userByToken(hash, now) {
    const user = this.db.get('SELECT users.* FROM tokens JOIN users ON users.id = tokens.user_id WHERE tokens.hash = ?', hash);
    if (user && now - user.last_seen_at > MINUTE) this.db.run('UPDATE users SET last_seen_at = ? WHERE id = ?', now, user.id);
    return user;
  }

  limit(bucket, max, windowMs, now, message = 'Слишком много действий подряд. Попробуйте чуть позже.') {
    const key = `${bucket}:${Math.floor(now / windowMs)}`;
    const row = this.db.get('SELECT used FROM counters WHERE bucket = ?', key);
    if (row && row.used >= max) fail(429, 'RATE_LIMITED', message);
    if (row) this.db.run('UPDATE counters SET used = used + 1 WHERE bucket = ?', key);
    else this.db.run('INSERT INTO counters (bucket, used, expires_at) VALUES (?, 1, ?)', key, (Math.floor(now / windowMs) + 1) * windowMs);
  }

  areFriends(a, b) {
    const [low, high] = pair(a, b);
    return Boolean(this.db.get('SELECT 1 AS ok FROM friendships WHERE low = ? AND high = ?', low, high));
  }

  blocked(a, b) {
    return Boolean(this.db.get('SELECT 1 AS ok FROM blocks WHERE (blocker = ? AND blocked = ?) OR (blocker = ? AND blocked = ?)', a, b, b, a));
  }

  friendIds(userId) {
    return this.db.all('SELECT CASE WHEN low = ? THEN high ELSE low END AS id FROM friendships WHERE low = ? OR high = ?', userId, userId, userId).map(row => row.id);
  }

  requireFriends(userId, ids) {
    const friends = new Set(this.friendIds(userId));
    if (ids.some(id => !friends.has(id))) fail(403, 'NOT_FRIENDS', 'Приглашать можно только друзей');
  }

  notify(userId, type, actorId, entityId, message, now) {
    if (!userId || userId === actorId) return;
    this.db.run('INSERT INTO notifications (id, user_id, type, actor_id, entity_id, text, created_at, read_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)',
      crypto.randomUUID(), userId, type, actorId ?? null, entityId ?? null, message, now);
    this.db.run('DELETE FROM notifications WHERE user_id = ? AND id NOT IN (SELECT id FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 60)', userId, userId);
  }

  /** Deletes everything past its lifetime. Expired location points are gone, not archived. */
  purge(now = this.now()) {
    this.lastPurge = now;
    this.db.run('DELETE FROM share_recipients WHERE user_id IN (SELECT user_id FROM shares WHERE expires_at <= ?)', now);
    this.db.run('DELETE FROM shares WHERE expires_at <= ?', now);
    this.db.run('DELETE FROM invites WHERE expires_at <= ?', now);
    this.db.run('DELETE FROM link_codes WHERE expires_at <= ?', now);
    this.db.run('DELETE FROM counters WHERE expires_at <= ?', now);
    this.db.run('DELETE FROM notifications WHERE created_at <= ?', now - 14 * DAY);
    const oldMeetups = 'SELECT id FROM meetups WHERE starts_at <= ?';
    this.db.run(`DELETE FROM messages WHERE meetup_id IN (${oldMeetups})`, now - 2 * DAY);
    this.db.run(`DELETE FROM meetup_members WHERE meetup_id IN (${oldMeetups})`, now - 2 * DAY);
    this.db.run('DELETE FROM meetups WHERE starts_at <= ?', now - 2 * DAY);
    const oldEvents = 'SELECT id FROM events WHERE ends_at <= ?';
    this.db.run(`DELETE FROM event_members WHERE event_id IN (${oldEvents})`, now - 7 * DAY);
    this.db.run(`DELETE FROM event_reports WHERE event_id IN (${oldEvents})`, now - 7 * DAY);
    this.db.run('DELETE FROM events WHERE ends_at <= ?', now - 7 * DAY);
    return this.nextExpiry();
  }

  nextExpiry() {
    return this.db.get('SELECT MIN(expires_at) AS at FROM shares')?.at ?? null;
  }

  // ---- views ----

  shareView(userId, now) {
    const share = this.db.get('SELECT * FROM shares WHERE user_id = ? AND expires_at > ?', userId, now);
    if (!share) return null;
    const recipients = share.audience === 'selected'
      ? this.db.all('SELECT recipient_id FROM share_recipients WHERE user_id = ? ORDER BY recipient_id', userId).map(row => row.recipient_id) : [];
    return { mode: share.mode, audience: share.audience, recipients, note: share.note, grantedAt: share.granted_at, expiresAt: share.expires_at,
      hasPoint: share.lat !== null, updatedAt: share.updated_at,
      ...(share.lat !== null ? { lat: share.lat, lon: share.lon, accuracy: share.accuracy } : {}) };
  }

  /** The point a friend shares with this viewer, or null. Friendship, blocks and audience are all checked. */
  visibleLocation(ownerId, viewerId, now) {
    const share = this.db.get(`SELECT * FROM shares WHERE user_id = ? AND expires_at > ? AND (audience = 'all'
      OR EXISTS (SELECT 1 FROM share_recipients WHERE share_recipients.user_id = shares.user_id AND recipient_id = ?))`, ownerId, now, viewerId);
    if (!share || !this.areFriends(ownerId, viewerId) || this.blocked(ownerId, viewerId)) return null;
    return { sharing: true, mode: share.mode, note: share.note, expiresAt: share.expires_at, updatedAt: share.updated_at,
      ...(share.lat !== null ? { lat: share.lat, lon: share.lon, accuracy: share.accuracy } : {}) };
  }

  friendsView(user, now) {
    const rows = this.db.all(`SELECT users.*, friendships.created_at AS since FROM friendships
      JOIN users ON users.id = CASE WHEN friendships.low = ? THEN friendships.high ELSE friendships.low END
      WHERE friendships.low = ? OR friendships.high = ? ORDER BY users.name`, user.id, user.id, user.id);
    const mine = this.shareView(user.id, now);
    return rows.map(row => ({
      ...publicUser(row), since: row.since,
      location: this.visibleLocation(row.id, user.id, now),
      iShareWith: Boolean(mine && (mine.audience === 'all' || mine.recipients.includes(row.id)))
    }));
  }

  meetupView(meetup, viewerId) {
    const members = this.db.all(`SELECT users.id, users.name, users.emoji, users.color, meetup_members.status, meetup_members.seen_revision, meetup_members.updated_at
      FROM meetup_members JOIN users ON users.id = meetup_members.user_id WHERE meetup_id = ? ORDER BY users.name`, meetup.id);
    const messages = this.db.all(`SELECT messages.id, messages.body, messages.created_at, users.id AS user_id, users.name, users.emoji, users.color
      FROM messages JOIN users ON users.id = messages.user_id WHERE meetup_id = ? ORDER BY messages.created_at DESC LIMIT 30`, meetup.id).reverse();
    const me = members.find(member => member.id === viewerId);
    return {
      id: meetup.id, title: meetup.title, note: meetup.note, status: meetup.status, startsAt: meetup.starts_at, revision: meetup.revision,
      place: { name: meetup.place_name, id: meetup.place_id, lat: meetup.lat, lon: meetup.lon },
      host: publicUser(this.db.get('SELECT * FROM users WHERE id = ?', meetup.host_id)), isHost: meetup.host_id === viewerId,
      myStatus: me?.status ?? null, changed: Boolean(me && meetup.host_id !== viewerId && me.seen_revision > 0 && me.seen_revision < meetup.revision),
      members: members.map(member => ({ ...publicUser(member), status: member.status, updatedAt: member.updated_at })),
      messages: messages.map(message => ({ id: message.id, body: message.body, createdAt: message.created_at, author: publicUser({ id: message.user_id, name: message.name, emoji: message.emoji, color: message.color }) })),
      updatedAt: meetup.updated_at
    };
  }

  meetupsView(user, now) {
    return this.db.all(`SELECT meetups.* FROM meetups JOIN meetup_members ON meetup_members.meetup_id = meetups.id AND meetup_members.user_id = ?
      WHERE meetups.starts_at > ? ORDER BY meetups.starts_at LIMIT 40`, user.id, now - 6 * HOUR).map(row => this.meetupView(row, user.id));
  }

  memberMeetup(user, id) {
    const meetup = typeof id === 'string' ? this.db.get('SELECT meetups.* FROM meetups JOIN meetup_members ON meetup_members.meetup_id = meetups.id AND meetup_members.user_id = ? WHERE meetups.id = ?', user.id, id) : null;
    if (!meetup) fail(404, 'NOT_FOUND', 'Встреча не найдена');
    return meetup;
  }

  hostMeetup(user, id) {
    const meetup = this.memberMeetup(user, id);
    if (meetup.host_id !== user.id) fail(403, 'FORBIDDEN', 'Это может сделать только организатор встречи');
    if (meetup.status === 'cancelled') fail(409, 'CANCELLED', 'Встреча уже отменена');
    return meetup;
  }

  eventView(event, viewer, friends) {
    const counts = this.db.get(`SELECT SUM(status = 'going') AS going, SUM(status = 'waitlist') AS waitlist FROM event_members WHERE event_id = ?`, event.id);
    const mine = viewer ? this.db.get('SELECT status FROM event_members WHERE event_id = ? AND user_id = ?', event.id, viewer.id) : null;
    // Participation is shown only to a participant's friends; others see a number.
    const friendsGoing = viewer && friends.size
      ? this.db.all(`SELECT users.* FROM event_members JOIN users ON users.id = event_members.user_id WHERE event_id = ? AND event_members.status = 'going' LIMIT 50`, event.id)
        .filter(row => friends.has(row.id)).slice(0, 8).map(publicUser) : [];
    return {
      id: event.id, title: event.title, description: event.description, category: event.category, visibility: event.visibility, status: event.status,
      place: { name: event.place_name, id: event.place_id, lat: event.lat, lon: event.lon },
      startsAt: event.starts_at, endsAt: event.ends_at, capacity: event.capacity,
      going: Number(counts?.going ?? 0), waitlist: Number(counts?.waitlist ?? 0),
      host: publicUser(this.db.get('SELECT * FROM users WHERE id = ?', event.host_id)), isHost: Boolean(viewer && event.host_id === viewer.id),
      myStatus: mine?.status ?? null, friendsGoing
    };
  }

  canSeeEvent(event, viewer, friends) {
    if (!event) return false;
    if (viewer && event.host_id === viewer.id) return true;
    if (event.status !== 'active') return Boolean(viewer && event.status === 'cancelled' && this.db.get('SELECT 1 AS ok FROM event_members WHERE event_id = ? AND user_id = ?', event.id, viewer.id));
    if (viewer && this.blocked(event.host_id, viewer.id)) return false;
    return event.visibility === 'public' || Boolean(viewer && friends.has(event.host_id));
  }

  visibleEvent(viewer, id) {
    const event = typeof id === 'string' ? this.db.get('SELECT * FROM events WHERE id = ?', id) : null;
    const friends = viewer ? new Set(this.friendIds(viewer.id)) : new Set();
    if (!this.canSeeEvent(event, viewer, friends)) fail(404, 'NOT_FOUND', 'Событие не найдено');
    return { event, friends };
  }

  notificationsView(user) {
    const rows = this.db.all(`SELECT notifications.*, users.name, users.emoji, users.color FROM notifications LEFT JOIN users ON users.id = notifications.actor_id
      WHERE user_id = ? ORDER BY created_at DESC LIMIT 30`, user.id);
    return rows.map(row => ({ id: row.id, type: row.type, text: row.text, entityId: row.entity_id, createdAt: row.created_at, read: row.read_at !== null,
      actor: row.actor_id && row.name ? publicUser({ id: row.actor_id, name: row.name, emoji: row.emoji, color: row.color }) : null }));
  }

  deleteUser(userId, now) {
    const hosted = this.db.all('SELECT id FROM meetups WHERE host_id = ?', userId).map(row => row.id);
    for (const id of hosted) {
      for (const member of this.db.all('SELECT user_id FROM meetup_members WHERE meetup_id = ?', id)) this.notify(member.user_id, 'meetup_cancelled', null, id, 'Встреча отменена: организатор удалил профиль', now);
      this.db.run('DELETE FROM messages WHERE meetup_id = ?', id);
      this.db.run('DELETE FROM meetup_members WHERE meetup_id = ?', id);
      this.db.run('DELETE FROM meetups WHERE id = ?', id);
    }
    for (const event of this.db.all('SELECT id FROM events WHERE host_id = ?', userId)) {
      this.db.run('DELETE FROM event_members WHERE event_id = ?', event.id);
      this.db.run('DELETE FROM event_reports WHERE event_id = ?', event.id);
      this.db.run('DELETE FROM events WHERE id = ?', event.id);
    }
    for (const statement of [
      'DELETE FROM tokens WHERE user_id = ?', 'DELETE FROM invites WHERE user_id = ?', 'DELETE FROM link_codes WHERE user_id = ?',
      'DELETE FROM friendships WHERE low = ? OR high = ?', 'DELETE FROM blocks WHERE blocker = ? OR blocked = ?',
      'DELETE FROM shares WHERE user_id = ?', 'DELETE FROM share_recipients WHERE user_id = ? OR recipient_id = ?',
      'DELETE FROM meetup_members WHERE user_id = ?', 'DELETE FROM messages WHERE user_id = ?', 'DELETE FROM event_members WHERE user_id = ?',
      'DELETE FROM event_reports WHERE user_id = ?', 'DELETE FROM notifications WHERE user_id = ? OR actor_id = ?', 'DELETE FROM users WHERE id = ?'
    ]) this.db.run(statement, ...Array(statement.split('?').length - 1).fill(userId));
  }
}

function inviteCode() { return randomString(8, CODE_ALPHABET); }

const PUBLIC_OPS = {
  register({ input, meta, now, fresh }) {
    // Generous per-address limit: a whole venue or campus often shares one public address.
    this.limit(`register:${meta.client ?? 'anonymous'}`, 40, HOUR, now, 'С этого адреса уже создано много профилей. Попробуйте через час.');
    const name = text(input.name, { field: 'Имя', min: 1, max: 32 });
    const emoji = typeof input.emoji === 'string' && EMOJIS.includes(input.emoji) ? input.emoji : fail(400, 'INVALID_INPUT', 'Выберите значок из списка');
    const id = crypto.randomUUID();
    this.db.run('INSERT INTO users (id, name, emoji, color, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)', id, name, emoji, colorFor(id), now, now);
    this.db.run('INSERT INTO tokens (hash, user_id, created_at) VALUES (?, ?, ?)', fresh.hash, id, now);
    return { token: fresh.token, me: publicUser(this.db.get('SELECT * FROM users WHERE id = ?', id)) };
  },

  previewInvite({ input, meta, now, viewer }) {
    this.limit(`preview:${meta.client ?? 'anonymous'}`, 120, HOUR, now);
    const code = typeof input.code === 'string' ? input.code.trim().toUpperCase() : '';
    const invite = code ? this.db.get('SELECT * FROM invites WHERE code = ? AND expires_at > ? AND uses < max_uses', code, now) : null;
    if (!invite) fail(404, 'INVITE_INVALID', 'Приглашение не найдено или устарело. Попросите новую ссылку.');
    const inviter = this.db.get('SELECT * FROM users WHERE id = ?', invite.user_id);
    return { inviter: publicUser(inviter), expiresAt: invite.expires_at,
      alreadyFriends: Boolean(viewer && viewer.id !== inviter.id && this.areFriends(viewer.id, inviter.id)), own: Boolean(viewer && viewer.id === inviter.id) };
  },

  listEvents({ viewer, now }) {
    const friends = viewer ? new Set(this.friendIds(viewer.id)) : new Set();
    const rows = this.db.all(`SELECT * FROM events WHERE ends_at > ? AND status IN ('active', 'cancelled', 'hidden') ORDER BY starts_at LIMIT 300`, now);
    return { events: rows.filter(event => this.canSeeEvent(event, viewer, friends)).slice(0, 100).map(event => this.eventView(event, viewer, friends)) };
  },

  getEvent({ viewer, input }) {
    const { event, friends } = this.visibleEvent(viewer, input.id);
    return { event: this.eventView(event, viewer, friends) };
  },

  claimDevice({ input, meta, now, fresh }) {
    this.limit(`claim:${meta.client ?? 'anonymous'}`, 20, HOUR, now, 'Слишком много попыток ввода кода. Попробуйте через час.');
    const code = typeof input.code === 'string' ? input.code.replace(/\D/g, '') : '';
    const link = code.length === 6 ? this.db.get('SELECT * FROM link_codes WHERE code = ? AND expires_at > ?', code, now) : null;
    if (!link) fail(404, 'CODE_INVALID', 'Код не подошёл или устарел. Получите новый в профиле на телефоне.');
    this.db.run('DELETE FROM link_codes WHERE code = ?', code);
    this.db.run('INSERT INTO tokens (hash, user_id, created_at) VALUES (?, ?, ?)', fresh.hash, link.user_id, now);
    return { token: fresh.token, me: publicUser(this.db.get('SELECT * FROM users WHERE id = ?', link.user_id)) };
  }
};

const USER_OPS = {
  state({ user, now }) {
    const notifications = this.notificationsView(user);
    return {
      me: publicUser(user), serverTime: now, share: this.shareView(user.id, now),
      friends: this.friendsView(user, now), meetups: this.meetupsView(user, now),
      notifications, unread: notifications.filter(item => !item.read).length,
      blocked: this.db.all('SELECT users.id, users.name, users.emoji, users.color FROM blocks JOIN users ON users.id = blocks.blocked WHERE blocker = ?', user.id).map(publicUser)
    };
  },

  updateProfile({ user, input }) {
    const name = input.name === undefined ? user.name : text(input.name, { field: 'Имя', min: 1, max: 32 });
    const emoji = input.emoji === undefined ? user.emoji : EMOJIS.includes(input.emoji) ? input.emoji : fail(400, 'INVALID_INPUT', 'Выберите значок из списка');
    this.db.run('UPDATE users SET name = ?, emoji = ? WHERE id = ?', name, emoji, user.id);
    return { me: publicUser({ ...user, name, emoji }) };
  },

  deleteAccount({ user, now }) {
    this.deleteUser(user.id, now);
    return { deleted: true };
  },

  logout({ tokenHash }) {
    this.db.run('DELETE FROM tokens WHERE hash = ?', tokenHash);
    return { loggedOut: true };
  },

  createInvite({ user, now }) {
    const current = this.db.get('SELECT * FROM invites WHERE user_id = ? AND expires_at > ? AND uses < max_uses ORDER BY created_at DESC LIMIT 1', user.id, now + DAY);
    if (current) return { code: current.code, expiresAt: current.expires_at };
    this.limit(`invite:${user.id}`, 30, DAY, now);
    const code = inviteCode();
    this.db.run('INSERT INTO invites (code, user_id, created_at, expires_at, uses, max_uses) VALUES (?, ?, ?, ?, 0, 30)', code, user.id, now, now + 3 * DAY);
    return { code, expiresAt: now + 3 * DAY };
  },

  acceptInvite({ user, input, now }) {
    this.limit(`accept:${user.id}`, 30, HOUR, now);
    const code = typeof input.code === 'string' ? input.code.trim().toUpperCase() : '';
    const invite = code ? this.db.get('SELECT * FROM invites WHERE code = ? AND expires_at > ? AND uses < max_uses', code, now) : null;
    if (!invite) fail(404, 'INVITE_INVALID', 'Приглашение не найдено или устарело. Попросите новую ссылку.');
    if (invite.user_id === user.id) fail(409, 'OWN_INVITE', 'Это ваша собственная ссылка. Отправьте её другу.');
    if (this.blocked(invite.user_id, user.id)) fail(403, 'BLOCKED', 'Добавить этого человека нельзя');
    const friend = this.db.get('SELECT * FROM users WHERE id = ?', invite.user_id);
    if (this.areFriends(user.id, friend.id)) return { friend: publicUser(friend), already: true };
    if (this.friendIds(user.id).length >= 500) fail(409, 'TOO_MANY_FRIENDS', 'Достигнут предел в 500 друзей');
    const [low, high] = pair(user.id, friend.id);
    this.db.run('INSERT INTO friendships (low, high, created_at) VALUES (?, ?, ?)', low, high, now);
    this.db.run('UPDATE invites SET uses = uses + 1 WHERE code = ?', code);
    this.notify(friend.id, 'friend_added', user.id, user.id, `${user.name} теперь у вас в друзьях`, now);
    return { friend: publicUser(friend), already: false };
  },

  removeFriend({ user, input }) {
    if (typeof input.userId !== 'string') fail(400, 'INVALID_INPUT', 'Укажите друга');
    const [low, high] = pair(user.id, input.userId);
    this.db.run('DELETE FROM friendships WHERE low = ? AND high = ?', low, high);
    this.db.run('DELETE FROM share_recipients WHERE (user_id = ? AND recipient_id = ?) OR (user_id = ? AND recipient_id = ?)', user.id, input.userId, input.userId, user.id);
    return { removed: true };
  },

  blockUser({ user, input, now }) {
    if (typeof input.userId !== 'string' || input.userId === user.id || !this.db.get('SELECT 1 AS ok FROM users WHERE id = ?', input.userId)) fail(400, 'INVALID_INPUT', 'Укажите человека');
    USER_OPS.removeFriend.call(this, { user, input });
    this.db.run('INSERT OR IGNORE INTO blocks (blocker, blocked, created_at) VALUES (?, ?, ?)', user.id, input.userId, now);
    // A blocked person also leaves the blocker's meetups.
    this.db.run('DELETE FROM meetup_members WHERE user_id = ? AND meetup_id IN (SELECT id FROM meetups WHERE host_id = ?)', input.userId, user.id);
    return { blocked: true };
  },

  unblockUser({ user, input }) {
    this.db.run('DELETE FROM blocks WHERE blocker = ? AND blocked = ?', user.id, String(input.userId ?? ''));
    return { unblocked: true };
  },

  startShare({ user, input, now }) {
    if (input.consent !== true) fail(400, 'CONSENT_REQUIRED', 'Подтвердите, что согласны показать друзьям свою точку');
    const mode = SHARE_MODES.includes(input.mode) ? input.mode : fail(400, 'INVALID_INPUT', 'Выберите точность: примерно или точно');
    const minutes = SHARE_MINUTES.includes(Number(input.minutes)) ? Number(input.minutes) : fail(400, 'INVALID_INPUT', 'Выберите срок: 15 минут, 1 час или 8 часов');
    const audience = input.audience === 'selected' ? 'selected' : input.audience === 'all' ? 'all' : fail(400, 'INVALID_INPUT', 'Выберите, кому показывать');
    const recipients = audience === 'selected' ? idList(input.recipients, 100) : [];
    if (audience === 'selected' && !recipients.length) fail(400, 'INVALID_INPUT', 'Выберите хотя бы одного друга');
    if (recipients.length) this.requireFriends(user.id, recipients);
    const note = text(input.note, { field: 'Статус', max: 60 });
    const previous = this.shareView(user.id, now);
    const expiresAt = now + minutes * MINUTE;
    // A new consent starts from an empty point: nothing collected under older settings carries over.
    this.db.run(`INSERT INTO shares (user_id, mode, audience, note, granted_at, expires_at, lat, lon, accuracy, updated_at) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL)
      ON CONFLICT(user_id) DO UPDATE SET mode = excluded.mode, audience = excluded.audience, note = excluded.note, granted_at = excluded.granted_at,
      expires_at = excluded.expires_at, lat = NULL, lon = NULL, accuracy = NULL, updated_at = NULL`, user.id, mode, audience, note, now, expiresAt);
    this.db.run('DELETE FROM share_recipients WHERE user_id = ?', user.id);
    for (const id of recipients) this.db.run('INSERT INTO share_recipients (user_id, recipient_id) VALUES (?, ?)', user.id, id);
    this.schedule(expiresAt);
    if (!previous) {
      const audienceIds = audience === 'all' ? this.friendIds(user.id) : recipients;
      const until = minutes === 480 ? '8 часов' : minutes === 60 ? 'час' : '15 минут';
      for (const id of audienceIds) this.notify(id, 'location_shared', user.id, user.id, `${user.name} показывает вам, где находится, на ${until}`, now);
    }
    return { share: this.shareView(user.id, now) };
  },

  publishLocation({ user, input, now }) {
    const lat = Number(input.lat), lon = Number(input.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) fail(400, 'INVALID_INPUT', 'Некорректные координаты');
    const share = this.db.get('SELECT * FROM shares WHERE user_id = ? AND expires_at > ?', user.id, now);
    if (!share) fail(409, 'SHARE_INACTIVE', 'Показ геопозиции выключен или его срок истёк');
    if (share.updated_at && now - share.updated_at < 4000) return { share: this.shareView(user.id, now), throttled: true };
    const accuracyInput = Number.isFinite(Number(input.accuracy)) ? Math.min(100000, Math.max(0, Number(input.accuracy))) : null;
    // Approximate mode keeps three decimals (about 110 m north–south, 70 m east–west in Astana).
    const round = value => share.mode === 'approximate' ? Math.round(value * 1000) / 1000 : Math.round(value * 1e6) / 1e6;
    const accuracy = share.mode === 'approximate' ? Math.max(150, accuracyInput ?? 150) : accuracyInput;
    this.db.run('UPDATE shares SET lat = ?, lon = ?, accuracy = ?, updated_at = ? WHERE user_id = ?', round(lat), round(lon), accuracy, now, user.id);
    return { share: this.shareView(user.id, now) };
  },

  stopShare({ user }) {
    this.db.run('DELETE FROM shares WHERE user_id = ?', user.id);
    this.db.run('DELETE FROM share_recipients WHERE user_id = ?', user.id);
    return { share: null };
  },

  pingFriend({ user, input, now }) {
    if (typeof input.userId !== 'string' || !this.areFriends(user.id, input.userId)) fail(403, 'NOT_FRIENDS', 'Можно попросить только друга');
    this.limit(`ping:${user.id}:${input.userId}`, 1, 10 * MINUTE, now, 'Вы уже попросили недавно. Дайте другу время ответить.');
    this.notify(input.userId, 'location_request', user.id, user.id, `${user.name} просит показать, где вы. Решать вам.`, now);
    return { sent: true };
  },

  meetingParticipants({ user, input, now }) {
    const ids = idList(input.userIds, 8).filter(id => id !== user.id);
    this.requireFriends(user.id, ids);
    const located = [], missing = [];
    const mine = this.shareView(user.id, now);
    if (mine?.hasPoint) located.push({ ...publicUser(user), lat: mine.lat, lon: mine.lon, mode: mine.mode, self: true });
    for (const id of ids) {
      const friend = publicUser(this.db.get('SELECT * FROM users WHERE id = ?', id));
      const location = this.visibleLocation(id, user.id, now);
      if (location?.lat !== undefined) located.push({ ...friend, lat: location.lat, lon: location.lon, mode: location.mode });
      else missing.push(friend);
    }
    return { me: publicUser(user), located, missing };
  },

  createMeetup({ user, input, now }) {
    this.limit(`meetup:${user.id}`, 40, DAY, now);
    const title = text(input.title, { field: 'Название', max: 60, fallback: '' }) || 'Встреча';
    const note = text(input.note, { field: 'Комментарий', max: 200 });
    const where = place(input.place);
    const startsAt = timestamp(input.startsAt, 'время встречи');
    if (startsAt < now - 10 * MINUTE || startsAt > now + 30 * DAY) fail(400, 'INVALID_INPUT', 'Время встречи: от сейчас до 30 дней вперёд');
    const invitees = idList(input.invitees, 20).filter(id => id !== user.id);
    if (!invitees.length) fail(400, 'INVALID_INPUT', 'Позовите хотя бы одного друга');
    this.requireFriends(user.id, invitees);
    const active = this.db.get(`SELECT COUNT(*) AS n FROM meetups WHERE host_id = ? AND status = 'active' AND starts_at > ?`, user.id, now - 6 * HOUR).n;
    if (active >= 20) fail(409, 'TOO_MANY', 'У вас уже 20 активных встреч');
    const id = crypto.randomUUID();
    this.db.run(`INSERT INTO meetups (id, host_id, title, note, place_name, place_id, lat, lon, starts_at, status, revision, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 1, ?, ?)`, id, user.id, title, note, where.name, where.id, where.lat, where.lon, startsAt, now, now);
    this.db.run(`INSERT INTO meetup_members (meetup_id, user_id, status, seen_revision, updated_at) VALUES (?, ?, 'going', 1, ?)`, id, user.id, now);
    for (const friendId of invitees) {
      this.db.run(`INSERT INTO meetup_members (meetup_id, user_id, status, seen_revision, updated_at) VALUES (?, ?, 'invited', 0, ?)`, id, friendId, now);
      this.notify(friendId, 'meetup_invite', user.id, id, `${user.name} зовёт вас: ${title} · ${where.name}`, now);
    }
    return { meetup: this.meetupView(this.db.get('SELECT * FROM meetups WHERE id = ?', id), user.id) };
  },

  rsvpMeetup({ user, input, now }) {
    const meetup = this.memberMeetup(user, input.id);
    if (meetup.status === 'cancelled') fail(409, 'CANCELLED', 'Встреча отменена');
    const status = MEMBER_STATUSES.includes(input.status) ? input.status : fail(400, 'INVALID_INPUT', 'Неизвестный ответ');
    const before = this.db.get('SELECT status FROM meetup_members WHERE meetup_id = ? AND user_id = ?', meetup.id, user.id).status;
    this.db.run('UPDATE meetup_members SET status = ?, seen_revision = ?, updated_at = ? WHERE meetup_id = ? AND user_id = ?', status, meetup.revision, now, meetup.id, user.id);
    const phrases = { going: 'придёт', declined: 'не сможет прийти', arrived: 'уже на месте', on_way: 'уже в пути' };
    if (before !== status && phrases[status]) this.notify(meetup.host_id, `meetup_${status}`, user.id, meetup.id, `${user.name} ${phrases[status]}: ${meetup.title}`, now);
    return { meetup: this.meetupView(meetup, user.id) };
  },

  updateMeetup({ user, input, now }) {
    const meetup = this.hostMeetup(user, input.id);
    const title = input.title === undefined ? meetup.title : text(input.title, { field: 'Название', min: 1, max: 60 });
    const note = input.note === undefined ? meetup.note : text(input.note, { field: 'Комментарий', max: 200 });
    const where = input.place === undefined ? { name: meetup.place_name, id: meetup.place_id, lat: meetup.lat, lon: meetup.lon } : place(input.place);
    const startsAt = input.startsAt === undefined ? meetup.starts_at : timestamp(input.startsAt, 'время встречи');
    if (startsAt !== meetup.starts_at && (startsAt < now - 10 * MINUTE || startsAt > now + 30 * DAY)) fail(400, 'INVALID_INPUT', 'Время встречи: от сейчас до 30 дней вперёд');
    const moved = startsAt !== meetup.starts_at || where.lat !== meetup.lat || where.lon !== meetup.lon;
    this.db.run(`UPDATE meetups SET title = ?, note = ?, place_name = ?, place_id = ?, lat = ?, lon = ?, starts_at = ?, revision = revision + ?, updated_at = ? WHERE id = ?`,
      title, note, where.name, where.id, where.lat, where.lon, startsAt, moved ? 1 : 0, now, meetup.id);
    this.db.run('UPDATE meetup_members SET seen_revision = seen_revision + ? WHERE meetup_id = ? AND user_id = ?', moved ? 1 : 0, meetup.id, user.id);
    if (moved) for (const member of this.db.all('SELECT user_id FROM meetup_members WHERE meetup_id = ?', meetup.id)) {
      this.notify(member.user_id, 'meetup_changed', user.id, meetup.id, `${user.name} изменил(а) время или место: ${title}`, now);
    }
    return { meetup: this.meetupView(this.db.get('SELECT * FROM meetups WHERE id = ?', meetup.id), user.id) };
  },

  inviteToMeetup({ user, input, now }) {
    const meetup = this.hostMeetup(user, input.id);
    const ids = idList(input.userIds, 20).filter(id => id !== user.id);
    this.requireFriends(user.id, ids);
    for (const id of ids) {
      const added = this.db.run(`INSERT OR IGNORE INTO meetup_members (meetup_id, user_id, status, seen_revision, updated_at) VALUES (?, ?, 'invited', 0, ?)`, meetup.id, id, now);
      if (added.changes) this.notify(id, 'meetup_invite', user.id, meetup.id, `${user.name} зовёт вас: ${meetup.title} · ${meetup.place_name}`, now);
    }
    return { meetup: this.meetupView(meetup, user.id) };
  },

  cancelMeetup({ user, input, now }) {
    const meetup = this.hostMeetup(user, input.id);
    this.db.run(`UPDATE meetups SET status = 'cancelled', updated_at = ? WHERE id = ?`, now, meetup.id);
    for (const member of this.db.all('SELECT user_id FROM meetup_members WHERE meetup_id = ?', meetup.id)) {
      this.notify(member.user_id, 'meetup_cancelled', user.id, meetup.id, `${user.name} отменил(а) встречу: ${meetup.title}`, now);
    }
    return { meetup: this.meetupView(this.db.get('SELECT * FROM meetups WHERE id = ?', meetup.id), user.id) };
  },

  postMessage({ user, input, now }) {
    const meetup = this.memberMeetup(user, input.id);
    this.limit(`message:${user.id}`, 20, MINUTE, now);
    const body = text(input.body, { field: 'Сообщение', min: 1, max: 280 });
    this.db.run('INSERT INTO messages (id, meetup_id, user_id, body, created_at) VALUES (?, ?, ?, ?, ?)', crypto.randomUUID(), meetup.id, user.id, body, now);
    this.db.run('DELETE FROM messages WHERE meetup_id = ? AND id NOT IN (SELECT id FROM messages WHERE meetup_id = ? ORDER BY created_at DESC LIMIT 100)', meetup.id, meetup.id);
    return { meetup: this.meetupView(meetup, user.id) };
  },

  createEvent({ user, input, now }) {
    this.limit(`event:${user.id}`, 10, DAY, now, 'За сутки можно создать до 10 событий');
    const title = text(input.title, { field: 'Название', min: 3, max: 80 });
    const description = text(input.description, { field: 'Описание', max: 600 });
    const category = EVENT_CATEGORIES.includes(input.category) ? input.category : 'other';
    const where = place(input.place);
    const startsAt = timestamp(input.startsAt, 'начало события');
    if (startsAt < now - 10 * MINUTE || startsAt > now + 60 * DAY) fail(400, 'INVALID_INPUT', 'Начало события: от сейчас до 60 дней вперёд');
    const endsAt = input.endsAt === undefined || input.endsAt === null ? startsAt + 2 * HOUR : timestamp(input.endsAt, 'окончание события');
    if (endsAt <= startsAt || endsAt - startsAt > 12 * HOUR) fail(400, 'INVALID_INPUT', 'Событие длится от нескольких минут до 12 часов');
    const capacity = input.capacity === undefined || input.capacity === null || input.capacity === '' ? null : Number(input.capacity);
    if (capacity !== null && (!Number.isInteger(capacity) || capacity < 2 || capacity > 500)) fail(400, 'INVALID_INPUT', 'Мест: от 2 до 500 или без ограничения');
    const visibility = input.visibility === 'friends' ? 'friends' : 'public';
    const active = this.db.get(`SELECT COUNT(*) AS n FROM events WHERE host_id = ? AND status = 'active' AND ends_at > ?`, user.id, now).n;
    if (active >= 5) fail(409, 'TOO_MANY', 'Можно вести до 5 будущих событий одновременно');
    const id = crypto.randomUUID();
    this.db.run(`INSERT INTO events (id, host_id, title, description, category, place_name, place_id, lat, lon, starts_at, ends_at, capacity, visibility, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`, id, user.id, title, description, category, where.name, where.id, where.lat, where.lon, startsAt, endsAt, capacity, visibility, now, now);
    this.db.run(`INSERT INTO event_members (event_id, user_id, status, created_at) VALUES (?, ?, 'going', ?)`, id, user.id, now);
    return { event: this.eventView(this.db.get('SELECT * FROM events WHERE id = ?', id), user, new Set(this.friendIds(user.id))) };
  },

  joinEvent({ user, input, now }) {
    const { event, friends } = this.visibleEvent(user, input.id);
    if (event.status !== 'active') fail(409, 'CLOSED', 'Событие отменено');
    if (event.ends_at <= now) fail(409, 'CLOSED', 'Событие уже закончилось');
    const existing = this.db.get('SELECT status FROM event_members WHERE event_id = ? AND user_id = ?', event.id, user.id);
    if (!existing) {
      // Synchronous count-and-insert: inside a Durable Object no other request can take the last seat in between.
      const going = this.db.get(`SELECT COUNT(*) AS n FROM event_members WHERE event_id = ? AND status = 'going'`, event.id).n;
      const status = event.capacity !== null && going >= event.capacity ? 'waitlist' : 'going';
      this.db.run('INSERT INTO event_members (event_id, user_id, status, created_at) VALUES (?, ?, ?, ?)', event.id, user.id, status, now);
      if (status === 'going') this.notify(event.host_id, 'event_joined', user.id, event.id, `${user.name} идёт на «${event.title}»`, now);
    }
    return { event: this.eventView(event, user, friends) };
  },

  leaveEvent({ user, input, now }) {
    const { event, friends } = this.visibleEvent(user, input.id);
    if (event.host_id === user.id) fail(409, 'HOST', 'Организатор не может уйти со своего события, но может его отменить');
    const existing = this.db.get('SELECT status FROM event_members WHERE event_id = ? AND user_id = ?', event.id, user.id);
    this.db.run('DELETE FROM event_members WHERE event_id = ? AND user_id = ?', event.id, user.id);
    if (existing?.status === 'going' && event.status === 'active') {
      const next = this.db.get(`SELECT user_id FROM event_members WHERE event_id = ? AND status = 'waitlist' ORDER BY created_at LIMIT 1`, event.id);
      if (next) {
        this.db.run(`UPDATE event_members SET status = 'going' WHERE event_id = ? AND user_id = ?`, event.id, next.user_id);
        this.notify(next.user_id, 'event_spot', null, event.id, `Освободилось место: вы идёте на «${event.title}»`, now);
      }
    }
    return { event: this.eventView(event, user, friends) };
  },

  cancelEvent({ user, input, now }) {
    const { event } = this.visibleEvent(user, input.id);
    if (event.host_id !== user.id) fail(403, 'FORBIDDEN', 'Отменить событие может только организатор');
    this.db.run(`UPDATE events SET status = 'cancelled', updated_at = ? WHERE id = ?`, now, event.id);
    for (const member of this.db.all('SELECT user_id FROM event_members WHERE event_id = ?', event.id)) {
      this.notify(member.user_id, 'event_cancelled', user.id, event.id, `Событие отменено: «${event.title}»`, now);
    }
    return { event: this.eventView(this.db.get('SELECT * FROM events WHERE id = ?', event.id), user, new Set(this.friendIds(user.id))) };
  },

  reportEvent({ user, input, now }) {
    const { event } = this.visibleEvent(user, input.id);
    if (event.host_id === user.id) fail(409, 'HOST', 'Нельзя пожаловаться на своё событие');
    const reason = text(input.reason, { field: 'Причина', max: 200, fallback: '' });
    this.db.run('INSERT OR IGNORE INTO event_reports (event_id, user_id, reason, created_at) VALUES (?, ?, ?, ?)', event.id, user.id, reason, now);
    const reports = this.db.get('SELECT COUNT(*) AS n FROM event_reports WHERE event_id = ?', event.id).n;
    // Hidden until reviewed; the organizer still sees it.
    if (reports >= REPORTS_TO_HIDE && event.status === 'active') this.db.run(`UPDATE events SET status = 'hidden', updated_at = ? WHERE id = ?`, now, event.id);
    return { reported: true };
  },

  inviteToEvent({ user, input, now }) {
    const { event } = this.visibleEvent(user, input.id);
    if (event.status !== 'active') fail(409, 'CLOSED', 'Событие отменено');
    const ids = idList(input.userIds, 20).filter(id => id !== user.id);
    this.requireFriends(user.id, ids);
    this.limit(`event-invite:${user.id}`, 60, DAY, now);
    for (const id of ids) this.notify(id, 'event_invite', user.id, event.id, `${user.name} зовёт вас на «${event.title}»`, now);
    return { invited: ids.length };
  },

  markRead({ user, now }) {
    this.db.run('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL', now, user.id);
    return { read: true };
  },

  linkDevice({ user, now }) {
    this.limit(`link:${user.id}`, 10, HOUR, now);
    this.db.run('DELETE FROM link_codes WHERE user_id = ?', user.id);
    let code;
    do { code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, '0'); }
    while (this.db.get('SELECT 1 AS ok FROM link_codes WHERE code = ?', code));
    this.db.run('INSERT INTO link_codes (code, user_id, expires_at) VALUES (?, ?, ?)', code, user.id, now + 10 * MINUTE);
    return { code, expiresAt: now + 10 * MINUTE };
  }
};

export const OPERATIONS = Object.freeze({ public: Object.keys(PUBLIC_OPS), user: Object.keys(USER_OPS) });
