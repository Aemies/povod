// Всё хранится только в браузере участника (localStorage). Сервера с базой нет.
import { DEFAULT_CONFIG } from './providers.js';

const KEY_CONFIG = 'povod.config';
const KEY_HISTORY = 'povod.history';
const SECRET_FIELDS = ['gigaKey', 'openaiKey', 'apiKey', 'accessCode'];
const PUBLIC_FIELDS = ['provider', 'proxyUrl', 'gigaScope', 'gigaModel', 'openaiModel', 'baseUrl', 'model'];

function read(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}
function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}

let sessionSecrets = {}; // если «не запоминать» — ключи живут только до закрытия вкладки

export function loadConfig() {
  const saved = read(KEY_CONFIG, null);
  if (!saved) return null;
  return { ...DEFAULT_CONFIG, ...saved, ...sessionSecrets };
}

export function saveConfig(config, remember) {
  const toSave = { ...config, remember: !!remember };
  sessionSecrets = {};
  if (!remember) {
    for (const f of SECRET_FIELDS) { sessionSecrets[f] = config[f]; delete toSave[f]; }
  }
  write(KEY_CONFIG, toSave);
}

export function forgetSecrets() {
  const saved = read(KEY_CONFIG, null);
  sessionSecrets = {};
  if (!saved) return;
  for (const f of SECRET_FIELDS) delete saved[f];
  write(KEY_CONFIG, saved);
}

// Ссылка-настройка для команды: только адреса и модели, без ключей и кода.
export function setupLink(config) {
  const data = {};
  for (const f of PUBLIC_FIELDS) if (config[f]) data[f] = config[f];
  const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(data)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${location.origin}${location.pathname}#setup=${encoded}`;
}

export function readSetupFromHash() {
  const m = location.hash.match(/^#setup=([A-Za-z0-9_-]+)/);
  if (!m) return null;
  try {
    const json = decodeURIComponent(escape(atob(m[1].replace(/-/g, '+').replace(/_/g, '/'))));
    const data = JSON.parse(json);
    const clean = {};
    for (const f of PUBLIC_FIELDS) if (typeof data[f] === 'string') clean[f] = data[f].slice(0, 300);
    if (!['gigachat', 'openai', 'compatible'].includes(clean.provider)) delete clean.provider;
    return clean;
  } catch {
    return null;
  }
}

export function loadHistory() { return read(KEY_HISTORY, []); }
export function saveHistory(list) { return write(KEY_HISTORY, list.slice(0, 50)); }
export function addToHistory(item) { const list = [item, ...loadHistory().filter((x) => x.id !== item.id)]; saveHistory(list); return list; }
export function updateInHistory(id, patch) {
  const list = loadHistory().map((x) => (x.id === id ? { ...x, ...patch } : x));
  saveHistory(list);
  return list;
}
export function clearHistory() { try { localStorage.removeItem(KEY_HISTORY); } catch { /* ignore */ } }

export function ratingsCsv(list) {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [['Дата', 'Компания', 'Уточнение', 'Тема', 'Подключение', 'Повод найден', 'Оценка', 'Обычное время подготовки, мин', 'Время исследования, сек']];
  const labels = { useful: 'Полезна', partial: 'Частично', not_useful: 'Не помогла' };
  for (const x of list) {
    rows.push([
      new Date(x.createdAt).toLocaleString('ru-RU'), x.report.company, x.input?.identifier, x.input?.focus, x.provider,
      x.report.signal === 'found' ? 'да' : 'нет', labels[x.rating] || '', x.minutes ?? '', x.elapsedSeconds,
    ]);
  }
  return '﻿' + rows.map((r) => r.map(esc).join(';')).join('\r\n');
}
