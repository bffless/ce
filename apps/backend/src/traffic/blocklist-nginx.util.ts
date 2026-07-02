/**
 * The edge-rule emitter (issue #392, ADR-0002): renders the compiled Blocklist
 * regex sources from blocklist-compiler.ts into nginx server-block rules.
 *
 * The emitted snippet is server-level rewrite-module directives (set/if), so
 * it runs BEFORE location matching — exactly like the retired static
 * `if ($block_scanner)` blocks it replaces — and drops blocklisted requests
 * at the edge on every location of the server block. `$uri` is nginx's
 * percent-decoded, normalized path, which matches the app-side enforcement's
 * decoded-candidate semantics; `~*` gives the same case-insensitivity as the
 * app's `i` flag. Allow rules are evaluated after block rules, so an
 * allowlist match always rescues, mirroring buildBlocklistMatcher().
 *
 * Everything here is a pure function: no I/O, no Nest. Validation of the
 * assembled snippet against a real nginx binary lives in
 * domains/edge-blocklist.service.ts.
 */

export interface EdgeBlocklistRuleInput {
  /** Combined block regex source from compileBlocklistRegexSource(), or null. */
  blockSource: string | null;
  /** Combined allow regex source, or null when no exceptions exist. */
  allowSource: string | null;
  /** 444 where nginx faces the internet (CE mode), 403 behind Traefik/platform. */
  returnCode: '444' | '403';
}

/**
 * Defense-in-depth: assert a compiled regex source cannot escape its quoted
 * nginx context. The blocklist compiler's strict charset already makes a
 * violation impossible for admin input, so a failure here means a compiler
 * bug — callers should treat it as "emit no edge rules", never crash serving.
 *
 * Rejected outright: whitespace/quotes/braces/semicolons/comments (nginx
 * config syntax), and `$` followed by a variable-name character (nginx would
 * try to interpolate a variable inside the pattern). `$` as a regex anchor is
 * always followed by `|`, `)`, or end-of-source in compiled output, so
 * anchors pass.
 */
export function assertNginxSafeRegexSource(source: string): void {
  if (/[\s"'{};#`]/.test(source)) {
    throw new Error('Compiled blocklist regex contains nginx config syntax characters');
  }
  if (/\$[A-Za-z_{]/.test(source)) {
    throw new Error('Compiled blocklist regex contains an nginx variable interpolation');
  }
}

/**
 * Render the per-server-block enforcement rules. Returns '' when there is
 * nothing to block (empty effective set or bot protection disabled — callers
 * pass blockSource: null for both), so generated configs simply omit the
 * section.
 */
export function renderEdgeBlocklistRules(input: EdgeBlocklistRuleInput): string {
  if (!input.blockSource) {
    return '';
  }
  assertNginxSafeRegexSource(input.blockSource);
  if (input.allowSource) {
    assertNginxSafeRegexSource(input.allowSource);
  }

  const lines = [
    '    # Blocklist edge enforcement (generated from Baseline + Blocklists)',
    '    set $blocklist_hit 0;',
    `    if ($uri ~* "${input.blockSource}") {`,
    '        set $blocklist_hit 1;',
    '    }',
  ];
  if (input.allowSource) {
    lines.push(
      `    if ($uri ~* "${input.allowSource}") {`,
      '        set $blocklist_hit 0;',
      '    }',
    );
  }
  lines.push('    if ($blocklist_hit) {', `        return ${input.returnCode};`, '    }');
  return lines.join('\n');
}

/**
 * Wrap emitted rules in a minimal, self-contained nginx config for `nginx -t`
 * validation. Deliberately references no certificates, upstreams, or files
 * beyond the prefix directory, so it validates identically in any container
 * that has an nginx binary. All paths are relative to the `-p` prefix the
 * validator runs with.
 */
export function renderEdgeBlocklistSandboxConfig(rules: string): string {
  return `pid blocklist-validate.pid;
error_log blocklist-validate.error.log;
events {
}
http {
    access_log off;
    server {
        listen 127.0.0.1:8080;
        server_name blocklist-validate.invalid;
${rules}
        location / {
            return 404;
        }
    }
}
`;
}
