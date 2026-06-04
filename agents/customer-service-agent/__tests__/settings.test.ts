import { describe, it, expect } from 'vitest';
import {
  defaultSettings,
  mergeSettings,
  parseContactMethods,
  parseQuickLinks,
  parseSuggestions,
  sanitizeHref,
  contactHref,
  publicSettings,
  type AgentSettings,
} from '../lib/settings';
import { loadConfig } from '../lib/config';

// A baseline settings object; tests override the bits they care about.
function settings(over: Partial<AgentSettings> = {}): AgentSettings {
  return {
    agentName: 'Acme Support',
    systemPrompt: 'You are Acme support.',
    model: 'gemini-2.5-flash-lite',
    greet: true,
    suggestions: ['How does pricing work?'],
    quickLinks: [{ label: 'Docs', href: '/docs' }],
    contactMethods: [{ type: 'phone', label: 'Call us', value: '+1 (555) 010-2030' }],
    enabledTools: [],
    webSearchEnabled: true,
    webSearchSite: '',
    ...over,
  };
}

describe('sanitizeHref — link-injection guard', () => {
  it('allows http(s), tel, mailto, sms, and site-relative hrefs', () => {
    expect(sanitizeHref('https://acme.com')).toBe('https://acme.com');
    expect(sanitizeHref('http://acme.com')).toBe('http://acme.com');
    expect(sanitizeHref('tel:+15550102030')).toBe('tel:+15550102030');
    expect(sanitizeHref('mailto:support@acme.com')).toBe('mailto:support@acme.com');
    expect(sanitizeHref('sms:+15550102030')).toBe('sms:+15550102030');
    expect(sanitizeHref('/docs')).toBe('/docs');
  });
  it('drops javascript:, data:, vbscript:, and other unknown schemes', () => {
    expect(sanitizeHref('javascript:alert(1)')).toBeNull();
    expect(sanitizeHref('JavaScript:alert(1)')).toBeNull();
    expect(sanitizeHref('data:text/html;base64,xxx')).toBeNull();
    expect(sanitizeHref('vbscript:msgbox')).toBeNull();
    expect(sanitizeHref('ftp://acme.com')).toBeNull();
    expect(sanitizeHref('')).toBeNull();
  });
  it('trims surrounding whitespace before judging the scheme', () => {
    expect(sanitizeHref('  https://acme.com  ')).toBe('https://acme.com');
    expect(sanitizeHref('  javascript:alert(1)')).toBeNull();
  });
});

describe('contactHref — builds the right scheme per contact type', () => {
  it('phone → tel: with non-dial chars stripped (keeps a leading +)', () => {
    expect(contactHref({ type: 'phone', label: 'Call', value: '+1 (555) 010-2030' })).toBe('tel:+15550102030');
    expect(contactHref({ type: 'phone', label: 'Call', value: '555.010.2030' })).toBe('tel:5550102030');
  });
  it('email → mailto:', () => {
    expect(contactHref({ type: 'email', label: 'Email', value: 'support@acme.com' })).toBe(
      'mailto:support@acme.com',
    );
  });
  it('url → sanitized as-is', () => {
    expect(contactHref({ type: 'url', label: 'Support', value: 'https://acme.com/support' })).toBe(
      'https://acme.com/support',
    );
    expect(contactHref({ type: 'url', label: 'Bad', value: 'javascript:alert(1)' })).toBeNull();
  });
});

describe('parseContactMethods — tolerant JSON + sanitize', () => {
  it('parses a valid array and keeps only resolvable, well-typed entries', () => {
    const json = JSON.stringify([
      { type: 'phone', label: 'Call sales', value: '+1 (555) 010-2030' },
      { type: 'email', label: 'Email support', value: 'support@acme.com' },
      { type: 'url', label: 'Help center', value: 'https://acme.com/help' },
      { type: 'url', label: 'Evil', value: 'javascript:alert(1)' }, // dropped (bad href)
      { type: 'sms', label: 'Bad type', value: '123' }, // dropped (unknown type)
      { type: 'phone', label: '', value: '+1' }, // dropped (empty label)
    ]);
    expect(parseContactMethods(json)).toEqual([
      { type: 'phone', label: 'Call sales', value: '+1 (555) 010-2030' },
      { type: 'email', label: 'Email support', value: 'support@acme.com' },
      { type: 'url', label: 'Help center', value: 'https://acme.com/help' },
    ]);
  });
  it('returns [] for junk / undefined', () => {
    expect(parseContactMethods(undefined)).toEqual([]);
    expect(parseContactMethods('not json')).toEqual([]);
    expect(parseContactMethods('{"not":"an array"}')).toEqual([]);
  });
});

