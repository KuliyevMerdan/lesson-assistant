const $ = (id) => document.getElementById(id);

$('startBtn').addEventListener('click', async () => {
  const topic = $('topic').value;
  const apiKey = $('apiKey').value;
  $('launchError').textContent = '';

  const res = await window.api.startSession({ topic, apiKey });
  if (!res || !res.ok) {
    $('launchError').textContent = (res && res.error) || 'Не удалось начать сессию.';
    return;
  }

  $('topicLabel').textContent = topic || 'Без темы';
  if (res.hotkey) $('hotkeyLabel').textContent = res.hotkey;
  $('launch').classList.add('hidden');
  $('main').classList.remove('hidden');
});

$('askBtn').addEventListener('click', sendManual);
$('manualInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendManual();
});

async function sendManual() {
  const text = $('manualInput').value.trim();
  if (!text) return;
  $('manualInput').value = '';
  await window.api.askManual({ text });
}

window.api.onSttLine((text) => {
  const el = $('transcript');
  const line = document.createElement('div');
  line.textContent = text;
  el.appendChild(line);
  el.scrollTop = el.scrollHeight;
});

window.api.onStatus((text) => {
  $('status').textContent = text;
});

window.api.onAnswer((payload) => {
  const el = $('answer');
  el.classList.remove('muted', 'error');
  if (payload.loading) {
    el.textContent = 'Думаю…';
  } else if (payload.error) {
    el.classList.add('error');
    el.textContent = 'Ошибка: ' + payload.error;
  } else {
    el.textContent = payload.text || '';
  }
});
