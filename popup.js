const wall = (name) => `backgrounds/${name}.webp`;

const walls = {
  'forest-road': 'Forest Road', 'red-peaks': 'Red Peaks', dunes: 'Dunes', canyon: 'Canyon',
  'autumn-peaks': 'Autumn', fittonia: 'Fittonia', fog: 'Fog', 'misty-peaks': 'Misty Peaks',
  'painted-canyon': 'Painted', 'shore-house': 'Shore', 'emerald-bay': 'Emerald Bay', mesa: 'Mesa',
  yosemite: 'Yosemite', canopy: 'Canopy', 'durdle-door': 'Durdle Door', sheep: 'Sheep',
  'blue-hour': 'Blue Hour', snowcap: 'Snowcap', summit: 'Summit', valley: 'Valley',
  'pine-lake': 'Pine Lake', creek: 'Creek', leaves: 'Leaves', woodland: 'Woodland', highland: 'Highland',
};
const shuffle = (a) => a.map((v) => [Math.random(), v]).sort(([x], [y]) => x - y).map(([, v]) => v);

const off = new Set(JSON.parse(localStorage.off ?? '[]'));
const pinned = new Set(JSON.parse(localStorage.pins ?? '[]'));
let shown = JSON.parse(localStorage.shown ?? '[]').filter((n) => n in walls);

const grid = document.getElementById('bg');
const tile = document.getElementById('tile');
const toggle = (set, c) => {
  set.has(c.dataset.bg) ? set.delete(c.dataset.bg) : set.add(c.dataset.bg);
  sync();
};
const chips = Array.from({ length: 9 }, () => {
  const t = tile.content.cloneNode(true);
  const [c, pin] = t.querySelectorAll('button');
  c.onclick = () => toggle(off, c);
  pin.onclick = () => toggle(pinned, c);
  grid.append(t);
  return c;
});

const all = document.getElementById('all');
const sync = () => {
  chips.forEach((c) => {
    c.ariaPressed = !off.has(c.dataset.bg);
    c.nextElementSibling.ariaPressed = pinned.has(c.dataset.bg);
  });
  all.textContent = chips.every((c) => !off.has(c.dataset.bg)) ? 'Disable all' : 'Enable all';
  localStorage.off = JSON.stringify([...off]);
  localStorage.pins = JSON.stringify([...pinned].filter((n) => shown.includes(n)));
  localStorage.shown = JSON.stringify(shown);
};

// Keeps pinned tiles in their slot and refills the rest, preferring ones not currently shown.
const roll = () => {
  const fresh = [...shuffle(Object.keys(walls).filter((n) => !shown.includes(n))), ...shuffle(shown.filter((n) => !pinned.has(n)))];
  shown = chips.map((_, i) => (pinned.has(shown[i]) ? shown[i] : fresh.shift()));
  chips.forEach((c, i) => {
    c.dataset.bg = shown[i];
    c.textContent = walls[shown[i]];
    c.style.setProperty('--wall', `url(${wall(shown[i])})`);
    c.nextElementSibling.ariaLabel = `Pin ${walls[shown[i]]}`;
  });
  sync();
};

all.onclick = () => {
  const on = all.textContent === 'Enable all';
  chips.forEach((c) => (on ? off.delete(c.dataset.bg) : off.add(c.dataset.bg)));
  sync();
};
document.getElementById('refresh').onclick = () => {
  off.clear();
  roll();
};
roll();

document.querySelectorAll('[data-full]').forEach((b) => {
  b.onclick = async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const pool = shown.filter((n) => !off.has(n));
    const name = pool[Math.floor(Math.random() * pool.length)];
    // Closing before the service worker receives the message silently drops it.
    await chrome.runtime.sendMessage({ tabId: tab.id, full: b.dataset.full === 'true', bg: name && wall(name) });
    window.close();
  };
});
