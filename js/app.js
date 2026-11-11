import { h, icon, rich } from './dom.js';
import { FOCUSES, exportReport, safeUrl } from './report.js';
import { DEFAULT_CONFIG, GIGA_MODELS, GIGA_SCOPES, checkProvider, isReady, providerLabel, runResearch } from './providers.js';
import * as store from './storage.js';

const VERSION = 'ВЕРСИЯ 0.3';
const TITLES = { new: 'Рабочий стол', history: 'Мои карточки', guide: 'О пилоте', settings: 'Подключение' };

const state = {
  tab: 'new',
  config: store.loadConfig(),
  form: { company: '', identifier: '', focus: FOCUSES[0] },
  busy: false,
  seconds: 0,
  error: '',
  notice: '',
  data: null,
  copied: false,
  feedback: { rating: '', minutes: '', status: '' },
  settings: null, // черновик настроек
};

// Ссылка-настройка от руководителя: подставляем адрес прокси и модели.
const setup = store.readSetupFromHash();
if (setup) {
  state.config = { ...DEFAULT_CONFIG, ...(state.config || {}), ...setup };
  store.saveConfig(state.config, state.config.remember !== false);
  history.replaceState(null, '', location.pathname);
  state.tab = 'settings';
  state.notice = 'Настройки от руководителя применены. Осталось ввести код доступа или свой ключ и нажать «Сохранить».';
}

let timer = null;
function set(patch) { Object.assign(state, patch); render(); }

// ---------- Действия ----------
async function research(e) {
  e.preventDefault();
  const { company, identifier, focus } = state.form;
  if (!state.config || !isReady(state.config)) return set({ error: 'Сначала настройте подключение в разделе «Подключение».' });
  set({ error: '', data: null, busy: true, seconds: 0, feedback: { rating: '', minutes: '', status: '' } });
  const started = Date.now();
  timer = setInterval(() => { state.seconds = Math.floor((Date.now() - started) / 1000); const b = document.querySelector('[data-seconds]'); if (b) b.textContent = state.seconds; }, 1000);
  try {
    const data = await runResearch(state.config, { company: company.trim(), identifier: identifier.trim(), focus });
    store.addToHistory(data);
    set({ data });
  } catch (err) {
    set({ error: err?.message || 'Не удалось выполнить исследование.' });
  } finally {
    clearInterval(timer);
    set({ busy: false });
  }
}

function resetToNew() { set({ tab: 'new', data: null, error: '', notice: '', feedback: { rating: '', minutes: '', status: '' } }); }

async function copyReport() {
  try {
    await navigator.clipboard.writeText(exportReport(state.data));
    set({ copied: true });
    setTimeout(() => set({ copied: false }), 2000);
  } catch { set({ error: 'Не удалось скопировать. Используйте кнопку «Скачать».' }); }
}

function downloadText(name, text, type = 'text/plain;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = h('a', { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function saveFeedback(e) {
  e.preventDefault();
  const { rating, minutes } = state.feedback;
  if (!rating) return;
  store.updateInHistory(state.data.id, { rating, minutes: Number(minutes) || 0 });
  state.data = { ...state.data, rating, minutes: Number(minutes) || 0 };
  set({ feedback: { ...state.feedback, status: 'Спасибо! Оценка сохранена в истории. Выгрузите её для организатора в разделе «Мои карточки».' } });
}

// ---------- Разметка ----------
function navButton(id, label, iconName, onClick, extra = {}) {
  return h('button', { title: label, className: state.tab === id ? 'nav active' : 'nav', disabled: state.busy || extra.disabled, onClick },
    icon(iconName, 19), label, id === 'new' ? icon('chevronRight', 15) : null);
}

