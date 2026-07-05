import { describe, it, expect } from 'vitest';
import { serializeFilterValue, displayFilterValue } from './filter-value';

describe('serializeFilterValue', () => {
  it('splits an in value with commas into a trimmed array', () => {
    expect(serializeFilterValue('in', 'a.com, b.com ,c.com')).toEqual(['a.com', 'b.com', 'c.com']);
  });

  it('keeps an in value with no comma as a string (preserves expressions)', () => {
    expect(serializeFilterValue('in', 'steps.folderFeeds.urls')).toBe('steps.folderFeeds.urls');
  });

  it('keeps a single literal in value as a string', () => {
    expect(serializeFilterValue('in', 'only.com')).toBe('only.com');
  });

  it('drops empty segments from an in list', () => {
    expect(serializeFilterValue('in', 'a.com, , b.com,')).toEqual(['a.com', 'b.com']);
  });

  it('never splits non-in operators, even with commas', () => {
    expect(serializeFilterValue('eq', 'a, b')).toBe('a, b');
    expect(serializeFilterValue('like', '%x, y%')).toBe('%x, y%');
  });
});

describe('displayFilterValue', () => {
  it('joins an array with comma-space', () => {
    expect(displayFilterValue(['a', 'b'])).toBe('a, b');
  });

  it('passes a string through', () => {
    expect(displayFilterValue('steps.x.urls')).toBe('steps.x.urls');
  });

  it('renders nullish as empty string', () => {
    expect(displayFilterValue(undefined)).toBe('');
  });
});
