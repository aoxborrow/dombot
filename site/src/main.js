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
  if (os) {
    const hl = document.getElementById('hero-dl-label');
    if (hl) hl.textContent = label[os];
    document.querySelectorAll('.dl-card[data-os="' + os + '"]').forEach(function (el) {
      el.classList.add('detected');
    });
  }
})();
