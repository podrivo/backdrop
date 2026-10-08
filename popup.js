const wall = (name) => `backgrounds/${name}.webp`;

const chips = [...document.querySelectorAll('[data-bg]')];
const names = new Set(chips.map((c) => c.dataset.bg));
const picked = new Set(JSON.parse(localStorage.bgs ?? JSON.stringify([...names])));
if (localStorage.bgs == null) localStorage.bgs = JSON.stringify([...picked]);

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
    const pool = [...picked].filter((n) => names.has(n));
    const name = pool[Math.floor(Math.random() * pool.length)];
    chrome.runtime.sendMessage({ tabId: tab.id, full: b.dataset.full === 'true', bg: name && wall(name) });
    window.close();
  };
});
