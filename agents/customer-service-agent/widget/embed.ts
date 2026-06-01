// widget/embed.ts — one-tag embed for the 1:1 Ask AI Guru widget.
//
//   <script src="https://YOUR-DEPLOY/widget.js"></script>
//
// Injects a bottom-right iframe loading /ask (the exact AskGuruWidget). The iframe
// resizes between launcher-size (closed) and panel-size (open) via postMessage from
// the embedded page, so the host page stays clickable everywhere else.
//
// Personalization (optional, vendor-neutral):
//   • Deploy SAME-SITE (e.g. support.acme.com, cookie scoped to .acme.com) and the
//     widget reads your login cookie server-side — nothing to wire here.
//   • CROSS-ORIGIN? Hand the widget a signed identity token (a JWT your app mints
//     for the logged-in user). Browsers block third-party cookies, so this is the
//     standard way. Two ways to provide it, both dependency-free:
//        <script src=".../widget.js" data-identity-token="<jwt>"></script>
//     or, for SPAs that learn the user after load:
//        window.AskGuru.identify('<jwt>')   // call again with '' to sign out
//   The token is forwarded into the iframe and verified SERVER-SIDE (IDENTITY_MODE=jwt).
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

  // Forward an optional identity token to the iframe (targeted to the agent's own
  // origin, never '*'). Re-sent on every iframe load so it survives reloads.
  let identityToken: string | null = script?.getAttribute('data-identity-token') || null;
  const pushIdentity = () => {
    try {
      iframe.contentWindow?.postMessage({ __askguru_identity: identityToken }, base);
    } catch {
      /* iframe not ready yet — the load handler will retry */
    }
  };
  iframe.addEventListener('load', pushIdentity);
  (window as unknown as { AskGuru?: { identify(t: string | null): void } }).AskGuru = {
    identify(t: string | null) {
      identityToken = t || null;
      pushIdentity();
    },
  };

  window.addEventListener('message', (e: MessageEvent) => {
    const d = e.data as { __askguru?: boolean; open?: boolean } | undefined;
    if (!d || !d.__askguru) return;
    if (d.open) {
      // > 640px so the widget renders its DESKTOP floating-card layout (not the
      // mobile sheet); the card sits at the iframe's bottom-right corner.
      iframe.style.width = 'min(720px, 100vw)';
      iframe.style.height = 'min(88vh, 760px)';
    } else {
      iframe.style.width = '248px';
      iframe.style.height = '96px';
    }
  });
})();