function sidebar() {
  return h('aside', { className: 'sidebar' },
    h('a', { href: './', className: 'brand', 'aria-label': 'Повод — на главную' }, h('span', { className: 'brandmark' }, h('i'), h('i'), h('i'), h('i')), 'повод', h('span', { className: 'brand-dot' }, '.')),
    h('div', { className: 'sidebar-label' }, 'РАБОЧЕЕ ПРОСТРАНСТВО'),
    h('nav', { 'aria-label': 'Основная навигация' },
      navButton('new', 'Новая подготовка', 'plus', resetToNew),
      navButton('history', 'Мои карточки', 'clock', () => set({ tab: 'history', error: '', notice: '' })),
      navButton('guide', 'О пилоте', 'book', () => set({ tab: 'guide', error: '', notice: '' })),
      navButton('settings', 'Подключение', 'settings', () => set({ tab: 'settings', error: '', settings: null }))),
    h('div', { className: 'sidebar-note' }, h('span', { className: 'tiny-label' }, 'ОДИН ПОЛЕЗНЫЙ РАЗГОВОР'), h('p', {}, 'Начинается с понимания бизнеса.'), h('span', { className: 'note-line' })),
    h('div', { className: 'sidebar-bottom' }, icon('shield', 18), h('span', {}, 'Только открытые', h('br'), 'сведения о компаниях')));
}

function dashboard() {
  const ready = isReady(state.config);
  const f = state.form;
  const bind = (key) => (e) => { f[key] = e.target.value; };
  return [
    h('div', { className: 'dashboard-head' },
      h('section', { className: 'welcome-card' },
        h('span', { className: 'eyebrow' }, 'ВАШ СЛЕДУЮЩИЙ РАЗГОВОР'),
        h('h1', {}, 'Сначала повод.', h('br'), h('em', {}, 'Потом звонок.')),
        h('p', {}, 'Поймите бизнес компании.', h('br'), 'Найдите тему, с которой стоит начать.'),
        waveSvg()),
      h('section', { className: 'connection-card' },
        h('div', { className: 'connection-top' }, h('span', { className: 'eyebrow' }, 'МОЁ ПОДКЛЮЧЕНИЕ'), icon('radio', 17)),
        h('div', { className: 'connection-orbit' }, h('span', {}, 'API')),
        h('h2', {}, ready ? providerLabel(state.config) : 'Не подключено'),
        h('p', {}, ready ? (state.config.provider === 'gigachat' && !state.config.gigaKey ? 'Общий доступ руководителя' : 'Ваш ключ на этом устройстве') : 'Подключите GigaChat или другой ИИ'),
        h('button', { className: 'icon-button', onClick: () => set({ tab: 'settings', settings: null }) }, ready ? 'Настроить' : 'Подключить', icon('arrowUpRight', 15)))),
    !ready ? h('div', { className: 'alert' }, 'Для начала настройте подключение: введите код доступа от руководителя или свой API-ключ.') : null,
    h('div', { className: 'start-grid' },
      h('section', { className: 'research-panel' },
        h('div', { className: 'panel-top' }, h('span', { className: 'step' }, '01 / ПОДГОТОВКА'), h('span', { className: 'public-only' }, icon('shield', 14), 'Открытые источники')),
        h('form', { onSubmit: research },
          h('label', { for: 'company' }, 'С какой компанией поговорим?'),
          h('div', { className: 'input-icon' }, icon('search', 21), h('input', { id: 'company', value: f.company, onInput: bind('company'), placeholder: 'Название компании', minlength: 2, maxlength: 160, required: true, disabled: state.busy })),
          h('label', { for: 'identifier' }, 'Уточните компанию ', h('span', {}, 'чтобы найти именно её')),
          h('input', { id: 'identifier', value: f.identifier, onInput: bind('identifier'), placeholder: 'Официальный сайт, ИНН или регион', maxlength: 180, required: true, disabled: state.busy }),
          h('label', { for: 'focus' }, 'На чём сосредоточиться?'),
          h('select', { id: 'focus', onChange: bind('focus'), disabled: state.busy }, FOCUSES.map((x) => h('option', { selected: x === f.focus }, x))),
          h('button', { className: 'primary', disabled: state.busy || !ready },
            state.busy ? [icon('loader', 20, 'spin'), 'Изучаем компанию · ', h('span', { 'data-seconds': '' }, state.seconds), ' сек.'] : ['Подготовиться к разговору', icon('arrowUpRight', 22)]),
          h('p', { className: 'form-note' }, state.busy ? 'Поиск и проверка источников могут занять несколько минут.' : 'Указывайте только публичные сведения. Данные из банковских систем не нужны.'))),
      h('aside', { className: 'result-preview' },
        h('span', { className: 'tiny-label' }, 'НА ВЫХОДЕ — КОРОТКАЯ КАРТОЧКА'),
        h('h2', {}, 'Не начинать с чистого листа.'),
        previewItem('01', 'Проверяемые факты', 'Что происходит в компании. С датами и ссылками.'),
        previewItem('02', 'Тема для разговора', 'Возможные потребности и вопросы для их проверки.'),
        previewItem('03', 'Первые слова', 'Как начать разговор и спокойно ответить на отказ.'),
        h('div', { className: 'honest-note' }, 'Нет свежего повода?', h('br'), h('strong', {}, 'Так и скажем.')))),
    h('div', { className: 'principles' }, h('div', {}, h('span', {}, '01'), 'Сначала изучаем'), icon('arrowRight', 16), h('div', {}, h('span', {}, '02'), 'Проверяем гипотезу'), icon('arrowRight', 16), h('div', {}, h('span', {}, '03'), 'Начинаем разговор')),
  ];
}

