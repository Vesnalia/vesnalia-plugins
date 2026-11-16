(function () {
  'use strict';

  var Mode = window.InputVim.Mode;
  var Register = window.InputVim.Register;

  // VesnALIA owns plugin enablement, so the browser-extension storage layer is omitted.
  var values = {
    enabled: true,
    startMode: 'INSERT',
    matchBrackets: false,
    tabSize: 4,
    indentMode: 'smart',
    useClipboard: true,
    highlightYank: true,
    halfPageJump: 20,
    alwaysCentered: false,
    lineNumbers: 'off',
  };

  Register.setUseClipboard(values.useClipboard);

  window.InputVim.Settings = {
    DEFAULTS: values,
    load: function (callback) { if (callback) callback(values); },
    get: function (key) { return values[key]; },
    getStartMode: function () { return values.startMode === 'NORMAL' ? Mode.NORMAL : Mode.INSERT; },
    isPageExcluded: function () { return false; },
    onChange: function () {},
  };
})();
