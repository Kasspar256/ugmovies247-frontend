const STARTUP_RECOVERY_SCRIPT = `
(function () {
  var APP_USER_AGENT_TOKEN = 'Ugmovies247App';
  var SW_CLEAN_KEY = 'ugmovies247.native-sw-clean.v2';
  var CHUNK_RETRY_KEY = 'ugmovies247.chunk-retry.v2';
  var RECOVERY_SHOWN_KEY = 'ugmovies247.recovery-shown.v1';

  function isNativeApp() {
    var ua = '';

    try {
      ua = window.navigator && window.navigator.userAgent ? window.navigator.userAgent : '';
    } catch (error) {
      ua = '';
    }

    return ua.indexOf(APP_USER_AGENT_TOKEN) !== -1 || Boolean(window.Capacitor);
  }

  function getChromeMajorVersion() {
    var ua = '';
    var match = null;

    try {
      ua = window.navigator && window.navigator.userAgent ? window.navigator.userAgent : '';
      match = ua.match(/(?:Chrome|CriOS)\\/([0-9]+)/);
    } catch (error) {
      return 0;
    }

    return match && match[1] ? Number(match[1]) || 0 : 0;
  }

  function safeSessionGet(key) {
    try {
      return window.sessionStorage ? window.sessionStorage.getItem(key) : '';
    } catch (error) {
      return '';
    }
  }

  function safeSessionSet(key, value) {
    try {
      if (window.sessionStorage) window.sessionStorage.setItem(key, value);
    } catch (error) {}
  }

  function safeLocalGet(key) {
    try {
      return window.localStorage ? window.localStorage.getItem(key) : '';
    } catch (error) {
      return '';
    }
  }

  function safeLocalSet(key, value) {
    try {
      if (window.localStorage) window.localStorage.setItem(key, value);
    } catch (error) {}
  }

  function clearShellCaches() {
    var tasks = [];

    if (window.navigator && navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
      tasks.push(
        navigator.serviceWorker
          .getRegistrations()
          .then(function (registrations) {
            return Promise.all(
              registrations.map(function (registration) {
                return registration.unregister().catch(function () {});
              })
            );
          })
          .catch(function () {})
      );
    }

    if (window.caches && window.caches.keys) {
      tasks.push(
        caches
          .keys()
          .then(function (keys) {
            return Promise.all(
              keys
                .filter(function (key) {
                  return key.indexOf('ugmovies247-') === 0;
                })
                .map(function (key) {
                  return caches.delete(key).catch(function () {});
                })
            );
          })
          .catch(function () {})
      );
    }

    return Promise.all(tasks).catch(function () {});
  }

  function reportStartupError(message, source) {
    try {
      var payload = JSON.stringify({
        message: String(message || '').slice(0, 700),
        source: String(source || 'startup').slice(0, 80),
        path: window.location ? window.location.pathname : '',
        userAgent: navigator && navigator.userAgent ? navigator.userAgent : '',
        at: new Date().toISOString()
      });

      if (navigator && navigator.sendBeacon) {
        navigator.sendBeacon('/api/client-errors', new Blob([payload], { type: 'application/json' }));
        return;
      }

      fetch('/api/client-errors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        keepalive: true
      }).catch(function () {});
    } catch (error) {}
  }

  function showRecovery(message) {
    if (!document.body) {
      window.setTimeout(function () {
        showRecovery(message);
      }, 60);
      return;
    }

    if (safeSessionGet(RECOVERY_SHOWN_KEY) === '1') return;
    safeSessionSet(RECOVERY_SHOWN_KEY, '1');

    var text = String(message || 'The app had trouble starting on this device.');
    var markup =
      '<main style="min-height:100vh;margin:0;background:#0B0C10;color:#fff;display:grid;place-items:center;padding:24px;font-family:system-ui,-apple-system,Segoe UI,sans-serif;text-align:center">' +
      '<section style="width:min(100%,430px)">' +
      '<img src="/siteicon.png" alt="" style="width:88px;height:88px;object-fit:contain;margin:0 auto 24px;display:block;border-radius:24px">' +
      '<div style="display:inline-flex;border:1px solid rgba(255,255,255,.14);border-radius:999px;padding:8px 13px;color:rgba(255,255,255,.72);font-size:11px;font-weight:900;letter-spacing:.18em;text-transform:uppercase">App Recovery</div>' +
      '<h1 style="margin:20px 0 0;font-size:34px;line-height:1;font-weight:900;letter-spacing:0">Let us restart cleanly</h1>' +
      '<p style="margin:16px auto 0;color:rgba(255,255,255,.68);font-size:15px;line-height:1.7;max-width:350px">UGMOVIES247 hit a startup problem on this phone. Clear the app cache below and reopen so your account can continue safely.</p>' +
      '<p style="margin:12px auto 0;color:rgba(255,255,255,.38);font-size:12px;line-height:1.5;max-width:350px">' +
      text.replace(/[<>&]/g, '') +
      '</p>' +
      '<button id="ugm-recovery-retry" style="margin-top:24px;width:100%;min-height:54px;border:0;border-radius:18px;background:#D90429;color:#fff;font-size:13px;font-weight:900;letter-spacing:.14em;text-transform:uppercase">Clear Cache and Restart</button>' +
      '<a href="https://ugmovies247.com/browse?fresh=1" style="margin-top:12px;width:100%;min-height:54px;border:1px solid rgba(255,255,255,.12);border-radius:18px;background:rgba(255,255,255,.06);color:#fff;font-size:13px;font-weight:900;letter-spacing:.14em;text-transform:uppercase;text-decoration:none;display:flex;align-items:center;justify-content:center">Open Web Version</a>' +
      '</section>' +
      '</main>';

    try {
      document.documentElement.style.background = '#0B0C10';
      document.body.innerHTML = markup;
      document.getElementById('ugm-recovery-retry').onclick = function () {
        safeSessionSet(RECOVERY_SHOWN_KEY, '');
        clearShellCaches().then(function () {
          window.location.replace('/browse?fresh=1&recovered=1&t=' + Date.now());
        });
      };
    } catch (error) {}
  }

  function isChunkOrStartupError(message) {
    return /ChunkLoadError|Loading chunk|Loading CSS chunk|dynamically imported module|module script|Failed to fetch|Load failed|Unexpected token|Application error/i.test(
      String(message || '')
    );
  }

  function handleFatal(message, source) {
    reportStartupError(message, source);

    if (!isChunkOrStartupError(message)) {
      return;
    }

    if (safeSessionGet(CHUNK_RETRY_KEY) !== '1') {
      safeSessionSet(CHUNK_RETRY_KEY, '1');
      clearShellCaches().then(function () {
        var separator = window.location.search ? '&' : '?';
        window.location.replace(window.location.pathname + window.location.search + separator + 'recoverReload=' + Date.now());
      });
      return;
    }

    window.setTimeout(function () {
      showRecovery(message);
    }, 120);
  }

  if (isNativeApp() && safeLocalGet(SW_CLEAN_KEY) !== '1') {
    safeLocalSet(SW_CLEAN_KEY, '1');
    clearShellCaches().then(function () {
      if (safeSessionGet(CHUNK_RETRY_KEY) !== '1') {
        safeSessionSet(CHUNK_RETRY_KEY, '1');
        window.location.replace('/browse?fresh=1&nativeClean=1');
      }
    });
  }

  if (isNativeApp()) {
    var chromeMajor = getChromeMajorVersion();

    if (chromeMajor > 0 && chromeMajor < 90) {
      reportStartupError('Legacy Android WebView detected: Chrome ' + chromeMajor, 'legacy-webview');
      window.setTimeout(function () {
        showRecovery(
          'This phone is using an old Android WebView/Chrome engine. Please update Android System WebView or Chrome from Play Store, then reopen UGMOVIES247.'
        );
      }, 250);
    }
  }

  window.addEventListener(
    'error',
    function (event) {
      if (event && event.target && event.target !== window) return;
      handleFatal((event && (event.message || (event.error && event.error.message))) || 'Client startup error', 'error');
    },
    true
  );

  window.addEventListener('unhandledrejection', function (event) {
    var reason = event && event.reason;
    handleFatal((reason && (reason.message || reason.toString && reason.toString())) || 'Unhandled startup promise rejection', 'promise');
  });

  var scans = 0;
  var scanTimer = window.setInterval(function () {
    scans += 1;
    try {
      var bodyText = document.body && document.body.innerText ? document.body.innerText : '';
      if (bodyText.indexOf('Application error: a client-side exception has occurred') !== -1) {
        window.clearInterval(scanTimer);
        reportStartupError('Application error screen reached startup.', 'screen-scan');
      }
    } catch (error) {}

    if (scans > 20) {
      window.clearInterval(scanTimer);
    }
  }, 500);
})();
`;

export default function StartupRecoveryScript() {
  return <script dangerouslySetInnerHTML={{ __html: STARTUP_RECOVERY_SCRIPT }} />;
}