function previewItem(n, title, text) {
  return h('div', { className: 'preview-item' }, h('span', {}, n), h('div', {}, h('h3', {}, title), h('p', {}, text)));
}

function waveSvg() {
  const wrap = document.createElement('div');
  wrap.innerHTML = '<svg class="signal-wave" viewBox="0 0 500 90" fill="none" aria-hidden="true"><path d="M0 76C35 76 35 48 70 54S120 90 160 55S210 62 250 32S300 50 340 18S400 40 440 10S480 15 500 2" stroke="url(#wave)" stroke-width="1.5"/><path d="M0 90H500M0 60H500M0 30H500" stroke="white" stroke-opacity=".04"/><circle cx="250" cy="32" r="3" fill="white"/><circle cx="340" cy="18" r="3" fill="white"/><defs><linearGradient id="wave"><stop stop-color="white" stop-opacity=".05"/><stop offset=".6" stop-color="white" stop-opacity=".7"/><stop offset="1" stop-color="white" stop-opacity=".1"/></linearGradient></defs></svg>';
  return wrap.firstChild;
}

function reportView() {
  const data = state.data;
  const r = data.report;
  const fb = state.feedback;
  const rating = fb.rating || data.rating || '';
  return [
    h('div', { className: 'report-heading' },
      h('div', {}, h('h1', { className: 'company-title' }, r.company), h('p', { className: 'identity' }, rich(r.identity))),
      h('div', { className: 'actions' },
        h('button', { className: 'icon-button', onClick: copyReport }, icon(state.copied ? 'check' : 'copy', 17), state.copied ? ' Скопировано' : ' Копировать'),
        h('button', { className: 'icon-button', onClick: () => downloadText(`Повод — ${r.company.replace(/[^\p{L}\p{N} -]/gu, '').slice(0, 60)}.txt`, exportReport(data)) }, icon('download', 17), 'Скачать'))),
    h('div', { className: 'report-meta' },
      h('span', { className: r.signal === 'found' ? 'status positive' : 'status neutral' }, r.identityStatus !== 'confirmed' ? 'Нужно уточнить компанию' : r.signal === 'found' ? 'Есть повод для разговора' : 'Свежий повод не найден'),
      h('span', {}, `${new Date(data.createdAt).toLocaleDateString('ru-RU')} · ${data.provider} · исследование ${data.elapsedSeconds} сек.`)),
    h('p', { className: 'report-summary' }, rich(r.summary)),
    r.facts.length ? h('section', { className: 'report-section' },
      h('div', { className: 'section-heading' }, h('h2', {}, h('span', {}, '01'), ' Что известно'), h('small', {}, 'Факты из открытых источников')),
      h('div', { className: 'facts-grid' }, r.facts.map((f) => h('article', { className: 'fact' },
        h('div', { className: 'fact-date' }, f.date), h('p', {}, rich(f.text)),
        safeUrl(f.url) ? h('a', { href: safeUrl(f.url), target: '_blank', rel: 'noopener noreferrer' }, f.source || 'Источник', icon('external', 13)) : null)))) : null,
    r.hypotheses.length ? h('section', { className: 'report-section' },
      h('div', { className: 'section-heading' }, h('h2', {}, h('span', {}, '02'), ' Что стоит проверить'), h('small', {}, 'Гипотезы, а не подтверждённые потребности')),
      h('div', { className: 'hypotheses' }, r.hypotheses.map((x, i) => h('article', { className: 'hypothesis' },
        h('div', {}, h('span', { className: 'tag' }, `ГИПОТЕЗА ${i + 1}`), h('h3', {}, x.topic), h('p', {}, rich(x.rationale)), h('span', { className: 'role' }, `Кому адресовать: ${x.role}`)),
        h('blockquote', {}, rich(x.question)))))) : null,
    r.opening ? h('section', { className: 'opening' }, h('span', { className: 'tiny-label' }, 'НАЧАЛО РАЗГОВОРА · АДАПТИРУЙТЕ ПОД СЕБЯ'), icon('message', 25), h('p', {}, `«${r.opening.replace(/\s*\(\[[^\]]+\]\(https?:\/\/[^\s]+\)\)/g, '')}»`)) : null,
    h('div', { className: 'guide-grid' },
      r.questions.length ? h('section', { className: 'panel' }, h('h2', {}, 'Вопросы для разговора'), h('ol', {}, r.questions.map((q) => h('li', {}, rich(q))))) : null,
      r.objections.length ? h('section', { className: 'panel' }, h('h2', {}, 'Если услышите отказ'), r.objections.map((o) => h('div', { className: 'objection' }, h('strong', {}, `«${o.objection}»`), h('p', {}, rich(o.response))))) : null),
    r.limitations.length ? h('section', { className: 'limits' }, h('h3', {}, 'Перед звонком'), h('ul', {}, r.limitations.map((l) => h('li', {}, rich(l))))) : null,
    h('form', { className: 'feedback', onSubmit: saveFeedback },
      h('div', {}, h('span', { className: 'tiny-label' }, 'ОБРАТНАЯ СВЯЗЬ ПИЛОТА'), h('h2', {}, 'Эта карточка помогла?'), h('p', {}, 'Оцените подготовку, даже если подходящей темы не нашлось.')),
      h('div', { className: 'feedback-fields' },
        h('div', { className: 'rating', role: 'group', 'aria-label': 'Полезность карточки' },
          [['useful', 'Да, полезна'], ['partial', 'Частично'], ['not_useful', 'Не помогла']].map(([v, l]) =>
            h('button', { type: 'button', 'aria-pressed': String(rating === v), className: rating === v ? 'selected' : '', onClick: () => set({ feedback: { ...fb, rating: v, status: '' } }) }, l))),
        h('label', { className: 'minutes' }, 'Обычно готовлюсь к такому звонку',
          h('input', { type: 'number', min: 0, max: 120, required: true, value: fb.minutes || (data.minutes ?? ''), onInput: (e) => { fb.minutes = e.target.value; } }), 'мин.'),
        h('button', { className: 'small-primary', disabled: !rating }, 'Сохранить оценку', icon('arrowRight', 15)),
        h('p', { role: 'status' }, fb.status))),
    h('button', { className: 'text-button', onClick: resetToNew }, icon('plus', 17), 'Другая компания'),
  ];
}

