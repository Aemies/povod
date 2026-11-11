// Прокси «Повода» для GigaChat и поиска Яндекса.
// Зачем: браузер не может обращаться к GigaChat напрямую (нет CORS, сертификат Минцифры не входит в доверенные браузера).
// Прокси пересылает запросы только на 3 фиксированных адреса GigaChat, а поиск выполняет сам через Yandex Search API
// от имени сервисного аккаунта функции (ключ поиска не нужен). Общий ключ GigaChat и поиск выдаются только по коду доступа.
// Работает как Яндекс Облако Cloud Function (Node.js 22, точка входа index.handler) и как обычный Node-сервер (server.js).
'use strict';

const https = require('node:https');
const tls = require('node:tls');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const TARGETS = {
  'gigachat-oauth': { url: 'https://ngw.devices.sberbank.ru:9443/api/v2/oauth', method: 'POST', key: 'giga' },
  'gigachat-models': { url: 'https://gigachat.devices.sberbank.ru/api/v1/models', method: 'GET' },
  'gigachat-chat': { url: 'https://gigachat.devices.sberbank.ru/api/v1/chat/completions', method: 'POST' },
  search: { method: 'POST', local: true },
};
const SEARCH_URL = 'https://searchapi.api.cloud.yandex.net/v2/web/search';
const PASS_HEADERS = ['authorization', 'content-type', 'accept', 'rquid'];
const MAX_BODY = 300 * 1024;
const env = process.env;

// Сертификат НУЦ Минцифры: файл russian_trusted_root_ca.pem рядом с этим файлом (или путь в RU_CA_PATH).
let ca;
function trustedCa() {
  if (ca !== undefined) return ca;
  const file = env.RU_CA_PATH || path.join(__dirname, 'russian_trusted_root_ca.pem');
  ca = fs.existsSync(file) ? [...tls.rootCertificates, fs.readFileSync(file, 'utf8')] : null;
  return ca;
}

