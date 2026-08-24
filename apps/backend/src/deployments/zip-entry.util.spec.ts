import { isHiddenZipEntry } from './zip-entry.util';

describe('isHiddenZipEntry', () => {
  it('keeps ordinary files at any depth', () => {
    expect(isHiddenZipEntry('index.html')).toBe(false);
    expect(isHiddenZipEntry('apps/site/dist/assets/app.js')).toBe(false);
  });

  it('keeps a top-level .bffless directory (skills, workflows)', () => {
    expect(isHiddenZipEntry('.bffless/skills/demo/SKILL.md')).toBe(false);
    expect(isHiddenZipEntry('.bffless/workflows/index.json')).toBe(false);
  });

  it('keeps a nested .bffless directory — upload-artifact zips under the build path', () => {
    expect(isHiddenZipEntry('apps/workflow/hello-dist/.bffless/workflows/index.json')).toBe(false);
    expect(isHiddenZipEntry('dist/.bffless/skills/demo/SKILL.md')).toBe(false);
  });

  it('drops every other dot entry, at any depth, including dotfiles inside .bffless', () => {
    expect(isHiddenZipEntry('.DS_Store')).toBe(true);
    expect(isHiddenZipEntry('.git/HEAD')).toBe(true);
    expect(isHiddenZipEntry('assets/.DS_Store')).toBe(true);
    expect(isHiddenZipEntry('dist/.hidden/secret.txt')).toBe(true);
    expect(isHiddenZipEntry('.bffless/.DS_Store')).toBe(true);
    expect(isHiddenZipEntry('dist/.bffless/.git/config')).toBe(true);
  });

  it('drops __MACOSX resource forks and does not confuse .bffless-lookalikes', () => {
    expect(isHiddenZipEntry('__MACOSX/dist/._index.html')).toBe(true);
    expect(isHiddenZipEntry('dist/__MACOSX/._app.js')).toBe(true);
    expect(isHiddenZipEntry('.bfflessx/file')).toBe(true);
    expect(isHiddenZipEntry('.bffless')).toBe(true); // a file literally named .bffless
  });
});
