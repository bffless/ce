import { resolveContentType } from './content-type.util';

describe('resolveContentType', () => {
  describe('from the key extension', () => {
    it('appends charset=utf-8 to text types so browsers do not fall back to windows-1252', () => {
      expect(resolveContentType('reports/index.html')).toBe('text/html; charset=utf-8');
      expect(resolveContentType('assets/app.css')).toBe('text/css; charset=utf-8');
    });

    it('resolves extensions the hand-rolled tables omitted', () => {
      expect(resolveContentType('notes.md')).toBe('text/markdown; charset=utf-8');
      expect(resolveContentType('page.htm')).toBe('text/html; charset=utf-8');
      expect(resolveContentType('mod.mjs')).toBe('application/javascript; charset=utf-8');
      expect(resolveContentType('lib.wasm')).toBe('application/wasm');
      expect(resolveContentType('photo.avif')).toBe('image/avif');
      expect(resolveContentType('site.webmanifest')).toBe('application/manifest+json; charset=utf-8');
    });

    it('leaves binary types without a charset', () => {
      expect(resolveContentType('doc.pdf')).toBe('application/pdf');
      expect(resolveContentType('img.png')).toBe('image/png');
    });

    it('falls back to application/octet-stream for an unknown extension', () => {
      expect(resolveContentType('archive.xyzzy')).toBe('application/octet-stream');
      expect(resolveContentType('no-extension')).toBe('application/octet-stream');
    });
  });

  describe('from the stored content type', () => {
    it('prefers the stored type when the extension is unknown', () => {
      expect(resolveContentType('blob.xyzzy', 'application/pdf')).toBe('application/pdf');
    });

    it('appends charset=utf-8 to a stored text type that lacks one', () => {
      expect(resolveContentType('blob.xyzzy', 'text/html')).toBe('text/html; charset=utf-8');
    });

    it('preserves a stored charset verbatim rather than forcing utf-8', () => {
      expect(resolveContentType('legacy.html', 'text/html; charset=iso-8859-1')).toBe(
        'text/html; charset=iso-8859-1',
      );
    });

    it('ignores a stored application/octet-stream when the extension is known', () => {
      expect(resolveContentType('notes.md', 'application/octet-stream')).toBe(
        'text/markdown; charset=utf-8',
      );
    });

    it('ignores an empty or whitespace-only stored type', () => {
      expect(resolveContentType('notes.md', '')).toBe('text/markdown; charset=utf-8');
      expect(resolveContentType('notes.md', '   ')).toBe('text/markdown; charset=utf-8');
    });

    it('keeps application/octet-stream when neither source knows better', () => {
      expect(resolveContentType('blob.xyzzy', 'application/octet-stream')).toBe(
        'application/octet-stream',
      );
    });
  });
});
