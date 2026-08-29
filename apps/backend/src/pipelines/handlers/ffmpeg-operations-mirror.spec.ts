import { readFileSync } from 'fs';
import * as path from 'path';

/**
 * A drift fence over the ffmpeg operation list, which is written out FOUR
 * times in this repo and imported none of them.
 *
 * `apps/frontend/src/components/pipelines/handlers/types.ts` is a hand-copied
 * duplicate of the backend's `FfmpegHandlerConfig`: the frontend tsconfig is
 * `include: ["src"]` with a sole `@/*` → `./src/*` alias, so there is no module
 * resolution between the two packages and `tsc` cannot see a divergence. Until
 * the admin picker reads `ops` from `GET /api/video/capabilities` (which CE
 * already returns), the only thing holding the copies together is a comment —
 * and that convention has already failed twice on this branch alone, in
 * opposite directions: once the frontend was corrected while the backend TSDoc
 * went stale, and once the backend dropped an operation while the frontend kept
 * offering it. Both were caught by a human reading both files; neither was a
 * gate. This is the gate.
 *
 * PARSING SOURCE TEXT IS UGLY. It is done anyway because it is the only thing
 * that can fail CI today: nothing else in the build, the type-check or either
 * test suite reads both files. The parsing is deliberately dumb — a declaration
 * these regexes cannot read fails the test with the file and the snippet named,
 * which is the right outcome for "someone reshaped a list this test exists to
 * watch".
 */

const REPO = path.resolve(__dirname, '../../../../..');
const BACKEND = path.join(REPO, 'apps/backend/src');
const FRONTEND_TYPES = path.join(REPO, 'apps/frontend/src/components/pipelines/handlers/types.ts');

function read(file: string): string {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    throw new Error(
      `ffmpeg operation mirror: cannot read ${file}. If the file moved, update this test — it is the only gate on the four hand-copied operation lists.`,
    );
  }
}

/** `export type FfmpegOperation = 'a' | 'b';` — union members, in order. */
function unionMembers(source: string, file: string, typeName: string): string[] {
  const decl = new RegExp(`type ${typeName}\\s*=([^;]*);`).exec(source);
  if (!decl) throw new Error(`ffmpeg operation mirror: no \`type ${typeName}\` found in ${file}`);
  const members = decl[1].match(/'[^']+'/g);
  if (!members) {
    throw new Error(
      `ffmpeg operation mirror: \`type ${typeName}\` in ${file} has no quoted members: ${decl[1].trim()}`,
    );
  }
  return members.map((m) => m.slice(1, -1));
}

/** `const NAME = ['a', 'b'] as const;` — array members, in order. */
function arrayMembers(source: string, file: string, constName: string): string[] {
  const decl = new RegExp(`${constName}\\s*=\\s*\\[([^\\]]*)\\]`).exec(source);
  if (!decl) throw new Error(`ffmpeg operation mirror: no \`${constName} = [...]\` in ${file}`);
  const members = decl[1].match(/'[^']+'/g);
  if (!members) {
    throw new Error(
      `ffmpeg operation mirror: \`${constName}\` in ${file} has no quoted members: ${decl[1].trim()}`,
    );
  }
  return members.map((m) => m.slice(1, -1));
}

/**
 * Property names declared directly in an interface body — one per line-leading
 * `name?:`, so TSDoc lines (which start `*`) and inline object types (which are
 * never at the start of a line) are skipped.
 */
function interfaceFields(source: string, file: string, name: string): string[] {
  const start = new RegExp(`export interface ${name}\\b[^{]*\\{`).exec(source);
  if (!start) throw new Error(`ffmpeg operation mirror: no \`interface ${name}\` in ${file}`);
  const from = start.index + start[0].length;
  const end = source.indexOf('\n}', from);
  if (end === -1)
    throw new Error(`ffmpeg operation mirror: \`interface ${name}\` in ${file} never closes`);
  return source
    .slice(from, end)
    .split('\n')
    .map((line) => /^ {2}([A-Za-z_$][\w$]*)\??:/.exec(line))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => m[1]);
}

/** Both lists in the failure message — the point is to see the divergence, not just that there is one. */
function expectSameList(actual: string[], expected: string[], what: string) {
  if (actual.join(',') !== expected.join(',')) {
    throw new Error(
      `ffmpeg ${what} have drifted apart:\n  ${expected.join(', ')}\n  ${actual.join(', ')}\nUpdate both files — there is no import path between them, so nothing else will catch this.`,
    );
  }
}

describe('ffmpeg operation lists agree across backend and frontend', () => {
  const interfaceSrc = read(path.join(BACKEND, 'pipelines/execution/step-handler.interface.ts'));
  const handlerSrc = read(path.join(BACKEND, 'pipelines/handlers/ffmpeg.handler.ts'));
  const capabilitySrc = read(path.join(BACKEND, 'pipelines/ffmpeg/ffmpeg-capability.service.ts'));
  const frontendSrc = read(FRONTEND_TYPES);

  const backendOps = unionMembers(interfaceSrc, 'step-handler.interface.ts', 'FfmpegOperation');

  it('the backend union is the five curated operations', () => {
    expect(backendOps).toEqual(['probe', 'extract_audio', 'slice', 'concat', 'frames']);
  });

  it("the handler's own OPERATIONS guard matches the union it validates against", () => {
    expectSameList(
      arrayMembers(handlerSrc, 'ffmpeg.handler.ts', 'OPERATIONS'),
      backendOps,
      'handler OPERATIONS and the FfmpegOperation union',
    );
  });

  it('FFMPEG_OPS (what /api/video/capabilities advertises) matches the union', () => {
    expectSameList(
      arrayMembers(capabilitySrc, 'ffmpeg-capability.service.ts', 'FFMPEG_OPS'),
      backendOps,
      'FFMPEG_OPS and the FfmpegOperation union',
    );
  });

  it('the admin UI offers exactly the operations the backend accepts', () => {
    expectSameList(
      unionMembers(frontendSrc, 'frontend types.ts', 'FfmpegOperation'),
      backendOps,
      "the frontend's FfmpegOperation and the backend's",
    );
  });

  // Bonus, not the primary target: the deleted contact-sheet knobs lingering in
  // the frontend copy were the SECOND half of the drift, and a field-name check
  // is what would have caught them.
  it.each([['FfmpegHandlerConfig'], ['FfmpegDrawConfig'], ['FfmpegTileConfig']])(
    '%s declares the same fields on both sides',
    (name) => {
      expectSameList(
        interfaceFields(frontendSrc, 'frontend types.ts', name),
        interfaceFields(interfaceSrc, 'step-handler.interface.ts', name),
        `${name}'s fields (frontend vs backend)`,
      );
    },
  );
});
