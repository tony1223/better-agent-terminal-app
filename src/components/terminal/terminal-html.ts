/**
 * Terminal HTML for WebView
 *
 * This embeds xterm.js via CDN (for simplicity).
 * For offline support, bundle xterm.js files and use source={{ uri }} with local assets.
 *
 * Bridge protocol:
 *   RN → WebView: window.handleOutput(data), window.handleResize(), window.handleTheme(colors)
 *   WebView → RN: postMessage({ type: 'input', data }) / { type: 'resize', cols, rows } / { type: 'ready' }
 */

export const terminalHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/xterm@5.3.0/css/xterm.min.css">
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
    }
    .xterm {
      padding: 4px;
    }
  </style>
</head>
<body>
  <div id="terminal"></div>

  <script src="https://cdn.jsdelivr.net/npm/xterm@5.3.0/lib/xterm.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/xterm-addon-fit@0.8.0/lib/xterm-addon-fit.min.js"></script>
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

      // ---- RN → WebView: trigger resize ----
      window.handleResize = function() {
        fitAddon.fit();
        sendResize();
      };

      // ---- RN → WebView: change theme ----
      window.handleTheme = function(colors) {
        term.options.theme = colors;
      };

      // ---- RN → WebView: set font size ----
      window.handleFontSize = function(size) {
        term.options.fontSize = size;
        fitAddon.fit();
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
        fitAddon.fit();
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
