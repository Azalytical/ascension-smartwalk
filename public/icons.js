/** SmartWalk line icons: 24 × 24, 1.8px stroke, currentColor. */
(function () {
  "use strict";
  const paths = Object.freeze({
    location: '<path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z"/><circle cx="12" cy="10" r="2.25"/>',
    locate: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3"/>',
    search: '<circle cx="10.75" cy="10.75" r="6.75"/><path d="m16 16 4.5 4.5"/>',
    food: '<path d="M4 3v7a3 3 0 0 0 6 0V3M7 3v18M17 21V3c-2.5 1.5-4 4.4-4 8v2h4"/>',
    walk: '<path d="M4 19h16M12 19v-6m0-10-6.5 10h13L12 3Z"/><path d="M7.5 16.5 6 19m10.5-2.5L18 19"/>',
    culture: '<path d="m3 9 9-5 9 5H3Zm2 0v10m5-10v10m4-10v10m5-10v10M3 20h18"/>',
    discover: '<path d="m12 2 1.9 6.1L20 10l-6.1 1.9L12 18l-1.9-6.1L4 10l6.1-1.9L12 2Z"/><path d="m19 17 .7 2.3L22 20l-2.3.7L19 23l-.7-2.3L16 20l2.3-.7L19 17Z"/>',
    time: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
    budget: '<path d="M4 5h16M4 9h16M12 9v11"/>',
    preferences: '<path d="M4 6h3m4 0h9M4 12h10m4 0h2M4 18h5m4 0h7"/><circle cx="9" cy="6" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="11" cy="18" r="2"/>',
    map: '<path d="m3 6 6-2 6 2 6-2v14l-6 2-6-2-6 2V6Zm6-2v14m6-12v14"/>',
    expand: '<path d="M9 4H4v5m11-5h5v5M4 15v5h5m11-5v5h-5"/>',
    collapse: '<path d="M4 9h5V4m11 5h-5V4M4 15h5v5m11-5h-5v5"/>',
    route: '<circle cx="5" cy="18" r="2"/><circle cx="19" cy="6" r="2"/><path d="M7 18h6a4 4 0 0 0 0-8h-2a4 4 0 0 1 0-8h6"/>',
    alternative: '<path d="M4 7h10a5 5 0 0 1 5 5v5m0 0-3-3m3 3 3-3M4 17h5a4 4 0 0 0 4-4"/>',
    save: '<path d="M5 3h12l3 3v15H4V3h1Zm2 0v6h10V3M7 21v-8h10v8"/>',
    download: '<path d="M12 3v12m-4-4 4 4 4-4M4 16v4h16v-4"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3m3 0-1 14H7L6 7m4 4v6m4-6v6"/>',
    external: '<path d="M13 4h7v7m0-7-9 9"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/>',
    instagram: '<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r=".9" fill="currentColor" stroke="none"/>',
    phone: '<path d="m7.2 3 3 3.6-1.8 2.1a15 15 0 0 0 6.9 6.9l2.1-1.8 3.6 3-.9 3a2 2 0 0 1-2 1.4C9.7 21.2 2.8 14.3 2.8 5a2 2 0 0 1 1.4-2l3-.9Z"/>',
    back: '<path d="m14 5-7 7 7 7M7 12h13"/>',
    close: '<path d="M5 5 19 19M19 5 5 19"/>',
    arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
    arrowUpRight: '<path d="M6 18 18 6M9 6h9v9"/>',
    chevronDown: '<path d="m5 9 7 7 7-7"/>',
    check: '<path d="m4 12 5 5L20 6"/>',
    child: '<circle cx="12" cy="4.5" r="2"/><path d="m6 10 6 2 6-2m-6 2v5m-5 4 5-4 5 4"/>',
    shield: '<path d="m12 2 8 3v6c0 5-3.5 8.5-8 11-4.5-2.5-8-6-8-11V5l8-3Z"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
  });
  const svgNS = "http://www.w3.org/2000/svg";
  function icon(name) {
    const artwork = paths[name];
    if (!artwork) throw new RangeError(`Unknown SmartWalk icon: ${name}`);
    const template = document.createElement("template");
    template.innerHTML = `<svg xmlns="${svgNS}" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${artwork}</svg>`;
    return template.content.firstElementChild;
  }
  window.SmartWalkIcons = Object.freeze({ icon, names: Object.freeze(Object.keys(paths)) });
}());
