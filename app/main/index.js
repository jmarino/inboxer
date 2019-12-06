const fs = require('fs');
const path = require('path');
const {
  app, BrowserWindow, Menu, shell, ipcMain, nativeImage, Notification, dialog,
} = require('electron');
const log = require('electron-log');
const isDev = require('electron-is-dev');
const { autoUpdater } = require('electron-updater');
const minimatch = require('minimatch-all');
const electronDL = require('electron-dl');
const { isDarwin, isLinux, isWindows } = require('./utils');
const config = require('./config');
const appMenu = require('./menu');
const appTray = require('./tray');

app.setAppUserModelId('com.denysdovhan.inboxer');

require('electron-context-menu')();

const mainURL = 'https://mail.google.com/';

// gmail logo from https://gsuite.google.com/setup/resources/logos/
const iconMailFile = path.join(__dirname, '..', 'static/gmail_48px.png');
// snoozed logo copied from Inboxer
const iconSnoozedFile = path.join(__dirname, '..', 'static/IconSnoozed.png');

let mainWindow;
let isQuitting = false;
let prevUnreadCount = 0;

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
  process.exit();
}

function allowedUrl(url) {
  const urls = [
    'https://accounts.google.com/@(u|AccountChooser|AddSession|ServiceLogin|CheckCookie|Logout){**/**,**}',
    'https://accounts.google.com/signin/@(usernamerecovery|recovery|challenge|selectchallenge){**/**,**}',
    'http://www.google.*/accounts/Logout2**',
    'https://www.google.com/a/**/acs',
    'https://**.okta.com/**',
    'https://google.*/accounts/**',
    'https://www.google.**/accounts/signin/continue**',
    'https://mail.google.com/**',
    'https://drive.google.com/**',
    'https://docs.google.com/**',
    'https://www.google.com/calendar**',
    'https://sites.google.com/**',
    'https://chat.google.com/**',
    'https://contacts.google.com/**',
    path.join('file://', __dirname, '../renderer/preferences**'),
  ];

  return minimatch(url, urls);
}

// Inform the user about Google's plan to discontinue Inbox
function showMigrationDialog(win) {
  if (config.get('displayMigrationInfo') === 'no >1.3.0') { // indicates dialog was dismissed from version >1.3.0
    return;
  }

  const message = 'This version of Inboxer has been migrated to use Gmail';
  const detail = `Inboxer was originally developed to provide a view of Google's Inbox packaged \
in a desktop app. However, Google has announced plans to discontinue Inbox at the end of March 2019.
See Google's official announcement here:
https://www.blog.google/products/gmail/inbox-signing-find-your-favorite-features-new-gmail/

Versions >= 1.3.0 have been migrated from Inbox to Gmail to ensure Inboxer continues \
to work after Google pulls the plug on Inbox.
Versions 1.2.x will continue working with Inbox until the bitter end.`;

  dialog.showMessageBox(win, {
    type: 'info',
    icon: nativeImage.createFromPath(path.join(__dirname, '..', 'static/Icon.png')),
    title: 'Important Message',
    message,
    detail,
    checkboxLabel: 'Show this window again',
    checkboxChecked: true,
    buttons: ['Ok'],
    defaultId: 0,
  }, (response, checkBoxChecked) => {
    if (!checkBoxChecked) {
      config.set('displayMigrationInfo', 'no >1.3.0');
    }
  });
}

function createMainWindow() {
  const windowState = config.get('windowState');

  const win = new BrowserWindow({
    show: false, // Hide application until your page has loaded
    title: app.name,
    x: windowState.x,
    y: windowState.y,
    width: windowState.width,
    height: windowState.height,
    minWidth: 890,
    minHeight: 400,
    alwaysOnTop: config.get('alwaysOnTop'),
    autoHideMenuBar: config.get('autoHideMenuBar'),
    backgroundColor: '#f2f2f2',
    icon: path.join(__dirname, '..', 'static/Icon.png'),
    titleBarStyle: 'hidden-inset',
    webPreferences: {
      preload: path.join(__dirname, '..', 'renderer', 'browser.js'),
      nodeIntegration: false,
    },
  });

  if (isDarwin) {
    win.setSheetOffset(40);
  }

  win.loadURL(mainURL);

  // Show window after loading the DOM
  // Docs: https://electronjs.org/docs/api/browser-window#showing-window-gracefully
  win.once('ready-to-show', () => {
    win.show();
    showMigrationDialog(win);
  });

  win.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();

      if (isDarwin) {
        app.hide();
      } else {
        win.hide();
      }
    }
  });

  return win;
}

