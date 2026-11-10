import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
function loadTs(file, imports, extra = {}) {
  const code = ts.transpileModule(readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {};
  vm.runInNewContext(code, {
    exports,
    require(name) {
      assert.ok(Object.hasOwn(imports, name), `Unexpected dependency: ${name}`);
      return imports[name];
    },
    process: { env: {} }, console: { log() {}, error() {} }, URL, Date,
    setTimeout() { throw new Error('Tests must not start timers'); },
    ...extra,
  }, { filename: file });
  return exports;
}

function widget({ tag = '', html = '', browser = 'en' } = {}) {
  const elements = new Map();
  function element() {
    return {
      innerHTML: '', value: '', style: {}, classList: { add() {}, remove() {}, toggle() {} },
      scrollHeight: 0, scrollTop: 0, clientHeight: 0,
      addEventListener() {}, appendChild() {}, setAttribute() {},
    };
  }
  const script = { src: 'https://example.test/deesy.js', getAttribute: (key) => key === 'data-lang' ? tag : null };
  const document = {
    currentScript: script, documentElement: { lang: html }, body: null,
    addEventListener() {}, createElement: element,
  };
  const window = {};
  const source = readFileSync(path.join(root, 'public/deesy.js'), 'utf8')
    .replace('function start() {', 'window.testWidget = { T: T, pickLang: pickLang, Chat: Chat }; function start() {');
  vm.runInNewContext(source, { window, document, navigator: { language: browser }, URL, Date, location: { pathname: '/fi', href: 'https://example.test/fi' } });
  const { T, pickLang, Chat } = window.testWidget;
  const chat = Object.create(Chat.prototype);
  Object.assign(chat, { lang: pickLang(), msgs: [], pending: [], waiting: 0,
    shadow: { innerHTML: '', querySelector(selector) {
      if (!elements.has(selector)) elements.set(selector, element());
      return elements.get(selector);
    } },
  });
  return { T, pickLang, chat, elements };
}

const mock = loadTs('src/lib/mock-ai.ts', { './default-prompts': { isSalesAgentPrompt: () => false } });
function agent({ text = '', history, lang = 'fi', apiKey = false, reply = 'Selvä!', failure = false } = {}) {
  const rows = history || [{ role: 'user', content: text, meta: null, attachments: [] }];
  let system = '';
  const agentExports = loadTs('src/lib/shop/agent.ts', {
    '@/lib/prisma': { prisma: { message: { findMany: async () => rows.slice().reverse() } } },
    '@/lib/llm': { hasApiKey: () => apiKey, callClaude: async (args) => {
      system = [args.system, args.systemExtra].join('\n');
      if (failure) throw new Error('Simulated offline');
      return { content: [{ type: 'text', text: reply }], stop_reason: 'end_turn', usage: { input_tokens: 0, output_tokens: 0 } };
    } },
    '@/lib/default-prompts': { isSalesAgentPrompt: () => false }, '@/lib/mock-ai': mock,
    './catalog': { getCatalog: async () => [] },
    './shopify': { activePromotions: async () => ({ active: [], upcoming: [] }), promoNote: () => '' },
    './knowledge': { SHOP_EMAIL: 'info@deesse.ee', SHOP_URL: 'https://deesse.ee', buildSystemPrompt: () => '' },
    './tools': { discountCode: () => null, orderLookupReady: () => false, toolDefs: () => [], runTool() { throw new Error('No real tools'); } },
    './learning': { rulesBlock: async () => '', similarExamples: async () => '' },
  });
  return { ...agentExports, run: () => agentExports.runAgent({ id: 'unit-test', channel: 'web', model: 'claude', temperature: 0.5, topP: 1, pageUrl: null, customerName: null, customerEmail: null, systemPrompt: null, lang }), system: () => system };
}

for (const [input, expected] of [
  [{ tag: 'fi' }, 'fi'], [{ tag: 'fi-FI' }, 'fi'], [{ tag: 'FI', html: 'en' }, 'fi'],
  [{ html: 'fi-FI' }, 'fi'], [{ browser: 'fi' }, 'fi'], [{ tag: 'de' }, 'en'],
  [{ tag: 'et', html: 'fi' }, 'et'], [{ tag: 'ru' }, 'ru'], [{ tag: 'en' }, 'en'],
]) test(`locale selection ${JSON.stringify(input)}`, () => assert.equal(widget(input).pickLang(), expected));

test('Finnish dictionary has every supported UI key and no empty strings', () => {
  const { T } = widget();
  for (const lang of ['fi', 'et', 'ru']) assert.deepEqual(Object.keys(T[lang]).sort(), Object.keys(T.en).sort());
  for (const value of Object.values(T.fi)) {
    if (Array.isArray(value)) assert.equal(value.length, 4);
    else assert.equal(typeof value, 'string');
    assert.ok(String(value).trim());
  }
});

test('Finnish greeting, controls, input, screen-reader language and chips render', () => {
  const { chat, T } = widget({ html: 'fi' });
  chat.build();
  const html = chat.shadow.innerHTML;
  assert.match(html, /lang="fi"/);
  for (const key of ['open', 'close', 'attach', 'placeholder', 'send']) assert.ok(html.includes(`aria-label="${T.fi[key]}"`), key);
  assert.ok(chat.$body.innerHTML.includes(T.fi.welcome.split('\n')[0]));
  for (const chip of T.fi.chips) assert.ok(chat.$body.innerHTML.includes(chip));
});

test('Finnish teaser dismissal has a descriptive accessible label', () => {
  const { chat } = widget({ tag: 'fi' });
  chat.showTeaser();
  assert.match(chat.$teaser.innerHTML, /aria-label="Sulje vinkki"/);
});

test('Finnish failure, team, pending, checkout and stock strings render', () => {
  const { chat, T } = widget({ tag: 'fi' });
  chat.build();
  chat.msgs = [{ id: 'answer', by: 'team', text: 'Selvä', at: new Date().toISOString(), cartUrl: 'https://example.test/cart',
    products: [{ title: 'Product', url: 'https://example.test/product', price: '10 €', inStock: false }] }];
  chat.pending = [{ tempId: 'pending', text: 'Moi', failed: true, at: new Date().toISOString() }];
  chat.waiting = Date.now();
  chat.render();
  for (const key of ['failed', 'typing', 'checkout', 'order', 'team', 'today']) assert.ok(chat.$body.innerHTML.includes(T.fi[key]), key);
});

test('all Finnish chips and common Finnish inputs select Finnish without a locale hint', () => {
  const { T } = widget();
  const { messageLanguage } = agent();
  for (const text of [...T.fi.chips, T.fi.productChip, 'kengät', 'Hei, haluaisin kengät', 'Kiitos', 'Haluan kengät', 'Kyllä']) assert.equal(messageLanguage(text), 'Finnish', text);
});

test('a bare «Hei» is Finnish only on the Finnish page (it is Estonian too)', () => {
  const { messageLanguage } = agent();
  assert.equal(messageLanguage('Hei!', 'fi'), 'Finnish');
  assert.equal(messageLanguage('Hei!'), 'Estonian');
  assert.equal(messageLanguage('Hei!', 'et'), 'Estonian');
  assert.equal(messageLanguage('Hei, kas suurus 38 on olemas?'), 'Estonian');
  assert.equal(messageLanguage('Hei, can you help me?'), 'English');
  assert.equal(messageLanguage('Hei, haluaisin kengät'), 'Finnish');
});

test('Finnish page retains neutral names and words but allows clear language switches', () => {
  const { messageLanguage } = agent();
  for (const text of ['Bikini fitness', 'Pitäisiköhän']) assert.equal(messageLanguage(text, 'fi'), 'Finnish', text);
  assert.equal(messageLanguage('FLAMINGO-1020', 'fi'), null);
  for (const [text, language] of [['Hello, can you help me?', 'English'], ['Tere, kas suurus 38 on olemas?', 'Estonian'], ['Здравствуйте, нужен размер 38', 'Russian']]) {
    assert.equal(messageLanguage(text, 'fi'), language);
    assert.equal(messageLanguage(text), language);
  }
  assert.equal(messageLanguage('👠', 'fi'), null);
  assert.equal(messageLanguage('', 'fi'), null);
});

for (const [text, lang, expected] of [
  ['Toimitus ja nouto', 'fi', 'Kiitos viestistä!'], ['kengät', 'fi', 'Kiitos viestistä!'], ['', 'fi', 'Kiitos viestistä!'],
  ['Hello', 'fi', 'Thank you'], ['Tere', 'et', 'Aitäh'], ['Здравствуйте', 'ru', 'Спасибо'], ['Hello', 'en', 'Thank you'],
]) test(`offline reply ${lang}: ${text || 'attachment only'}`, async () => {
  const result = await agent({ text, lang }).run();
  assert.equal(result.meta.engine, 'offline');
  assert.ok(result.text.startsWith(expected), result.text);
});

test('Finnish LLM instruction matches chip language, while API failures and empty answers stay Finnish', async () => {
  const current = agent({ text: 'Toimitus ja nouto', apiKey: true });
  assert.equal((await current.run()).text, 'Selvä!');
  assert.match(current.system(), /Write your whole reply in Finnish/);
  assert.ok((await agent({ text: 'Apua koon valintaan', apiKey: true, failure: true }).run()).text.startsWith('Kiitos viestistä!'));
  assert.ok((await agent({ text: 'Onko kokoani saatavilla?', apiKey: true, reply: '' }).run()).text.startsWith('Kiitos viestistä!'));
});

test('attachment follows Finnish conversation and ignores internal team notes', async () => {
  const current = agent({ apiKey: true, history: [
    { role: 'user', content: 'Toimitus ja nouto', meta: null },
    { role: 'user', content: 'Внутренняя заметка', meta: { internal: true } },
    { role: 'user', content: '', meta: null },
  ] });
  await current.run();
  assert.match(current.system(), /Write your whole reply in Finnish/);
});

test('neutral model codes retain a clear English switch, or default to Finnish for a new chat', async () => {
  const switched = agent({ apiKey: true, history: [
    { role: 'user', content: 'Hei!', meta: null },
    { role: 'user', content: 'Hello, can you help me?', meta: null },
    { role: 'user', content: 'FLAMINGO-1020', meta: null },
  ] });
  await switched.run();
  assert.match(switched.system(), /Write your whole reply in English/);
  const fresh = agent({ text: 'FLAMINGO-1020', apiKey: true });
  await fresh.run();
  assert.match(fresh.system(), /Write your whole reply in Finnish/);
});

function api(existing = null) {
  let savedLang;
  let agentLang;
  let session = existing;
  const { POST } = loadTs('src/app/api/widget/chat/route.ts', {
    '@/lib/prisma': { ensureDefaultPrompts: async () => {}, prisma: {
      chatSession: {
        findFirst: async () => session,
        create: async ({ data }) => { savedLang = data.lang; return session = { id: 'session', ...data }; },
        update: async ({ data }) => { if (Object.hasOwn(data, 'lang')) savedLang = data.lang; return session = { ...session, ...data }; },
      },
      message: { count: async () => 0, create: async ({ data }) => ({ id: 'message', ...data, createdAt: new Date() }) },
      systemPrompt: { findUnique: async () => null },
    } },
    '@/lib/cors': { json: (_request, data, status = 200) => ({ status, ...data }) },
    '@/lib/files': { parseFiles: () => [] },
    '@/lib/shop/agent': { runAgent: async (value) => { agentLang = value.lang; return { text: 'Unit test', meta: {} }; } },
    '@/lib/default-prompts': {},
  });
  return { post: (lang) => POST({ json: async () => ({ visitorId: 'unit-test-visitor-1234', text: 'Test', lang }) }), saved: () => savedLang, passed: () => agentLang };
}

for (const lang of ['fi', 'et', 'ru', 'en']) test(`API saves and passes ${lang} without fallback`, async () => {
  const current = api();
  assert.equal((await current.post(lang)).status, 200);
  assert.equal(current.saved(), lang);
  assert.equal(current.passed(), lang);
});

test('API updates existing conversation language to Finnish and still rejects unsupported values', async () => {
  const current = api({ id: 'session', lang: 'en', pageUrl: null });
  assert.equal((await current.post('fi')).status, 200);
  assert.equal(current.saved(), 'fi');
  assert.equal(current.passed(), 'fi');
  const unsupported = api();
  assert.equal((await unsupported.post('unknown')).status, 200);
  assert.equal(unsupported.saved(), null);
});

test('widget sends fi to the API without changing the customer message', async () => {
  const { chat } = widget({ tag: 'fi' });
  chat.build();
  chat.vid = 'unit-test-visitor';
  chat.sid = null;
  const pending = { tempId: 'test-send', text: 'Apua koon valintaan', at: new Date().toISOString() };
  chat.pending = [pending];
  let sent;
  chat.api = async (_method, body) => { sent = body; return { __status: 200, messages: [] }; };
  chat.send(pending);
  await new Promise(setImmediate);
  assert.equal(sent.lang, 'fi');
  assert.equal(sent.text, pending.text);
  assert.equal(chat.pending.length, 0);
});

for (const [reason, key] of [['TOO_BIG', 'tooBig'], ['TYPE', 'badType'], ['LIMIT', 'limit'], ['unavailable', 'offline']]) {
  test(`widget displays Finnish API failure ${reason} and allows retry`, async () => {
    const { chat, T } = widget({ tag: 'fi' });
    chat.build();
    const pending = { tempId: 'failed-send', text: 'Moi', at: new Date().toISOString() };
    chat.pending = [pending];
    let notice;
    chat.flash = (message) => { notice = message; };
    chat.api = async () => ({ __status: 503, reason });
    chat.send(pending);
    await new Promise(setImmediate);
    assert.equal(notice, T.fi[key]);
    assert.equal(pending.failed, true);
    assert.ok(chat.$body.innerHTML.includes(T.fi.failed));
    chat.api = async () => ({ __status: 200, messages: [] });
    chat.retry(pending.tempId);
    await new Promise(setImmediate);
    assert.equal(chat.pending.length, 0);
  });
}

// PM 10.11: the Gmail draft is only the letter; a real tracking link from order_status is kept
test('e-mail draft keeps only the letter', () => {
  const { emailBody } = agent();
  const negin = "I've passed this to the team. Here's the draft reply to Negin for review:\n\n---\n\nSubject: Re: Return requested for order #1629\n\nHello Negin,\n\nThank you.\n\nWarm regards,\nDeisi\n\n---\n\nNotes for the team:\n- check the refund";
  assert.equal(emailBody(negin), 'Hello Negin,\n\nThank you.\n\nWarm regards,\nDeisi');
  assert.equal(emailBody('Тема: Re: Ваш заказ DEESSE\n\nЗдравствуйте!\n\nСпасибо.'), 'Здравствуйте!\n\nСпасибо.');
  assert.equal(emailBody('Tere!\n\nAitäh kirja eest.\n\nParimate soovidega\nDeisi'), 'Tere!\n\nAitäh kirja eest.\n\nParimate soovidega\nDeisi');
  assert.equal(emailBody('Hello Anna,\n\nYes.\n\n---\n\nNotes for the team: refund'), 'Hello Anna,\n\nYes.');
});
test('guardLinks keeps tracking links from order_status only', () => {
  const { guardLinks } = agent();
  const url = 'https://www.dpdgroup.com/ee/mydpd/my-parcels/track?parcelNumber=0123456789';
  assert.equal(guardLinks(`Track: ${url}`, [], undefined, [url]).text, `Track: ${url}`);
  assert.equal(guardLinks(`Track: ${url}`, [], undefined, []).text, 'Track: https://deesse.ee');
});
