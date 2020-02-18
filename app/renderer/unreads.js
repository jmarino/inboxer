const { ipcRenderer: ipc, remote } = require('electron');
const path = require('path');
const {
  $, $$, sendNotification, sendClick,
} = require('./utils');

const config = remote.require('../../app/main/config');

const seenMessages = new Map();

// global variables that will be filled with icon data from main process
var iconMail;
var iconSnoozed;
// receive icon data (base64 encoded string) from main process
ipc.on('notification-icons', function(event, icon1, icon2) {
    iconMail = icon1;
    iconSnoozed = icon2;
});


function keyByMessage({
  messageType, subject, sender, conversationLength,
}) {
  try {
    return JSON.stringify({
      messageType, subject, sender, conversationLength,
    });
  } catch (error) {
    console.error(error); // eslint-disable-line
    return undefined;
  }
}

function extractSubject(message) {
  return $('.y6 span span', message).textContent;
}

function extractSender(message) {
  return $('span.bA4', message).textContent;
}

function extractConversationLength(message) {
  const lenSpan = $('span.bx0', message);
  return (lenSpan) ? lenSpan.textContent : null;
}

// name of currently selected folder: Inbox, Sent, ...
function folderName() {
  const folder = $('div.TK div.aim.ain div.TO');
  return (folder) ? folder.getAttribute('data-tooltip') : null;
}

// extract number of unread messages in Inbox from the left column
// works even if we're not in Inbox
function extractNumberUnread() {
  // div.TK: left column, main folders
  // div.aim: each folder (Inbox, Starred, Sent, ...)
  // div.TO with data-tooltip="Inbox": Inbox folder
  // div.bsU: contains number of unread messages
  const numUnreadDiv = $('div.TK div.aim div.TO[data-tooltip="Inbox"] div.bsU');
  const numUnread = (numUnreadDiv) ? parseInt(numUnreadDiv.textContent, 10) : 0;
  return (Number.isNaN(numUnread)) ? 0 : numUnread;
}

// returns array of notifications: {message, title, body, icon}
function findUnreadSnoozedMessages() {
  // Apr 2020: gmail now places empty identical tables before or after the actual message table
  // Look for the first table that has any rows in it
  const messageTables = Array.from($$('div.Cp table.F')).filter((messageTable) => {
      const trs = $$('tr', messageTable);
      return trs.length > 0;
  });
  const messageTable = messageTables[0];
  if (messageTable === null) {
    return [];
  }
  const notifications = [];

  // mark already seen messages false
  seenMessages.forEach((value, key, map) => {
    map.set(key, false);
  });

  const notifyUnread = config.get('notify.unread');
  const notifySnoozed = config.get('notify.snoozed');
  // iterate through all messages (rows in table)
  $$('table.F > tbody > tr', messageTable).forEach((message) => {
    let messageType = null;
    if (message.className.includes('zA zE')) { // unread message  <tr class="zA zE ..." ...>
      messageType = 'unread';
    } else if ($('td.byZ div.by1', message) !== null) { // snoozed message
      messageType = 'snoozed';
    }

    if (messageType !== null) {
      const subject = extractSubject(message);
      const sender = extractSender(message);
      const conversationLength = extractConversationLength(message);
      const key = keyByMessage({
        messageType,
        subject,
        sender,
        conversationLength,
      });

      // if message hasn't been seen before, schedule notification
      if (!seenMessages.has(key)) {
        if ((messageType === 'unread' && notifyUnread)
            || (messageType === 'snoozed' && notifySnoozed)) {
          const icon = (messageType === 'unread') ? iconMail : iconSnoozed;
          notifications.push({
            message,
            title: sender,
            body: subject,
            icon: `data:image/src;base64,${icon}`,  // icon is base64 encoded string
          });
        }
      }
      seenMessages.set(key, true); // mark message as seen
    }
  });

  // delete any seenMessages still marked false
  seenMessages.forEach((value, key, map) => {
    if (value === false) {
      map.delete(key);
    }
  });

  return notifications;
}

function checkUnreads() {
  if (typeof checkUnreads.haveUnread === 'undefined') {
    checkUnreads.haveUnread = false;
  }

  let period = parseFloat(config.get('notify.period'), 10) * 1000; // convert seconds to milliseconds
  if (period < 100) {
    period = 100; // no faster than every 100 ms
  }

  const numUnread = extractNumberUnread();
  if (checkUnreads.haveUnread !== (numUnread > 0)) {
    ipc.send('update-unreads-count', numUnread);
    checkUnreads.haveUnread = (numUnread > 0);
  }

  // skip if we're not inside the inbox
  if (folderName() !== 'Inbox') {
    setTimeout(checkUnreads, period);
    return;
  }

  if (typeof checkUnreads.startingUp === 'undefined') {
    checkUnreads.startingUp = true;
  }

  // notifications for new unread or snoozed messages
  const notifications = findUnreadSnoozedMessages();
  if (!checkUnreads.startingUp) { // send notifications only if we're not just starting up
    notifications.reverse().forEach((notification) => {
      const {
        message, title, body, icon,
      } = notification;
      sendNotification({
        title,
        body,
        icon,
      }).addEventListener('click', () => {
        ipc.send('show-window', true);
        sendClick(message);
      });
    });
  }

  if (checkUnreads.startingUp) {
    checkUnreads.startingUp = false;
  }

  setTimeout(checkUnreads, period);
}

module.exports = checkUnreads;
