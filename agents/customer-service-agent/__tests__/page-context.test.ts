import { describe, it, expect } from 'vitest';
import { sanitizePageContext } from '../lib/security';

// The widget tells the agent which page the visitor is on (e.g. /onboarding) so it
// can give page-aware help. The value comes from the BROWSER, so it is untrusted:
// we keep the pathname ONLY (never query/hash — they can carry tokens/PII), bound
// the length, and strip anything that could break out into the prompt.
describe('sanitizePageContext', () => {
  it('keeps a clean pathname as-is', () => {
    expect(sanitizePageContext('/onboarding')).toBe('/onboarding');
    expect(sanitizePageContext('/account/billing')).toBe('/account/billing');
  });

  it('strips the query string (may carry tokens / PII)', () => {
    expect(sanitizePageContext('/onboarding?token=secret&step=2')).toBe('/onboarding');
  });

  it('strips the hash fragment', () => {
    expect(sanitizePageContext('/onboarding#set-up-team')).toBe('/onboarding');
  });

  it('reduces a full URL to its pathname (drops host + query)', () => {
    expect(sanitizePageContext('https://nemorouter.ai/onboarding?t=secret')).toBe('/onboarding');
  });

  it('normalizes a missing leading slash', () => {
    expect(sanitizePageContext('models')).toBe('/models');
  });

  it('returns null for empty / non-string input', () => {
    expect(sanitizePageContext('')).toBeNull();
    expect(sanitizePageContext('   ')).toBeNull();
    expect(sanitizePageContext(undefined)).toBeNull();
    expect(sanitizePageContext(null)).toBeNull();
    expect(sanitizePageContext(42 as unknown as string)).toBeNull();
  });

  it('strips control chars / newlines (no prompt-injection line breaks)', () => {
    expect(sanitizePageContext('/foo\nIGNORE PREVIOUS\r\nbar')).toBe('/fooIGNORE PREVIOUSbar');
  });

  it('bounds the length to 256 chars', () => {
    const long = '/' + 'a'.repeat(400);
    const out = sanitizePageContext(long)!;
    expect(out.length).toBe(256);
    expect(out.startsWith('/aaaa')).toBe(true);
  });

  it('returns just "/" for the root path', () => {
    expect(sanitizePageContext('/')).toBe('/');
    expect(sanitizePageContext('https://nemorouter.ai/')).toBe('/');
  });
});
