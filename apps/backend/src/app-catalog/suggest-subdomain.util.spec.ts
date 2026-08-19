import { slugify, suggestSubdomain } from './suggest-subdomain.util';

describe('suggestSubdomain', () => {
  const never = async () => false;
  const notReserved = () => false;

  it('proposes <default>-<project> when it is free', async () => {
    await expect(
      suggestSubdomain({
        defaultSubdomain: 'studio',
        projectName: 'blog',
        isTaken: never,
        isReserved: notReserved,
      }),
    ).resolves.toBe('studio-blog');
  });

  it('slugifies the project name', async () => {
    await expect(
      suggestSubdomain({
        defaultSubdomain: 'studio',
        projectName: 'My Blog_2026!',
        isTaken: never,
        isReserved: notReserved,
      }),
    ).resolves.toBe('studio-my-blog-2026');
  });

  it('appends -2, -3, … while candidates are taken', async () => {
    const taken = new Set(['studio-blog', 'studio-blog-2']);
    await expect(
      suggestSubdomain({
        defaultSubdomain: 'studio',
        projectName: 'blog',
        isTaken: async (s) => taken.has(s),
        isReserved: notReserved,
      }),
    ).resolves.toBe('studio-blog-3');
  });

  it('skips reserved candidates without probing them', async () => {
    const probed: string[] = [];
    await expect(
      suggestSubdomain({
        defaultSubdomain: 'ad',
        projectName: 'min',
        isTaken: async (s) => {
          probed.push(s);
          return false;
        },
        isReserved: (s) => s === 'ad-min',
      }),
    ).resolves.toBe('ad-min-2');
    expect(probed).toEqual(['ad-min-2']);
  });

  it('gives up after maxAttempts', async () => {
    await expect(
      suggestSubdomain({
        defaultSubdomain: 'studio',
        projectName: 'blog',
        isTaken: async () => true,
        isReserved: notReserved,
        maxAttempts: 3,
      }),
    ).resolves.toBeUndefined();
  });

  it('returns undefined when the inputs slugify to nothing', async () => {
    await expect(
      suggestSubdomain({
        defaultSubdomain: '!!!',
        projectName: '???',
        isTaken: never,
        isReserved: notReserved,
      }),
    ).resolves.toBeUndefined();
  });
});

describe('slugify', () => {
  it('collapses and trims separators', () => {
    expect(slugify('--Hello  World--')).toBe('hello-world');
  });
});