// function to encode file data to base64 encoded string
function base64_encode(file) {
    // read binary data
    var bitmap = fs.readFileSync(file);
    // convert binary data to base64 encoded string
    return Buffer.from(bitmap).toString('base64');
}

app.on('ready', () => {
  Menu.setApplicationMenu(appMenu);
  mainWindow = createMainWindow();
  appTray.create(mainWindow);

  if (!isDev && !isLinux) {
    autoUpdater.logger = log;
    autoUpdater.logger.transports.file.level = 'info';
    autoUpdater.checkForUpdatesAndNotify();
  }

  const { webContents } = mainWindow;

  webContents.on('dom-ready', () => {
    webContents.insertCSS(fs.readFileSync(path.join(__dirname, '../renderer/browser.css'), 'utf8'));
    // encode notification icons as base64 encoded strings and send them to renderer process
    iconMail = base64_encode(iconMailFile);
    iconSnoozed = base64_encode(iconSnoozedFile);
    mainWindow.webContents.send('notification-icons', iconMail, iconSnoozed);
  });

  webContents.on('will-navigate', (e, url) => {
    if (!allowedUrl(url)) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });

  webContents.on('new-window', (e, url) => {
    e.preventDefault();
    if (allowedUrl(url)) {
      webContents.loadURL(url);
      return;
    }
    shell.openExternal(url);
  });
});

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    if (!mainWindow.isVisible()) {
      mainWindow.show();
    }
    mainWindow.focus();
  }
});

app.on('activate', () => {
  mainWindow.show();
});

app.on('before-quit', () => {
  isQuitting = true;

  if (!mainWindow.isFullScreen()) {
    config.set('windowState', mainWindow.getBounds());
  }
});

ipcMain.on('update-unreads-count', (e, unreadCount) => {
  if (isDarwin || isLinux) {
    let isUpdated = false;
    if (config.get('showUnreadBadge')) {
      app.badgeCount = unreadCount;
      isUpdated = true;
    } else {
      app.badgeCount = 0;
      isUpdated = false;
    }
    if (isDarwin && config.get('bounceDockIcon') && prevUnreadCount !== unreadCount && isUpdated) {
      app.dock.bounce('informational');
      prevUnreadCount = unreadCount;
    }
  }

  if ((isLinux || isWindows) && config.get('showUnreadBadge')) {
    appTray.setBadge(unreadCount);
  } else if ((isLinux || isWindows)) {
    appTray.setBadge(false);
  }

  if (isWindows) {
    if (config.get('showUnreadBadge')) {
      if (unreadCount === 0) {
        mainWindow.setOverlayIcon(null, '');
      } else {
        // Delegate drawing of overlay icon to renderer process
        mainWindow.webContents.send('render-overlay-icon', unreadCount);
      }
    } else {
      mainWindow.setOverlayIcon(null, '');
    }

    if (config.get('flashWindowOnMessage')) {
      mainWindow.flashFrame(unreadCount !== 0);
    }
  }
});

ipcMain.on('update-overlay-icon', (e, image, count) => {
  mainWindow.setOverlayIcon(nativeImage.createFromDataURL(image), count);
});

ipcMain.on('show-window', () => {
  mainWindow.show();
});

function downloadStarted(downloadItem) {
  if (!config.get('notify.download')) {
    return;
  }
  downloadItem.on('done', (event, state) => { // notify user on download complete
    if (state === 'completed') {
      const filename = downloadItem.getSavePath();
      const notification = new Notification({
        title: 'Download Complete',
        body: filename,
      });
      notification.on('click', () => {
        shell.showItemInFolder(filename);
      });
      notification.show();
    }
  });
}
electronDL({ onStarted: downloadStarted });
