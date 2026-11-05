/*! DEESSE shop chat window - Deisi. Same design as the DEESSE Studio chat, texts and buttons for the shop.
 * Embed: <script src="https://<app>.up.railway.app/deesy.js" defer></script>
 * Options on the script tag: data-lang="et|ru|en" (default: the page's <html lang>), data-position="left" (default right),
 * data-teaser="off" (no bubble after 7 s).
 */
(function () {
  'use strict';
  if (window.__deesseShopChat) return;
  window.__deesseShopChat = true;

  var script = document.currentScript || (function () { var s = document.querySelectorAll('script[src*="deesy.js"]'); return s[s.length - 1]; })();
  var API = new URL(script.src).origin;
  var PHOTO = 'https://static.wixstatic.com/media/e18625_9887d123d40f423e9c1f723b1e15363c~mv2.png/v1/fill/w_240,h_240,al_c,q_85,enc_auto/deisi.png';

  var T = {
    ru: {
      name: 'Дейси', role: 'ИИ-ассистент магазина DEESSE, на связи 24/7',
      welcome: 'Здравствуйте! Я Дейси, ассистент магазина DEESSE 💕\nПомогу подобрать туфли и одежду для pole и exotic, подскажу размер и доставку.',
      chips: ['Подобрать туфли для pole', 'Помочь с размером', 'Доставка и самовывоз', 'Возврат и обмен'],
      productChip: 'Есть ли мой размер?',
      placeholder: 'Напишите сообщение', send: 'Отправить', open: 'Открыть чат с Дейси', close: 'Свернуть чат',
      typing: 'Дейси печатает', team: 'Коллега DEESSE', note: 'Отвечает ИИ. Сложные вопросы Дейси передаёт коллеге.',
      teaser: 'Помочь подобрать туфли? 👠', attach: 'Прикрепить фото или PDF', tooBig: 'Файл больше 6 МБ. Пришлите поменьше.',
      badType: 'Можно отправить фото или PDF.', photo: 'Фото', sending: 'Отправляю…', failed: 'Не отправилось. Нажмите, чтобы повторить',
      today: 'Сегодня', checkout: 'Перейти к оплате', view: 'Смотреть', cart: '🛒 корзина', order: 'под заказ',
      limit: 'Сегодня сообщений очень много. Напишите, пожалуйста, на info@deesse.ee', offline: 'Нет связи. Попробуйте ещё раз.',
    },
    et: {
      name: 'Deisi', role: 'DEESSE poe virtuaalne assistent, alati olemas',
      welcome: 'Tere! Mina olen Deisi, DEESSE poe assistent 💕\nAitan valida pole- ja exotic-kingad ning riided, soovitan suuruse ja räägin tarnest.',
      chips: ['Aita valida pole-kingad', 'Aita suurusega', 'Tarne ja järeletulek', 'Tagastus ja vahetus'],
      productChip: 'Kas minu suurus on olemas?',
      placeholder: 'Kirjuta sõnum', send: 'Saada', open: 'Ava vestlus Deisiga', close: 'Sulge vestlus',
      typing: 'Deisi kirjutab', team: 'DEESSE kolleeg', note: 'Vastab tehisintellekt. Keerulised küsimused annab Deisi kolleegile.',
      teaser: 'Kas aitan kingi valida? 👠', attach: 'Lisa foto või PDF', tooBig: 'Fail on suurem kui 6 MB. Saada väiksem.',
      badType: 'Saata saab foto või PDF-i.', photo: 'Foto', sending: 'Saadan…', failed: 'Ei läinud teele. Vajuta, et uuesti saata',
      today: 'Täna', checkout: 'Mine kassasse', view: 'Vaata', cart: '🛒 ostukorv', order: 'tellimisel',
      limit: 'Täna on sõnumeid väga palju. Palun kirjutage info@deesse.ee', offline: 'Ühendus katkes. Proovige uuesti.',
    },
    en: {
      name: 'Deisi', role: 'DEESSE shop AI assistant, here 24/7',
      welcome: 'Hi! I’m Deisi, the DEESSE shop assistant 💕\nI can help you choose pole and exotic heels and wear, find your size and sort out delivery.',
      chips: ['Help me choose pole shoes', 'Help with my size', 'Delivery & pickup', 'Returns & exchanges'],
      productChip: 'Is my size available?',
      placeholder: 'Write a message', send: 'Send', open: 'Open chat with Deisi', close: 'Minimise chat',
      typing: 'Deisi is typing', team: 'DEESSE colleague', note: 'Answers are by AI. Deisi passes tricky questions to a colleague.',
      teaser: 'Shall I help you find the right heels? 👠', attach: 'Attach a photo or PDF', tooBig: 'The file is over 6 MB. Please send a smaller one.',
      badType: 'You can send a photo or a PDF.', photo: 'Photo', sending: 'Sending…', failed: 'Not sent. Tap to try again',
      today: 'Today', checkout: 'Go to checkout', view: 'View', cart: '🛒 cart', order: 'on order',
      limit: 'There are a lot of messages today. Please write to info@deesse.ee', offline: 'No connection. Please try again.',
    },
  };

  var CSS = '\
:host{all:initial}\
*{box-sizing:border-box;margin:0;padding:0}\
.root{--ink:#080808;--paper:#fff;--olive:#989061;--champagne:#cdc7a1;--blush:#f6e4dc;--blush-deep:#e9c8bb;--gold:#dfbd70;--mute:#6f6a60;\
font:400 15px/1.45 Montserrat,"Helvetica Neue",Arial,sans-serif;color:var(--ink);-webkit-font-smoothing:antialiased}\
button{font:inherit;color:inherit;background:none;border:0;cursor:pointer}\
button:focus-visible,a:focus-visible{outline:2px solid var(--olive);outline-offset:3px}\
textarea:focus,textarea:focus-visible{outline:none}\
.launch{position:fixed;right:22px;bottom:22px;z-index:2147483000;width:68px;height:68px;border-radius:50%;display:grid;place-items:center;transition:transform .25s cubic-bezier(.2,.9,.3,1.3)}\
.launch:hover{transform:scale(1.06)}\
.ring{position:absolute;inset:0;border-radius:50%;padding:3px;background:conic-gradient(from var(--a,0deg),var(--champagne) 0deg,#fff6dc 40deg,var(--gold) 80deg,var(--olive) 160deg,var(--champagne) 300deg);\
-webkit-mask:radial-gradient(farthest-side,transparent calc(100% - 3px),#000 calc(100% - 3px));mask:radial-gradient(farthest-side,transparent calc(100% - 3px),#000 calc(100% - 3px));animation:sweep 6s linear infinite}\
@property --a{syntax:"<angle>";inherits:false;initial-value:0deg}\
@keyframes sweep{to{--a:360deg}}\
.launch img{width:60px;height:60px;border-radius:50%;object-fit:cover;box-shadow:0 10px 30px rgba(8,8,8,.28)}\
.dot{position:absolute;right:4px;bottom:4px;width:14px;height:14px;border-radius:50%;background:#3fbf6f;border:2.5px solid #fff}\
.badge{position:absolute;top:-2px;right:-2px;min-width:22px;height:22px;padding:0 6px;border-radius:11px;background:var(--ink);color:#fff;font-size:12px;font-weight:600;display:grid;place-items:center;border:2px solid #fff}\
.launch.hidden{transform:scale(0);pointer-events:none}\
.teaser{position:fixed;right:100px;bottom:34px;z-index:2147483000;max-width:240px;padding:12px 34px 12px 16px;border-radius:18px 18px 4px 18px;background:#fff;box-shadow:0 14px 40px rgba(8,8,8,.16);font-size:14px;font-weight:500;cursor:pointer;animation:pop .5s cubic-bezier(.2,.9,.3,1.2) both}\
.teaser .x{position:absolute;right:8px;top:8px;width:20px;height:20px;border-radius:50%;font-size:14px;line-height:20px;color:var(--mute)}\
@keyframes pop{from{opacity:0;transform:translateY(8px) scale(.96)}to{opacity:1;transform:none}}\
.panel{position:fixed;right:22px;bottom:22px;z-index:2147483001;width:400px;height:min(660px,calc(100vh - 44px));display:flex;flex-direction:column;border-radius:26px;overflow:hidden;background:var(--paper);\
box-shadow:0 30px 80px rgba(8,8,8,.28),0 0 0 1px rgba(8,8,8,.06);transform-origin:bottom right;transition:transform .32s cubic-bezier(.2,.9,.3,1.1),opacity .2s}\
.panel.closed{transform:scale(.6) translateY(40px);opacity:0;pointer-events:none}\
.left .launch,.left .panel{right:auto;left:22px}.left .panel{transform-origin:bottom left}.left .teaser{right:auto;left:100px;border-radius:18px 18px 18px 4px}\
.head{position:relative;background:var(--ink);color:#fff;padding:18px 18px 18px 92px;min-height:86px;display:flex;flex-direction:column;justify-content:center}\
.head::after{content:"";position:absolute;inset:auto 0 0 0;height:1px;background:linear-gradient(90deg,transparent,var(--champagne),transparent);opacity:.6}\
.head .pic{position:absolute;left:16px;top:50%;transform:translateY(-50%);width:62px;height:62px}\
.head .pic img{width:100%;height:100%;border-radius:50%;object-fit:cover;border:2px solid var(--champagne)}\
.head .pic .dot{right:0;bottom:2px;border-color:var(--ink)}\
.name{font-family:"Great Vibes",cursive;font-size:36px;line-height:1;font-weight:400;color:#fff;letter-spacing:.01em}\
.role{font-size:12px;color:rgba(255,255,255,.72);margin-top:4px}\
.min{position:absolute;right:12px;top:12px;width:34px;height:34px;border-radius:50%;display:grid;place-items:center;color:#fff}\
.min:hover{background:rgba(255,255,255,.1)}\
.body{flex:1;overflow-y:auto;padding:18px 16px 8px;scroll-behavior:smooth;background:radial-gradient(120% 60% at 100% 0%,var(--blush) 0%,rgba(246,228,220,0) 55%),#fff}\
.day{text-align:center;font-size:11px;color:var(--mute);margin:6px 0 12px}\
.row{display:flex;gap:8px;margin:0 0 10px;align-items:flex-end}\
.row.me{justify-content:flex-end}\
.av{width:28px;height:28px;border-radius:50%;object-fit:cover;flex:none}\
.av.ghost{visibility:hidden}\
.bub{max-width:78%;padding:10px 14px;border-radius:18px;white-space:pre-wrap;word-wrap:break-word;overflow-wrap:anywhere;font-size:14.5px;animation:rise .28s ease-out both}\
.deisi .bub{background:var(--blush);border-bottom-left-radius:6px}\
.team .bub{background:#fff;border:1px solid var(--champagne);border-bottom-left-radius:6px}\
.me .bub{background:var(--ink);color:#fff;border-bottom-right-radius:6px}\
.who{font-size:11px;font-weight:600;color:var(--olive);margin-bottom:2px}\
.bub a{color:inherit;text-decoration:underline;text-underline-offset:2px;font-weight:500}\
.bub b{font-weight:600}\
.time{font-size:10.5px;color:var(--mute);margin:-6px 0 10px 36px}\
.row.me + .time{text-align:right;margin-left:0}\
.fail{font-size:12px;color:#b3261e;text-align:right;margin:-4px 2px 10px;cursor:pointer}\
@keyframes rise{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}\
.chips{display:flex;flex-wrap:wrap;gap:8px;margin:4px 0 14px 36px}\
.chip{padding:8px 13px;border-radius:999px;border:1px solid var(--olive);color:var(--ink);font-size:13px;font-weight:500;background:#fff;transition:background .15s,color .15s}\
.chip:hover{background:var(--olive);color:#fff}\
.cards{display:flex;gap:8px;overflow-x:auto;margin:-2px 0 12px 36px;padding-bottom:4px;scroll-snap-type:x mandatory}\
.card{flex:0 0 172px;scroll-snap-align:start;display:flex;flex-direction:column;border:1px solid #efe7dc;border-radius:16px;overflow:hidden;background:#fff;text-decoration:none;color:var(--ink);transition:border-color .15s,transform .15s}\
.card:hover{border-color:var(--olive);transform:translateY(-1px)}\
.card img{width:100%;height:150px;object-fit:cover;background:var(--blush)}\
.card .ct{padding:8px 10px 10px;font-size:12.5px;font-weight:500;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}\
.card .cp{padding:0 10px 10px;font-size:13px;font-weight:600;color:var(--olive);display:flex;justify-content:space-between;gap:6px}\
.card .cp small{font-weight:500;color:var(--mute);font-size:11px}\
.pay{display:flex;align-items:center;justify-content:center;gap:8px;margin:-2px 0 12px 36px;padding:12px 16px;border-radius:999px;background:var(--olive);color:#fff;font-weight:600;font-size:14px;text-decoration:none;letter-spacing:.02em;transition:background .15s}\
.pay:hover{background:#7f784f}\
.typing .bub{display:flex;gap:4px;align-items:center;padding:13px 14px}\
.typing i{width:6px;height:6px;border-radius:50%;background:var(--olive);animation:blink 1.2s infinite}\
.typing i:nth-child(2){animation-delay:.15s}.typing i:nth-child(3){animation-delay:.3s}\
@keyframes blink{0%,80%,100%{opacity:.25;transform:translateY(0)}40%{opacity:1;transform:translateY(-3px)}}\
.foot{padding:10px 12px 12px;border-top:1px solid #efece4;background:#fff}\
.box{display:flex;align-items:flex-end;gap:8px;border:1px solid var(--champagne);border-radius:22px;padding:6px 6px 6px 14px;transition:border-color .15s}\
.box:focus-within{border-color:var(--olive)}\
textarea{flex:1;resize:none;border:0;outline:0;font:inherit;font-size:15px;line-height:1.4;max-height:120px;padding:7px 0;background:transparent;color:var(--ink)}\
textarea::placeholder{color:#9b968b}\
.send{width:38px;height:38px;border-radius:50%;background:var(--olive);color:#fff;display:grid;place-items:center;flex:none;transition:transform .15s,opacity .15s}\
.send:disabled{opacity:.35;cursor:default}\
.send:not(:disabled):hover{transform:scale(1.06)}\
.clip{width:34px;height:38px;border-radius:50%;display:grid;place-items:center;color:var(--mute);flex:none;margin-left:-6px}\
.clip:hover{color:var(--olive)}\
.pic-msg{display:block;max-width:220px;max-height:260px;border-radius:14px;object-fit:cover}\
.bub.media{padding:4px;background:transparent!important;border:0!important}\
.filechip{display:inline-flex;align-items:center;gap:8px;padding:10px 12px;border-radius:14px;background:#fff;border:1px solid var(--champagne);color:var(--ink)!important;text-decoration:none!important;font-weight:500;font-size:13.5px;max-width:240px}\
.filechip span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}\
.note{font-size:10.5px;color:var(--mute);text-align:center;margin-top:7px}\
.note.err{color:#b3261e}\
@media (max-width:600px){\
.launch{right:16px;bottom:16px;width:62px;height:62px}.left .launch{left:16px}\
.launch img{width:55px;height:55px}\
.teaser{right:88px;bottom:26px;max-width:200px}.left .teaser{left:88px}\
.panel,.left .panel{right:0;left:0;bottom:0;width:100vw;height:100dvh;border-radius:0}\
.head{padding-top:max(18px,env(safe-area-inset-top))}\
.foot{padding-bottom:max(12px,env(safe-area-inset-bottom))}\
textarea{font-size:16px}}\
@media (prefers-reduced-motion:reduce){.ring{animation:none}.bub,.teaser{animation:none}.panel,.launch{transition:none}.typing i{animation:none;opacity:.6}}';

  var SEND_ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 12h14M13 6l6 6-6 6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var CLIP_ICON = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M20 11.5l-7.8 7.8a5 5 0 01-7.1-7.1l8.5-8.5a3.3 3.3 0 014.7 4.7l-8.5 8.5a1.7 1.7 0 01-2.4-2.4l7.8-7.8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var MIN_ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } }
  function ssGet(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }
  function ssSet(k, v) { try { sessionStorage.setItem(k, v); } catch (e) { /* private mode */ } }
  function rid() { var a = new Uint8Array(16); (window.crypto || {}).getRandomValues ? crypto.getRandomValues(a) : a.forEach(function (_, i) { a[i] = Math.random() * 256; }); return Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join(''); }

  /** escaped text → **bold**, [label](url) and bare links; the cart link gets a short label */
  function rich(text, cartUrl, t) {
    var links = [];
    var s = String(text || '').replace(/\[([^\]]{1,80})\]\((https?:\/\/[^\s)]+)\)/g, function (_, label, url) { links.push({ label: label, url: url }); return '\u0000' + (links.length - 1) + '\u0000'; });
    s = esc(s).replace(/\*\*([^*\n]{1,200})\*\*/g, '<b>$1</b>');
    s = s.replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)»"])/g, function (u) {
      var raw = u.replace(/&amp;/g, '&');
      var label = cartUrl && raw === cartUrl ? t.cart : u.replace(/^https?:\/\/(www\.)?/, '').replace(/\?.*$/, '').slice(0, 40) + (u.length > 48 ? '…' : '');
      return '<a href="' + u + '" target="_blank" rel="noopener">' + label + '</a>';
    });
    return s.replace(/\u0000(\d+)\u0000/g, function (_, i) { var l = links[+i]; return '<a href="' + esc(l.url) + '" target="_blank" rel="noopener">' + esc(l.url === cartUrl ? t.cart : l.label) + '</a>'; });
  }

  function pickLang() {
    var l = (script.getAttribute('data-lang') || document.documentElement.lang || navigator.language || 'en').slice(0, 2).toLowerCase();
    return T[l] ? l : 'en';
  }

  function Chat() {
    this.lang = pickLang();
    this.vid = lsGet('deesy-vid') || (function () { var v = rid(); lsSet('deesy-vid', v); return v; })();
    this.sid = lsGet('deesy-sid');
    this.msgs = [];
    this.pending = [];
    this.open = false;
    this.waiting = 0;
    this.unread = 0;
    this.loaded = false;
    this.init();
  }

  Chat.prototype.t = function () { return T[this.lang] || T.en; };

  Chat.prototype.init = function () {
    if (!document.getElementById('deesse-chat-fonts')) {
      var l = document.createElement('link');
      l.id = 'deesse-chat-fonts'; l.rel = 'stylesheet';
      l.href = 'https://fonts.googleapis.com/css2?family=Great+Vibes&family=Montserrat:wght@400;500;600&display=swap';
      document.head.appendChild(l);
    }
    this.mount = document.createElement('div');
    this.mount.setAttribute('data-deesse-chat', '');
    document.body.appendChild(this.mount);
    this.shadow = this.mount.attachShadow({ mode: 'open' });
    this.build();
    var self = this;
    if (script.getAttribute('data-teaser') !== 'off' && !ssGet('dc-teased') && !lsGet('dc-started')) setTimeout(function () { self.showTeaser(); }, 7000);
    if (this.sid) this.load();
  };

  Chat.prototype.build = function () {
    var t = this.t(), self = this;
    var left = script.getAttribute('data-position') === 'left' ? ' left' : '';
    this.shadow.innerHTML = '<style>' + CSS + '</style><div class="root' + left + '">' +
      '<button class="launch" aria-label="' + esc(t.open) + '" aria-expanded="false"><span class="ring"></span><img src="' + PHOTO + '" alt=""><span class="dot"></span></button>' +
      '<div class="panel closed" role="dialog" aria-label="' + esc(t.name) + '" aria-modal="false">' +
      '<div class="head"><div class="pic"><img src="' + PHOTO + '" alt="' + esc(t.name) + '"><span class="dot"></span></div>' +
      '<div class="name">' + esc(t.name) + '</div><div class="role">' + esc(t.role) + '</div>' +
      '<button class="min" aria-label="' + esc(t.close) + '">' + MIN_ICON + '</button></div>' +
      '<div class="body" aria-live="polite"></div>' +
      '<div class="foot"><div class="box"><button class="clip" aria-label="' + esc(t.attach) + '" title="' + esc(t.attach) + '">' + CLIP_ICON + '</button>' +
      '<input type="file" accept="image/*,application/pdf" hidden><textarea rows="1" aria-label="' + esc(t.placeholder) + '" placeholder="' + esc(t.placeholder) + '" maxlength="2000"></textarea>' +
      '<button class="send" aria-label="' + esc(t.send) + '" disabled>' + SEND_ICON + '</button></div>' +
      '<div class="note" aria-live="polite">' + esc(t.note) + '</div></div></div></div>';
    var $ = function (s) { return self.shadow.querySelector(s); };
    this.$launch = $('.launch'); this.$panel = $('.panel'); this.$body = $('.body'); this.$ta = $('textarea'); this.$send = $('.send');
    this.$file = $('input[type=file]'); this.$note = $('.note');
    this.$launch.addEventListener('click', function () { self.setOpen(true); });
    $('.min').addEventListener('click', function () { self.setOpen(false); });
    this.$send.addEventListener('click', function () { self.submit(); });
    $('.clip').addEventListener('click', function () { self.$file.click(); });
    this.$file.addEventListener('change', function () { var f = self.$file.files && self.$file.files[0]; self.$file.value = ''; if (f) self.attach(f); });
    this.$ta.addEventListener('input', function () { self.autosize(); });
    this.$ta.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); self.submit(); } });
    this.$panel.addEventListener('keydown', function (e) { if (e.key === 'Escape') self.setOpen(false); });
    this.$body.addEventListener('click', function (e) {
      var chip = e.target.closest('.chip'); if (chip) { self.submit(chip.textContent); return; }
      var f = e.target.closest('.fail'); if (f) self.retry(f.getAttribute('data-id'));
    });
    this.render();
  };

  Chat.prototype.showTeaser = function () {
    if (this.open) return;
    ssSet('dc-teased', '1');
    var self = this, d = document.createElement('div');
    d.className = 'teaser'; d.setAttribute('role', 'button'); d.tabIndex = 0;
    d.innerHTML = esc(this.t().teaser) + '<button class="x" aria-label="×">×</button>';
    d.addEventListener('click', function (e) { d.remove(); self.$teaser = null; if (!e.target.closest('.x')) self.setOpen(true); });
    this.shadow.querySelector('.root').appendChild(d);
    this.$teaser = d;
  };

  Chat.prototype.setOpen = function (open) {
    this.open = open;
    if (this.$teaser) { this.$teaser.remove(); this.$teaser = null; }
    this.$panel.classList.toggle('closed', !open);
    this.$launch.classList.toggle('hidden', open && window.innerWidth <= 600);
    this.$launch.setAttribute('aria-expanded', String(open));
    var self = this;
    if (open) {
      this.unread = 0; this.renderBadge();
      setTimeout(function () { self.$ta.focus({ preventScroll: true }); self.scrollEnd(); }, 60);
      if (this.sid && !this.loaded) this.load();
      this.poll();
    } else { this.$launch.focus({ preventScroll: true }); clearTimeout(this.pollTimer); }
    if (window.innerWidth <= 600) document.documentElement.style.overflow = open ? 'hidden' : '';
  };

  Chat.prototype.autosize = function () {
    var ta = this.$ta; ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 120) + 'px';
    this.$send.disabled = !ta.value.trim();
  };

  Chat.prototype.flash = function (msg) {
    var self = this;
    this.$note.textContent = msg; this.$note.classList.add('err');
    clearTimeout(this.noteTimer);
    this.noteTimer = setTimeout(function () { self.$note.textContent = self.t().note; self.$note.classList.remove('err'); }, 6000);
  };

  Chat.prototype.api = function (method, body, query) {
    var url = API + '/api/widget/chat' + (query ? '?' + query : '');
    return fetch(url, { method: method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { j.__status = r.status; return j; }); });
  };

  Chat.prototype.load = function () {
    var self = this;
    return this.api('GET', null, 'visitorId=' + this.vid + (this.sid ? '&sessionId=' + this.sid : '')).then(function (j) {
      if (j.__status !== 200) return;
      self.loaded = true;
      if (j.sessionId) { self.sid = j.sessionId; lsSet('deesy-sid', j.sessionId); }
      self.merge(j.messages || [], true);
    }).catch(function () { /* offline */ });
  };

  // while the window is open, look for colleague answers every 20 s
  Chat.prototype.poll = function () {
    var self = this;
    clearTimeout(this.pollTimer);
    if (!this.open) return;
    this.pollTimer = setTimeout(function () {
      if (!self.sid || self.waiting) { self.poll(); return; }
      var last = self.msgs.length ? self.msgs[self.msgs.length - 1].at : '';
      self.api('GET', null, 'visitorId=' + self.vid + '&sessionId=' + self.sid + (last ? '&after=' + encodeURIComponent(last) : ''))
        .then(function (j) { if (j.__status === 200) self.merge(j.messages || []); })
        .catch(function () {}).then(function () { self.poll(); });
    }, 20000);
  };

  Chat.prototype.merge = function (list, replace) {
    var known = {}; this.msgs.forEach(function (m) { known[m.id] = 1; });
    var fresh = list.filter(function (m) { return !known[m.id]; });
    this.msgs = replace ? list.slice() : this.msgs.concat(fresh);
    var answers = fresh.filter(function (m) { return !m.me; });
    if (answers.length && !this.open && !replace) { this.unread += answers.length; this.renderBadge(); }
    this.render();
  };

  Chat.prototype.submit = function (textArg) {
    var text = String(textArg != null ? textArg : this.$ta.value).trim();
    if (!text) return;
    if (textArg == null) { this.$ta.value = ''; this.autosize(); }
    var p = { tempId: 't' + Date.now(), text: text, failed: false, at: new Date().toISOString() };
    this.pending.push(p);
    this.send(p);
  };

  Chat.prototype.send = function (p) {
    var self = this;
    this.waiting = Date.now();
    lsSet('dc-started', '1');
    this.render();
    var body = { visitorId: this.vid, sessionId: this.sid, text: p.text, lang: this.lang, page: location.href };
    if (p.upload) body.files = [p.upload];
    this.api('POST', body).then(function (j) {
      self.waiting = 0;
      if (j.__status === 200 && j.messages) {
        if (j.sessionId) { self.sid = j.sessionId; lsSet('deesy-sid', j.sessionId); }
        self.pending = self.pending.filter(function (x) { return x !== p; });
        self.merge(j.messages);
        return;
      }
      p.failed = true;
      var t = self.t();
      self.flash(j.reason === 'TOO_BIG' ? t.tooBig : j.reason === 'TYPE' ? t.badType : j.reason === 'LIMIT' ? t.limit : t.offline);
      self.render();
    }).catch(function () { self.waiting = 0; p.failed = true; self.flash(self.t().offline); self.render(); });
  };

  Chat.prototype.retry = function (tempId) {
    var p = this.pending.filter(function (x) { return x.tempId === tempId; })[0];
    if (!p) return;
    p.failed = false; this.send(p);
  };

  // photo → max 1600 px JPEG; PDF as it is (max 6 MB)
  Chat.prototype.attach = function (file) {
    var t = this.t(), self = this;
    var type = String(file.type || '').toLowerCase();
    var isImg = /^image\//.test(type), isPdf = type === 'application/pdf';
    if (!isImg && !isPdf) { this.flash(t.badType); return; }
    var name = file.name || (isImg ? 'photo.jpg' : 'file.pdf');
    var read = isImg && type !== 'image/gif' ? this.shrink(file).then(function (d) { name = name.replace(/\.[^.]+$/, '') + '.jpg'; type = 'image/jpeg'; return d; })
      : (file.size > 6 * 1024 * 1024 ? Promise.reject('big') : new Promise(function (res, rej) { var r = new FileReader(); r.onload = function () { res(r.result); }; r.onerror = rej; r.readAsDataURL(file); }));
    read.then(function (dataUrl) {
      if (dataUrl.length > 8.3 * 1024 * 1024) { self.flash(t.tooBig); return; }
      var p = { tempId: 'f' + Date.now(), text: self.$ta.value.trim(), file: { kind: isImg ? 'image' : 'file', url: isImg ? dataUrl : '', name: name }, failed: false, at: new Date().toISOString(), upload: { name: name, type: type, data: dataUrl } };
      self.$ta.value = ''; self.autosize();
      self.pending.push(p);
      self.send(p);
    }, function (e) { self.flash(e === 'big' ? t.tooBig : t.badType); });
  };

  Chat.prototype.shrink = function (file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        var k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
        var c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
        var g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url); resolve(c.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = function (e) { URL.revokeObjectURL(url); reject(e); };
      img.src = url;
    });
  };

  Chat.prototype.renderBadge = function () {
    var b = this.$launch.querySelector('.badge');
    if (!this.unread) { if (b) b.remove(); return; }
    if (!b) { b = document.createElement('span'); b.className = 'badge'; this.$launch.appendChild(b); }
    b.textContent = this.unread > 9 ? '9+' : String(this.unread);
  };

  Chat.prototype.render = function () {
    if (!this.$body) return;
    var t = this.t(), self = this;
    var loc = this.lang === 'en' ? 'en-GB' : this.lang;
    var atBottom = this.$body.scrollHeight - this.$body.scrollTop - this.$body.clientHeight < 80;
    var h = '<div class="row deisi"><img class="av" src="' + PHOTO + '" alt=""><div class="bub">' + rich(t.welcome, null, t) + '</div></div>';
    if (!this.msgs.length && !this.pending.length) {
      var chips = /\/products\//.test(location.pathname) ? [t.productChip].concat(t.chips.slice(0, 3)) : t.chips;
      h += '<div class="chips">' + chips.map(function (c) { return '<button class="chip">' + esc(c) + '</button>'; }).join('') + '</div>';
    }
    var fmtDay = function (iso) { var d = new Date(iso); return d.toDateString() === new Date().toDateString() ? t.today : d.toLocaleDateString(loc, { day: 'numeric', month: 'long' }); };
    var fmtTime = function (iso) { return new Date(iso).toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' }); };
    var all = this.msgs.concat(this.pending.map(function (p) { return { id: p.tempId, me: true, by: 'me', text: p.text, files: p.file ? [p.file] : [], at: p.at, pending: true, failed: p.failed }; }));
    var body = function (m, extra) {
      var files = (m.files || []).map(function (f) {
        return f.kind === 'image'
          ? (f.url ? '<img class="pic-msg" src="' + esc(f.url) + '" alt="' + esc(t.photo) + '">' : '<div class="filechip">📷 <span>' + esc(f.name || t.photo) + '</span></div>')
          : '<span class="filechip">📎 <span>' + esc(f.name || 'PDF') + '</span></span>';
      }).join('');
      var onlyMedia = files && !m.text;
      return { cls: onlyMedia ? ' media' : '', html: (extra || '') + files + (m.text ? (files ? '<div style="margin-top:6px">' : '') + rich(m.text, m.cartUrl, t) + (files ? '</div>' : '') : '') };
    };
    var lastDay = '', prevBy = 'deisi';
    all.forEach(function (m, i) {
      var day = m.at ? fmtDay(m.at) : '';
      if (day && day !== lastDay) { h += '<div class="day">' + esc(day) + '</div>'; lastDay = day; prevBy = ''; }
      var next = all[i + 1], lastOfGroup = !next || next.by !== m.by, b;
      if (m.me) {
        b = body(m); h += '<div class="row me"><div class="bub' + b.cls + '">' + b.html + '</div></div>';
        if (m.failed) h += '<div class="fail" role="button" data-id="' + esc(m.id) + '">' + esc(t.failed) + '</div>';
      } else {
        var showWho = m.by === 'team' && prevBy !== 'team';
        b = body(m, showWho ? '<div class="who">' + esc(t.team) + '</div>' : '');
        h += '<div class="row ' + (m.by === 'team' ? 'team' : 'deisi') + '"><img class="av' + (lastOfGroup ? '' : ' ghost') + '" src="' + PHOTO + '" alt=""><div class="bub' + (showWho ? '' : b.cls) + '">' + b.html + '</div></div>';
        if (m.products && m.products.length) {
          h += '<div class="cards">' + m.products.map(function (p) {
            return '<a class="card" href="' + esc(p.url) + '" target="_blank" rel="noopener">' + (p.image ? '<img src="' + esc(p.image + (p.image.indexOf('?') > -1 ? '&' : '?') + 'width=400') + '" alt="" loading="lazy">' : '') +
              '<span class="ct">' + esc(p.title) + '</span><span class="cp">' + esc(p.price) + (p.inStock ? '' : '<small>' + esc(t.order) + '</small>') + '</span></a>';
          }).join('') + '</div>';
        }
        if (m.cartUrl) h += '<a class="pay" href="' + esc(m.cartUrl) + '" target="_blank" rel="noopener">' + esc(t.checkout) + ' →</a>';
      }
      if (lastOfGroup && m.at && !m.pending) h += '<div class="time">' + esc(fmtTime(m.at)) + '</div>';
      prevBy = m.by;
    });
    if (this.waiting && Date.now() - this.waiting < 90000)
      h += '<div class="row deisi typing" aria-label="' + esc(t.typing) + '"><img class="av" src="' + PHOTO + '" alt=""><div class="bub"><i></i><i></i><i></i></div></div>';
    this.$body.innerHTML = h;
    if (atBottom || this.waiting) this.scrollEnd();
    void self;
  };

  Chat.prototype.scrollEnd = function () { if (this.$body) this.$body.scrollTop = this.$body.scrollHeight; };

  function start() { window.deesseChat = new Chat(); }
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
})();
