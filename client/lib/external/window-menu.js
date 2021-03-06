'use strict';

var browser = require('util/browser');

var ShortcutsFix = require('./shortcuts-fix');

var debug = require('debug')('window-menu');


/**
 * Application Window Menu integration
 */
function WindowMenu(app) {

  this.fix = new ShortcutsFix(app);

  // Updating Menu
  app.on('tools:state-changed', (tab, state) => {
    debug('Notifying menu about client state change', state);

    // fix for Ctrl+A shortcut that does not work reliably on Windows And Linux
    if (!isMac()) {
      state.bpmn ? this.fix.bind() : this.fix.unbind();
    }

    browser.send('menu:update', state);
  });


  // Listening on menu actions
  browser.on('menu:action', function(err, action, options) {
    debug('Received action from menu: ' + action, options);

    app.triggerAction(action, options);
  });

}

module.exports = WindowMenu;

function isMac() {
  return window.navigator.platform === 'MacIntel';
}