describe('parseQuickLinks — tolerant JSON + href sanitize', () => {
  it('keeps well-formed links and drops dangerous hrefs', () => {
    const json = JSON.stringify([
      { label: 'Pricing', href: '/pricing' },
      { label: 'Docs', href: 'https://acme.com/docs' },
      { label: 'Evil', href: 'javascript:alert(1)' },
      { label: '', href: '/x' },
    ]);
    expect(parseQuickLinks(json)).toEqual([
      { label: 'Pricing', href: '/pricing' },
      { label: 'Docs', href: 'https://acme.com/docs' },
    ]);
  });
  it('returns [] for junk', () => {
    expect(parseQuickLinks('garbage')).toEqual([]);
  });
});

describe('parseSuggestions — comma list OR JSON array', () => {
  it('parses a JSON array of strings', () => {
    expect(parseSuggestions('["a","b"]')).toEqual(['a', 'b']);
  });
  it('parses a comma-separated list', () => {
    expect(parseSuggestions('a, b ,c')).toEqual(['a', 'b', 'c']);
  });
  it('returns [] for empty/undefined', () => {
    expect(parseSuggestions(undefined)).toEqual([]);
    expect(parseSuggestions('')).toEqual([]);
  });
});

describe('defaultSettings — env-driven, sane fallbacks', () => {
  it('falls back to built-in suggestions/links/contacts when env is unset', () => {
    const s = defaultSettings(loadConfig());
    expect(s.suggestions.length).toBeGreaterThan(0);
    expect(s.quickLinks.length).toBeGreaterThan(0);
    expect(s.contactMethods.length).toBeGreaterThan(0);
    // every quick link + contact resolves to a safe href
    for (const l of s.quickLinks) expect(sanitizeHref(l.href)).not.toBeNull();
    for (const c of s.contactMethods) expect(contactHref(c)).not.toBeNull();
  });
});

describe('mergeSettings — overlay precedence (Supabase over env)', () => {
  it('overlays only the keys present in the override; arrays replace wholesale', () => {
    const base = settings();
    const merged = mergeSettings(base, {
      systemPrompt: 'Overridden prompt',
      suggestions: ['only this'],
    });
    expect(merged.systemPrompt).toBe('Overridden prompt');
    expect(merged.suggestions).toEqual(['only this']);
    // untouched keys keep the base value
    expect(merged.agentName).toBe('Acme Support');
    expect(merged.quickLinks).toEqual(base.quickLinks);
  });
  it('ignores undefined/empty-array overrides so a partial save never blanks a section', () => {
    const base = settings();
    const merged = mergeSettings(base, { suggestions: [], quickLinks: undefined });
    expect(merged.suggestions).toEqual(base.suggestions);
    expect(merged.quickLinks).toEqual(base.quickLinks);
  });
  it('sanitizes overridden quick links + contact methods', () => {
    const merged = mergeSettings(settings(), {
      quickLinks: [
        { label: 'Good', href: '/ok' },
        { label: 'Bad', href: 'javascript:alert(1)' },
      ],
      contactMethods: [{ type: 'url', label: 'Bad', value: 'javascript:alert(1)' }],
    });
    expect(merged.quickLinks).toEqual([{ label: 'Good', href: '/ok' }]);
    expect(merged.contactMethods).toEqual([]); // the only entry was unsafe
  });
  it('overlays web-search enabled + normalizes the site host (admin → env)', () => {
    const base = settings({ webSearchEnabled: true, webSearchSite: 'nemorouter.ai' });
    const merged = mergeSettings(base, { webSearchEnabled: false, webSearchSite: 'https://www.example.com/docs' });
    expect(merged.webSearchEnabled).toBe(false);
    expect(merged.webSearchSite).toBe('example.com'); // scheme + www + path stripped
  });
  it('empty-string webSearchSite is a deliberate "whole web" override (not ignored)', () => {
    const base = settings({ webSearchSite: 'nemorouter.ai' });
    expect(mergeSettings(base, { webSearchSite: '' }).webSearchSite).toBe('');
    // undefined, by contrast, keeps the base
    expect(mergeSettings(base, {}).webSearchSite).toBe('nemorouter.ai');
  });
});

describe('publicSettings — web-search settings are server-only (never leak)', () => {
  it('omits webSearchEnabled + webSearchSite from the public projection', () => {
    const wire = JSON.stringify(publicSettings(settings({ webSearchSite: 'nemorouter.ai' })));
    expect(wire).not.toContain('webSearchSite');
    expect(wire).not.toContain('webSearchEnabled');
  });
});

describe('publicSettings — never leaks server-only fields', () => {
  it('exposes only agentName, suggestions, quickLinks, contactMethods', () => {
    const pub = publicSettings(settings({ systemPrompt: 'SECRET PROMPT', model: 'secret-model' }));
    expect(pub).toEqual({
      agentName: 'Acme Support',
      suggestions: ['How does pricing work?'],
      quickLinks: [{ label: 'Docs', href: '/docs' }],
      contactMethods: [{ type: 'phone', label: 'Call us', value: '+1 (555) 010-2030' }],
    });
    const wire = JSON.stringify(pub);
    expect(wire).not.toContain('SECRET PROMPT');
    expect(wire).not.toContain('secret-model');
  });
});
