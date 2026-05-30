'use client';

import { useEffect } from 'react';

// Bridges the iframe-embedded widget to its host page: posts {open} whenever the
// panel (role=dialog) appears/disappears so the host can resize the iframe to fit
// (small for the launcher, large for the open panel). Non-invasive — observes the
// DOM rather than modifying AskGuruWidget.
export function EmbedBridge() {
  useEffect(() => {
    const post = () => {
      const open = Boolean(document.querySelector('[role="dialog"]'));
      try {
        window.parent.postMessage({ __askguru: true, open }, '*');
      } catch {
        /* cross-origin parent — ignore */
      }
    };
    const obs = new MutationObserver(post);
    obs.observe(document.body, { childList: true, subtree: true });
    post();
    return () => obs.disconnect();
  }, []);
  return null;
}