function historyView() {
  const list = store.loadHistory();
  return [
    h('h1', {}, 'Мои ', h('em', {}, 'карточки.')),
    h('p', { className: 'intro' }, 'Последние 50 исследований. Они хранятся только в этом браузере на этом устройстве.'),
    list.length ? h('div', { className: 'settings-actions', style: 'margin-bottom:24px' },
      h('button', { className: 'icon-button', onClick: () => downloadText(`Повод — оценки ${new Date().toISOString().slice(0, 10)}.csv`, store.ratingsCsv(list), 'text/csv;charset=utf-8') }, icon('download', 16), 'Выгрузить оценки для организатора (CSV)'),
      h('button', { className: 'text-button forget', onClick: () => { if (confirm('Удалить все карточки из этого браузера?')) { store.clearHistory(); render(); } } }, icon('trash', 15), 'Очистить историю')) : null,
    h('div', { className: 'history-list' }, list.length
      ? list.map((x) => h('button', { className: 'history-item', onClick: () => set({ data: x, tab: 'new', feedback: { rating: '', minutes: '', status: '' } }) },
        icon('building', 22), h('span', {}, h('strong', {}, x.report.company), h('small', {}, `${new Date(x.createdAt).toLocaleString('ru-RU')}${x.rating ? ' · оценено' : ''}`)), icon('arrowUpRight', 20)))
      : h('div', { className: 'panel' }, h('h2', {}, 'Здесь появятся ваши исследования'), h('p', {}, 'Начните с одной компании. Завершённая карточка сохранится автоматически.'),
        h('button', { className: 'text-button', onClick: resetToNew }, 'Подготовить первый звонок ', icon('arrowRight', 16)))),
  ];
}

