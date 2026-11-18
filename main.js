const { app, BrowserWindow, globalShortcut, ipcMain } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const readline = require('readline');
const Anthropic = require('@anthropic-ai/sdk');

const MODEL = 'claude-sonnet-5';
const ANSWER_HOTKEY = 'CommandOrControl+Shift+Enter';
const TRANSCRIPT_CAP = 4000; // держим только «хвост» расшифровки

let mainWindow = null;
let anthropic = null;
let sttProc = null;
let sessionTopic = '';
let transcript = '';

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 460,
    height: 760,
    title: 'Ассистент урока — ИИ (виден на экране)',
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Намеренно НЕ вызываем mainWindow.setContentProtection(true):
  // окно должно оставаться видимым во время демонстрации экрана.
  mainWindow.loadFile('index.html');

  // Разрешаем доступ к микрофону для этого локального приложения.
  mainWindow.webContents.session.setPermissionRequestHandler((_wc, permission, cb) => {
    cb(permission === 'media');
  });
}

app.whenReady().then(() => {
  createWindow();

  globalShortcut.register(ANSWER_HOTKEY, () => {
    answerFromTranscript();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (sttProc) sttProc.kill();
});

app.on('window-all-closed', () => {
  if (sttProc) sttProc.kill();
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('start-session', (_evt, { topic, apiKey }) => {
  sessionTopic = (topic || '').trim();
  const key = (apiKey || '').trim() || process.env.ANTHROPIC_API_KEY;
  if (!key) return { ok: false, error: 'Не указан ключ Claude API.' };
  try {
    anthropic = new Anthropic({ apiKey: key });
  } catch (e) {
    return { ok: false, error: 'Не удалось инициализировать Claude: ' + msg(e) };
  }
  startSTT();
  return { ok: true, hotkey: ANSWER_HOTKEY };
});

ipcMain.handle('ask-manual', async (_evt, { text }) => {
  const q = (text || '').trim();
  if (!q) return { ok: false };
  await askAndPush(`Ответь по существу на этот вопрос ученика:\n"""\n${q}\n"""`);
  return { ok: true };
});

function startSTT() {
  if (sttProc) return;
  const py = process.env.PYTHON_BIN || 'python3';
  try {
    sttProc = spawn(py, [path.join(__dirname, 'stt', 'stt_server.py')], { cwd: __dirname });
  } catch (e) {
    sendStatus('STT не запущен: ' + msg(e));
    return;
  }

  const rl = readline.createInterface({ input: sttProc.stdout });
  rl.on('line', (line) => {
    let obj;
    try { obj = JSON.parse(line); } catch { return; }
    if (obj.type === 'ready') {
      sendStatus('Слушаю…');
    } else if (obj.type === 'error') {
      sendStatus(obj.text || 'Ошибка STT');
    } else if (obj.type === 'line' && obj.text) {
      transcript = (transcript + ' ' + obj.text).slice(-TRANSCRIPT_CAP);
      if (mainWindow) mainWindow.webContents.send('stt-line', obj.text);
    }
  });

  sttProc.stderr.on('data', (d) => process.stderr.write('[stt] ' + d));
  sttProc.on('exit', (code) => {
    sendStatus('STT остановлен (код ' + code + '). Проверь установку Python-зависимостей.');
    sttProc = null;
  });
}

async function answerFromTranscript() {
  const t = transcript.trim();
  if (!t) { sendStatus('Пока нечего анализировать — тишина.'); return; }
  await askAndPush(
    'Ниже — расшифровка последних реплик урока (русский и/или английский). ' +
    'Найди ПОСЛЕДНИЙ заданный вопрос, на который преподавателю стоит дать развёрнутый ответ, ' +
    'и ответь по существу. Если явного вопроса нет — коротко скажи об этом.\n\n' +
    'Транскрипт:\n"""\n' + t + '\n"""'
  );
}

async function askAndPush(userText) {
  if (!anthropic) { pushAnswer({ error: 'Сессия не запущена.' }); return; }
  pushAnswer({ loading: true });
  try {
    const resp = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: systemPrompt(sessionTopic),
      messages: [{ role: 'user', content: userText }],
    });
    const text = resp.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();
    pushAnswer({ text: text || '(пустой ответ)' });
  } catch (e) {
    pushAnswer({ error: msg(e) });
  }
}

function systemPrompt(topic) {
  return (
    'Ты — ассистент преподавателя во время живого онлайн-урока. ' +
    'Тема урока: "' + (topic || 'не указана') + '". ' +
    'Преподаватель использует тебя ОТКРЫТО — окно ассистента видно на экране. ' +
    'Помогай давать точные, глубокие и понятные ответы на вопросы учеников. ' +
    'Отвечай на языке вопроса (русский или английский). ' +
    'Пиши компактно: суть в первых строках, при необходимости короткий пример или шаги. ' +
    'Не выдумывай факты; если не уверен — скажи об этом прямо.'
  );
}

function pushAnswer(payload) {
  if (mainWindow) mainWindow.webContents.send('answer', payload);
}
function sendStatus(text) {
  if (mainWindow) mainWindow.webContents.send('status', text);
}
function msg(e) {
  return e && e.message ? e.message : String(e);
}
