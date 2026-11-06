/**
 * DEESSE shop - Gmail bridge for Deisi (Google Apps Script, runs in the info@deesse.ee Google account).
 *
 * Every 5 minutes it takes new unread customer e-mails from the inbox, asks the Deisi app
 * (POST /api/email) for an answer and saves the answer as a Gmail DRAFT reply in the same thread.
 * Nothing is sent automatically: a person opens the draft, checks it and presses Send.
 * Newsletters (owner 06.11): Deisi unsubscribes by herself (one-click link, unsubscribe e-mail or link) and archives them,
 * except the domains kept in the app (Setting keep_newsletters). Promotions are checked too, but only mail with List-Unsubscribe.
 * Invoices are forwarded to the accountant when the app says so (sender confirmed by Gmail and known); otherwise label needs-person.
 *
 * Setup (once):
 * 1. https://script.google.com → New project (logged in as info@deesse.ee) → paste this file.
 * 2. Project Settings → Script properties:
 *      APP_URL      = https://shopify-chatbot-production-fbfb.up.railway.app
 *      BRIDGE_TOKEN = the same long random text as EMAIL_BRIDGE_TOKEN in Railway Variables
 * 3. Run "setup" once and allow Gmail access. It creates the labels and the 5-minute trigger.
 */

var LABEL_DRAFT = 'Deisi/draft';
var LABEL_SKIP = 'Deisi/skip';
var LABEL_HUMAN = 'Deisi/needs-person';
var LABEL_UNSUB = 'Deisi/unsubscribed';
var LABEL_FWD = 'Deisi/invoice-forwarded';
var SEARCH = 'in:inbox is:unread newer_than:2d -category:promotions -category:social -category:forums';
var SEARCH_LISTS = 'in:inbox newer_than:3d -label:Deisi-unsubscribed (category:promotions OR category:forums OR category:updates)';

function setup() {
  [LABEL_DRAFT, LABEL_SKIP, LABEL_HUMAN, LABEL_UNSUB, LABEL_FWD].forEach(function (name) {
    if (!GmailApp.getUserLabelByName(name)) GmailApp.createLabel(name);
  });
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'run') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('run').timeBased().everyMinutes(5).create();
  run();
}

function run() {
  var props = PropertiesService.getScriptProperties();
  var appUrl = String(props.getProperty('APP_URL') || '').replace(/\/+$/, '');
  var token = props.getProperty('BRIDGE_TOKEN');
  if (!appUrl || !token) throw new Error('Set APP_URL and BRIDGE_TOKEN in Script properties');

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    var seen = JSON.parse(props.getProperty('SEEN') || '{}');
    var me = Session.getActiveUser().getEmail().toLowerCase();
    // customer mail (unread, main inbox) + mass mail from the other tabs (only with List-Unsubscribe, for unsubscribing)
    var threads = GmailApp.search(SEARCH, 0, 20).map(function (t) { return { thread: t, lists: false }; })
      .concat(GmailApp.search(SEARCH_LISTS, 0, 20).map(function (t) { return { thread: t, lists: true }; }));
    var started = Date.now();
    threads.forEach(function (item) {
      if (Date.now() - started > 4 * 60 * 1000) return; // keep inside the 6-minute limit
      var thread = item.thread;
      var msgs = thread.getMessages();
      var msg = msgs[msgs.length - 1];
      var id = msg.getId();
      if (seen[id]) return;
      var listUnsub = msg.getHeader('List-Unsubscribe') || '';
      if (item.lists ? !listUnsub : !msg.isUnread()) return;
      var from = msg.getFrom();
      if (from.toLowerCase().indexOf(me) !== -1) return;

      var payload = {
        threadId: thread.getId(),
        messageId: id,
        from: from,
        fromName: (from.match(/^\s*"?([^"<]+?)"?\s*</) || [])[1] || '',
        subject: msg.getSubject(),
        text: msg.getPlainBody().slice(0, 8000),
        listUnsubscribe: listUnsub,
        authOk: /dkim=pass|spf=pass/i.test(msg.getHeader('Authentication-Results') || msg.getHeader('ARC-Authentication-Results') || ''),
        knownSender: knownSender(from),
        attachmentNames: msg.getAttachments({ includeInlineImages: false }).map(function (a) { return a.getName(); }),
        attachments: attachmentsOf(msg),
      };
      var res = UrlFetchApp.fetch(appUrl + '/api/email', {
        method: 'post',
        contentType: 'application/json',
        headers: { Authorization: 'Bearer ' + token },
        payload: JSON.stringify(payload),
        muteHttpExceptions: true,
      });
      if (res.getResponseCode() !== 200) {
        console.warn('Deisi answered ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 300));
        return; // tried again in 5 minutes
      }
      var answer = JSON.parse(res.getContentText());
      if (answer.action === 'unsubscribe') {
        var method = unsubscribe(msg, listUnsub);
        thread.addLabel(label(LABEL_UNSUB));
        thread.markRead();
        thread.moveToArchive();
        UrlFetchApp.fetch(appUrl + '/api/email', {
          method: 'post',
          contentType: 'application/json',
          headers: { Authorization: 'Bearer ' + token },
          payload: JSON.stringify({ op: 'unsub', threadId: thread.getId(), method: method }),
          muteHttpExceptions: true,
        });
      } else if (answer.action === 'forward' && answer.to) {
        // invoices to the accountant (the app decided: sender confirmed by Gmail and known)
        msg.forward(answer.to);
        thread.addLabel(label(LABEL_FWD));
        thread.markRead();
      } else if (answer.action === 'handoff_mail') {
        thread.addLabel(label(LABEL_HUMAN));
      } else if (answer.action === 'draft' && answer.text) {
        msg.createDraftReply(answer.text);
        thread.addLabel(label(LABEL_DRAFT));
        if (answer.handoff) thread.addLabel(label(LABEL_HUMAN));
      } else {
        thread.addLabel(label(LABEL_SKIP));
      }
      seen[id] = Date.now();
    });
    // forget message ids older than 7 days
    Object.keys(seen).forEach(function (k) { if (Date.now() - seen[k] > 7 * 86400000) delete seen[k]; });
    props.setProperty('SEEN', JSON.stringify(seen));
  } finally {
    lock.releaseLock();
  }
}

