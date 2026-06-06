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

  // Track open state so an orientation change / resize can re-apply the right size
  // (e.g. rotating a phone, or crossing the mobile↔desktop breakpoint while open).
  let isOpen = false;
  const isMobile = () => window.matchMedia('(max-width: 639px)').matches;

  const sizeIframe = () => {
    // Mobile open/close is INSTANT — animating width/height to full-screen reflows
    // the embedded page every frame (janky, feels slow). Desktop keeps the quiet
    // .18s card resize where the size delta is small.
    iframe.style.transition = isMobile() ? 'none' : 'width .18s ease, height .18s ease';
    if (!isOpen) {
      // Launcher pill — small, bottom-right, host page fully usable.
      iframe.style.inset = 'auto 0 0 auto';
      iframe.style.width = '248px';
      iframe.style.height = '96px';
      return;
    }
    if (isMobile()) {
      // MOBILE → TRUE full screen: cover the whole site so the widget reads as a
      // full app, not a partial card. The in-iframe panel is inset-0 with a clear
      // Close that shrinks this iframe back to the launcher (returns to the site).
      // 100dvh (with 100vh fallback) tracks the mobile URL-bar collapse correctly.
      iframe.style.inset = '0';
      iframe.style.width = '100vw';
      iframe.style.height = '100vh';
      iframe.style.height = '100dvh';
    } else {
      // DESKTOP → floating card anchored bottom-right (the widget renders its card
      // layout because the iframe is wider than its 640px mobile breakpoint).
      iframe.style.inset = 'auto 0 0 auto';
      iframe.style.width = 'min(720px, 100vw)';
      iframe.style.height = 'min(88vh, 760px)';
    }
  };

  window.addEventListener('message', (e: MessageEvent) => {
    const d = e.data as { __askguru?: boolean; open?: boolean } | undefined;
    if (!d || !d.__askguru) return;
    isOpen = Boolean(d.open);
    sizeIframe();
  });
  // Re-apply on viewport changes so rotation / resize keeps full-screen correct.
  window.addEventListener('resize', sizeIframe);
  window.addEventListener('orientationchange', sizeIframe);
})();
