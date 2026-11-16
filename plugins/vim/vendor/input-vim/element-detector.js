(function () {
  'use strict';

  var InputHandler = window.InputVim.InputHandler;
  var ContentEditableHandler = window.InputVim.ContentEditableHandler;

  var inputHandler = new InputHandler();
  var ceHandler = new ContentEditableHandler();

  function isExcluded(el) {
    return !el || !!el.closest('.xterm, [data-terminal], [role="terminal"], [data-alia-vim-ignore]');
  }

  function isTextInput(el) {
    if (isExcluded(el) || el.readOnly || el.disabled) return false;
    if (el.tagName === 'TEXTAREA') return true;
    // Single-line inputs are usually search, navigation, titles, or settings—not
    // editors. Plugins can explicitly opt one in when it really is an editor.
    return el.tagName === 'INPUT' && !!el.closest('[data-alia-vim-editor]');
  }

  function isContentEditable(el) {
    if (isExcluded(el)) return false;
    return el.isContentEditable === true;
  }

  function isVimTarget(el) {
    return isTextInput(el) || isContentEditable(el);
  }

  function getHandler(el) {
    if (isTextInput(el)) return inputHandler;
    if (isContentEditable(el)) return ceHandler;
    return null;
  }

  window.InputVim = window.InputVim || {};
  window.InputVim.ElementDetector = {
    isTextInput: isTextInput,
    isContentEditable: isContentEditable,
    isVimTarget: isVimTarget,
    getHandler: getHandler,
  };
})();
