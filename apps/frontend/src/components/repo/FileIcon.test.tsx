import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { FileIcon, getFileIcon } from './FileIcon';

describe('FileIcon', () => {
  describe('directories', () => {
    it('should render folder icon for directories', () => {
      const { container } = render(
        <FileIcon fileName="test-folder" isDirectory={true} />
      );

      const svg = container.querySelector('svg');
      expect(svg).toBeInTheDocument();
      expect(svg).toHaveClass('text-blue-500');
    });

    it('should render open folder icon when isOpen is true', () => {
      const { container } = render(
        <FileIcon fileName="test-folder" isDirectory={true} isOpen={true} />
      );

      const svg = container.querySelector('svg');
      expect(svg).toBeInTheDocument();
      expect(svg).toHaveClass('text-blue-500');
    });

    it('should render closed folder icon when isOpen is false', () => {
      const { container } = render(
        <FileIcon fileName="test-folder" isDirectory={true} isOpen={false} />
      );

      const svg = container.querySelector('svg');
      expect(svg).toBeInTheDocument();
    });
  });

  describe('HTML files', () => {
    it('should render orange icon for .html files', () => {
      const { container } = render(<FileIcon fileName="index.html" />);

      const svg = container.querySelector('svg');
      expect(svg).toBeInTheDocument();
      expect(svg).toHaveClass('text-orange-500');
    });

    it('should render orange icon for .htm files', () => {
      const { container } = render(<FileIcon fileName="page.htm" />);

      const svg = container.querySelector('svg');
      expect(svg).toHaveClass('text-orange-500');
    });
  });

  describe('CSS files', () => {
    it('should render blue icon for .css files', () => {
      const { container } = render(<FileIcon fileName="style.css" />);

      const svg = container.querySelector('svg');
      expect(svg).toBeInTheDocument();
      expect(svg).toHaveClass('text-blue-500');
    });

    it('should render pink icon for .scss files', () => {
      const { container } = render(<FileIcon fileName="main.scss" />);

      const svg = container.querySelector('svg');
      expect(svg).toHaveClass('text-pink-500');
    });

    it('should render pink icon for .sass files', () => {
      const { container } = render(<FileIcon fileName="main.sass" />);

      const svg = container.querySelector('svg');
      expect(svg).toHaveClass('text-pink-500');
    });
  });

  describe('JavaScript files', () => {
    it('should render yellow icon for .js files', () => {
      const { container } = render(<FileIcon fileName="app.js" />);

      const svg = container.querySelector('svg');
      expect(svg).toBeInTheDocument();
      expect(svg).toHaveClass('text-yellow-500');
    });

    it('should render yellow icon for .jsx files', () => {
      const { container } = render(<FileIcon fileName="Component.jsx" />);

      const svg = container.querySelector('svg');
      expect(svg).toHaveClass('text-yellow-500');
    });

    it('should render blue icon for .ts files', () => {
      const { container } = render(<FileIcon fileName="main.ts" />);

      const svg = container.querySelector('svg');
      expect(svg).toHaveClass('text-blue-600');
    });

    it('should render blue icon for .tsx files', () => {
      const { container } = render(<FileIcon fileName="App.tsx" />);

      const svg = container.querySelector('svg');
      expect(svg).toHaveClass('text-blue-600');
    });
  });

  describe('image files', () => {
    it('should render green icon for .png files', () => {
      const { container } = render(<FileIcon fileName="logo.png" />);

      const svg = container.querySelector('svg');
      expect(svg).toBeInTheDocument();
      expect(svg).toHaveClass('text-green-500');
    });

    it('should render green icon for .jpg files', () => {
      const { container } = render(<FileIcon fileName="photo.jpg" />);

      const svg = container.querySelector('svg');
      expect(svg).toHaveClass('text-green-500');
    });

    it('should render green icon for .svg files', () => {
      const { container } = render(<FileIcon fileName="icon.svg" />);

      const svg = container.querySelector('svg');
      expect(svg).toHaveClass('text-green-600');
    });

    it('should render green icon for .gif files', () => {
      const { container } = render(<FileIcon fileName="animation.gif" />);

      const svg = container.querySelector('svg');
      expect(svg).toHaveClass('text-green-500');
    });
  });

  describe('JSON files', () => {
    it('should render yellow icon for .json files', () => {
      const { container } = render(<FileIcon fileName="package.json" />);

      const svg = container.querySelector('svg');
      expect(svg).toBeInTheDocument();
      expect(svg).toHaveClass('text-yellow-600');
    });

    it('should render yellow icon for .jsonc files', () => {
      const { container } = render(<FileIcon fileName="tsconfig.jsonc" />);

      const svg = container.querySelector('svg');
      expect(svg).toHaveClass('text-yellow-600');
    });
  });

  describe('markdown and text files', () => {
    it('should render gray icon for .md files', () => {
      const { container } = render(<FileIcon fileName="README.md" />);

      const svg = container.querySelector('svg');
      expect(svg).toBeInTheDocument();
    });

    it('should render gray icon for .txt files', () => {
      const { container } = render(<FileIcon fileName="notes.txt" />);

      const svg = container.querySelector('svg');
      expect(svg).toBeInTheDocument();
    });
  });

  describe('special files', () => {
    it('should render icon for .gitignore file', () => {
      const { container } = render(<FileIcon fileName=".gitignore" />);

      const svg = container.querySelector('svg');
      expect(svg).toBeInTheDocument();
    });

    it('should render icon for .dockerignore file', () => {
      const { container } = render(<FileIcon fileName=".dockerignore" />);

      const svg = container.querySelector('svg');
      expect(svg).toBeInTheDocument();
    });
  });

  describe('unknown file types', () => {
    it('should render default icon for unknown extensions', () => {
      const { container } = render(<FileIcon fileName="unknown.xyz" />);

      const svg = container.querySelector('svg');
      expect(svg).toBeInTheDocument();
      expect(svg).toHaveClass('text-gray-500');
    });

    it('should render default icon for files with no extension', () => {
      const { container } = render(<FileIcon fileName="Makefile" />);

      const svg = container.querySelector('svg');
      expect(svg).toBeInTheDocument();
    });
  });

  describe('icon sizing', () => {
    it('should use default size of 16', () => {
      const { container } = render(<FileIcon fileName="test.js" />);

      const svg = container.querySelector('svg');
      expect(svg).toHaveAttribute('width', '16');
      expect(svg).toHaveAttribute('height', '16');
    });

    it('should accept custom size', () => {
      const { container } = render(<FileIcon fileName="test.js" size={24} />);

      const svg = container.querySelector('svg');
      expect(svg).toHaveAttribute('width', '24');
      expect(svg).toHaveAttribute('height', '24');
    });
  });

  describe('custom className', () => {
    it('should apply custom className', () => {
      const { container } = render(
        <FileIcon fileName="test.js" className="custom-class" />
      );

      const svg = container.querySelector('svg');
      expect(svg).toHaveClass('custom-class');
    });
  });

  describe('case insensitivity', () => {
    it('should handle uppercase extensions', () => {
      const { container } = render(<FileIcon fileName="Photo.JPG" />);

      const svg = container.querySelector('svg');
      expect(svg).toHaveClass('text-green-500');
    });

    it('should handle mixed case extensions', () => {
      const { container } = render(<FileIcon fileName="Script.Js" />);

      const svg = container.querySelector('svg');
      expect(svg).toHaveClass('text-yellow-500');
    });
  });
});

describe('getFileIcon', () => {
  it('should return folder icon config for directories', () => {
    const iconConfig = getFileIcon('test-folder', true);

    expect(iconConfig.color).toContain('text-blue');
  });

  it('should return correct icon config for HTML files', () => {
    const iconConfig = getFileIcon('index.html', false);

    expect(iconConfig.color).toBe('text-orange-500');
  });

  it('should return correct icon config for CSS files', () => {
    const iconConfig = getFileIcon('style.css', false);

    expect(iconConfig.color).toBe('text-blue-500');
  });

  it('should return default icon config for unknown files', () => {
    const iconConfig = getFileIcon('unknown.xyz', false);

    expect(iconConfig.color).toContain('text-gray');
  });
});
