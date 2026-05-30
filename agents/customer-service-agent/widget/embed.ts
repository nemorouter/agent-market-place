// widget/embed.ts — one-tag embed for the 1:1 Ask AI Guru widget.
//
//   <script src="https://YOUR-DEPLOY/widget.js"></script>
//
// Injects a bottom-right iframe loading /ask (the exact AskGuruWidget). The iframe
// resizes between launcher-size (closed) and panel-size (open) via postMessage from
// the embedded page, so the host page stays clickable everywhere else.
(function () {
  const script = document.currentScript as HTMLScriptElement | null;
  const base = new URL(script?.src || window.location.href).origin;

  const iframe = document.createElement('iframe');
  iframe.src = base + '/ask';
  iframe.title = 'Ask AI Guru';
  iframe.setAttribute('allow', 'microphone');
  iframe.setAttribute('allowtransparency', 'true');
  iframe.style.cssText =
    'position:fixed;bottom:0;right:0;width:248px;height:96px;border:0;background:transparent;' +
    'z-index:2147483647;transition:width .18s ease,height .18s ease;color-scheme:light';
  document.body.appendChild(iframe);

  window.addEventListener('message', (e: MessageEvent) => {
    const d = e.data as { __askguru?: boolean; open?: boolean } | undefined;
    if (!d || !d.__askguru) return;
    if (d.open) {
      iframe.style.width = 'min(456px, 100vw)';
      iframe.style.height = 'min(86vh, 712px)';
    } else {
      iframe.style.width = '248px';
      iframe.style.height = '96px';
    }
  });
})();
