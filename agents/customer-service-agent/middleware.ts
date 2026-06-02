// middleware.ts — security response headers for every route.
//
// Two tiers, so we harden the operator surface WITHOUT breaking the embeddable
// widget (which is meant to be framed on customer sites):
//   • Baseline (all routes): nosniff, referrer policy, HSTS in prod. These do not
//     affect embedding.
//   • Operator surface (/admin, /api/admin, /api/config, /api/tools,
//     /api/tool-credentials): additionally DENY framing + clickjacking — these must
//     never be embedded anywhere.
//
// The public chat surfaces (/api/chat, /api/session, /api/config GET, widget.js)
// stay frame-friendly on purpose.
import { NextResponse, type NextRequest } from 'next/server';

const OPERATOR_PREFIXES = ['/admin', '/api/admin', '/api/config', '/api/tools', '/api/tool-credentials'];

export function middleware(req: NextRequest): NextResponse {
  const res = NextResponse.next();
  // Baseline — safe for embedded + standalone alike.
  res.headers.set('X-Content-Type-Options', 'nosniff');
  res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.headers.set('X-DNS-Prefetch-Control', 'off');
  if (process.env.NODE_ENV === 'production') {
    res.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  }
  // Operator surface — clickjacking + framing lockdown.
  const path = req.nextUrl.pathname;
  if (OPERATOR_PREFIXES.some((p) => path === p || path.startsWith(p + '/'))) {
    res.headers.set('X-Frame-Options', 'DENY');
    res.headers.set('Content-Security-Policy', "frame-ancestors 'none'");
  }
  return res;
}

// Skip Next internals + static assets; the widget bundle (public/widget.js) is
// served as a static asset, so it stays embeddable (no frame headers applied).
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|widget.js).*)'],
};
