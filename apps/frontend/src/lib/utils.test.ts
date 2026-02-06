import { describe, it, expect } from 'vitest';
import { cn, formatFileSize } from './utils';

describe('utils', () => {
  describe('cn (className merger)', () => {
    it('should merge class names', () => {
      const result = cn('text-red-500', 'bg-blue-500');
      expect(result).toBe('text-red-500 bg-blue-500');
    });

    it('should handle conditional classes', () => {
      const result = cn('base-class', true && 'conditional-class', false && 'not-included');
      expect(result).toContain('base-class');
      expect(result).toContain('conditional-class');
      expect(result).not.toContain('not-included');
    });

    it('should merge conflicting Tailwind classes', () => {
      // twMerge should keep the last class when there's a conflict
      const result = cn('p-4', 'p-8');
      expect(result).toBe('p-8');
    });

    it('should handle arrays of classes', () => {
      const result = cn(['text-sm', 'font-bold']);
      expect(result).toContain('text-sm');
      expect(result).toContain('font-bold');
    });

    it('should handle undefined and null', () => {
      const result = cn('base', undefined, null, 'other');
      expect(result).toContain('base');
      expect(result).toContain('other');
    });

    it('should handle empty strings', () => {
      const result = cn('base', '', 'other');
      expect(result).toContain('base');
      expect(result).toContain('other');
    });
  });

  describe('formatFileSize', () => {
    it('should format 0 bytes', () => {
      expect(formatFileSize(0)).toBe('0 B');
    });

    it('should format bytes (< 1024)', () => {
      expect(formatFileSize(500)).toBe('500.0 B');
      expect(formatFileSize(1)).toBe('1.0 B');
      expect(formatFileSize(1023)).toBe('1023.0 B');
    });

    it('should format kilobytes', () => {
      expect(formatFileSize(1024)).toBe('1.0 KB');
      expect(formatFileSize(2048)).toBe('2.0 KB');
      expect(formatFileSize(1536)).toBe('1.5 KB');
      expect(formatFileSize(10240)).toBe('10.0 KB');
    });

    it('should format megabytes', () => {
      expect(formatFileSize(1048576)).toBe('1.0 MB'); // 1024 * 1024
      expect(formatFileSize(2097152)).toBe('2.0 MB'); // 2 * 1024 * 1024
      expect(formatFileSize(5242880)).toBe('5.0 MB'); // 5 * 1024 * 1024
      expect(formatFileSize(1572864)).toBe('1.5 MB'); // 1.5 * 1024 * 1024
    });

    it('should format gigabytes', () => {
      expect(formatFileSize(1073741824)).toBe('1.0 GB'); // 1024 * 1024 * 1024
      expect(formatFileSize(2147483648)).toBe('2.0 GB'); // 2 * 1024 * 1024 * 1024
      expect(formatFileSize(5368709120)).toBe('5.0 GB'); // 5 * 1024 * 1024 * 1024
    });

    it('should format terabytes', () => {
      expect(formatFileSize(1099511627776)).toBe('1.0 TB'); // 1024 * 1024 * 1024 * 1024
      expect(formatFileSize(2199023255552)).toBe('2.0 TB'); // 2 * 1024 * 1024 * 1024 * 1024
    });

    it('should round to 1 decimal place', () => {
      expect(formatFileSize(1536)).toBe('1.5 KB');
      expect(formatFileSize(1740)).toBe('1.7 KB');
      expect(formatFileSize(1945)).toBe('1.9 KB');
    });

    it('should handle edge cases', () => {
      // Just under 1 KB
      expect(formatFileSize(1023)).toBe('1023.0 B');

      // Just over 1 KB
      expect(formatFileSize(1025)).toBe('1.0 KB');

      // Just under 1 MB
      expect(formatFileSize(1048575)).toBe('1024.0 KB');

      // Just over 1 MB
      expect(formatFileSize(1048577)).toBe('1.0 MB');
    });

    it('should handle very large terabyte values', () => {
      // Test a very large TB value (100 TB)
      const hundredTB = 100 * 1024 * 1024 * 1024 * 1024;
      const result = formatFileSize(hundredTB);
      expect(result).toBe('100.0 TB');
    });

    it('should handle decimal file sizes correctly', () => {
      // Test that we get sensible rounding
      expect(formatFileSize(1536.7)).toBe('1.5 KB');
      expect(formatFileSize(1945.2)).toBe('1.9 KB');
    });
  });

  describe('integration tests', () => {
    it('should format typical web file sizes', () => {
      // HTML file
      expect(formatFileSize(15360)).toBe('15.0 KB');

      // CSS file
      expect(formatFileSize(51200)).toBe('50.0 KB');

      // JavaScript bundle
      expect(formatFileSize(524288)).toBe('512.0 KB');

      // Image
      expect(formatFileSize(2097152)).toBe('2.0 MB');

      // Video
      expect(formatFileSize(52428800)).toBe('50.0 MB');
    });

    it('should be consistent with file tree display', () => {
      // Simulating file tree with various file sizes
      const files = [
        { name: 'index.html', size: 1024 },
        { name: 'style.css', size: 2048 },
        { name: 'script.js', size: 15360 },
        { name: 'logo.png', size: 524288 },
      ];

      const formatted = files.map((f) => ({
        ...f,
        formattedSize: formatFileSize(f.size),
      }));

      expect(formatted[0].formattedSize).toBe('1.0 KB');
      expect(formatted[1].formattedSize).toBe('2.0 KB');
      expect(formatted[2].formattedSize).toBe('15.0 KB');
      expect(formatted[3].formattedSize).toBe('512.0 KB');
    });
  });
});
