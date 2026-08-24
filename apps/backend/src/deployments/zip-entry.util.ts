/**
 * The one dot-directory a deployment may ship: BFFless itself reads `.bffless/skills`,
 * `.bffless/workflows`, … from a deployment, and upload-artifact keeps it when walking a
 * build directory. Kept at ANY depth — the actions zip under the build path
 * (`apps/site/dist/.bffless/…`) and base-path serving re-keys it to the root.
 */
const KEPT_DOT_DIR = '.bffless';

/**
 * Whether a zip entry is a hidden/system file that must not become a deployment asset:
 * any path segment that starts with `.` (except a `.bffless` directory segment) or an
 * `__MACOSX` resource-fork directory.
 */
export function isHiddenZipEntry(filePath: string): boolean {
  const segments = filePath.split('/');
  return segments.some((segment, index) => {
    if (segment === '__MACOSX') return true;
    if (!segment.startsWith('.')) return false;
    const isDirectory = index < segments.length - 1;
    return !(segment === KEPT_DOT_DIR && isDirectory);
  });
}
