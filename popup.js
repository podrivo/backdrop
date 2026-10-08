// Which frame of backgrounds/<name>-<frame>.webp to use at each local hour, like macOS dynamic wallpapers.
// ponytail: fixed hours stand in for sunrise/sunset; use SunCalc + geolocation if seasons matter.
const SOLAR = [1, 1, 1, 1, 1, 2, 3, 0, 0, 4, 4, 4, 4, 4, 4, 4, 5, 6, 7, 1, 1, 1, 1, 1]; // night, dawn, sunrise, morning, day, afternoon, sunset, dusk
const LIGHT_DARK = SOLAR.map((_, h) => +(h < 7 || h > 18));
const STILL = SOLAR.map(() => 0);
const FRAMES = { bigsur: SOLAR, beach: SOLAR, graphic: LIGHT_DARK, sequoia: LIGHT_DARK, mountain: STILL, sunflowers: STILL };
const hour = new Date().getHours();
const wall = (name) => `backgrounds/${name}-${FRAMES[name][hour]}.webp`;

const chips = [...document.querySelectorAll('[data-bg]')];
const picked = new Set(JSON.parse(localStorage.bgs ?? '[]'));

chips.forEach((c) => {
  c.style.setProperty('--wall', `url(${wall(c.dataset.bg)})`);
  c.ariaPressed = picked.has(c.dataset.bg);
  c.onclick = () => {
    picked.has(c.dataset.bg) ? picked.delete(c.dataset.bg) : picked.add(c.dataset.bg);
    c.ariaPressed = picked.has(c.dataset.bg);
    localStorage.bgs = JSON.stringify([...picked]);
  };
});

document.querySelectorAll('[data-full]').forEach((b) => {
  b.onclick = async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const pool = [...picked].filter((n) => n in FRAMES);
    const name = pool[Math.floor(Math.random() * pool.length)];
    chrome.runtime.sendMessage({ tabId: tab.id, full: b.dataset.full === 'true', bg: name && wall(name) });
    window.close();
  };
});
