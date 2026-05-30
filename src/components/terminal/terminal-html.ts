/**
 * Terminal HTML for WebView
 *
 * xterm.js + xterm-addon-fit are vendored (src/components/terminal/xterm-vendor.ts)
 * and inlined here so the terminal works fully offline — the phone often only has
 * a LAN/Tailscale path to the desktop and cannot reach a CDN.
 * Regenerate the vendored bundle with: node scripts/vendor-xterm.mjs
 *
 * Bridge protocol:
 *   RN → WebView: window.handleOutput(data), window.handleResize(), window.handleTheme(colors)
 *   WebView → RN: postMessage({ type: 'input', data }) / { type: 'resize', cols, rows } / { type: 'ready' }
 */

import { XTERM_CSS, XTERM_JS, XTERM_FIT_JS } from './xterm-vendor'

export const terminalHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
  <style>${XTERM_CSS}</style>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body {
      width: 100%;
      height: 100%;
      overflow: hidden;
      background: #1f1d1a;
    }
    #terminal {
      width: 100%;
      height: 100%;
      overflow: hidden;
    }
    body.desktop-layout #terminal {
      overflow-x: auto;
    }
    body.desktop-layout .xterm {
      min-width: var(--terminal-width, 100%);
    }
    .xterm {
      padding: 4px;
    }
  </style>
</head>
<body>
  <div id="terminal"></div>

  <script>${XTERM_JS}</script>
  <script>${XTERM_FIT_JS}</script>
  <script>
    (function() {
      var term = new Terminal({
        fontSize: 13,
        fontFamily: '"SF Mono", "Menlo", "Monaco", "Courier New", monospace',
        cursorBlink: true,
        scrollback: 10000,
        convertEol: true,
        allowTransparency: true,
        scrollOnOutput: true,
        theme: {
          background: '#1f1d1a',
          foreground: '#dfdbc3',
          cursor: '#dfdbc3',
          selectionBackground: 'rgba(255,255,255,0.2)',
        },
      });

      var fitAddon = new FitAddon.FitAddon();
      term.loadAddon(fitAddon);
      var viewportState = { mode: 'desktop', cols: 100, rows: 30 };

      var container = document.getElementById('terminal');
      term.open(container);

      // Initial fit after short delay (wait for layout)
      setTimeout(function() {
        fitAddon.fit();
        sendResize();
      }, 100);

      // ---- WebView → RN: keyboard input ----
      term.onData(function(data) {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'input',
          data: data
        }));
      });

      // ---- RN → WebView: output data ----
      window.handleOutput = function(data) {
        term.write(data);
      };

      // ---- RN → WebView: wipe scrollback before a buffer re-replay ----
      window.clearTerminal = function() {
        term.reset();
      };

      // ---- RN → WebView: keep xterm cursor focus in sync with native keyboard proxy ----
      window.focusTerminal = function() {
        term.focus();
      };

      // ---- RN → WebView: trigger resize ----
      window.handleResize = function() {
        fitAddon.fit();
        sendResize();
      };

      var DESKTOP_FONT_SIZE = 13;

      // In mobile mode the column count is fixed, so shrink the font until every
      // column fits the screen width — otherwise long prompts/paths get clipped
      // off the right edge with no way to scroll to them.
      function applyMobileLayout() {
        container.style.setProperty('--terminal-width', '100%');
        var cols = viewportState.cols || term.cols || 56;
        var rows = viewportState.rows || term.rows || 24;
        var avail = (container.clientWidth || window.innerWidth || 0) - 8;
        var fontSize = DESKTOP_FONT_SIZE;
        if (avail > 0 && cols > 0) {
          fontSize = Math.max(6, Math.min(DESKTOP_FONT_SIZE, Math.floor(avail / (cols * 0.62))));
        }
        if (term.options.fontSize !== fontSize) {
          term.options.fontSize = fontSize;
        }
        term.resize(cols, rows);
        term.refresh(0, Math.max(0, term.rows - 1));
      }

      // ---- RN → WebView: shared desktop/mobile terminal viewport state ----
      window.handleViewportState = function(state) {
        if (!state) return;
        viewportState = {
          mode: state.mode || 'desktop',
          cols: state.cols || term.cols,
          rows: state.rows || term.rows
        };
        document.body.classList.toggle('mobile-layout', viewportState.mode === 'mobile');
        document.body.classList.toggle('desktop-layout', viewportState.mode !== 'mobile');
        if (viewportState.mode === 'mobile') {
          applyMobileLayout();
          return;
        }
        if (term.options.fontSize !== DESKTOP_FONT_SIZE) {
          term.options.fontSize = DESKTOP_FONT_SIZE;
        }
        var approxCellWidth = Math.max(7, Math.ceil((term.options.fontSize || 13) * 0.62));
        container.style.setProperty('--terminal-width', ((viewportState.cols * approxCellWidth) + 16) + 'px');
        if (viewportState.cols > 0 && viewportState.rows > 0) {
          term.resize(viewportState.cols, viewportState.rows);
          term.refresh(0, Math.max(0, term.rows - 1));
        }
      };

      // ---- RN → WebView: change theme ----
      window.handleTheme = function(colors) {
        term.options.theme = colors;
      };

      // ---- RN → WebView: set font size ----
      window.handleFontSize = function(size) {
        term.options.fontSize = size;
        if (viewportState.mode === 'mobile') {
          applyMobileLayout();
        } else {
          fitAddon.fit();
        }
        sendResize();
      };

      // ---- Resize observer ----
      function sendResize() {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'resize',
          cols: term.cols,
          rows: term.rows
        }));
      }

      var ro = new ResizeObserver(function() {
        if (viewportState.mode === 'mobile') {
          applyMobileLayout();
        } else {
          fitAddon.fit();
        }
        sendResize();
      });
      ro.observe(container);

      // ---- Ready signal ----
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'ready' }));
    })();
  </script>
</body>
</html>
`
