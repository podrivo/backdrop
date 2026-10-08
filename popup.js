const chips = [...document.querySelectorAll('[data-bg]')];
const picked = new Set(JSON.parse(localStorage.bgs ?? '[]'));

chips.forEach((c) => {
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
    const pool = [...picked];
    const bg = pool[Math.floor(Math.random() * pool.length)] ?? '';
    chrome.runtime.sendMessage({ tabId: tab.id, full: b.dataset.full === 'true', bg });
    window.close();
  };
});
