// The «Друзья» tab: friends on the map, meetups and events (screens in ../social/).
// Social polling starts at page load, so a running location share and new invitations
// keep working while the person is on another tab.
import * as shell from '../shell.js';
import { mountSocial } from '../social/screens.js';
import * as social from '../social/service.js';

let screen = null;
let pending = [];

function showTab() {
  const open = shell.openTab || shell.activateTab || shell.showTab || shell.selectTab;
  open?.('friends');
}

/** Runs the action now if the tab is on screen, otherwise right after it mounts. */
function whenMounted(action) {
  if (screen) action(screen);
  else { pending.push(action); showTab(); }
}

shell.registerTab({
  id: 'friends', order: 30, icon: 'friends', title: { ru: 'Друзья', kk: 'Достар', en: 'Friends' },
  mount(root, ctx) {
    screen = mountSocial(root, ctx);
    const actions = pending;
    pending = [];
    for (const action of actions) action(screen);
  },
  relang() { screen?.relang(); },
  unmount() {
    screen?.unmount();
    screen = null;
  }
});

social.start();

// Links people send each other: /?friend=CODE (invite), /?event=ID, /?meetup=ID.
// They are handled after main.js has booted the shell and opened its first tab, which happens right after this import.
const params = new URLSearchParams(location.search);
const invite = params.get('friend'), eventId = params.get('event'), meetupId = params.get('meetup');
if (invite || eventId || meetupId) {
  const url = new URL(location.href);
  for (const key of ['friend', 'event', 'meetup']) url.searchParams.delete(key);
  history.replaceState(null, '', url);
  setTimeout(() => {
    if (invite) whenMounted(tab => tab.openInvite(invite));
    if (eventId) whenMounted(tab => tab.openEvent(eventId));
    if (meetupId) whenMounted(tab => tab.openMeetup(meetupId));
  });
}

// «Позвать друзей» on a place card: window.SeruenSocial.planMeetup({ id, name, lat, lon }).
window.SeruenSocial = {
  planMeetup(place) { whenMounted(tab => tab.planMeetup(place)); },
  signedIn: social.signedIn
};
