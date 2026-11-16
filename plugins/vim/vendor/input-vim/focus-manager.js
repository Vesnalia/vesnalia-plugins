(function () {
  'use strict';

  var Mode = window.InputVim.Mode;

  var _activeElement = null;
  var _recentFocusSteal = 0;
  var _deactivating = false;
  var _engine = null;
  var _overlay = null;
  var _getHandler = null;
  var _updateCursor = null;
  var _signal = null;
  var _preserveModeUntil = 0;

  function init(engine, overlay, getHandler, updateCursor, signal) {
    _engine = engine;
    _overlay = overlay;
    _getHandler = getHandler;
    _updateCursor = updateCursor;
    _signal = signal;

    document.addEventListener('focusin', function (e) {
      var el = e.composedPath ? e.composedPath()[0] : e.target;
      if (el === _activeElement) return;
      var ED = window.InputVim.ElementDetector;
      if (!ED.isVimTarget(el)) return;
      activate(el);
    }, { capture: true, signal: signal });

    document.addEventListener('mousedown', function () {
      _recentFocusSteal = Date.now();
    }, { capture: true, signal: signal });

    document.addEventListener('focusout', function (e) {
      var el = e.composedPath ? e.composedPath()[0] : e.target;
      if (el !== _activeElement) return;

      // deactivate() sets _deactivating before blurring — let that through
      if (_deactivating) return;

      // Some native actions briefly blur or rebuild the editor. Preserve its
      // mode and focus instead of treating that transition as a user blur.
      if (Date.now() < _preserveModeUntil) {
        var preservedTarget = _activeElement;
        setTimeout(function () {
          if ((_signal && _signal.aborted) || !preservedTarget || preservedTarget !== _activeElement) return;
          var focused = document.activeElement;
          var ED = window.InputVim.ElementDetector;
          if (focused && focused !== preservedTarget && ED.isVimTarget(focused)) return;
          if (preservedTarget.isConnected && focused !== preservedTarget) preservedTarget.focus();
        }, 0);
        return;
      }

      var EI = window.InputVim.EventInterceptor;

      // Clear transient commands, but keep the mode. Programmatic/window blur
      // must not behave like Escape; actual clicks still deactivate below.
      EI.clearTransientState();
      _engine.parser.reset();
      _overlay.updateCmd('');

      // User-initiated blur (Tab, Enter, click) — deactivate normally
      if (Date.now() - _recentFocusSteal <= 300) {
        deactivate();
        return;
      }

      // Re-focus unless the user clicked on another vim-target (let focusin handle it)
      var refocusEl = _activeElement;
      setTimeout(function () {
        if ((_signal && _signal.aborted) || !refocusEl || refocusEl !== _activeElement) return;
        var ED = window.InputVim.ElementDetector;
        var newFocus = document.activeElement;
        if (newFocus && newFocus !== refocusEl && ED.isVimTarget(newFocus)) return;
        if (document.activeElement !== refocusEl) {
          refocusEl.focus();
        }
      }, 0);
    }, { capture: true, signal: signal });
  }

  function clearElement(el) {
    if (!el) return;
    el.style.caretColor = '';
    el.removeAttribute('data-input-vim');
    var origType = el.getAttribute('data-input-vim-original-type');
    if (origType) {
      el.type = origType;
      el.removeAttribute('data-input-vim-original-type');
    }
  }

  function activate(el) {
    var Settings = window.InputVim.Settings;
    Settings.load(function () {
      if (!Settings.get('enabled') || Settings.isPageExcluded()) return;
      if (_activeElement && _activeElement !== el) clearElement(_activeElement);

      // Swap email inputs to text so selectionStart/selectionEnd work
      if (el.tagName === 'INPUT' && el.type.toLowerCase() === 'email') {
        el.setAttribute('data-input-vim-original-type', 'email');
        el.type = 'text';
      }

      var mode = Date.now() < _preserveModeUntil ? _engine.mode : Settings.getStartMode();
      _activeElement = el;
      el.setAttribute('data-input-vim', mode);
      _engine.setMode(mode);
      _engine.parser.reset();
      _overlay.show(mode, el);
      _updateCursor();
    });
  }

  function deactivate() {
    var el = _activeElement;
    clearElement(el);
    _overlay.hideCursor();
    _activeElement = null;
    _engine.setMode(Mode.NORMAL);
    _engine.parser.reset();
    window.InputVim.EventInterceptor.clearTransientState();
    _overlay.hide();
    // Blur after removing data-input-vim so the page-escape-blocker allows it.
    // _deactivating flag tells the focusout handler not to re-focus.
    _deactivating = true;
    if (el) el.blur();
    _deactivating = false;
  }

  function dispose() {
    clearElement(_activeElement);
    document.querySelectorAll('[data-input-vim]').forEach(clearElement);
    _overlay.hide();
    _activeElement = null;
  }

  function getActiveElement() {
    return _activeElement;
  }

  function markFocusSteal() {
    _preserveModeUntil = 0;
    _recentFocusSteal = Date.now();
  }

  function preserveModeForTransientBlur() {
    _preserveModeUntil = Date.now() + 500;
  }

  // Check for already-focused elements on page load
  function checkExistingFocus() {
    var el = document.activeElement;
    // Traverse into shadow roots to find the real focused element
    while (el && el.shadowRoot && el.shadowRoot.activeElement) {
      el = el.shadowRoot.activeElement;
    }
    var ED = window.InputVim.ElementDetector;
    if (el && ED.isVimTarget(el) && el !== _activeElement) {
      activate(el);
    }
  }

  window.InputVim = window.InputVim || {};
  window.InputVim.FocusManager = {
    init: init,
    activate: activate,
    deactivate: deactivate,
    dispose: dispose,
    getActiveElement: getActiveElement,
    markFocusSteal: markFocusSteal,
    preserveModeForTransientBlur: preserveModeForTransientBlur,
    checkExistingFocus: checkExistingFocus,
  };
})();
