import test from 'node:test';
import assert from 'node:assert/strict';
import { handleApi } from '../src/api.mjs';
import { localSocialHub } from '../src/social/local.mjs';
import { fairMeetingPoints } from '../src/social/meeting.mjs';

const ORIGIN = 'https://seruen.example';
const cafe = (id, name, lat, lon, extra = {}) => ({ id, name, lat, lon, category: 'cafe', description: name, tags: { amenity: 'cafe' },
  sourceUrl: `https://www.openstreetmap.org/node/${id}`, retrievedAt: '2026-10-19T10:00:00Z', openingHours: '24/7', ...extra });
// Two friends about 2.8 km apart along a parallel; the middle café is fair, the one next to Ana is not.
const dataset = [
  cafe('1', 'Кофе у Аны', 51.1283, 71.4310),
  cafe('2', 'Кофе посередине', 51.1283, 71.4504),
  cafe('3', 'Кофе у Бека', 51.1283, 71.4690),
  cafe('4', 'Закрытое кафе', 51.1284, 71.4505, { openingHours: 'Mo-Su 03:00-04:00' })
];

function setup() {
  let clock = Date.parse('2026-10-20T10:00:00Z');
  const hub = localSocialHub(':memory:', { now: () => clock });
  const env = { SOCIAL_LOCAL: hub, LOCAL_DEVELOPMENT: true };
  const api = async (path, { body, token, method = body === undefined ? 'GET' : 'POST', origin = ORIGIN } = {}) => {
    const headers = { ...(origin ? { Origin: origin } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) };
    const response = await handleApi(new Request(`${ORIGIN}/api/social/${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }), env, dataset);
    return { status: response.status, data: await response.json() };
  };
  const person = async (name, emoji = '🦊') => {
    const { status, data } = await api('register', { body: { name, emoji } });
    assert.equal(status, 200, JSON.stringify(data));
    return { token: data.token, id: data.me.id, name };
  };
  const befriend = async (a, b) => {
    const invite = await api('createInvite', { body: {}, token: a.token });
    const accepted = await api('acceptInvite', { body: { code: invite.data.code }, token: b.token });
    assert.equal(accepted.status, 200, JSON.stringify(accepted.data));
  };
  const share = (who, extra = {}) => api('startShare', { token: who.token, body: { mode: 'precise', audience: 'all', minutes: 60, consent: true, ...extra } });
  return { api, person, befriend, share, advance: ms => { clock += ms; }, now: () => clock };
}

test('a profile needs only a name and an icon; the token is never stored in clear', async () => {
  const { api, person } = setup();
  const ana = await person('Ана');
  assert.ok(ana.token.length >= 40);
  const state = await api('state', { token: ana.token });
  assert.equal(state.status, 200);
  assert.equal(state.data.me.name, 'Ана');
  assert.deepEqual(state.data.friends, []);
  assert.equal((await api('state')).status, 401);
  assert.equal((await api('state', { token: 'x'.repeat(43) })).status, 401);
  assert.equal((await api('register', { body: { name: '', emoji: '🦊' } })).status, 400);
  assert.equal((await api('register', { body: { name: 'Ок', emoji: '💣' } })).status, 400);
});

test('requests from another site are rejected', async () => {
  const { api } = setup();
  assert.equal((await api('register', { body: { name: 'Ана', emoji: '🦊' }, origin: 'https://evil.example' })).status, 403);
});

test('an invite link makes two people friends, once, and never with themselves', async () => {
  const { api, person } = setup();
  const ana = await person('Ана'), bek = await person('Бек', '🐻');
  const invite = await api('createInvite', { body: {}, token: ana.token });
  const preview = await api(`invite?code=${invite.data.code}`);
  assert.equal(preview.status, 200);
  assert.equal(preview.data.inviter.name, 'Ана');
  assert.equal((await api('acceptInvite', { body: { code: invite.data.code }, token: ana.token })).status, 409);
  const accepted = await api('acceptInvite', { body: { code: invite.data.code }, token: bek.token });
  assert.equal(accepted.data.friend.name, 'Ана');
  assert.equal((await api('acceptInvite', { body: { code: invite.data.code }, token: bek.token })).data.already, true);
  const anaState = await api('state', { token: ana.token });
  assert.deepEqual(anaState.data.friends.map(friend => friend.name), ['Бек']);
  assert.equal(anaState.data.notifications[0].type, 'friend_added');
  assert.equal((await api('acceptInvite', { body: { code: 'NOPE2345' }, token: bek.token })).status, 404);
});

test('location is shown only after explicit consent, only to friends, and is gone when stopped', async () => {
  const { api, person, befriend, share } = setup();
  const ana = await person('Ана'), bek = await person('Бек'), stranger = await person('Чужой');
  await befriend(ana, bek);
  assert.equal((await share(ana, { consent: false })).status, 400);
  assert.equal((await api('publishLocation', { token: ana.token, body: { lat: 51.1283, lon: 71.4304 } })).status, 409);
  assert.equal((await share(ana)).status, 200);
  assert.equal((await api('publishLocation', { token: ana.token, body: { lat: 51.12834567, lon: 71.43045678, accuracy: 12 } })).status, 200);
  const seen = (await api('state', { token: bek.token })).data.friends[0].location;
  assert.equal(seen.lat, 51.128346);
  assert.equal(seen.accuracy, 12);
  const strangerState = await api('state', { token: stranger.token });
  assert.deepEqual(strangerState.data.friends, []);
  await api('stopShare', { token: ana.token, body: {} });
  assert.equal((await api('state', { token: bek.token })).data.friends[0].location, null);
});

test('approximate mode rounds the point and widens accuracy; the share expires on time', async () => {
  const { api, person, befriend, share, advance } = setup();
  const ana = await person('Ана'), bek = await person('Бек');
  await befriend(ana, bek);
  await share(ana, { mode: 'approximate', minutes: 15 });
  await api('publishLocation', { token: ana.token, body: { lat: 51.12834567, lon: 71.43045678, accuracy: 10 } });
  const seen = (await api('state', { token: bek.token })).data.friends[0].location;
  assert.equal(seen.lat, 51.128);
  assert.equal(seen.lon, 71.43);
  assert.equal(seen.accuracy, 150);
  advance(15 * 60_000 + 1);
  assert.equal((await api('state', { token: bek.token })).data.friends[0].location, null);
  assert.equal((await api('state', { token: ana.token })).data.share, null);
});

test('sharing with selected friends hides the point from the others', async () => {
  const { api, person, befriend, share } = setup();
  const ana = await person('Ана'), bek = await person('Бек'), dina = await person('Дина');
  await befriend(ana, bek);
  await befriend(ana, dina);
  assert.equal((await share(ana, { audience: 'selected', recipients: [] })).status, 400);
  assert.equal((await share(ana, { audience: 'selected', recipients: [bek.id] })).status, 200);
  await api('publishLocation', { token: ana.token, body: { lat: 51.1283, lon: 71.4304 } });
  assert.ok((await api('state', { token: bek.token })).data.friends[0].location.lat);
  assert.equal((await api('state', { token: dina.token })).data.friends[0].location, null);
});

test('blocking ends the friendship and hides the location', async () => {
  const { api, person, befriend, share } = setup();
  const ana = await person('Ана'), bek = await person('Бек');
  await befriend(ana, bek);
  await share(ana);
  await api('publishLocation', { token: ana.token, body: { lat: 51.1283, lon: 71.4304 } });
  await api('blockUser', { token: bek.token, body: { userId: ana.id } });
  assert.deepEqual((await api('state', { token: bek.token })).data.friends, []);
  const invite = await api('createInvite', { body: {}, token: ana.token });
  assert.equal((await api('acceptInvite', { body: { code: invite.data.code }, token: bek.token })).status, 403);
});

test('the fair meeting point minimises the longest walk and skips closed places', async () => {
  const { api, person, befriend, share } = setup();
  const ana = await person('Ана'), bek = await person('Бек'), dina = await person('Дина');
  await befriend(ana, bek);
  await befriend(ana, dina);
  await share(bek);
  await api('publishLocation', { token: bek.token, body: { lat: 51.1283, lon: 71.4700 } });
  const missingFriend = await api('meeting-point', { token: ana.token, body: { userIds: [dina.id] } });
  assert.equal(missingFriend.status, 409);
  const result = await api('meeting-point', { token: ana.token, body: { userIds: [bek.id, dina.id], kind: 'coffee', me: { lat: 51.1283, lon: 71.4300 }, at: '2026-10-20T10:00:00Z' } });
  assert.equal(result.status, 200, JSON.stringify(result.data));
  assert.equal(result.data.options[0].place.name, 'Кофе посередине');
  assert.ok(!result.data.options.some(option => option.place.name === 'Закрытое кафе'));
  assert.equal(result.data.options[0].walks.length, 2);
  assert.ok(result.data.options[0].spreadMinutes <= 1);
  assert.deepEqual(result.data.missing.map(friend => friend.name), ['Дина']);
  assert.ok(result.data.participants.every(person => person.lat === undefined), 'coordinates are not echoed back');
});

test('one friend is enough for a meeting point, with or without the caller\'s own point', async () => {
  const { api, person, befriend, share, now } = setup();
  const ana = await person('Ана'), bek = await person('Бек'), dina = await person('Дина');
  await befriend(ana, bek);
  await befriend(ana, dina);
  await share(bek);
  await api('publishLocation', { token: bek.token, body: { lat: 51.1283, lon: 71.4700 } });
  // Only the friend's point is known (Ana shares nothing and sends no point): the nearest good places to the friend.
  const friendOnly = await api('meeting-point', { token: ana.token, body: { userIds: [bek.id], kind: 'coffee', at: '2026-10-20T10:00:00Z' } });
  assert.equal(friendOnly.status, 200, JSON.stringify(friendOnly.data));
  assert.equal(friendOnly.data.options[0].place.name, 'Кофе у Бека');
  assert.equal(friendOnly.data.options[0].walks.length, 1);
  assert.equal(friendOnly.data.options[0].why, `Идти примерно ${friendOnly.data.options[0].maxMinutes} мин`);
  // A friend without a point and Ana's own point (from her start point, not geolocation): the places near Ana, the friend listed as missing.
  const meOnly = await api('meeting-point', { token: ana.token, body: { userIds: [dina.id], kind: 'coffee', me: { lat: 51.1283, lon: 71.4310 }, at: '2026-10-20T10:00:00Z' } });
  assert.equal(meOnly.status, 200, JSON.stringify(meOnly.data));
  assert.equal(meOnly.data.options[0].place.name, 'Кофе у Аны');
  assert.deepEqual(meOnly.data.missing.map(friend => friend.name), ['Дина']);
  // Nobody's point is known: nothing to count from.
  assert.equal((await api('meeting-point', { token: ana.token, body: { userIds: [dina.id] } })).status, 409);
  // A meetup with one invited friend, who does not share a location.
  const place = { id: '2', name: 'Кофе посередине', lat: 51.1283, lon: 71.4504 };
  assert.equal((await api('createMeetup', { token: ana.token, body: { title: 'Кофе', place, startsAt: now() + 3600_000, invitees: [dina.id] } })).status, 200);
});

test('fairMeetingPoints prefers an even split over a shorter total', () => {
  const people = [{ id: 'a', lat: 51.1283, lon: 71.4400 }, { id: 'b', lat: 51.1283, lon: 71.4610 }];
  const { options } = fairMeetingPoints(dataset, people, { kind: 'coffee', at: new Date('2026-10-20T10:00:00Z') });
  assert.equal(options[0].place.name, 'Кофе посередине');
  assert.ok(options[0].maxMinutes < options[1].maxMinutes);
});

test('a meeting place names its dataset, not always OSM', () => {
  const people = [{ id: 'a', lat: 51.1283, lon: 71.4400 }, { id: 'b', lat: 51.1283, lon: 71.4610 }];
  const overture = dataset.map(place => ({ ...place, source: { label: 'Overture Maps · Meta' } }));
  assert.equal(fairMeetingPoints(overture, people, { kind: 'coffee', at: new Date('2026-10-20T10:00:00Z') }).options[0].place.source.label, 'Overture Maps · Meta');
  assert.equal(fairMeetingPoints(dataset, people, { kind: 'coffee', at: new Date('2026-10-20T10:00:00Z') }).options[0].place.source.label, 'OpenStreetMap');
});

test('meetups invite friends only and collect answers', async () => {
  const { api, person, befriend, now } = setup();
  const ana = await person('Ана'), bek = await person('Бек'), stranger = await person('Чужой');
  await befriend(ana, bek);
  const place = { id: '2', name: 'Кофе посередине', lat: 51.1283, lon: 71.4504 };
  assert.equal((await api('createMeetup', { token: ana.token, body: { title: 'Кофе', place, startsAt: now() + 3600_000, invitees: [stranger.id] } })).status, 403);
  const created = await api('createMeetup', { token: ana.token, body: { title: 'Кофе', place, startsAt: now() + 3600_000, invitees: [bek.id] } });
  assert.equal(created.status, 200, JSON.stringify(created.data));
  const id = created.data.meetup.id;
  const bekState = await api('state', { token: bek.token });
  assert.equal(bekState.data.meetups[0].myStatus, 'invited');
  assert.equal(bekState.data.notifications[0].type, 'meetup_invite');
  assert.equal((await api('rsvpMeetup', { token: bek.token, body: { id, status: 'on_way' } })).data.meetup.myStatus, 'on_way');
  await api('postMessage', { token: bek.token, body: { id, body: 'Буду через 5 минут' } });
  const anaView = (await api('state', { token: ana.token })).data.meetups[0];
  assert.equal(anaView.members.find(member => member.name === 'Бек').status, 'on_way');
  assert.equal(anaView.messages[0].body, 'Буду через 5 минут');
  assert.equal((await api('updateMeetup', { token: bek.token, body: { id, startsAt: now() + 7200_000 } })).status, 403);
  await api('updateMeetup', { token: ana.token, body: { id, startsAt: now() + 7200_000 } });
  assert.equal((await api('state', { token: bek.token })).data.meetups[0].changed, true);
  await api('cancelMeetup', { token: ana.token, body: { id } });
  assert.equal((await api('state', { token: bek.token })).data.meetups[0].status, 'cancelled');
  assert.equal((await api('state', { token: stranger.token })).data.meetups.length, 0);
});

test('friends vote between up to three places and the meetup settles on the leader', async () => {
  const { api, person, befriend, now } = setup();
  const ana = await person('Ана'), bek = await person('Бек'), dana = await person('Дана');
  await befriend(ana, bek); await befriend(ana, dana);
  const options = dataset.slice(0, 3).map(({ id, name, lat, lon }) => ({ id, name, lat, lon }));
  const created = await api('createMeetup', { token: ana.token, body: { title: 'Кофе', options, startsAt: now() + 3600_000, invitees: [bek.id, dana.id] } });
  assert.equal(created.status, 200, JSON.stringify(created.data));
  const id = created.data.meetup.id;
  assert.equal(created.data.meetup.poll.open, true);
  assert.equal(created.data.meetup.poll.options.length, 3);
  assert.equal(created.data.meetup.place.name, 'Кофе у Аны');
  assert.equal((await api('createMeetup', { token: ana.token, body: { title: 'x', options: options.slice(0, 1), startsAt: now() + 3600_000, invitees: [bek.id] } })).status, 400);

  // Bek votes for the middle café: it leads, but the vote stays open until everyone has answered.
  let vote = await api('voteMeetup', { token: bek.token, body: { id, option: 1 } });
  assert.equal(vote.status, 200, JSON.stringify(vote.data));
  assert.equal(vote.data.meetup.place.name, 'Кофе посередине');
  assert.equal(vote.data.meetup.poll.myVote, 1);
  assert.equal(vote.data.meetup.poll.open, true);
  const host = await api('state', { token: ana.token });
  assert.ok(host.data.notifications.some(item => item.type === 'meetup_vote' && item.text.includes('Кофе посередине')));
  assert.equal((await api('voteMeetup', { token: bek.token, body: { id, option: 7 } })).status, 400);
  assert.equal((await api('decideMeetup', { token: bek.token, body: { id, option: 2 } })).status, 403);

  // Dana declines and the host votes: everyone left has voted, so the place is fixed and members are told.
  await api('rsvpMeetup', { token: dana.token, body: { id, status: 'declined' } });
  vote = await api('voteMeetup', { token: ana.token, body: { id, option: 1 } });
  assert.equal(vote.data.meetup.poll.open, false);
  assert.equal(vote.data.meetup.place.name, 'Кофе посередине');
  const guest = await api('state', { token: bek.token });
  assert.ok(guest.data.notifications.some(item => item.text.startsWith('Место выбрано: Кофе посередине')));
  assert.equal(guest.data.meetups[0].changed, true);
  assert.equal((await api('voteMeetup', { token: bek.token, body: { id, option: 0 } })).status, 409);

  // The host can also settle a vote early.
  const second = await api('createMeetup', { token: ana.token, body: { title: 'Обед', options, startsAt: now() + 7200_000, invitees: [bek.id] } });
  const decided = await api('decideMeetup', { token: ana.token, body: { id: second.data.meetup.id, option: 2 } });
  assert.equal(decided.data.meetup.poll.open, false);
  assert.equal(decided.data.meetup.place.name, 'Кофе у Бека');
});

test('events respect capacity, promote the waitlist and hide after reports', async () => {
  const { api, person, befriend, now } = setup();
  const host = await person('Организатор'), a = await person('А'), b = await person('Б'), c = await person('В'), d = await person('Г');
  await befriend(host, a);
  const place = { name: 'Набережная Есиля', lat: 51.161, lon: 71.423 };
  const created = await api('createEvent', { token: host.token, body: { title: 'Утренняя пробежка', category: 'sport', place, startsAt: now() + 86400_000, capacity: 2 } });
  assert.equal(created.status, 200, JSON.stringify(created.data));
  const id = created.data.event.id;
  assert.equal(created.data.event.going, 1);
  assert.equal((await api('joinEvent', { token: a.token, body: { id } })).data.event.myStatus, 'going');
  assert.equal((await api('joinEvent', { token: b.token, body: { id } })).data.event.myStatus, 'waitlist');
  const anonymous = await api('events');
  assert.equal(anonymous.data.events[0].going, 2);
  assert.deepEqual(anonymous.data.events[0].friendsGoing, []);
  assert.deepEqual((await api('events', { token: host.token })).data.events[0].friendsGoing.map(friend => friend.name), ['А']);
  await api('leaveEvent', { token: a.token, body: { id } });
  assert.equal((await api(`event?id=${id}`, { token: b.token })).data.event.myStatus, 'going');
  for (const reporter of [a, c, d]) await api('reportEvent', { token: reporter.token, body: { id, reason: 'спам' } });
  assert.equal((await api('events')).data.events.length, 0);
  assert.equal((await api('events', { token: host.token })).data.events[0].status, 'hidden');
});

test('friends-only events are invisible to strangers', async () => {
  const { api, person, befriend, now } = setup();
  const host = await person('Хост'), friend = await person('Друг'), stranger = await person('Чужой');
  await befriend(host, friend);
  await api('createEvent', { token: host.token, body: { title: 'Настолки дома', category: 'other', visibility: 'friends', place: { name: 'Дом', lat: 51.12, lon: 71.43 }, startsAt: now() + 3600_000 } });
  assert.equal((await api('events', { token: friend.token })).data.events.length, 1);
  assert.equal((await api('events', { token: stranger.token })).data.events.length, 0);
  assert.equal((await api('events')).data.events.length, 0);
});

test('a six-digit code signs a second device into the same profile once', async () => {
  const { api, person } = setup();
  const ana = await person('Ана');
  const link = await api('linkDevice', { token: ana.token, body: {} });
  assert.match(link.data.code, /^\d{6}$/);
  const claimed = await api('claimDevice', { body: { code: link.data.code } });
  assert.equal(claimed.data.me.id, ana.id);
  assert.notEqual(claimed.data.token, ana.token);
  assert.equal((await api('claimDevice', { body: { code: link.data.code } })).status, 404);
  assert.equal((await api('state', { token: claimed.data.token })).data.me.name, 'Ана');
});

test('deleting the profile removes the person everywhere', async () => {
  const { api, person, befriend, share } = setup();
  const ana = await person('Ана'), bek = await person('Бек');
  await befriend(ana, bek);
  await share(ana);
  await api('deleteAccount', { token: ana.token, body: {} });
  assert.equal((await api('state', { token: ana.token })).status, 401);
  assert.deepEqual((await api('state', { token: bek.token })).data.friends, []);
  assert.deepEqual((await api('state', { token: bek.token })).data.notifications.filter(item => item.actor), []);
});

test('place search finds places by name and sorts by distance', async () => {
  const { api } = setup();
  const result = await api('places?q=кофе&lat=51.1283&lon=71.47');
  assert.equal(result.data.places[0].name, 'Кофе у Бека');
});