function guideView() {
  return [
    h('h1', {}, 'Проверяем пользу.', h('br'), h('em', {}, 'Вместе.')),
    h('p', { className: 'intro' }, 'Помощник для первого разговора с компанией, которой уже много раз звонили.'),
    h('div', { className: 'guide-grid' },
      h('section', { className: 'panel' }, h('h2', {}, 'Как использовать'), h('ol', {},
        h('li', {}, 'Введите название и сайт, ИНН или регион компании.'),
        h('li', {}, 'Выберите тему и дождитесь исследования открытых источников.'),
        h('li', {}, 'Откройте ссылки, проверьте совпадение компании и актуальность события.'),
        h('li', {}, 'Возьмите подходящие вопросы и адаптируйте начало разговора.'),
        h('li', {}, 'Оцените карточку и раз в неделю выгрузите оценки организатору.'))),
      h('section', { className: 'panel' }, h('h2', {}, 'Где хранятся данные'),
        h('p', {}, 'У сайта нет своего сервера и базы. Карточки, оценки и ключи хранятся только в вашем браузере.'),
        h('p', {}, 'Запрос о компании уходит выбранному сервису ИИ, а поиск Яндекса и GigaChat — через прокси руководителя.')),
      h('section', { className: 'panel' }, h('h2', {}, 'Что вводить'),
        h('p', {}, 'Публичное название компании, её сайт, ИНН или регион.'),
        h('p', {}, 'Не добавляйте данные из банковских систем, сведения о счетах, сделках, переписку и персональные контакты.')),
      h('section', { className: 'panel' }, h('h2', {}, 'Границы помощника'),
        h('p', {}, 'Потребность компании — гипотеза до разговора. Найденная новость не означает готовность купить продукт.'),
        h('p', {}, 'Условия, тарифы и доступность банковских продуктов менеджер проверяет отдельно. Если повода нет, помощник так и пишет.'))),
  ];
}