function forward(url, method, headers, body) {
  return new Promise((resolve, reject) => {
    const options = { method, headers, timeout: 170000 };
    if (trustedCa()) options.ca = trustedCa();
    const req = https.request(url, options, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode || 502, body: Buffer.concat(chunks).toString('utf8'), type: res.headers['content-type'] || 'application/json' }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function sameSecret(a, b) {
  const h = (v) => crypto.createHash('sha256').update(String(v)).digest();
  return crypto.timingSafeEqual(h(a), h(b));
}

// Простая защита от подбора кода: не более 10 неверных попыток за 15 минут с одного IP (в пределах одного экземпляра).
const failures = new Map();
function tooManyFailures(ip) {
  const now = Date.now();
  const list = (failures.get(ip) || []).filter((t) => now - t < 15 * 60 * 1000);
  failures.set(ip, list);
  return list.length >= 10;
}
function noteFailure(ip) { failures.set(ip, [...(failures.get(ip) || []), Date.now()]); }

// ---------- Поиск: Yandex Search API v2 + текст первых страниц ----------
class SearchError extends Error { constructor(m) { super(m); this.povod = true; } }

function decodeXml(v) {
  return String(v || '').replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}

function pageText(html) {
  return String(html)
    .replace(/<(script|style|noscript|svg|nav|footer|header)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ').trim();
}

async function fetchPage(url) {
  try {
    const r = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PovodBot/1.0)', Accept: 'text/html' } });
    if (!r.ok || !/text\/html/i.test(r.headers.get('content-type') || '')) return '';
    return pageText((await r.text()).slice(0, 600000)).slice(0, 6000);
  } catch { return ''; }
}

function parseYandexXml(xml) {
  return [...xml.matchAll(/<doc[\s>][\s\S]*?<\/doc>/g)].map((m) => m[0]).slice(0, 8).map((doc) => ({
    url: decodeXml((doc.match(/<url>([\s\S]*?)<\/url>/) || [])[1]),
    title: decodeXml((doc.match(/<title>([\s\S]*?)<\/title>/) || [])[1]),
    content: [...doc.matchAll(/<passage>([\s\S]*?)<\/passage>/g)].map((p) => decodeXml(p[1])).join(' … '),
    published_date: (() => { const m = doc.match(/<modtime>(\d{4})(\d{2})(\d{2})/); return m ? `${m[1]}-${m[2]}-${m[3]}` : ''; })(),
  })).filter((d) => /^https?:\/\//.test(d.url));
}

async function yandexSearch(query, iamToken) {
  const folderId = env.FOLDER_ID;
  const auth = env.SEARCH_API_KEY ? `Api-Key ${env.SEARCH_API_KEY}` : iamToken ? `Bearer ${iamToken}` : '';
  if (!folderId || !auth) throw new SearchError('Поиск не настроен: у функции нет FOLDER_ID или сервисного аккаунта.');
  const payload = JSON.stringify({
    query: { searchType: 'SEARCH_TYPE_RU', queryText: query, familyMode: 'FAMILY_MODE_MODERATE' },
    folderId,
    responseFormat: 'FORMAT_XML',
    groupSpec: { groupMode: 'GROUP_MODE_FLAT', groupsOnPage: '8', docsInGroup: '1' },
    maxPassages: '3',
    l10n: 'LOCALIZATION_RU',
  });
  const res = await forward(SEARCH_URL, 'POST', { authorization: auth, 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(payload)) }, payload);
  if (res.status === 401 || res.status === 403) throw new SearchError('Поиск Яндекса отклонил доступ. Проверьте роль сервисного аккаунта (search-api.webSearch.user).');
  if (res.status >= 400) throw new SearchError(`Поиск Яндекса вернул ошибку HTTP ${res.status}.`);
  let xml = '';
  try { xml = Buffer.from(JSON.parse(res.body).rawData || '', 'base64').toString('utf8'); } catch { /* ниже проверка */ }
  if (!xml) throw new SearchError('Поиск Яндекса вернул пустой ответ.');
  const errorText = (xml.match(/<error[^>]*>([\s\S]*?)<\/error>/) || [])[1];
  if (errorText && !/<doc[\s>]/.test(xml)) throw new SearchError(`Поиск Яндекса: ${decodeXml(errorText)}`);
  const docs = parseYandexXml(xml);
  // Подтягиваем текст первых трёх страниц, чтобы у модели было больше, чем сниппет.
  const texts = await Promise.all(docs.slice(0, 3).map((d) => fetchPage(d.url)));
  texts.forEach((t, i) => { if (t) docs[i].raw_content = t; });
  return docs;
}

function cors(origin) {
  const allowed = (env.ALLOWED_ORIGIN || '*').split(',').map((s) => s.trim()).filter(Boolean);
  const allow = allowed.includes('*') ? '*' : allowed.includes(origin) ? origin : allowed[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept, RqUID, X-Povod-Target, X-Povod-Code',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
}

// Общая логика: { method, headers (в нижнем регистре), body (строка), ip } -> { status, headers, body }
async function handle({ method, headers, body, ip, iamToken }) {
  const base = cors(headers.origin || '');
  const reply = (status, data) => ({ status, headers: { ...base, 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify(data) });

  if (method === 'OPTIONS') return { status: 204, headers: base, body: '' };
  if (method === 'GET' && !headers['x-povod-target']) {
    return reply(200, { ok: true, service: 'povod-proxy', sharedGigaChat: !!env.GIGACHAT_AUTH_KEY, search: !!env.FOLDER_ID, caLoaded: !!trustedCa() });
  }

  const allowed = (env.ALLOWED_ORIGIN || '*').split(',').map((s) => s.trim());
  if (!allowed.includes('*') && !allowed.includes(headers.origin || '')) return reply(403, { povodError: 'Прокси не принимает запросы с этого сайта. Проверьте ALLOWED_ORIGIN.' });

  const target = TARGETS[headers['x-povod-target']];
  if (!target) return reply(400, { povodError: 'Неизвестное направление запроса.' });
  if (method !== target.method) return reply(405, { povodError: 'Неверный метод запроса.' });
  if (body && Buffer.byteLength(body) > MAX_BODY) return reply(413, { povodError: 'Запрос слишком большой.' });

  const codeOk = () => !!env.ACCESS_CODE && !!headers['x-povod-code'] && sameSecret(headers['x-povod-code'], env.ACCESS_CODE);

  if (target.local) {
    if (!env.ACCESS_CODE) return reply(403, { povodError: 'Поиск отключён: на прокси не задан ACCESS_CODE.' });
    if (tooManyFailures(ip)) return reply(429, { povodError: 'Слишком много неверных попыток. Подождите 15 минут.' });
    if (!codeOk()) { noteFailure(ip); return reply(401, { povodError: 'Код доступа не подошёл. Уточните его у руководителя.' }); }
    let query = '';
    try { query = String(JSON.parse(body || '{}').query || '').slice(0, 400); } catch { /* пусто */ }
    if (!query) return reply(400, { povodError: 'Пустой поисковый запрос.' });
    try { return reply(200, { results: await yandexSearch(query, iamToken) }); }
    catch (e) { return reply(502, { povodError: e && e.povod ? e.message : 'Поиск Яндекса не ответил. Попробуйте позже.' }); }
  }

  const out = {};
  for (const name of PASS_HEADERS) if (headers[name]) out[name] = headers[name];
  let outBody = body || '';

  // Общие ключи руководителя подставляются, только если участник не дал свой ключ и ввёл верный код.
  if (target.key && !out.authorization) {
    const shared = env.GIGACHAT_AUTH_KEY;
    if (!shared) return reply(401, { povodError: 'Укажите свой ключ GigaChat: общий ключ на прокси не настроен.' });
    if (!env.ACCESS_CODE) return reply(403, { povodError: 'Общие ключи отключены: на прокси не задан ACCESS_CODE.' });
    if (tooManyFailures(ip)) return reply(429, { povodError: 'Слишком много неверных попыток. Подождите 15 минут.' });
    if (!codeOk()) {
      noteFailure(ip);
      return reply(401, { povodError: 'Код доступа не подошёл. Уточните его у руководителя.' });
    }
    out.authorization = `Basic ${shared}`;
    if (env.GIGACHAT_SCOPE) outBody = new URLSearchParams({ scope: env.GIGACHAT_SCOPE }).toString();
  }
  if (outBody) out['content-length'] = String(Buffer.byteLength(outBody));

  try {
    const res = await forward(target.url, target.method, out, target.method === 'GET' ? null : outBody);
    return { status: res.status, headers: { ...base, 'Content-Type': res.type }, body: res.body };
  } catch (e) {
    const tlsProblem = /certificate|self.signed|unable to verify/i.test(String(e && e.message));
    return reply(502, {
      povodError: tlsProblem
        ? 'Прокси не доверяет сертификату GigaChat. Положите russian_trusted_root_ca.pem рядом с index.js.'
        : 'Прокси не смог связаться с сервисом. Попробуйте позже.',
    });
  }
}

// Яндекс Облако Cloud Functions
module.exports.handler = async function (event, context) {
  const headers = {};
  for (const [k, v] of Object.entries(event.headers || {})) headers[k.toLowerCase()] = String(v);
  const body = event.body ? (event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body) : '';
  const ip = (event.requestContext && event.requestContext.identity && event.requestContext.identity.sourceIp) || headers['x-forwarded-for'] || 'unknown';
  const iamToken = context && context.token && context.token.access_token;
  const res = await handle({ method: event.httpMethod || 'GET', headers, body, ip, iamToken });
  return { statusCode: res.status, headers: res.headers, body: res.body, isBase64Encoded: false };
};

module.exports.handle = handle;
module.exports.parseYandexXml = parseYandexXml;
