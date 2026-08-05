import { describe, it, expect } from 'vitest';
import { presets } from '../ProjectResponseHeaderRulesTab';

describe('response header presets', () => {
  it('offers a Cross-Origin Isolation preset', () => {
    const names = presets.map((p) => p.name);
    expect(names).toContain('Cross-Origin Isolation');
  });

  it('sets both cross-origin isolation headers to the values SharedArrayBuffer requires', () => {
    const preset = presets.find((p) => p.name === 'Cross-Origin Isolation');

    expect(preset?.customHeaders).toEqual([
      { name: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
      { name: 'Cross-Origin-Embedder-Policy', value: 'credentialless' },
    ]);
  });

  it('applies project-wide, carrying no app-specific path', () => {
    const preset = presets.find((p) => p.name === 'Cross-Origin Isolation');

    // A generic control offered to every project cannot assume an app's
    // basePath, so the pattern is '**' and the field stays editable.
    expect(preset?.pathPattern).toBe('**');
  });

  it('leaves framing behaviour alone', () => {
    const preset = presets.find((p) => p.name === 'Cross-Origin Isolation');

    // 'sameorigin' is the existing default (nginx already emits
    // X-Frame-Options: SAMEORIGIN), so enabling isolation must not
    // silently change who may frame the content.
    expect(preset?.framePolicy).toBe('sameorigin');
  });

  it('leaves the existing presets carrying no custom headers', () => {
    const blockFraming = presets.find((p) => p.name === 'Block Framing');

    expect(blockFraming?.customHeaders).toBeUndefined();
  });
});
