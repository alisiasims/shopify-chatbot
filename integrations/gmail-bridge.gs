/**
 * DEESSE shop - Gmail bridge for Deisi (Google Apps Script, runs in the info@deesse.ee Google account).
 *
 * Every 5 minutes it takes new unread customer e-mails from the inbox, asks the Deisi app
 * (POST /api/email) for an answer and saves the answer as a Gmail DRAFT reply in the same thread.
 * Nothing is sent automatically: a person opens the draft, checks it and presses Send.
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
var SEARCH = 'in:inbox is:unread newer_than:2d -category:promotions -category:social -category:forums';

function setup() {
  [LABEL_DRAFT, LABEL_SKIP, LABEL_HUMAN].forEach(function (name) {
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
    var threads = GmailApp.search(SEARCH, 0, 20);
    var started = Date.now();
    threads.forEach(function (thread) {
      if (Date.now() - started > 4 * 60 * 1000) return; // keep inside the 6-minute limit
      var msgs = thread.getMessages();
      var msg = msgs[msgs.length - 1];
      var id = msg.getId();
      if (seen[id] || !msg.isUnread()) return;
      var from = msg.getFrom();
      if (from.toLowerCase().indexOf(me) !== -1) return;

      var payload = {
        threadId: thread.getId(),
        messageId: id,
        from: from,
        fromName: (from.match(/^\s*"?([^"<]+?)"?\s*</) || [])[1] || '',
        subject: msg.getSubject(),
        text: msg.getPlainBody().slice(0, 8000),
        listUnsubscribe: msg.getHeader('List-Unsubscribe') || '',
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
      if (answer.action === 'draft' && answer.text) {
        msg.createDraftReply(answer.text);
        thread.addLabel(GmailApp.getUserLabelByName(LABEL_DRAFT));
        if (answer.handoff) thread.addLabel(GmailApp.getUserLabelByName(LABEL_HUMAN));
      } else {
        thread.addLabel(GmailApp.getUserLabelByName(LABEL_SKIP));
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