/** A Gmail label, created when missing (new labels work without running setup again). */
function label(name) {
  return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
}

/** The sender wrote to us before (an older e-mail from the same address). */
function knownSender(from) {
  var addr = (String(from).match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/) || [''])[0];
  if (!addr) return false;
  return GmailApp.search('from:' + addr + ' older_than:2d', 0, 1).length > 0;
}

/**
 * Unsubscribes from a mailing list by its List-Unsubscribe header (RFC 2369 / 8058).
 * Returns how: one-click, mailto, link or none.
 */
function unsubscribe(msg, header) {
  var urls = (header.match(/<([^>]+)>/g) || []).map(function (u) { return u.slice(1, -1).trim(); });
  var http = urls.filter(function (u) { return /^https:\/\//i.test(u); })[0];
  var mailto = urls.filter(function (u) { return /^mailto:/i.test(u); })[0];
  var oneClick = /One-Click/i.test(msg.getHeader('List-Unsubscribe-Post') || '');
  try {
    if (http && oneClick) {
      var r = UrlFetchApp.fetch(http, { method: 'post', payload: 'List-Unsubscribe=One-Click', contentType: 'application/x-www-form-urlencoded', muteHttpExceptions: true, followRedirects: true });
      if (r.getResponseCode() < 400) return 'one-click';
    }
    if (mailto) {
      var m = mailto.replace(/^mailto:/i, '');
      var addr = decodeURIComponent(m.split('?')[0]);
      var q = m.indexOf('?') >= 0 ? m.slice(m.indexOf('?') + 1) : '';
      var subject = (q.match(/(?:^|&)subject=([^&]*)/i) || [])[1];
      var body = (q.match(/(?:^|&)body=([^&]*)/i) || [])[1];
      GmailApp.sendEmail(addr, subject ? decodeURIComponent(subject) : 'unsubscribe', body ? decodeURIComponent(body) : 'unsubscribe');
      return 'mailto';
    }
    if (http) {
      var g = UrlFetchApp.fetch(http, { method: 'get', muteHttpExceptions: true, followRedirects: true });
      if (g.getResponseCode() < 400) return 'link';
    }
  } catch (e) {
    console.warn('unsubscribe failed: ' + e);
  }
  return 'none';
}

/** Photos and PDFs up to 5 MB (at most 2) so Deisi can see a defect photo or a document. */
function attachmentsOf(msg) {
  var out = [];
  msg.getAttachments({ includeInlineImages: false }).forEach(function (a) {
    var type = a.getContentType();
    if (out.length >= 2 || a.getSize() > 5 * 1024 * 1024) return;
    if (!/^(image\/(jpeg|png|gif|webp)|application\/pdf)$/.test(type)) return;
    out.push({ name: a.getName(), type: type, data: Utilities.base64Encode(a.getBytes()) });
  });
  return out;
}

/**
 * Teach Deisi from our old e-mail answers (owner 05.11). Run once by hand ("Run" → learnFromSent).
 * Takes our sent replies of the last 2 years: the client's last message → our answer, and sends the pairs to /api/learn.
 * Contact data and health topics are filtered out on the server.
 */
function learnFromSent() {
  var props = PropertiesService.getScriptProperties();
  var appUrl = String(props.getProperty('APP_URL') || '').replace(/\/+$/, '');
  var token = props.getProperty('BRIDGE_TOKEN');
  var me = Session.getActiveUser().getEmail().toLowerCase();
  var pairs = [];
  for (var start = 0; start < 1000; start += 100) {
    var threads = GmailApp.search('in:sent newer_than:2y -category:promotions', start, 100);
    if (!threads.length) break;
    threads.forEach(function (t) {
      var msgs = t.getMessages();
      for (var i = 1; i < msgs.length; i++) {
        var ours = msgs[i].getFrom().toLowerCase().indexOf(me) >= 0;
        var prevTheirs = msgs[i - 1].getFrom().toLowerCase().indexOf(me) < 0;
        if (ours && prevTheirs) {
          pairs.push({
            id: msgs[i].getId(),
            question: stripQuote(msgs[i - 1].getPlainBody()).slice(0, 1500),
            answer: stripQuote(msgs[i].getPlainBody()).slice(0, 2500),
          });
        }
      }
    });
  }
  for (var k = 0; k < pairs.length; k += 50) {
    UrlFetchApp.fetch(appUrl + '/api/learn', {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + token },
      payload: JSON.stringify({ source: 'gmail', pairs: pairs.slice(k, k + 50) }),
      muteHttpExceptions: true,
    });
  }
  Logger.log('Sent ' + pairs.length + ' answers to Deisi');
}

/** The new text of an e-mail without the quoted older messages. */
function stripQuote(body) {
  var lines = String(body || '').split('\n');
  var out = [];
  for (var i = 0; i < lines.length; i++) {
    if (/^>/.test(lines[i]) || /^(On|Kuupäeval|В|Пн|Вт|Ср|Чт|Пт|Сб|Вс|E|T|K|N|R|L|P)\b.*(wrote|kirjutas|написал)/i.test(lines[i])) break;
    out.push(lines[i]);
  }
  return out.join('\n').trim();
}