// ---------- Настройки подключения ----------
function settingsView() {
  if (!state.settings) state.settings = { draft: { ...DEFAULT_CONFIG, ...(state.config || {}) }, remember: state.config?.remember !== false, message: '', error: '', checking: false };
  const st = state.settings;
  const d = st.draft;
  const field = (key, label, attrs = {}, hint) => [
    h('label', { for: `f-${key}` }, label),
    h('input', { id: `f-${key}`, value: d[key] || '', spellcheck: 'false', autocomplete: 'off', disabled: st.checking, onInput: (e) => { d[key] = e.target.value.trim(); }, ...attrs }),
    hint ? h('p', { className: 'field-hint' }, hint) : null,
  ];
  const secret = (key, label, placeholder, hint) => field(key, label, { type: 'password', autocomplete: 'new-password', placeholder }, hint);
  const select = (key, label, options) => h('div', {}, h('label', { for: `f-${key}` }, label),
    h('select', { id: `f-${key}`, disabled: st.checking, onChange: (e) => { d[key] = e.target.value; } }, options.map(([v, l]) => h('option', { value: v, selected: d[key] === v }, l))));
  const setSt = (patch) => { Object.assign(st, patch); render(); };

  const proxyBlock = (optional) => h('div', { className: 'search-config' },
    h('span', { className: 'eyebrow' }, 'ПРОКСИ РУКОВОДИТЕЛЯ'),
    h('h3', {}, optional ? 'Нужен для поиска' : 'Нужен для GigaChat'),
    h('p', {}, optional ? 'Поиск по открытым источникам идёт через прокси руководителя. Адрес и код выдаёт руководитель.' : 'Через прокси идут GigaChat и поиск Яндекса. Адрес и код доступа выдаёт руководитель.'),
    field('proxyUrl', 'Адрес прокси', { placeholder: 'https://functions.yandexcloud.net/…' }),
    secret('accessCode', 'Код доступа', 'Код от руководителя'));

  let body;
  if (d.provider === 'gigachat') {
    body = [
      proxyBlock(false),
      secret('gigaKey', 'Свой Authorization key GigaChat · необязательно', 'Вставьте ключ без слова Basic', 'Если пусто — используется общий ключ руководителя (нужен код доступа).'),
      h('div', { className: 'form-row' }, select('gigaScope', 'Тип проекта', GIGA_SCOPES), select('gigaModel', 'Модель', GIGA_MODELS.map((m) => [m, m]))),
    ];
  } else if (d.provider === 'openai') {
    body = [
      secret('openaiKey', 'API-ключ OpenAI', 'sk-…', 'Ключ используется для модели и встроенного веб-поиска. OpenAI недоступен с российских IP-адресов.'),
      field('openaiModel', 'Модель', { placeholder: 'gpt-6-astra' }),
    ];
  } else {
    body = [
      field('baseUrl', 'Адрес API (совместимый с OpenAI)', { placeholder: 'https://…/v1' }, 'Подойдёт любой сервис с OpenAI-совместимым API и разрешёнными запросами из браузера (CORS).'),
      secret('apiKey', 'API-ключ', 'Ключ сервиса'),
      field('model', 'Модель', { placeholder: 'Название модели' }),
      proxyBlock(true),
    ];
  }

  function validate() {
    const c = { ...d };
    if (c.proxyUrl && !/^https:\/\//.test(c.proxyUrl) && !/^http:\/\/localhost/.test(c.proxyUrl)) return [null, 'Адрес прокси должен начинаться с https://'];
    if (c.baseUrl && !/^https?:\/\//.test(c.baseUrl)) return [null, 'Адрес API должен начинаться с https://'];
    if (!isReady(c)) {
      if (c.provider === 'gigachat') return [null, 'Для GigaChat укажите адрес прокси и код доступа.'];
      if (c.provider === 'openai') return [null, 'Укажите API-ключ OpenAI.'];
      return [null, 'Укажите адрес API, модель, адрес прокси и код доступа (для поиска).'];
    }
    return [c, ''];
  }

  async function check() {
    const [c, err] = validate();
    if (!c) return setSt({ error: err, message: '' });
    setSt({ checking: true, error: '', message: '' });
    try { setSt({ message: await checkProvider(c) }); } catch (e) { setSt({ error: e?.message || 'Не удалось проверить подключение.' }); } finally { setSt({ checking: false }); }
  }

  function save(e) {
    e.preventDefault();
    const [c, err] = validate();
    if (!c) return setSt({ error: err, message: '' });
    store.saveConfig(c, st.remember);
    state.config = { ...c, remember: st.remember };
    setSt({ error: '', message: st.remember ? 'Сохранено на этом устройстве. Перейдите в «Новая подготовка».' : 'Сохранено до закрытия вкладки. Перейдите в «Новая подготовка».' });
  }

  async function shareLink() {
    const link = store.setupLink(d);
    try { await navigator.clipboard.writeText(link); setSt({ message: 'Ссылка скопирована. В ней только адрес прокси и модель, без ключей и кода. Код отправьте отдельно.', error: '' }); }
    catch { prompt('Скопируйте ссылку для команды:', link); }
  }

  return [
    h('div', { className: 'settings-heading' }, h('span', { className: 'eyebrow' }, 'ПОДКЛЮЧЕНИЕ ИИ'), h('h1', {}, 'Ваш ключ.', h('br'), h('em', {}, 'Ваш помощник.')),
      h('p', { className: 'intro' }, 'Выберите сервис. Ключи хранятся только в этом браузере и уходят напрямую своему сервису.')),
    state.notice ? h('div', { className: 'alert', role: 'status' }, state.notice) : null,
    h('div', { className: 'settings-grid' },
      h('section', { className: 'panel settings-card' },
        h('div', { className: 'section-heading' }, h('h2', {}, icon('key', 18), ' Подключение'), h('span', { className: 'tag' }, 'ТОЛЬКО В ЭТОМ БРАУЗЕРЕ')),
        h('div', { className: 'provider-switch', role: 'group', 'aria-label': 'Сервис ИИ' },
          [['gigachat', 'GigaChat'], ['openai', 'OpenAI'], ['compatible', 'Другой API']].map(([p, l]) =>
            h('button', { type: 'button', disabled: st.checking, 'aria-pressed': String(d.provider === p), className: d.provider === p ? 'selected' : '', onClick: () => { d.provider = p; setSt({ message: '', error: '' }); } }, l, icon('arrowUpRight', 16)))),
        h('form', { onSubmit: save, autocomplete: 'off' },
          body,
          h('label', { className: 'remember' }, h('input', { type: 'checkbox', checked: st.remember, onChange: (e) => { st.remember = e.target.checked; } }), ' Запомнить ключи на этом устройстве'),
          h('div', { className: 'settings-actions' },
            h('button', { type: 'submit', className: 'small-primary', disabled: st.checking }, 'Сохранить', icon('arrowUpRight', 17)),
            h('button', { type: 'button', className: 'icon-button', onClick: check, disabled: st.checking }, st.checking ? icon('loader', 16, 'spin') : icon('shield', 16), 'Проверить подключение')),
          st.error ? h('p', { role: 'alert', className: 'alert' }, st.error) : null,
          st.message ? h('p', { role: 'status', className: 'settings-status' }, icon('check', 16), st.message) : null,
          h('div', { className: 'settings-actions' },
            h('button', { type: 'button', className: 'text-button', onClick: shareLink }, icon('link', 15), 'Ссылка-настройка для команды'),
            h('button', { type: 'button', className: 'text-button forget', onClick: () => { store.forgetSecrets(); state.config = store.loadConfig(); state.settings = null; render(); } }, icon('trash', 15), 'Забыть ключи')))),
      h('aside', { className: 'settings-aside' },
        h('section', { className: 'panel' }, icon('shield', 23), h('h2', {}, 'Для руководителя'),
          h('p', {}, 'Разверните прокси (инструкция в README репозитория), положите туда общий ключ GigaChat и задайте код доступа. Поиск Яндекса работает от имени самой функции.'),
          h('p', {}, 'Затем заполните здесь адрес прокси, нажмите «Ссылка-настройка для команды» и разошлите ссылку. Код доступа передавайте отдельно, лично.'),
          h('p', {}, 'Сменили код на прокси — доступ у всех, кто знал старый, закрывается сразу.')),
        h('section', { className: 'panel' }, h('span', { className: 'eyebrow' }, 'ГДЕ ВЗЯТЬ КЛЮЧИ'),
          h('div', { className: 'documentation-links' },
            h('a', { href: 'https://developers.sber.ru/studio', target: '_blank', rel: 'noopener noreferrer' }, 'GigaChat Studio', icon('arrowUpRight', 14)),
            h('a', { href: 'https://platform.openai.com/api-keys', target: '_blank', rel: 'noopener noreferrer' }, 'OpenAI Platform', icon('arrowUpRight', 14)))))),
  ];
}

// ---------- Рендер ----------
function render() {
  const active = document.activeElement?.id;
  const root = document.getElementById('app');
  let content;
  if (state.tab === 'settings') content = settingsView();
  else if (state.tab === 'guide') content = guideView();
  else if (state.tab === 'history') content = historyView();
  else if (state.data) content = reportView();
  else content = dashboard();

  root.replaceChildren(h('div', { className: 'shell' },
    sidebar(),
    h('div', { className: 'workspace' },
      h('header', { className: 'topbar' }, h('div', {}, 'Рабочее пространство ', icon('chevronRight', 13), h('strong', {}, TITLES[state.tab])), h('span', { className: 'pilot-badge' }, h('span'), 'Пилот · клиентские менеджеры')),
      h('main', {},
        h('div', { className: 'page-caption' }, h('span', { className: 'small-square' }), 'КОРПОРАТИВНЫЙ БИЗНЕС ', h('span', { className: 'version' }, VERSION)),
        state.error && state.tab !== 'settings' ? h('div', { role: 'alert', className: 'alert' }, state.error) : null,
        content,
        h('footer', {}, h('span', {}, 'Повод · помощник клиентского менеджера'), h('button', { disabled: state.busy, onClick: () => set({ tab: 'guide' }) }, 'Как устроен пилот', icon('arrowUpRight', 13)))))));
  if (active) document.getElementById(active)?.focus();
}

render();
