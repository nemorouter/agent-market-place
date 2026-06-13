# Dashboard & onboarding troubleshooting

Help for issues people hit inside the signed-in Nemo Router dashboard. These pages
live behind login, so they aren't part of the public site — this doc is the agent's
knowledge of them. When the visitor's current page is provided (e.g. `/onboarding`),
prefer the matching section below.

## "We could not finish setting up your account automatically" (onboarding)

This appears on `/onboarding` (Step 1 — Set Up Team) when the automatic
account-setup step didn't finish. **It is a temporary server-side hiccup, not a
problem with the visitor's browser.** Their signup details are saved.

What to tell the visitor, in order:

1. **Click "Try again"** on the page. This re-runs the setup and resolves most cases.
2. If it keeps failing after a couple of tries, **click "Email support"** (or email
   **support@nemorouter.ai**) — we finish the setup manually. Their account and any
   signup details are safe; nothing was lost.

Do **not** tell the visitor to clear cookies, log out, or use a private/incognito
window for this error — it's a backend setup step, so those steps don't help and
just add friction. Reassure them their progress is saved and the team will complete
setup if "Try again" doesn't.

## A dashboard page is blank, stuck loading, or shows a spinner forever

This is more likely a client-side/session issue. Reasonable steps:

1. **Refresh the page.**
2. If still stuck, **sign out and sign back in** at https://nemorouter.ai/login.
3. If it persists, a hard refresh or a private/incognito window can rule out a stale
   cached bundle. If none of that works, email **support@nemorouter.ai** with the page
   URL and roughly when it happened.

## Can't sign in / stuck in a login loop

1. Use **"Use a password instead"** on the login screen if a magic link isn't arriving.
2. Check the spam/Promotions folder for the sign-in email.
3. Password resets are at https://nemorouter.ai/login → "Forgot password".
4. Still blocked → email **support@nemorouter.ai**.

## Where things live in the dashboard

- **Keys** — create and manage `sk-nemo-` virtual keys (the full key is shown once at
  creation). Set a per-key budget here to cap spend.
- **Onboarding** — the 3-step first-run flow: Set Up Team → Create Key → Invite Team.
- **Playground** — test a model in-browser; paste your own `sk-nemo-` key.
- **Billing / Credits** — buy credits and view invoices; requests draw down credits.
- **Teams / People** — invite members and manage roles (Owner, Admin, Member, Viewer).

When you don't know the answer, say so plainly and point the visitor to
https://nemorouter.ai/docs or **support@nemorouter.ai** — never invent dashboard
behavior.
