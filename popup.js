const wall = (name) => `backgrounds/${name}.webp`;

const walls = {
  'forest-road': 'Forest Road', 'red-peaks': 'Red Peaks', dunes: 'Dunes', canyon: 'Canyon',
  'autumn-peaks': 'Autumn', fittonia: 'Fittonia', fog: 'Fog', 'misty-peaks': 'Misty Peaks',
  'painted-canyon': 'Painted', 'shore-house': 'Shore', 'emerald-bay': 'Emerald Bay', mesa: 'Mesa',
  yosemite: 'Yosemite', canopy: 'Canopy', 'durdle-door': 'Durdle Door', sheep: 'Sheep',
  'blue-hour': 'Blue Hour', snowcap: 'Snowcap', summit: 'Summit', valley: 'Valley',
  'pine-lake': 'Pine Lake', creek: 'Creek', leaves: 'Leaves', woodland: 'Woodland', highland: 'Highland',
};
const names = Object.keys(walls);

// Shuffle all overrides picks without clearing them, so turning it off restores the selection.
let picks = JSON.parse(localStorage.picks ?? '[]').filter((n) => n in walls);
let all = !picks.length || localStorage.all !== 'false';
const mosaic = (ns) =>
  [0, 1, 2, 3]
    .map((i) => `url(${wall(ns[i % ns.length])}) ${(i % 2) * 100}% ${i > 1 ? 100 : 0}% / 50% 50% no-repeat`)
    .join(', ');
const shuffleArt = mosaic(['forest-road', 'emerald-bay', 'painted-canyon', 'fog']);
const art = (ns) => (ns.length === 1 ? `url(${wall(ns[0])}) center / cover` : ns.length ? mosaic(ns) : shuffleArt);

const bgOn = document.getElementById('bg-on');
bgOn.checked = localStorage.bgOn !== 'false';
bgOn.onchange = () => (localStorage.bgOn = bgOn.checked);

const grid = document.getElementById('bg');
const tile = document.getElementById('tile');
const boxes = {};
for (const n of ['shuffle', ...names]) {
  const t = tile.content.cloneNode(true);
  const l = t.querySelector('label');
  t.querySelector(n === 'shuffle' ? '.check' : '.shuffle').remove();
  l.style.setProperty('--wall', n === 'shuffle' ? shuffleArt : art([n]));
  t.querySelector('span').textContent = n === 'shuffle' ? 'Shuffle all' : walls[n];
  boxes[n] = t.querySelector('input');
  boxes[n].onchange = () => {
    if (n === 'shuffle') all = !all;
    else if (all) {
      all = false;
      if (!picks.includes(n)) picks = [...picks, n];
    } else picks = picks.includes(n) ? picks.filter((p) => p !== n) : [...picks, n];
    if (!picks.length) all = true;
    bgOn.checked = true;
    localStorage.bgOn = true;
    sync();
  };
  grid.append(t);
}

const thumb = document.querySelector('.thumb');
const toggleAll = document.getElementById('toggle-all');
toggleAll.onclick = () => {
  picks = toggleAll.textContent === 'Select all' ? [...names] : [];
  all = !picks.length;
  sync();
};
const sync = () => {
  localStorage.picks = JSON.stringify(picks);
  localStorage.all = all;
  for (const n in boxes) boxes[n].checked = n === 'shuffle' ? all : picks.includes(n);
  grid.classList.toggle('all', all);
  toggleAll.textContent = !all && picks.length === names.length ? 'Unselect all' : 'Select all';
  thumb.style.setProperty('--wall', art(all ? [] : picks));
  document.getElementById('pick').textContent =
    all ? 'Shuffle all' : picks.length === 1 ? walls[picks[0]] : `Shuffle ${picks.length} photos`;
};
sync();

const main = document.getElementById('main');
const custom = document.getElementById('custom');
const open = document.getElementById('open');
const show = (picker) => {
  main.hidden = picker;
  custom.hidden = !picker;
  (picker ? custom.querySelector(':checked') : open).focus();
};
open.onclick = () => show(true);
document.getElementById('back').onclick = () => show(false);

document.querySelectorAll('[data-full]').forEach((b) => {
  b.onclick = async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const pool = all ? names : picks;
    const name = pool[Math.floor(Math.random() * pool.length)];
    // Closing before the service worker receives the message silently drops it.
    await chrome.runtime.sendMessage({ tabId: tab.id, full: b.dataset.full === 'true', bg: bgOn.checked ? wall(name) : undefined });
    window.close();
  };
});
