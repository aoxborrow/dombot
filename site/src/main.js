// OS detection — highlight the matching download card and relabel the hero
// button. Best-effort; all platforms stay listed.
(function () {
  const ua = (navigator.userAgent || '') + ' ' + (navigator.platform || '');
  const os = /Mac|iPhone|iPad|iPod/i.test(ua)
    ? 'mac'
    : /Win/i.test(ua)
      ? 'win'
      : /Linux|Android|X11/i.test(ua)
        ? 'linux'
        : null;
  const label = { mac: 'Download for macOS', win: 'Download for Windows', linux: 'Download for Linux' };
  // How the app binary is spelled per platform (the stdio snippet shows the
  // gist, not the full install path — the app's Settings → MCP has that).
  const exe = { mac: 'DomBot.app', win: 'DomBot.exe', linux: 'dombot' };
  if (os) {
    const hl = document.getElementById('hero-dl-label');
    if (hl) hl.textContent = label[os];
    document.querySelectorAll('.dl-card[data-os="' + os + '"]').forEach(function (el) {
      el.classList.add('detected');
    });
    document.querySelectorAll('[data-stdio-exe]').forEach(function (el) {
      el.textContent = exe[os];
    });
    document.querySelectorAll('[data-stdio-copy]').forEach(function (el) {
      el.setAttribute('data-copy', exe[os] + ' --mcp-stdio');
    });
  }
})();

// Copy-to-clipboard buttons — flip to a check for a moment on success.
(function () {
  document.querySelectorAll('.copy-btn').forEach(function (btn) {
    let timer;
    btn.addEventListener('click', function () {
      const text = btn.getAttribute('data-copy') || '';
      const done = function () {
        btn.classList.add('copied');
        clearTimeout(timer);
        timer = setTimeout(function () { btn.classList.remove('copied'); }, 1600);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done).catch(function () {});
      } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); done(); } catch (e) {}
        document.body.removeChild(ta);
      }
    });
  });
})();
