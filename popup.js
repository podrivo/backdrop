const bg = document.getElementById('bg');
bg.value = localStorage.bg ?? '';
bg.onchange = () => (localStorage.bg = bg.value);

document.querySelectorAll('button').forEach((b) => {
  b.onclick = async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    chrome.runtime.sendMessage({ tabId: tab.id, full: b.dataset.full === 'true', bg: bg.value });
    window.close();
  };
});
