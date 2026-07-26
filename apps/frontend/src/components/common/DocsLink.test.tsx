import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { DocsLink, DocsInlineLink, WatchLink } from './DocsLink';

describe('DocsLink', () => {
  afterEach(cleanup);

  it('renders the label as a new-tab link to href', () => {
    render(<DocsLink href="https://docs.bffless.dev/storage/aws-s3/" label="S3 setup guide" />);

    const link = screen.getByRole('link', { name: /S3 setup guide/ });
    expect(link).toHaveAttribute('href', 'https://docs.bffless.dev/storage/aws-s3/');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });
});

describe('DocsInlineLink', () => {
  afterEach(cleanup);

  it('renders its children as a new-tab link', () => {
    render(
      <DocsInlineLink href="https://docs.bffless.dev/storage/minio/">
        View the MinIO setup guide
      </DocsInlineLink>,
    );

    const link = screen.getByRole('link', { name: /View the MinIO setup guide/ });
    expect(link).toHaveAttribute('href', 'https://docs.bffless.dev/storage/minio/');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });
});

describe('WatchLink', () => {
  afterEach(cleanup);

  it('links to the seeked share URL and labels itself with the timestamp', () => {
    render(<WatchLink videoId="zTGi5M0mcCo" start={249} />);

    const link = screen.getByRole('link', { name: /Watch this step \(4:09\)/ });
    expect(link).toHaveAttribute('href', 'https://youtu.be/zTGi5M0mcCo?t=249');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('does not mount an iframe — it is a text link, not an embed', () => {
    const { container } = render(<WatchLink videoId="zTGi5M0mcCo" start={249} />);
    expect(container.querySelector('iframe')).toBeNull();
  });
});
