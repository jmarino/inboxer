const os = require('os');
const { app } = require('electron');

module.exports = `
<!-- Please succinctly describe your issue and steps to reproduce it. -->
---
${app.name} ${app.getVersion()}
Electron ${process.versions.electron}
${process.platform} ${process.arch} ${os.release()}`;
