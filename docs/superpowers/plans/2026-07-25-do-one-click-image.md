# DigitalOcean 1-Click Image Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship BFFless CE as a DigitalOcean Marketplace 1-Click droplet image (Packer-built, warm-cache, zero-SSH web-wizard onboarding) plus the five lifecycle scripts (`restart.sh`, `update.sh`, `logs.sh`, `status.sh`, `backup.sh`) that benefit every CE install.

**Spec:** `docs/superpowers/specs/2026-07-20-do-one-click-image-design.md` (approved). The web-bootstrap dependency (`2026-07-20-web-bootstrap-setup-design.md`) has SHIPPED (v0.3.x): `setup.sh --bootstrap` exists, `install.sh` defaults to zero-SSH web bootstrap, `bootstrap/instance.env` carries applied-state. Per the spec's header note, the browser wizard is the PRIMARY onboarding path and the SSH first-login flow is the fallback.

**Architecture:** Three independent layers. (1) Repo-wide lifecycle scripts + a shared `scripts/setup-swap.sh`, all host-testable with stub-PATH unit tests. (2) `marketplace/digitalocean/` — Packer HCL2 template, provisioner scripts (prep → docker → warm-cache clone at `/opt/bffless` → vendored DO cleanup/img_check), cloud-init per-instance first-boot scripts (swap, then `setup.sh --bootstrap` + `start.sh`), first-login hook + MOTD. (3) CI: a shell-lint/test workflow and a manual+monthly Packer build workflow.

**Tech Stack:** bash, Packer (HCL2, `digitalocean` plugin), cloud-init per-instance scripts, GitHub Actions, shellcheck.

## Global Constraints

- **Branch/worktree:** `repos/ce` checkout is shared — work in a worktree: `git worktree add .claude/worktrees/do-one-click -b feat/do-one-click-image origin/main`. All paths below are relative to that worktree root.
- **Workspace rule:** commits stay local to the feature branch; ask the user before the first commit and before any push/PR.
- **New scripts are bash** with `set -euo pipefail` (exception: `status.sh` omits `-e` deliberately — it must report what it can), `--help`/`-h` flags, colored output in the `start.sh` style (`echo -e` with `RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'`), and shellcheck-clean.
- **No install-path assumptions:** lifecycle scripts resolve their own directory (`SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"`) and must work in a plain `install.sh` deployment (spec regression guard). Only `marketplace/digitalocean/` files may hardcode `/opt/bffless`.
- **No secrets/certs/`.env` baked into the image** (DO `img_check` forbids; a baked `ONBOARDING_TOKEN` would be a shared secret across droplets; `setup.sh --bootstrap` refuses to run when `.env` exists).
- **Swap threshold:** MemTotal < 3584 MB → create 2G swapfile; ≥ 3584 MB (a "4 GB" VM reports ~3.8 GB) → no-op. Swappiness 10.
- **Packer base:** `ubuntu-24-04-x64`, build droplet `s-1vcpu-1gb` (DO guidance: build on the smallest supported size). Snapshot name `bffless-ce-{{timestamp}}`.
- **Compose facts** (verified v0.3.2): container names `assethost-{nginx,postgres,minio,supertokens,redis,backend,frontend}`; profiles `postgres` (default on), `minio` (off), `redis` (off), `supertokens` (on when `SUPERTOKENS_MODE=local`); postgres user `postgres`, db `assethost`; local asset storage volume mounts at `/app/apps/backend/uploads` in the backend container; MinIO data at `/data` in the minio container; SSL files `ssl/fullchain.pem` + `ssl/privkey.pem`, bootstrap self-signed cert `ssl/bootstrap-selfsigned.crt`; backend health endpoint `GET http://localhost:3000/api/health`; claim token is `ONBOARDING_TOKEN=` in `.env`; applied-state readable from `bootstrap/instance.env` (`STATE=applied`, `PRIMARY_DOMAIN=...`).
- **Known trap:** `stop.sh --volumes` silently no-ops without a TTY — never rely on it in scripts/CI.
- **Known trap:** `start.sh` always runs `docker compose build nginx` — `update.sh` MUST `git pull` before restarting or nginx rebuilds from stale sources.
- **Docs domain:** user-facing links point at `https://docs.bffless.dev` (docs.bffless.app is stale).
- **Conventional commits**; use scopes `feat(scripts):`, `feat(marketplace):`, `docs:`, `ci:`.
- Vendored DO scripts (`900-cleanup.sh`, `999-img_check.sh`) are upstream code — do not modify, do not shellcheck.

## File Structure

```
repos/ce (worktree)
├── restart.sh                       # NEW  stop.sh + start.sh, flag passthrough
├── update.sh                        # NEW  version → dirty-guard → git pull → compose pull → restart
├── logs.sh                          # NEW  compose logs -f --tail=100 [service]
├── status.sh                        # NEW  versions/restart-pending, ps, resources, domain/SSL, health
├── backup.sh                        # NEW  pg_dump + assets + config → backups/*.tar.gz
├── docker-compose.yml               # MOD  swap comment block trimmed to point at script
├── README.md                        # MOD  new "Managing your instance" section
├── scripts/
│   ├── setup-swap.sh                # NEW  idempotent 2G swap on <3584MB hosts
│   ├── setup-swap.test.sh           # NEW  host-runnable unit test (stub PATH)
│   ├── compose-profiles.sh          # NEW  shared compose_profiles() helper
│   ├── compose-profiles.test.sh     # NEW  unit test
│   └── lifecycle.test.sh            # NEW  stub-PATH tests for the five scripts
├── marketplace/digitalocean/
│   ├── template.pkr.hcl             # NEW  Packer HCL2, DO builder
│   ├── README.md                    # NEW  build / test / submit instructions
│   ├── scripts/
│   │   ├── 010-prep.sh              # NEW  apt upgrade, ufw 22/80/443
│   │   ├── 020-docker.sh            # NEW  Docker CE (mirrors setup.sh install_docker)
│   │   ├── 030-bffless.sh           # NEW  clone /opt/bffless, pre-pull, hooks, MOTD
│   │   ├── 900-cleanup.sh           # NEW  vendored digitalocean/marketplace-partners
│   │   └── 999-img_check.sh         # NEW  vendored (exits 1 on failure → fails build)
│   ├── files/
│   │   ├── first-login.sh           # NEW  SSH fallback onboarding + bffless-setup cmd
│   │   ├── first-login.test.sh      # NEW  unit test (env-seam paths)
│   │   ├── etc/update-motd.d/99-bffless-readme          # NEW  dynamic MOTD
│   │   └── var/lib/cloud/scripts/per-instance/
│   │       ├── 001-swap             # NEW  first boot: setup-swap.sh
│   │       └── 002-bffless-first-boot   # NEW  first boot: bootstrap + start
│   └── listing/
│       ├── description.md           # NEW  marketplace listing copy
│       └── getting-started.md       # NEW  onboarding steps + script table
└── .github/workflows/
    ├── shell-checks.yml             # NEW  shellcheck + shell unit tests on PR
    └── marketplace-image.yml        # NEW  manual + monthly Packer build

repos/docs-public (separate repo/PR)
└── docs/deployment/digitalocean.md  # MOD  1-Click section + lifecycle scripts + restore
```

---

### Task 1: `scripts/setup-swap.sh` + test, trim compose comment block

**Files:**
- Create: `scripts/setup-swap.sh`
- Create: `scripts/setup-swap.test.sh`
- Modify: `docker-compose.yml:38-70` (swap comment block)

**Interfaces:**
- Produces: `scripts/setup-swap.sh` — idempotent, root-required (env-overridable seams: `SWAPFILE`, `FSTAB`, `MEMINFO`, `SYSCTL_DIR`, `SWAP_SIZE`, `SETUP_SWAP_ALLOW_NONROOT`). Exit 0 on no-op paths. Consumed later by `marketplace/digitalocean/files/var/lib/cloud/scripts/per-instance/001-swap` (Task 11).

- [ ] **Step 1: Write the failing test**

Create `scripts/setup-swap.test.sh` (pattern follows `docker/nginx/render-main-conf.test.sh`):

```bash
#!/bin/bash
# Host-runnable unit tests for scripts/setup-swap.sh (no root, no docker).
# Run: bash scripts/setup-swap.test.sh
set -u
FAILURES=0
SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/setup-swap.sh"

assert_contains() { # file needle label
    if grep -qF "$2" "$1" 2>/dev/null; then echo "ok: $3"; else echo "FAIL: $3 (missing '$2' in $1)"; FAILURES=$((FAILURES+1)); fi
}
assert_no_file() { # path label
    if [ ! -e "$1" ]; then echo "ok: $2"; else echo "FAIL: $2 (unexpected file $1)"; FAILURES=$((FAILURES+1)); fi
}
assert_file() { # path label
    if [ -e "$1" ]; then echo "ok: $2"; else echo "FAIL: $2 (missing file $1)"; FAILURES=$((FAILURES+1)); fi
}
assert_exit0() { # label (checks $?) — call immediately after the command
    if [ "$1" -eq 0 ]; then echo "ok: $2"; else echo "FAIL: $2 (exit $1)"; FAILURES=$((FAILURES+1)); fi
}

make_sandbox() { # $1 = MemTotal kB, $2 = swapon --show output ("" = no swap)
    SB=$(mktemp -d)
    mkdir -p "$SB/bin" "$SB/sysctl.d"
    printf 'MemTotal:       %s kB\n' "$1" > "$SB/meminfo"
    : > "$SB/fstab"
    cat > "$SB/bin/swapon" <<STUB
#!/bin/bash
if [[ "\$*" == *--show* ]]; then printf '%s' '$2'; fi
exit 0
STUB
    cat > "$SB/bin/fallocate" <<'STUB'
#!/bin/bash
# args: -l <size> <path> — create the file like the real thing would
: > "$3"
STUB
    printf '#!/bin/bash\nexit 0\n' > "$SB/bin/mkswap"
    printf '#!/bin/bash\nexit 0\n' > "$SB/bin/sysctl"
    chmod +x "$SB/bin/"*
}

run_swap() { # runs the script inside the sandbox; sets RC
    RC=0
    PATH="$SB/bin:$PATH" SETUP_SWAP_ALLOW_NONROOT=1 \
        SWAPFILE="$SB/swapfile" FSTAB="$SB/fstab" MEMINFO="$SB/meminfo" \
        SYSCTL_DIR="$SB/sysctl.d" bash "$SCRIPT" >/dev/null 2>&1 || RC=$?
}

echo "— case 1: low-RAM host creates swap —"
make_sandbox 987000 ""            # ~1 GB droplet, no active swap
run_swap; assert_exit0 "$RC" "low-RAM run exits 0"
assert_file "$SB/swapfile" "swapfile created"
assert_contains "$SB/fstab" "$SB/swapfile none swap sw 0 0" "fstab entry added"
assert_file "$SB/sysctl.d/99-bffless-swappiness.conf" "swappiness conf written"
assert_contains "$SB/sysctl.d/99-bffless-swappiness.conf" "vm.swappiness=10" "swappiness value"

echo "— case 2: re-run is a no-op (fstab already has entry) —"
run_swap; assert_exit0 "$RC" "re-run exits 0"
if [ "$(grep -c 'none swap sw' "$SB/fstab")" -eq 1 ]; then echo "ok: no duplicate fstab entry"; else echo "FAIL: duplicate fstab entry"; FAILURES=$((FAILURES+1)); fi
rm -rf "$SB"

echo "— case 3: 4GB-class host is a no-op —"
make_sandbox 3900000 ""           # 4 GB droplet reports ~3.8 GB
run_swap; assert_exit0 "$RC" "high-RAM run exits 0"
assert_no_file "$SB/swapfile" "no swapfile on 4GB host"
rm -rf "$SB"

echo "— case 4: active swap is a no-op —"
make_sandbox 987000 'NAME      TYPE SIZE USED PRIO
/swapfile file   2G   0B   -2
'
run_swap; assert_exit0 "$RC" "active-swap run exits 0"
assert_no_file "$SB/swapfile" "no swapfile when swap already active"
rm -rf "$SB"

[ "$FAILURES" -eq 0 ] && echo 'ALL SETUP-SWAP TESTS PASSED' || { echo "$FAILURES FAILURES"; exit 1; }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bash scripts/setup-swap.test.sh`
Expected: FAIL (setup-swap.sh does not exist → every case fails / script error)

- [ ] **Step 3: Write the implementation**

Create `scripts/setup-swap.sh`:

```bash
#!/bin/bash
# Create a 2G swapfile on low-RAM hosts so the OOM killer doesn't take out
# containers. Idempotent: no-ops when swap is already active, when the
# swapfile is already in fstab, or when the host has >= 4 GB RAM.
# Replaces the manual instructions that previously lived in docker-compose.yml.
#
# Usage: sudo ./scripts/setup-swap.sh
#
# Env seams (used by setup-swap.test.sh; production uses the defaults):
#   SWAPFILE FSTAB MEMINFO SYSCTL_DIR SWAP_SIZE SETUP_SWAP_ALLOW_NONROOT
set -euo pipefail

SWAPFILE="${SWAPFILE:-/swapfile}"
FSTAB="${FSTAB:-/etc/fstab}"
MEMINFO="${MEMINFO:-/proc/meminfo}"
SYSCTL_DIR="${SYSCTL_DIR:-/etc/sysctl.d}"
SWAP_SIZE="${SWAP_SIZE:-2G}"
# A "4 GB" VM reports ~3.8 GB MemTotal, a "2 GB" VM ~1.9 GB — 3584 MB splits them.
RAM_SKIP_THRESHOLD_KB=$((3584 * 1024))

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
    echo "Usage: sudo ./scripts/setup-swap.sh"
    echo ""
    echo "Creates a ${SWAP_SIZE} swapfile at ${SWAPFILE} on hosts with < 3.5 GB RAM,"
    echo "persists it in ${FSTAB}, and sets vm.swappiness=10."
    echo "Idempotent: safe to re-run; no-ops on hosts with >= 4 GB RAM."
    exit 0
fi

if [ "$(id -u)" -ne 0 ] && [ -z "${SETUP_SWAP_ALLOW_NONROOT:-}" ]; then
    echo "Run as root: sudo $0" >&2
    exit 1
fi

if [ -n "$(swapon --show 2>/dev/null)" ]; then
    echo "Swap is already active — nothing to do."
    swapon --show
    exit 0
fi

if grep -qF "$SWAPFILE none swap" "$FSTAB" 2>/dev/null; then
    echo "$SWAPFILE already configured in $FSTAB — nothing to do."
    exit 0
fi

ram_kb=$(awk '/^MemTotal:/ {print $2}' "$MEMINFO")
if [ "$ram_kb" -ge "$RAM_SKIP_THRESHOLD_KB" ]; then
    echo "Host has $((ram_kb / 1024)) MB RAM (4 GB class) — swap not needed, skipping."
    exit 0
fi

echo "Host has $((ram_kb / 1024)) MB RAM — creating ${SWAP_SIZE} swapfile at ${SWAPFILE}..."
fallocate -l "$SWAP_SIZE" "$SWAPFILE"
chmod 600 "$SWAPFILE"
mkswap "$SWAPFILE"
swapon "$SWAPFILE"
echo "$SWAPFILE none swap sw 0 0" >> "$FSTAB"

echo 'vm.swappiness=10' > "${SYSCTL_DIR}/99-bffless-swappiness.conf"
sysctl -w vm.swappiness=10 >/dev/null 2>&1 || true

echo "Swap enabled:"
swapon --show
```

Then `chmod +x scripts/setup-swap.sh scripts/setup-swap.test.sh`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bash scripts/setup-swap.test.sh`
Expected: `ALL SETUP-SWAP TESTS PASSED`

- [ ] **Step 5: Run shellcheck**

Run: `shellcheck scripts/setup-swap.sh scripts/setup-swap.test.sh` (install via `sudo apt-get install -y shellcheck` if missing)
Expected: no output

- [ ] **Step 6: Trim the docker-compose.yml swap block**

Replace the block at `docker-compose.yml:38-70` (from `# ====...` `# SWAP CONFIGURATION (Recommended for 1GB-2GB VMs)` through the closing `# ====...` line — leave the memory-tuning comment block above it untouched) with:

```yaml
# =============================================================================
# SWAP (Recommended for 1GB-2GB VMs)
# =============================================================================
# Without swap the OOM killer may terminate containers on small VMs.
# Run the bundled script once (idempotent; no-ops on hosts with >= 4 GB RAM):
#   sudo ./scripts/setup-swap.sh
# Check current swap:  swapon --show ; free -h
# =============================================================================
```

- [ ] **Step 7: Verify compose file still parses**

Run: `docker compose config -q` (if docker is unavailable on this host, run `python3 -c "import yaml,sys; yaml.safe_load(open('docker-compose.yml'))"`)
Expected: exit 0, no errors

- [ ] **Step 8: Commit** (ask the user first if this is the branch's first commit)

```bash
git add scripts/setup-swap.sh scripts/setup-swap.test.sh docker-compose.yml
git commit -m "feat(scripts): add idempotent setup-swap.sh, trim compose swap comment block"
```

---

### Task 2: `scripts/compose-profiles.sh` + test

**Files:**
- Create: `scripts/compose-profiles.sh`
- Create: `scripts/compose-profiles.test.sh`

**Interfaces:**
- Produces: `compose_profiles()` — bash function, echoes a space-prefixed string of `--profile X` args based on `ENABLE_POSTGRES` (default true), `ENABLE_MINIO` (default false), `ENABLE_REDIS` (default false), `SUPERTOKENS_MODE` (default local). Consumed by `update.sh` (Task 5). Callers load `.env` themselves before calling.
- Note: this duplicates the accumulation logic inside `start.sh:116-175` rather than refactoring `start.sh` to source it — `start.sh` interleaves user-facing prints and hard-fail checks with the accumulation, and destabilizing the battle-tested startup path for a 4-line extraction is a bad trade. Do NOT modify `start.sh`.

- [ ] **Step 1: Write the failing test**

Create `scripts/compose-profiles.test.sh`:

```bash
#!/bin/bash
# Unit tests for scripts/compose-profiles.sh. Run: bash scripts/compose-profiles.test.sh
set -u
FAILURES=0
LIB="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/compose-profiles.sh"

check() { # label expected env-assignments...
    local label="$1" expected="$2"; shift 2
    local got
    got=$(env -i bash -c "$* ; source '$LIB'; compose_profiles")
    if [ "$got" = "$expected" ]; then echo "ok: $label"; else echo "FAIL: $label (got '$got', want '$expected')"; FAILURES=$((FAILURES+1)); fi
}

check "defaults: postgres + supertokens" \
    " --profile postgres --profile supertokens" "true"
check "everything on" \
    " --profile postgres --profile minio --profile redis --profile supertokens" \
    "export ENABLE_POSTGRES=true ENABLE_MINIO=true ENABLE_REDIS=true SUPERTOKENS_MODE=local"
check "external DB + managed supertokens" \
    "" "export ENABLE_POSTGRES=false SUPERTOKENS_MODE=managed"
check "minio only extra" \
    " --profile postgres --profile minio --profile supertokens" \
    "export ENABLE_MINIO=true"

[ "$FAILURES" -eq 0 ] && echo 'ALL COMPOSE-PROFILES TESTS PASSED' || { echo "$FAILURES FAILURES"; exit 1; }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bash scripts/compose-profiles.test.sh`
Expected: FAIL (compose-profiles.sh not found)

- [ ] **Step 3: Write the implementation**

Create `scripts/compose-profiles.sh`:

```bash
#!/bin/bash
# Shared helper: compute `docker compose` --profile args from the environment.
# Source this file, then call compose_profiles. Callers load .env first
# (set -a; source .env; set +a) — this helper only reads env vars.
# Defaults mirror start.sh: postgres on, minio off, redis off, supertokens local.

compose_profiles() {
    local profiles=""
    if [ "${ENABLE_POSTGRES:-true}" = "true" ]; then
        profiles="$profiles --profile postgres"
    fi
    if [ "${ENABLE_MINIO:-false}" = "true" ]; then
        profiles="$profiles --profile minio"
    fi
    if [ "${ENABLE_REDIS:-false}" = "true" ]; then
        profiles="$profiles --profile redis"
    fi
    if [ "${SUPERTOKENS_MODE:-local}" = "local" ]; then
        profiles="$profiles --profile supertokens"
    fi
    echo "$profiles"
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bash scripts/compose-profiles.test.sh`
Expected: `ALL COMPOSE-PROFILES TESTS PASSED`

- [ ] **Step 5: shellcheck + commit**

Run: `shellcheck scripts/compose-profiles.sh scripts/compose-profiles.test.sh`

```bash
git add scripts/compose-profiles.sh scripts/compose-profiles.test.sh
git commit -m "feat(scripts): shared compose_profiles helper"
```

---

### Task 3: `restart.sh` + lifecycle test harness

**Files:**
- Create: `restart.sh`
- Create: `scripts/lifecycle.test.sh` (harness + restart case; later tasks append cases)

**Interfaces:**
- Produces: `./restart.sh [start.sh flags]` — cds to its own dir, runs `./stop.sh` then `./start.sh "$@"`. Consumed by `update.sh` (Task 5).
- Produces (test harness): `make_sandbox` copies the lifecycle scripts + `scripts/compose-profiles.sh` into a temp dir with a `bin/docker` stub that appends its argv to `$DOCKER_LOG`; `assert_contains`/`assert_file`/`assert_exit0` helpers identical in shape to Task 1's.

- [ ] **Step 1: Write the failing test (harness + restart case)**

Create `scripts/lifecycle.test.sh`:

```bash
#!/bin/bash
# Host-runnable unit tests for restart.sh / update.sh / logs.sh / status.sh /
# backup.sh. No docker or root needed: external commands are stubbed on PATH
# and each case runs in its own sandbox copy of the scripts.
# Run: bash scripts/lifecycle.test.sh
set -u
FAILURES=0
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

assert_contains() { # file needle label
    if grep -qF "$2" "$1" 2>/dev/null; then echo "ok: $3"; else echo "FAIL: $3 (missing '$2' in $1)"; FAILURES=$((FAILURES+1)); fi
}
assert_not_contains() { # file needle label
    if ! grep -qF "$2" "$1" 2>/dev/null; then echo "ok: $3"; else echo "FAIL: $3 (unexpected '$2' in $1)"; FAILURES=$((FAILURES+1)); fi
}
assert_file() { if [ -e "$1" ]; then echo "ok: $2"; else echo "FAIL: $2 (missing $1)"; FAILURES=$((FAILURES+1)); fi }
assert_exit() { # want got label
    if [ "$2" -eq "$1" ]; then echo "ok: $3"; else echo "FAIL: $3 (exit $2, want $1)"; FAILURES=$((FAILURES+1)); fi
}

make_sandbox() {
    SB=$(mktemp -d)
    mkdir -p "$SB/app/scripts" "$SB/bin"
    for f in restart.sh update.sh logs.sh status.sh backup.sh; do
        [ -f "$REPO_ROOT/$f" ] && cp "$REPO_ROOT/$f" "$SB/app/"
    done
    cp "$REPO_ROOT/scripts/compose-profiles.sh" "$SB/app/scripts/" 2>/dev/null || true
    # Default docker stub: log argv, succeed. Cases overwrite for richer behavior.
    cat > "$SB/bin/docker" <<'STUB'
#!/bin/bash
echo "docker $*" >> "$DOCKER_LOG"
exit 0
STUB
    chmod +x "$SB/bin/docker"
    export DOCKER_LOG="$SB/docker.log"
    : > "$DOCKER_LOG"
}

# ---------------------------------------------------------------- restart.sh
echo "— restart.sh: order + flag passthrough —"
(
    make_sandbox
    cat > "$SB/app/stop.sh" <<'STUB'
#!/bin/bash
echo "stop" >> calls.log
STUB
    cat > "$SB/app/start.sh" <<'STUB'
#!/bin/bash
echo "start $*" >> calls.log
STUB
    chmod +x "$SB/app/stop.sh" "$SB/app/start.sh"
    (cd "$SB/app" && PATH="$SB/bin:$PATH" ./restart.sh --all); rc=$?
    assert_exit 0 "$rc" "restart exits 0"
    assert_contains "$SB/app/calls.log" "stop" "stop.sh ran"
    assert_contains "$SB/app/calls.log" "start --all" "start.sh got --all"
    if [ "$(head -1 "$SB/app/calls.log")" = "stop" ]; then echo "ok: stop before start"; else echo "FAIL: stop before start"; FAILURES=$((FAILURES+1)); fi
    rm -rf "$SB"
)

[ "$FAILURES" -eq 0 ] && echo 'ALL LIFECYCLE TESTS PASSED' || { echo "$FAILURES FAILURES"; exit 1; }
```

Note for later tasks: append new cases ABOVE the final `[ "$FAILURES" ...]` line. The subshell `( ... )` per case keeps `PATH`/cwd/DOCKER_LOG isolated — but `FAILURES=$((FAILURES+1))` inside a subshell does not propagate, so each case's subshell must end with `exit "$FAILURES"` and the caller adds it: change every case to the form:

```bash
(
    make_sandbox
    FAILURES=0
    ...case body...
    rm -rf "$SB"
    exit "$FAILURES"
); FAILURES=$((FAILURES+$?))
```

Use exactly that form for the restart case above and all cases added later.

- [ ] **Step 2: Run test to verify it fails**

Run: `bash scripts/lifecycle.test.sh`
Expected: FAIL (restart.sh missing from sandbox → `./restart.sh: No such file`)

- [ ] **Step 3: Write the implementation**

Create `restart.sh`:

```bash
#!/bin/bash
# Restart BFFless services: ./stop.sh then ./start.sh.
# Any flags are passed through to start.sh (see ./start.sh --help).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
    echo "Usage: ./restart.sh [start.sh flags]"
    echo ""
    echo "Stops all services (./stop.sh), then starts them again (./start.sh)."
    echo "Flags are passed through to start.sh, e.g.:"
    echo "  ./restart.sh --all       restart with every optional service"
    echo "  ./restart.sh --minimal   restart with core services only"
    exit 0
fi

./stop.sh
./start.sh "$@"
```

`chmod +x restart.sh`

- [ ] **Step 4: Run test to verify it passes**

Run: `bash scripts/lifecycle.test.sh`
Expected: `ALL LIFECYCLE TESTS PASSED`

- [ ] **Step 5: shellcheck + commit**

Run: `shellcheck restart.sh scripts/lifecycle.test.sh`

```bash
git add restart.sh scripts/lifecycle.test.sh
git commit -m "feat(scripts): restart.sh with start.sh flag passthrough"
```

---

### Task 4: `logs.sh`

**Files:**
- Create: `logs.sh`
- Modify: `scripts/lifecycle.test.sh` (append case)

**Interfaces:**
- Produces: `./logs.sh [service]` — `docker compose <all profiles> logs -f --tail=100 [service]`. All four profiles are passed (same trick as `stop.sh:45`) so every service that exists is included regardless of `.env`.

- [ ] **Step 1: Append the failing test case**

Append to `scripts/lifecycle.test.sh` (above the final summary line, using the subshell-exit form from Task 3):

```bash
echo "— logs.sh: full compose invocation + service filter —"
(
    make_sandbox
    FAILURES=0
    (cd "$SB/app" && PATH="$SB/bin:$PATH" ./logs.sh backend); rc=$?
    assert_exit 0 "$rc" "logs exits 0"
    assert_contains "$DOCKER_LOG" \
        "docker compose --profile postgres --profile minio --profile redis --profile supertokens logs -f --tail=100 backend" \
        "logs passes all profiles + service"
    rm -rf "$SB"
    exit "$FAILURES"
); FAILURES=$((FAILURES+$?))
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bash scripts/lifecycle.test.sh`
Expected: FAIL on the logs case

- [ ] **Step 3: Write the implementation**

Create `logs.sh`:

```bash
#!/bin/bash
# Follow logs from all BFFless services, or a single service.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
    echo "Usage: ./logs.sh [service]"
    echo ""
    echo "Follows logs (last 100 lines) for all services, or one of:"
    echo "  nginx backend frontend postgres minio redis supertokens"
    exit 0
fi

# Pass every profile (same trick as stop.sh) so any service that exists is
# included, whatever this install has enabled.
ALL_PROFILES="--profile postgres --profile minio --profile redis --profile supertokens"
# shellcheck disable=SC2086  # ALL_PROFILES is an arg list by design
docker compose $ALL_PROFILES logs -f --tail=100 "$@"
```

`chmod +x logs.sh`

- [ ] **Step 4: Run test to verify it passes**

Run: `bash scripts/lifecycle.test.sh`
Expected: `ALL LIFECYCLE TESTS PASSED`

- [ ] **Step 5: shellcheck + commit**

Run: `shellcheck logs.sh`

```bash
git add logs.sh scripts/lifecycle.test.sh
git commit -m "feat(scripts): logs.sh — follow all-profile compose logs"
```

---

### Task 5: `update.sh`

**Files:**
- Create: `update.sh`
- Modify: `scripts/lifecycle.test.sh` (append 2 cases)

**Interfaces:**
- Consumes: `compose_profiles()` from `scripts/compose-profiles.sh` (Task 2); `./restart.sh` (Task 3).
- Produces: `./update.sh` — prints current version (`package.json` version + short SHA), aborts on dirty git tree, `git pull --ff-only`, profile-aware `docker compose pull`, `./restart.sh`, prints new version.

- [ ] **Step 1: Append the failing test cases**

Append to `scripts/lifecycle.test.sh` (subshell-exit form):

```bash
echo "— update.sh: aborts on dirty tree —"
(
    make_sandbox
    FAILURES=0
    cd "$SB/app"
    printf '{\n  "version": "0.0.1"\n}\n' > package.json
    printf '#!/bin/bash\necho "restart $*" >> calls.log\n' > restart.sh && chmod +x restart.sh
    git init -q && git config user.email t@t && git config user.name t
    git add -A && git commit -qm init
    echo dirty > dirty.txt                       # untracked file = dirty tree
    PATH="$SB/bin:$PATH" ./update.sh >/dev/null 2>&1; rc=$?
    assert_exit 1 "$rc" "update exits 1 on dirty tree"
    assert_not_contains "$DOCKER_LOG" "pull" "no image pull on dirty tree"
    assert_not_contains "calls.log" "restart" "no restart on dirty tree"
    cd / && rm -rf "$SB"
    exit "$FAILURES"
); FAILURES=$((FAILURES+$?))

echo "— update.sh: clean tree pulls with detected profiles and restarts —"
(
    make_sandbox
    FAILURES=0
    cd "$SB/app"
    printf '{\n  "version": "0.0.1"\n}\n' > package.json
    printf 'ENABLE_MINIO=true\n' > .env
    printf '#!/bin/bash\necho "restart $*" >> calls.log\n' > restart.sh && chmod +x restart.sh
    git init -q && git config user.email t@t && git config user.name t
    git add -A && git commit -qm init
    # Give the repo an upstream so `git pull --ff-only` succeeds (already up to date)
    git clone -q --bare . "$SB/origin.git"
    git remote add origin "$SB/origin.git" && git fetch -q origin
    branch=$(git symbolic-ref --short HEAD)
    git branch -q --set-upstream-to="origin/$branch"
    PATH="$SB/bin:$PATH" ./update.sh >/dev/null 2>&1; rc=$?
    assert_exit 0 "$rc" "update exits 0 on clean tree"
    assert_contains "$DOCKER_LOG" \
        "docker compose --profile postgres --profile minio --profile supertokens pull" \
        "profile-aware image pull (minio on, redis off)"
    assert_contains "calls.log" "restart" "restart.sh invoked"
    cd / && rm -rf "$SB"
    exit "$FAILURES"
); FAILURES=$((FAILURES+$?))
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bash scripts/lifecycle.test.sh`
Expected: FAIL on both update cases (update.sh missing)

- [ ] **Step 3: Write the implementation**

Create `update.sh`:

```bash
#!/bin/bash
# Update this BFFless install: git pull + docker compose pull + restart.
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
    cat <<'EOF'
Usage: ./update.sh

Updates this BFFless install:
  1. Aborts if the git tree has local changes (commit or stash them first)
  2. git pull --ff-only
  3. docker compose pull (only the profiles this install has enabled)
  4. ./restart.sh — start.sh rebuilds the local nginx image from the pulled tree
EOF
    exit 0
fi

current_version() {
    local pkg_version sha
    pkg_version=$(sed -nE 's/.*"version": *"([^"]+)".*/\1/p' package.json | head -1)
    sha=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
    echo "v${pkg_version} (${sha})"
}

echo -e "Current version: ${GREEN}$(current_version)${NC}"

if [ -n "$(git status --porcelain)" ]; then
    echo -e "${RED}✗ Local changes detected in $(pwd) — update.sh only fast-forwards a clean tree.${NC}"
    echo "  Review with:   git status"
    echo "  Then commit them, or stash/discard:  git stash"
    exit 1
fi

echo "Pulling latest code..."
git pull --ff-only

if [ -f .env ]; then
    set -a
    # shellcheck disable=SC1091
    source .env
    set +a
fi
# shellcheck disable=SC1091
source scripts/compose-profiles.sh
PROFILES=$(compose_profiles)

echo "Pulling latest images..."
# shellcheck disable=SC2086  # PROFILES is an arg list by design
docker compose $PROFILES pull

./restart.sh

echo -e "Updated to: ${GREEN}$(current_version)${NC}"
```

`chmod +x update.sh`

- [ ] **Step 4: Run test to verify it passes**

Run: `bash scripts/lifecycle.test.sh`
Expected: `ALL LIFECYCLE TESTS PASSED`

- [ ] **Step 5: shellcheck + commit**

Run: `shellcheck update.sh`

```bash
git add update.sh scripts/lifecycle.test.sh
git commit -m "feat(scripts): update.sh — dirty-guarded ff-only update with profile-aware pull"
```

---

### Task 6: `status.sh`

**Files:**
- Create: `status.sh`
- Modify: `scripts/lifecycle.test.sh` (append case)

**Interfaces:**
- Produces: `./status.sh` — always exits 0; sections: Version (repo version/SHA, running image refs + `org.opencontainers.image.version` labels, restart-pending warning when a container's image ID differs from the tag's current image ID), Services (`docker compose ps`), Resources (`free -h`, `swapon --show`, `df -h /`), Domain & SSL (domain from `bootstrap/instance.env` when `STATE=applied`, else `.env`; cert expiry via `openssl x509 -enddate` for `ssl/fullchain.pem` and `ssl/bootstrap-selfsigned.crt`), Backend health (`curl http://localhost:3000/api/health`).
- Restart-pending detection compares `docker inspect --format '{{.Image}}' <container>` (image ID the container runs) with `docker image inspect --format '{{.Id}}' <image-ref>` (image ID the tag currently points at) — works even though the tag is usually `latest`.

- [ ] **Step 1: Append the failing test case**

Append to `scripts/lifecycle.test.sh` (subshell-exit form):

```bash
echo "— status.sh: reports sections, restart-pending, and survives failures —"
(
    make_sandbox
    FAILURES=0
    cd "$SB/app"
    printf '{\n  "version": "0.0.1"\n}\n' > package.json
    git init -q && git config user.email t@t && git config user.name t
    git add -A && git commit -qm init
    mkdir -p bootstrap ssl
    printf 'STATE=applied\nPRIMARY_DOMAIN=example.com\n' > bootstrap/instance.env
    # docker stub: running container image ID differs from the tag's image ID
    cat > "$SB/bin/docker" <<'STUB'
#!/bin/bash
echo "docker $*" >> "$DOCKER_LOG"
case "$*" in
    "inspect --format {{.Image}} assethost-backend")        echo "sha256:aaa" ;;
    "inspect --format {{.Config.Image}} assethost-backend") echo "ghcr.io/bffless/ce-backend:latest" ;;
    "inspect --format {{.Image}} assethost-frontend")        echo "sha256:ccc" ;;
    "inspect --format {{.Config.Image}} assethost-frontend") echo "ghcr.io/bffless/ce-frontend:latest" ;;
    "image inspect --format {{.Id}} ghcr.io/bffless/ce-backend:latest")  echo "sha256:bbb" ;;
    "image inspect --format {{.Id}} ghcr.io/bffless/ce-frontend:latest") echo "sha256:ccc" ;;
    image\ inspect*Labels*) echo "0.3.2" ;;
    compose*ps*) echo "NAME  STATUS" ;;
    *) : ;;
esac
exit 0
STUB
    chmod +x "$SB/bin/docker"
    # curl stub: health check fails
    printf '#!/bin/bash\nexit 7\n' > "$SB/bin/curl" && chmod +x "$SB/bin/curl"
    out="$SB/status.out"
    PATH="$SB/bin:$PATH" ./status.sh > "$out" 2>&1; rc=$?
    assert_exit 0 "$rc" "status exits 0 even with failed health check"
    assert_contains "$out" "v0.0.1" "repo version shown"
    assert_contains "$out" "restart" "restart-pending warning shown (backend IDs differ)"
    assert_contains "$out" "example.com" "domain from bootstrap/instance.env"
    assert_contains "$out" "health check failed" "failed health reported, not fatal"
    cd / && rm -rf "$SB"
    exit "$FAILURES"
); FAILURES=$((FAILURES+$?))
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bash scripts/lifecycle.test.sh`
Expected: FAIL on the status case

- [ ] **Step 3: Write the implementation**

Create `status.sh`:

```bash
#!/bin/bash
# Show the health of this BFFless install: versions, services, resources,
# domain/SSL, and a backend health check. Always exits 0 — it reports
# problems, it doesn't fail on them (hence no `set -e`).
set -uo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BOLD='\033[1m'; NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
    echo "Usage: ./status.sh"
    echo ""
    echo "Reports: repo vs running image versions (with restart-pending warning),"
    echo "service status, RAM/swap/disk, configured domain, SSL cert expiry, and"
    echo "a backend health check."
    exit 0
fi

section() {
    echo ""
    echo -e "${BOLD}$1${NC}"
    echo "────────────────────────────────────────────────"
}

section "Version"
PKG_VERSION=$(sed -nE 's/.*"version": *"([^"]+)".*/\1/p' package.json | head -1)
GIT_SHA=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
echo "Checked-out repo:  v${PKG_VERSION} (${GIT_SHA})"

restart_pending=false
for svc in backend frontend; do
    container="assethost-${svc}"
    running_id=$(docker inspect --format '{{.Image}}' "$container" 2>/dev/null | head -1)
    if [ -z "$running_id" ]; then
        echo -e "${svc}: ${YELLOW}not running${NC}"
        continue
    fi
    image_ref=$(docker inspect --format '{{.Config.Image}}' "$container" 2>/dev/null | head -1)
    version_label=$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.version"}}' "$image_ref" 2>/dev/null | head -1)
    echo "${svc}: ${image_ref}${version_label:+ (${version_label})}"
    tag_id=$(docker image inspect --format '{{.Id}}' "$image_ref" 2>/dev/null | head -1)
    if [ -n "$tag_id" ] && [ "$running_id" != "$tag_id" ]; then
        restart_pending=true
    fi
done
if [ "$restart_pending" = true ]; then
    echo -e "${YELLOW}⚠ A newer image has been pulled but is not running — run ./restart.sh${NC}"
fi

section "Services"
ALL_PROFILES="--profile postgres --profile minio --profile redis --profile supertokens"
# shellcheck disable=SC2086
docker compose $ALL_PROFILES ps 2>/dev/null || echo -e "${RED}✗ docker compose unavailable${NC}"

section "Resources"
free -h 2>/dev/null || true
echo ""
swapon --show 2>/dev/null | grep -q . && swapon --show || echo -e "${YELLOW}No swap configured — consider: sudo ./scripts/setup-swap.sh${NC}"
echo ""
df -h / 2>/dev/null || true

section "Domain & SSL"
domain=""
if [ -f bootstrap/instance.env ]; then
    domain=$( ( STATE=""; PRIMARY_DOMAIN=""
                # shellcheck disable=SC1091
                . bootstrap/instance.env
                [ "$STATE" = "applied" ] && echo "$PRIMARY_DOMAIN" ) 2>/dev/null )
fi
if [ -z "$domain" ] && [ -f .env ]; then
    domain=$(grep '^PRIMARY_DOMAIN=' .env 2>/dev/null | head -1 | cut -d= -f2-)
fi
if [ -n "$domain" ]; then
    echo -e "Configured domain: ${GREEN}${domain}${NC}  (admin: https://admin.${domain})"
else
    echo -e "${YELLOW}No domain configured yet — instance is in bootstrap mode.${NC}"
fi
for cert in ssl/fullchain.pem ssl/bootstrap-selfsigned.crt; do
    [ -f "$cert" ] || continue
    enddate=$(openssl x509 -enddate -noout -in "$cert" 2>/dev/null | cut -d= -f2-)
    echo "${cert}: expires ${enddate:-unreadable}"
done

section "Backend health"
if response=$(curl -fs -m 5 http://localhost:3000/api/health 2>/dev/null); then
    echo -e "${GREEN}✓ Backend healthy:${NC} ${response}"
else
    echo -e "${RED}✗ Backend health check failed (http://localhost:3000/api/health)${NC}"
    echo "  Check logs: ./logs.sh backend"
fi

exit 0
```

`chmod +x status.sh`

- [ ] **Step 4: Run test to verify it passes**

Run: `bash scripts/lifecycle.test.sh`
Expected: `ALL LIFECYCLE TESTS PASSED`

- [ ] **Step 5: Sanity-run on this host** (repo has no containers here — expect graceful degradation)

Run: `./status.sh`
Expected: exit 0; "not running" for backend/frontend; no bash errors

- [ ] **Step 6: shellcheck + commit**

Run: `shellcheck status.sh`

```bash
git add status.sh scripts/lifecycle.test.sh
git commit -m "feat(scripts): status.sh — versions, restart-pending, resources, SSL, health"
```

---

### Task 7: `backup.sh`

**Files:**
- Create: `backup.sh`
- Modify: `scripts/lifecycle.test.sh` (append case)

**Interfaces:**
- Produces: `./backup.sh` → `backups/bffless-backup-<YYYYmmdd-HHMMSS>.tar.gz` (mode 600) containing `database.sql` (pg_dump via `docker exec assethost-postgres pg_dump -U postgres assethost`), asset storage (`uploads/` copied from `assethost-backend:/app/apps/backend/uploads`, or `minio-data/` from `assethost-minio:/data` when `.env` has `ENABLE_MINIO=true`), plus `.env`, `bootstrap/`, `ssl/`. Skips (with warning) the DB dump when the postgres container isn't running (external `DATABASE_URL` installs). Restore stays documented-manual (docs task 15).
- Deviation from spec (deliberate): the archive also includes `.env` + `bootstrap/` + `ssl/` — a DB+assets backup that omits `ENCRYPTION_KEY` and instance identity cannot actually be restored. The script warns that the archive contains secrets.

- [ ] **Step 1: Append the failing test case**

Append to `scripts/lifecycle.test.sh` (subshell-exit form):

```bash
echo "— backup.sh: archive contains db dump, assets, and config —"
(
    make_sandbox
    FAILURES=0
    cd "$SB/app"
    printf 'PRIMARY_DOMAIN=example.com\n' > .env      # ENABLE_MINIO unset → local storage path
    mkdir -p bootstrap ssl
    echo 'STATE=applied' > bootstrap/instance.env
    echo 'cert' > ssl/fullchain.pem
    cat > "$SB/bin/docker" <<'STUB'
#!/bin/bash
echo "docker $*" >> "$DOCKER_LOG"
case "$*" in
    "inspect --format {{.State.Running}} assethost-postgres") echo "true" ;;
    exec*pg_dump*) echo "-- pg_dump stub" ;;
    cp\ assethost-backend:*)
        dest="${!#}"
        mkdir -p "$dest" && echo blob > "$dest/asset.bin" ;;
esac
exit 0
STUB
    chmod +x "$SB/bin/docker"
    PATH="$SB/bin:$PATH" ./backup.sh >/dev/null 2>&1; rc=$?
    assert_exit 0 "$rc" "backup exits 0"
    archive=$(ls backups/bffless-backup-*.tar.gz 2>/dev/null | head -1)
    assert_file "$archive" "archive created"
    perms=$(stat -c %a "$archive" 2>/dev/null)
    if [ "$perms" = "600" ]; then echo "ok: archive is 600"; else echo "FAIL: archive perms $perms"; FAILURES=$((FAILURES+1)); fi
    listing="$SB/tar.lst"; tar -tzf "$archive" > "$listing"
    assert_contains "$listing" "database.sql" "db dump in archive"
    assert_contains "$listing" "uploads/asset.bin" "local assets in archive"
    assert_contains "$listing" ".env" ".env in archive"
    assert_contains "$listing" "bootstrap/instance.env" "bootstrap identity in archive"
    assert_contains "$listing" "ssl/fullchain.pem" "certs in archive"
    cd / && rm -rf "$SB"
    exit "$FAILURES"
); FAILURES=$((FAILURES+$?))
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bash scripts/lifecycle.test.sh`
Expected: FAIL on the backup case

- [ ] **Step 3: Write the implementation**

Create `backup.sh`:

```bash
#!/bin/bash
# Back up this BFFless install: database dump + asset storage + config/identity.
set -euo pipefail

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
    cat <<'EOF'
Usage: ./backup.sh

Writes backups/bffless-backup-<timestamp>.tar.gz containing:
  database.sql      pg_dump of the bundled Postgres (skipped for external DBs)
  uploads/          local asset storage (or minio-data/ when ENABLE_MINIO=true)
  .env bootstrap/ ssl/   config, instance identity, certificates

The archive contains secrets — store it securely.
Restore guide: https://docs.bffless.dev/deployment/digitalocean#restoring-a-backup
EOF
    exit 0
fi

TIMESTAMP=$(date +%Y%m%d-%H%M%S)
WORK_DIR=$(mktemp -d)
trap 'rm -rf "$WORK_DIR"' EXIT
mkdir -p backups

# 1. Database
if [ "$(docker inspect --format '{{.State.Running}}' assethost-postgres 2>/dev/null)" = "true" ]; then
    echo "Dumping PostgreSQL database..."
    docker exec assethost-postgres pg_dump -U postgres assethost > "$WORK_DIR/database.sql"
else
    echo -e "${YELLOW}⚠ Postgres container not running — skipping database dump.${NC}"
    echo "  (External DATABASE_URL installs: back that database up with your provider's tools.)"
fi

# 2. Asset storage
if grep -q '^ENABLE_MINIO=true' .env 2>/dev/null; then
    echo "Copying MinIO data..."
    docker cp assethost-minio:/data "$WORK_DIR/minio-data"
else
    echo "Copying local asset storage..."
    docker cp assethost-backend:/app/apps/backend/uploads "$WORK_DIR/uploads"
fi

# 3. Config + identity (small but essential for restore: secrets, domain, certs)
[ -f .env ] && cp .env "$WORK_DIR/"
[ -d bootstrap ] && cp -r bootstrap "$WORK_DIR/"
[ -d ssl ] && cp -r ssl "$WORK_DIR/"

ARCHIVE="backups/bffless-backup-${TIMESTAMP}.tar.gz"
tar czf "$ARCHIVE" -C "$WORK_DIR" .
chmod 600 "$ARCHIVE"

echo -e "${GREEN}✓ Backup written to ${ARCHIVE}${NC}"
echo -e "${YELLOW}⚠ The archive contains secrets (.env, certificates) — store it securely.${NC}"
echo "  Restore guide: https://docs.bffless.dev/deployment/digitalocean#restoring-a-backup"
```

`chmod +x backup.sh`

Note: `tar -tzf` lists entries with a `./` prefix (`./database.sql`) — the test's `grep -F "database.sql"` matches either way.

- [ ] **Step 4: Run test to verify it passes**

Run: `bash scripts/lifecycle.test.sh`
Expected: `ALL LIFECYCLE TESTS PASSED`

- [ ] **Step 5: shellcheck + commit**

Run: `shellcheck backup.sh`

```bash
git add backup.sh scripts/lifecycle.test.sh
git commit -m "feat(scripts): backup.sh — pg_dump + assets + config archive"
```

---

### Task 8: CI — `shell-checks.yml`

**Files:**
- Create: `.github/workflows/shell-checks.yml`

**Interfaces:**
- Consumes: the three test scripts from Tasks 1-7 and the marketplace scripts created in Tasks 10-12 (workflow lists them explicitly; it lands last-file-wins safe because paths that don't exist yet only run when the paths filter matches — see note below).
- Note: this task is ordered before the marketplace tasks, so the shellcheck list here includes files created later. Land this workflow file in this task with the FULL final list — the workflow only triggers on PRs touching these paths, and the branch will contain all files by PR time.

- [ ] **Step 1: Write the workflow**

Create `.github/workflows/shell-checks.yml`:

```yaml
name: Shell Checks

on:
  pull_request:
    paths:
      - '*.sh'
      - 'scripts/**'
      - 'marketplace/**'
      - '.github/workflows/shell-checks.yml'

permissions:
  contents: read

jobs:
  shell-checks:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      # Only the scripts introduced by the DO 1-Click work are linted —
      # pre-existing scripts (setup.sh, start.sh, ...) are not shellcheck-clean
      # and cleaning them up is out of scope. Vendored DO scripts
      # (900-cleanup.sh, 999-img_check.sh) are upstream code and excluded.
      - name: shellcheck
        run: |
          shellcheck \
            restart.sh update.sh logs.sh status.sh backup.sh \
            scripts/setup-swap.sh scripts/compose-profiles.sh \
            scripts/setup-swap.test.sh scripts/compose-profiles.test.sh scripts/lifecycle.test.sh \
            marketplace/digitalocean/scripts/010-prep.sh \
            marketplace/digitalocean/scripts/020-docker.sh \
            marketplace/digitalocean/scripts/030-bffless.sh \
            marketplace/digitalocean/files/first-login.sh \
            marketplace/digitalocean/files/etc/update-motd.d/99-bffless-readme \
            marketplace/digitalocean/files/var/lib/cloud/scripts/per-instance/001-swap \
            marketplace/digitalocean/files/var/lib/cloud/scripts/per-instance/002-bffless-first-boot

      - name: Shell unit tests
        run: |
          bash scripts/setup-swap.test.sh
          bash scripts/compose-profiles.test.sh
          bash scripts/lifecycle.test.sh
          bash marketplace/digitalocean/files/first-login.test.sh
```

- [ ] **Step 2: Validate the workflow syntax**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/shell-checks.yml'))"`
Expected: exit 0

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/shell-checks.yml
git commit -m "ci: shellcheck + shell unit tests for lifecycle and marketplace scripts"
```

---

### Task 9: CE README "Managing your instance" section

**Files:**
- Modify: `README.md` (insert new `## Managing your instance` between `## Setup` and `## Technology Stack` at line ~71; absorb the existing `### Updating` subsection at lines ~58-69)

- [ ] **Step 1: Edit README.md**

Remove the `### Updating` subsection (lines ~58-69, the one containing the manual `git pull` / `./stop.sh` / `docker compose pull` / `./start.sh` block) and insert after the `## Setup` section:

```markdown
## Managing your instance

Day-2 operations are covered by seven scripts in the repo root. They work on
any install (DigitalOcean 1-Click, manual droplet, home server) and are safe
to re-run.

| Script | What it does |
| --- | --- |
| `./start.sh` | Start services (profile-aware; `--all`, `--minimal`) |
| `./stop.sh` | Stop services (`--volumes` also deletes data — careful) |
| `./restart.sh` | `stop.sh` + `start.sh`; flags pass through to `start.sh` |
| `./update.sh` | Upgrade: `git pull --ff-only` → pull images → restart. Aborts on a dirty tree |
| `./logs.sh [service]` | Follow logs for all services, or one (`backend`, `nginx`, ...) |
| `./status.sh` | Versions (with restart-pending warning), services, RAM/swap/disk, domain, SSL expiry, health check |
| `./backup.sh` | `backups/bffless-backup-<ts>.tar.gz`: database dump + assets + config. Contains secrets — store securely |

On small VMs (1–2 GB RAM), enable swap once so the OOM killer doesn't take
out containers:

```bash
sudo ./scripts/setup-swap.sh   # idempotent; no-ops on hosts with >= 4 GB RAM
```
```

- [ ] **Step 2: Verify the README renders**

Run: `grep -n "Managing your instance" README.md && ! grep -n "### Updating" README.md`
Expected: the new section exists, the old subsection is gone

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: Managing your instance — document the seven lifecycle scripts"
```

---

### Task 10: Marketplace scaffolding — Packer template, prep + docker provisioners, vendored DO scripts

**Files:**
- Create: `marketplace/digitalocean/template.pkr.hcl`
- Create: `marketplace/digitalocean/scripts/010-prep.sh`
- Create: `marketplace/digitalocean/scripts/020-docker.sh`
- Create: `marketplace/digitalocean/scripts/900-cleanup.sh` (vendored)
- Create: `marketplace/digitalocean/scripts/999-img_check.sh` (vendored)

**Interfaces:**
- Produces: `packer build` entrypoint consuming `DIGITALOCEAN_API_TOKEN` env var; provisioner scripts run as root on the build droplet in numeric order. Task 11 adds `030-bffless.sh` to the template's script list — the list in this task ALREADY includes it (file arrives next task; `packer validate` does not check script existence, and the two tasks land in the same PR).

- [ ] **Step 1: Vendor the DO scripts**

```bash
mkdir -p marketplace/digitalocean/scripts
curl -fsSL -o marketplace/digitalocean/scripts/900-cleanup.sh https://raw.githubusercontent.com/digitalocean/marketplace-partners/master/scripts/90-cleanup.sh
curl -fsSL -o marketplace/digitalocean/scripts/999-img_check.sh https://raw.githubusercontent.com/digitalocean/marketplace-partners/master/scripts/99-img-check.sh
chmod +x marketplace/digitalocean/scripts/900-cleanup.sh marketplace/digitalocean/scripts/999-img_check.sh
head -5 marketplace/digitalocean/scripts/900-cleanup.sh   # sanity: real script, not an error page
```

Add a one-line provenance header comment to NEITHER file (keep byte-identical to upstream); provenance is recorded in `marketplace/digitalocean/README.md` (Task 14). Verified: `999-img_check.sh` exits 1 on validation failure, so it fails the Packer build as required.

- [ ] **Step 2: Write `scripts/010-prep.sh`**

```bash
#!/bin/bash
# Packer provisioner: base OS prep for the DO Marketplace image.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

# The base image runs unattended-upgrades on first boot — wait for apt locks.
while fuser /var/lib/dpkg/lock-frontend >/dev/null 2>&1 \
   || fuser /var/lib/apt/lists/lock >/dev/null 2>&1; do
    echo "Waiting for apt locks..."
    sleep 5
done

apt-get update
apt-get -o Dpkg::Options::="--force-confold" upgrade -y
apt-get install -y git ufw curl openssl

# img_check requires an enabled firewall. Docker publishes 80/443 via iptables
# directly (bypassing ufw), but the explicit allows document intent and cover
# any host-level services.
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
```

- [ ] **Step 3: Write `scripts/020-docker.sh`** (mirrors `setup.sh` `install_docker()`, lines 261-290)

```bash
#!/bin/bash
# Packer provisioner: install Docker CE + compose plugin.
# Mirrors setup.sh's install_docker() so the image matches what setup.sh
# would install on a manually-provisioned droplet.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

apt-get remove -y docker docker-engine docker.io containerd runc 2>/dev/null || true
apt-get update
apt-get install -y ca-certificates curl gnupg lsb-release
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable docker
systemctl start docker
```

- [ ] **Step 4: Write `template.pkr.hcl`**

```hcl
packer {
  required_plugins {
    digitalocean = {
      version = ">= 1.4.0"
      source  = "github.com/digitalocean/digitalocean"
    }
  }
}

variable "do_token" {
  type      = string
  default   = env("DIGITALOCEAN_API_TOKEN")
  sensitive = true
}

variable "region" {
  type    = string
  default = "nyc3"
}

variable "size" {
  type = string
  # Build on the smallest droplet the listing supports (DO guidance).
  default = "s-1vcpu-1gb"
}

source "digitalocean" "bffless-ce" {
  api_token     = var.do_token
  image         = "ubuntu-24-04-x64"
  region        = var.region
  size          = var.size
  ssh_username  = "root"
  snapshot_name = "bffless-ce-{{timestamp}}"
  tags          = ["bffless", "marketplace"]
}

build {
  sources = ["source.digitalocean.bffless-ce"]

  provisioner "shell" {
    environment_vars = ["DEBIAN_FRONTEND=noninteractive"]
    scripts = [
      "scripts/010-prep.sh",
      "scripts/020-docker.sh",
      "scripts/030-bffless.sh",
      "scripts/900-cleanup.sh",
      "scripts/999-img_check.sh",
    ]
  }
}
```

- [ ] **Step 5: Validate**

Run: `shellcheck marketplace/digitalocean/scripts/010-prep.sh marketplace/digitalocean/scripts/020-docker.sh`
Then, if the `packer` CLI is available locally (`packer version`): `cd marketplace/digitalocean && packer init template.pkr.hcl && packer validate template.pkr.hcl` (needs no DO token for validate; `packer init` downloads the plugin). If packer is not installed on this host, skip — the CI workflow (Task 13) runs `packer validate` on every build, and syntax is simple HCL2.
Expected: no shellcheck output; `The configuration is valid.` if packer ran

- [ ] **Step 6: Commit**

```bash
git add marketplace/digitalocean/template.pkr.hcl marketplace/digitalocean/scripts/
git commit -m "feat(marketplace): DO Packer template, prep + docker provisioners, vendored DO validation scripts"
```

---

### Task 11: `030-bffless.sh` + cloud-init first-boot scripts

**Files:**
- Create: `marketplace/digitalocean/scripts/030-bffless.sh`
- Create: `marketplace/digitalocean/files/var/lib/cloud/scripts/per-instance/001-swap`
- Create: `marketplace/digitalocean/files/var/lib/cloud/scripts/per-instance/002-bffless-first-boot`

**Interfaces:**
- Consumes: `scripts/setup-swap.sh` (Task 1), `setup.sh --bootstrap` + `start.sh` (existing), `first-login.sh` + MOTD file (created Task 12 — `030-bffless.sh` references their in-repo paths; both tasks land in the same PR).
- Produces: image state — repo at `/opt/bffless` (warm cache: images pre-pulled, nginx build cached), MOTD + per-instance scripts installed to system paths, `/usr/local/bin/bffless-setup` symlink, `.bashrc` first-login hook. Per-instance scripts run once per NEW droplet (cloud-init per-instance semantics), writing `/var/log/bffless-first-boot.log`.
- First-boot sequencing: cloud-init runs per-instance scripts in lexical order — `001-swap` (swap exists before any container starts) then `002-bffless-first-boot` (`setup.sh --bootstrap` generates per-droplet secrets + claim token, `start.sh` brings the wizard up at `https://<droplet-ip>/`).

- [ ] **Step 1: Write `scripts/030-bffless.sh`**

```bash
#!/bin/bash
# Packer provisioner: warm-cache BFFless install at /opt/bffless.
# The image bakes NO .env, NO secrets, NO certs — per-droplet configuration
# happens at first boot (002-bffless-first-boot) and in the browser wizard.
set -euo pipefail

INSTALL_DIR=/opt/bffless
MARKETPLACE_DIR="$INSTALL_DIR/marketplace/digitalocean"

git clone https://github.com/bffless/ce.git "$INSTALL_DIR"
cd "$INSTALL_DIR"

# Pre-pull every profile's images so a droplet's first boot only fetches deltas.
docker compose --profile postgres --profile minio --profile redis --profile supertokens pull
# Warm the local nginx build cache (start.sh rebuilds it at first boot).
docker compose build nginx

# MOTD (dynamic: shows the wizard claim link until setup completes)
install -m 0755 "$MARKETPLACE_DIR/files/etc/update-motd.d/99-bffless-readme" /etc/update-motd.d/99-bffless-readme

# First-boot (cloud-init per-instance) scripts: swap, then bootstrap + start.
mkdir -p /var/lib/cloud/scripts/per-instance
install -m 0755 "$MARKETPLACE_DIR/files/var/lib/cloud/scripts/per-instance/001-swap" /var/lib/cloud/scripts/per-instance/001-swap
install -m 0755 "$MARKETPLACE_DIR/files/var/lib/cloud/scripts/per-instance/002-bffless-first-boot" /var/lib/cloud/scripts/per-instance/002-bffless-first-boot

# First-login hook (DO convention) + always-available resume command.
chmod +x "$MARKETPLACE_DIR/files/first-login.sh"
ln -sf "$MARKETPLACE_DIR/files/first-login.sh" /usr/local/bin/bffless-setup
echo "/usr/local/bin/bffless-setup" >> /root/.bashrc
```

- [ ] **Step 2: Write `files/var/lib/cloud/scripts/per-instance/001-swap`**

```bash
#!/bin/bash
# cloud-init per-instance: create swap BEFORE any container starts, sized to
# the droplet the user actually picked (no-op on >= 4 GB droplets).
/opt/bffless/scripts/setup-swap.sh >> /var/log/bffless-first-boot.log 2>&1 || true
```

- [ ] **Step 3: Write `files/var/lib/cloud/scripts/per-instance/002-bffless-first-boot`**

```bash
#!/bin/bash
# cloud-init per-instance: configure + start BFFless so the web wizard is
# reachable at https://<droplet-ip>/ before anyone logs in over SSH.
exec >> /var/log/bffless-first-boot.log 2>&1
set -x
cd /opt/bffless

# Best-effort self-update: the image is a warm cache, never a pinned release.
timeout 120 git pull --ff-only || echo "git pull failed/timed out — continuing with baked tree"
timeout 600 docker compose --profile postgres --profile minio --profile redis --profile supertokens pull || echo "compose pull failed/timed out — continuing with cached images"

# Generates per-droplet secrets + ONBOARDING_TOKEN, writes .env, exits 0.
# (Refuses to run if .env already exists — correct: per-instance scripts run
# once, and a re-imaged droplet keeping its disk keeps its config.)
./setup.sh --bootstrap
./start.sh
```

- [ ] **Step 4: shellcheck + commit**

Run: `shellcheck marketplace/digitalocean/scripts/030-bffless.sh marketplace/digitalocean/files/var/lib/cloud/scripts/per-instance/001-swap marketplace/digitalocean/files/var/lib/cloud/scripts/per-instance/002-bffless-first-boot`

```bash
git add marketplace/digitalocean/scripts/030-bffless.sh marketplace/digitalocean/files/
git commit -m "feat(marketplace): warm-cache provisioner + first-boot swap/bootstrap scripts"
```

---

### Task 12: `first-login.sh` + MOTD

**Files:**
- Create: `marketplace/digitalocean/files/first-login.sh`
- Create: `marketplace/digitalocean/files/first-login.test.sh`
- Create: `marketplace/digitalocean/files/etc/update-motd.d/99-bffless-readme`

**Interfaces:**
- Consumes: `bootstrap/instance.env` (`STATE`/`PRIMARY_DOMAIN`), `.env` (`ONBOARDING_TOKEN`), `setup.sh` (interactive), `start.sh`.
- Produces: `first-login.sh` — hooked from `/root/.bashrc` and symlinked as `bffless-setup`. Env seams for tests: `BFFLESS_INSTALL_DIR` (default `/opt/bffless`), `BFFLESS_BASHRC` (default `/root/.bashrc`), `BFFLESS_SKEL_BASHRC` (default `/etc/skel/.bashrc`). Behavior: applied → print admin URL, restore `.bashrc`, exit 0; unclaimed + `.env` present → print wizard URL with `?token=`, offer terminal setup (`setup` + Enter), keep hook; `.env` missing → "first boot still preparing", keep hook.

- [ ] **Step 1: Write the failing test**

Create `marketplace/digitalocean/files/first-login.test.sh`:

```bash
#!/bin/bash
# Unit tests for first-login.sh (env-seam paths; no /opt or /root access).
# Run: bash marketplace/digitalocean/files/first-login.test.sh
set -u
FAILURES=0
SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/first-login.sh"

assert_contains() { if grep -qF "$2" "$1" 2>/dev/null; then echo "ok: $3"; else echo "FAIL: $3 (missing '$2' in $1)"; FAILURES=$((FAILURES+1)); fi }
assert_file_eq() { if diff -q "$1" "$2" >/dev/null 2>&1; then echo "ok: $3"; else echo "FAIL: $3"; FAILURES=$((FAILURES+1)); fi }

make_sandbox() {
    SB=$(mktemp -d)
    mkdir -p "$SB/app/bootstrap" "$SB/bin"
    echo "hook-line" > "$SB/bashrc"
    echo "clean-skel" > "$SB/skel-bashrc"
    # curl stub so detect_server_ip is deterministic and offline-safe
    printf '#!/bin/bash\necho 203.0.113.9\n' > "$SB/bin/curl" && chmod +x "$SB/bin/curl"
}
run_fl() { # stdin already wired by caller
    PATH="$SB/bin:$PATH" BFFLESS_INSTALL_DIR="$SB/app" BFFLESS_BASHRC="$SB/bashrc" \
        BFFLESS_SKEL_BASHRC="$SB/skel-bashrc" bash "$SCRIPT"
}

echo "— applied instance: prints admin URL, restores bashrc —"
make_sandbox
printf 'STATE=applied\nPRIMARY_DOMAIN=example.com\n' > "$SB/app/bootstrap/instance.env"
out=$(run_fl < /dev/null)
echo "$out" > "$SB/out"
assert_contains "$SB/out" "https://admin.example.com" "admin URL shown"
assert_file_eq "$SB/bashrc" "$SB/skel-bashrc" "bashrc restored from skel"
rm -rf "$SB"

echo "— unclaimed with .env: prints wizard link with token, keeps hook —"
make_sandbox
printf 'ONBOARDING_TOKEN=tok123\n' > "$SB/app/.env"
out=$(printf '\n' | run_fl)           # user presses Enter (skip terminal setup)
echo "$out" > "$SB/out"
assert_contains "$SB/out" "https://203.0.113.9/?token=tok123" "wizard claim URL shown"
assert_contains "$SB/bashrc" "hook-line" "bashrc hook kept while unclaimed"
rm -rf "$SB"

echo "— first boot not finished (no .env): says preparing, keeps hook —"
make_sandbox
out=$(run_fl < /dev/null)
echo "$out" > "$SB/out"
assert_contains "$SB/out" "still preparing" "preparing message shown"
assert_contains "$SB/bashrc" "hook-line" "bashrc hook kept"
rm -rf "$SB"

[ "$FAILURES" -eq 0 ] && echo 'ALL FIRST-LOGIN TESTS PASSED' || { echo "$FAILURES FAILURES"; exit 1; }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bash marketplace/digitalocean/files/first-login.test.sh`
Expected: FAIL (first-login.sh missing)

- [ ] **Step 3: Write `first-login.sh`**

```bash
#!/bin/bash
# DO Marketplace first-login experience. Hooked from /root/.bashrc by the
# image build; always available as `bffless-setup`. The browser wizard is the
# primary path — this script mostly points at it; terminal setup via setup.sh
# is the fallback for users who prefer SSH.
#
# Env seams (used by first-login.test.sh; production uses the defaults):
#   BFFLESS_INSTALL_DIR BFFLESS_BASHRC BFFLESS_SKEL_BASHRC
set -uo pipefail

INSTALL_DIR="${BFFLESS_INSTALL_DIR:-/opt/bffless}"
BASHRC="${BFFLESS_BASHRC:-/root/.bashrc}"
SKEL_BASHRC="${BFFLESS_SKEL_BASHRC:-/etc/skel/.bashrc}"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

cd "$INSTALL_DIR" || { echo "BFFless install not found at $INSTALL_DIR"; exit 1; }

restore_bashrc() {
    # DO convention: the hook removes itself once setup is complete.
    cp -f "$SKEL_BASHRC" "$BASHRC"
}

detect_server_ip() {
    curl -fsSL -m 3 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}'
}

instance_state() {
    ( [ -f bootstrap/instance.env ] && . bootstrap/instance.env && echo "${STATE:-}" ) 2>/dev/null
}

# ---- Already configured? Point at the admin panel and get out of the way. --
if [ "$(instance_state)" = "applied" ]; then
    domain=$( ( . bootstrap/instance.env && echo "${PRIMARY_DOMAIN:-}" ) 2>/dev/null )
    echo -e "${GREEN}✓ BFFless is configured${NC} — admin panel: ${BOLD}https://admin.${domain}${NC}"
    echo "  Manage this instance from ${INSTALL_DIR}: ./status.sh ./update.sh ./logs.sh ./backup.sh"
    restore_bashrc
    exit 0
fi

echo ""
echo -e "${BOLD}Welcome to BFFless CE${NC} — let's get you set up (~3 minutes)."
echo ""

# ---- First boot still running? ----------------------------------------------
if [ ! -f .env ]; then
    echo -e "${YELLOW}First boot is still preparing this droplet (swap, config, containers).${NC}"
    echo "  Progress:  tail -f /var/log/bffless-first-boot.log"
    echo "  Then log in again, or run:  bffless-setup"
    exit 0
fi

# ---- Unclaimed: primary path is the browser wizard. -------------------------
claim_token=$(grep '^ONBOARDING_TOKEN=' .env 2>/dev/null | head -1 | cut -d= -f2-)
server_ip=$(detect_server_ip)

echo -e "Finish setup in your browser (recommended):"
echo -e "  ${CYAN}${BOLD}https://${server_ip}/?token=${claim_token}${NC}"
echo ""
echo "  Your browser will warn about a self-signed certificate — that's expected"
echo "  before a domain is configured; proceed past the warning."
echo ""
echo "Prefer the terminal? Setup here needs your domain on Cloudflare ready:"
echo "  https://docs.bffless.dev/getting-started/quickstart"
echo ""
printf "Press Enter to continue to the shell, or type %bsetup%b to configure here: " "$BOLD" "$NC"
read -r answer || answer=""
if [ "$answer" != "setup" ]; then
    echo ""
    echo "OK — the wizard link above stays valid. This reminder shows on each login"
    echo "until setup completes (or run: bffless-setup)."
    exit 0
fi

# ---- Terminal fallback: Coolify-style interactive setup. --------------------
echo "Self-updating first (safe to skip on network failure)..."
timeout 120 git pull --ff-only || echo -e "${YELLOW}⚠ git pull failed — continuing with the current version${NC}"
timeout 600 docker compose --profile postgres --profile minio --profile redis --profile supertokens pull || echo -e "${YELLOW}⚠ image pull failed — continuing with cached images${NC}"

# Interactive setup.sh will ask before overwriting the bootstrap .env — answer
# y to reconfigure this droplet from the terminal instead of the wizard.
if ./setup.sh && [ -f .env ]; then
    ./start.sh
    domain=$(grep '^PRIMARY_DOMAIN=' .env 2>/dev/null | head -1 | cut -d= -f2-)
    if [ -n "$domain" ]; then
        echo -e "${GREEN}✓ Setup complete${NC} — admin panel: ${BOLD}https://admin.${domain}${NC}"
        restore_bashrc
    fi
else
    echo -e "${YELLOW}Setup didn't finish — run bffless-setup to try again (it re-prompts on next login too).${NC}"
fi
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bash marketplace/digitalocean/files/first-login.test.sh`
Expected: `ALL FIRST-LOGIN TESTS PASSED`

- [ ] **Step 5: Write the MOTD script**

Create `marketplace/digitalocean/files/etc/update-motd.d/99-bffless-readme`:

```bash
#!/bin/sh
# BFFless CE droplet MOTD (DO Marketplace image). update-motd.d scripts run at
# login, so this stays accurate as the instance moves through setup.
INSTALL_DIR=/opt/bffless

cat <<'EOF'

 ┌──────────────────────────────────────────────────────────────────┐
 │  BFFless CE — self-hosted static hosting + BFF pipelines         │
 └──────────────────────────────────────────────────────────────────┘
EOF

if grep -q '^STATE=applied' "$INSTALL_DIR/bootstrap/instance.env" 2>/dev/null; then
    domain=$(sed -n 's/^PRIMARY_DOMAIN=//p' "$INSTALL_DIR/bootstrap/instance.env" | head -1)
    printf ' Admin panel:  https://admin.%s\n' "$domain"
else
    token=$(sed -n 's/^ONBOARDING_TOKEN=//p' "$INSTALL_DIR/.env" 2>/dev/null | head -1)
    if [ -n "$token" ]; then
        ip=$(hostname -I | awk '{print $1}')
        printf ' Finish setup in your browser:  https://%s/?token=%s\n' "$ip" "$token"
        printf ' (or run: bffless-setup)\n'
    else
        printf ' First boot is still preparing this droplet — try again in a minute.\n'
        printf ' Progress:  tail -f /var/log/bffless-first-boot.log\n'
    fi
fi

cat <<'EOF'

 Manage your instance (cd /opt/bffless):
   ./status.sh   health, versions, resources    ./update.sh   upgrade BFFless
   ./logs.sh     follow service logs            ./backup.sh   DB + assets backup
   ./restart.sh  restart services               ./stop.sh     stop services

 Docs: https://docs.bffless.dev
EOF
```

- [ ] **Step 6: shellcheck + commit**

Run: `shellcheck marketplace/digitalocean/files/first-login.sh marketplace/digitalocean/files/first-login.test.sh marketplace/digitalocean/files/etc/update-motd.d/99-bffless-readme`

```bash
git add marketplace/digitalocean/files/
git commit -m "feat(marketplace): first-login flow (web-wizard primary, terminal fallback) + dynamic MOTD"
```

---

### Task 13: CI — `marketplace-image.yml`

**Files:**
- Create: `.github/workflows/marketplace-image.yml`

**Interfaces:**
- Consumes: `marketplace/digitalocean/template.pkr.hcl` (Task 10); repo secret `DIGITALOCEAN_API_TOKEN` (the user adds it in GitHub settings after merge — same pattern as `NPM_TOKEN` in `release-please.yml`).
- Produces: a DO snapshot `bffless-ce-<timestamp>` in the team account; snapshot name in the job summary. Vendor Portal submission stays manual.

- [ ] **Step 1: Write the workflow**

Create `.github/workflows/marketplace-image.yml`:

```yaml
name: Build DO Marketplace Image

# Builds the DigitalOcean 1-Click snapshot with Packer. NOT tied to CE
# releases — the image is a warm cache; droplets self-update at first boot
# and via update.sh. Monthly rebuild keeps the base OS fresh (DO expects
# periodic refreshes). Vendor Portal submission remains manual:
# https://cloud.digitalocean.com/vendorportal
on:
  workflow_dispatch:
    inputs:
      region:
        description: 'DO region for the build droplet'
        required: false
        default: 'nyc3'
        type: string
  schedule:
    - cron: '17 6 3 * *' # 06:17 UTC on the 3rd of each month

permissions:
  contents: read

jobs:
  build-image:
    runs-on: ubuntu-latest
    defaults:
      run:
        shell: bash # explicit bash => pipefail, so a packer failure isn't masked by tee
        working-directory: marketplace/digitalocean
    steps:
      - uses: actions/checkout@v4

      - uses: hashicorp/setup-packer@v3

      - name: Packer init + validate
        run: |
          packer init template.pkr.hcl
          packer validate template.pkr.hcl

      - name: Packer build
        env:
          DIGITALOCEAN_API_TOKEN: ${{ secrets.DIGITALOCEAN_API_TOKEN }}
        run: packer build -color=false -var "region=${{ inputs.region || 'nyc3' }}" template.pkr.hcl | tee build.log

      - name: Snapshot summary
        if: always()
        run: |
          {
            echo "## DO Marketplace image build"
            echo ""
            grep -iE "snapshot.*(created|bffless-ce)" build.log || echo "(no snapshot line found — check the build log)"
            echo ""
            echo "Next: submit/refresh the listing in the [Vendor Portal](https://cloud.digitalocean.com/vendorportal)."
          } >> "$GITHUB_STEP_SUMMARY"
```

- [ ] **Step 2: Validate the workflow syntax**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/marketplace-image.yml'))"`
Expected: exit 0

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/marketplace-image.yml
git commit -m "ci: DO marketplace image build (manual dispatch + monthly cron)"
```

---

### Task 14: Listing copy + marketplace README

**Files:**
- Create: `marketplace/digitalocean/listing/description.md`
- Create: `marketplace/digitalocean/listing/getting-started.md`
- Create: `marketplace/digitalocean/README.md`

- [ ] **Step 1: Write `listing/description.md`**

```markdown
# BFFless CE

BFFless CE is a self-hosted platform for static hosting with backend-for-frontend
superpowers: deploy static sites from CI in seconds, then add dynamic behavior —
API proxying without CORS, no-code backend pipelines, data tables, AI chat,
auth — without running your own backend.

**Highlights**

- **Deploy from CI in seconds** — a GitHub Action uploads your build; every
  commit gets an immutable URL, aliases (production/staging/pr-N) move freely
- **Proxy rules** — forward `/api/*` to any backend without CORS pain
- **Pipelines** — no-code backend handlers: forms, uploads, webhooks, scheduled jobs
- **Data tables + `use-bff-state`** — server state for React apps without a server
- **Auth built in** — cookie sessions, roles, per-folder access control
- **Cloudflare-first SSL** — recommended path uses Cloudflare's free CDN/WAF in front

**This 1-Click app**

Boots ready to configure: on first boot the droplet creates swap (on small
droplets), generates per-droplet secrets, and starts all services. Open
`https://<your-droplet-ip>/` and finish setup in the browser — no SSH required.
Lifecycle scripts (`status.sh`, `update.sh`, `backup.sh`, `logs.sh`,
`restart.sh`) come standard.

Runs on 1 GB droplets (2 GB recommended). Docs: https://docs.bffless.dev
```

- [ ] **Step 2: Write `listing/getting-started.md`**

```markdown
# Getting started with BFFless CE

After you create your droplet from the 1-Click image:

## 1. Wait ~2 minutes for first boot

The droplet configures itself on first boot: swap (on 1–2 GB droplets),
per-droplet secrets, and all services. No SSH needed.

## 2. Get your setup link

The setup wizard is claim-protected by a one-time token. Get your personal
setup link either way:

- **SSH (or the DO web console):** `ssh root@<your-droplet-ip>` — the welcome
  banner prints your setup link (`https://<ip>/?token=...`). This works in the
  DigitalOcean control panel's Droplet Console too.

## 3. Finish setup in the browser

Open the setup link. Your browser warns about a self-signed certificate —
that's expected before a domain is configured; proceed. The wizard walks you
through: create your admin account → set your domain (Cloudflare recommended,
free) → SSL → done. Your admin panel lands at `https://admin.<your-domain>`.

Prefer the terminal? The SSH welcome banner offers a full interactive setup
instead (`bffless-setup`).

## Managing your instance

All from `/opt/bffless`:

| Command | What it does |
| --- | --- |
| `./status.sh` | Health, versions (with restart-pending warning), RAM/swap/disk, SSL expiry |
| `./update.sh` | Upgrade BFFless: git pull + image pull + restart |
| `./logs.sh [service]` | Follow logs for all services or one |
| `./backup.sh` | Backup database + assets + config to `backups/` |
| `./restart.sh` | Restart all services |
| `./stop.sh` / `./start.sh` | Stop / start services |

## Resources

- Documentation: https://docs.bffless.dev
- Deployment guide: https://docs.bffless.dev/deployment/digitalocean
- Community & issues: https://github.com/bffless/ce
```

- [ ] **Step 3: Write `marketplace/digitalocean/README.md`**

```markdown
# DigitalOcean Marketplace image

Build tooling for the BFFless CE 1-Click droplet image.

## Layout

- `template.pkr.hcl` — Packer HCL2 template (DO builder, `ubuntu-24-04-x64`, builds on `s-1vcpu-1gb`)
- `scripts/010-prep.sh` — apt upgrade, ufw 22/80/443
- `scripts/020-docker.sh` — Docker CE + compose plugin (mirrors `setup.sh`'s installer)
- `scripts/030-bffless.sh` — clone to `/opt/bffless`, pre-pull all profile images, warm nginx build cache, install MOTD + first-boot scripts + first-login hook
- `scripts/900-cleanup.sh`, `scripts/999-img_check.sh` — vendored unmodified from [digitalocean/marketplace-partners](https://github.com/digitalocean/marketplace-partners) (`scripts/90-cleanup.sh`, `scripts/99-img-check.sh`); `img_check` failing fails the build
- `files/first-login.sh` — SSH login banner/fallback setup (also `bffless-setup`); `files/first-login.test.sh` unit-tests it
- `files/etc/update-motd.d/99-bffless-readme` — dynamic MOTD
- `files/var/lib/cloud/scripts/per-instance/` — first-boot: `001-swap`, `002-bffless-first-boot`
- `listing/` — version-controlled Vendor Portal listing copy

## How a droplet boots (image → running wizard)

1. cloud-init per-instance: `001-swap` (2G swap on <4 GB droplets), then
   `002-bffless-first-boot`: best-effort self-update (`git pull` + compose pull),
   `setup.sh --bootstrap` (per-droplet secrets + `ONBOARDING_TOKEN`), `start.sh`.
   Log: `/var/log/bffless-first-boot.log`.
2. The web wizard is live at `https://<droplet-ip>/` (self-signed cert until a
   domain is applied). The claim link with token is shown by the MOTD and the
   first-login banner.
3. First SSH login runs `first-login.sh`: points at the wizard, offers terminal
   setup, and removes its own `.bashrc` hook once the instance is configured.

The image is a **warm cache**, never a pinned release: no `.env`, secrets, or
certs are baked (DO `img_check` enforces this), and droplets self-update at
first boot and via `update.sh`, so frequent CE releases never require an image
rebuild. A monthly CI rebuild keeps the base OS fresh.

## Build

Locally:

```bash
export DIGITALOCEAN_API_TOKEN=...   # write-scoped token
cd marketplace/digitalocean
packer init template.pkr.hcl
packer build template.pkr.hcl       # ~15 min; snapshot bffless-ce-<timestamp>
```

Or run the **Build DO Marketplace Image** GitHub Actions workflow
(`workflow_dispatch`; also runs monthly). Requires the `DIGITALOCEAN_API_TOKEN`
repo secret.

## Test a snapshot

Create a droplet from the snapshot (Images → Snapshots → More → Create droplet;
test 1 GB AND 4 GB sizes), then verify:

- [ ] `swapon --show` — 2G swapfile on the 1 GB droplet; none on 4 GB
- [ ] `https://<droplet-ip>/` serves the claim wizard (self-signed cert warning)
- [ ] MOTD + first SSH login show the claim link with token
- [ ] Complete the wizard with a real Cloudflare-managed test domain → `https://admin.<domain>` works
- [ ] Second SSH login after setup does NOT re-prompt (bashrc hook removed)
- [ ] `./status.sh` `./update.sh` `./backup.sh` `./restart.sh` `./logs.sh` behave
- [ ] `ufw status` is active; `/var/log/bffless-first-boot.log` shows a clean run

## Submit

Vendor Portal (manual; no API): https://cloud.digitalocean.com/vendorportal —
attach the snapshot, paste `listing/description.md` and
`listing/getting-started.md`. Listing: min 1 GB / recommended 2 GB droplet.
```

- [ ] **Step 4: Commit**

```bash
git add marketplace/digitalocean/listing/ marketplace/digitalocean/README.md
git commit -m "feat(marketplace): listing copy + build/test/submit README"
```

---

### Task 15: docs-public — 1-Click section, lifecycle scripts, restore guide

**Files (in `/home/rico/bffless/repos/docs-public` — SEPARATE repo, own branch + PR):**
- Modify: `docs/deployment/digitalocean.md`

- [ ] **Step 1: Branch in docs-public**

```bash
cd /home/rico/bffless/repos/docs-public
git checkout -b feat/do-one-click-docs origin/main
```

- [ ] **Step 2: Edit `docs/deployment/digitalocean.md`**

(a) Insert directly under the intro (before `## Prerequisites`):

```markdown
## 1-Click Deploy (recommended)

<!-- TODO(listing): once the DO Marketplace listing is live, replace the line
below with the real listing URL + Deploy button image. -->
*The BFFless CE DigitalOcean Marketplace 1-Click app is coming soon — it is in
Marketplace review. Until it's live, use the manual install below.*

With the 1-Click image, the droplet configures itself on first boot: swap (on
small droplets), per-droplet secrets, and all services — then you finish setup
in the browser at `https://<droplet-ip>/` using the claim link shown in the SSH
welcome banner (also visible in the DigitalOcean Droplet Console). No SSH
session is required for the happy path.

Everything below remains the manual alternative and works on any provider.
```

(b) Replace the body of the existing `## Updating` section (`git pull` + `docker compose pull` block) with:

```markdown
```bash
cd /opt/bffless   # or wherever you cloned CE
./update.sh       # aborts on local changes; git pull + image pull + restart
```

`./status.sh` shows the running vs checked-out version and warns when a
restart is pending.
```

(c) Under `## Maintenance`, replace the `### Backup Database` section with:

```markdown
### Backup

```bash
./backup.sh   # backups/bffless-backup-<timestamp>.tar.gz
```

The archive contains the database dump, asset storage, `.env`, `bootstrap/`,
and `ssl/` — everything a restore needs. It contains secrets; store it
securely.

### Restoring a backup

Restore is manual (there is no `restore.sh` yet). On a fresh CE checkout:

```bash
# 1. Unpack
tar xzf bffless-backup-<timestamp>.tar.gz -C /tmp/bffless-restore

# 2. Restore config + identity + certs into the repo root
cp /tmp/bffless-restore/.env .
cp -r /tmp/bffless-restore/bootstrap /tmp/bffless-restore/ssl .

# 3. Start only postgres, load the dump, then start everything
./start.sh
docker exec -i assethost-postgres psql -U postgres -d assethost < /tmp/bffless-restore/database.sql

# 4. Restore assets (local storage installs)
docker cp /tmp/bffless-restore/uploads/. assethost-backend:/app/apps/backend/uploads
./restart.sh
```

For MinIO installs, copy `minio-data/` into the MinIO container's `/data`
instead of step 4.
```

- [ ] **Step 3: Build the docs site**

Run: `pnpm install && pnpm build`
Expected: Docusaurus build succeeds, no broken-link errors for the edited page

- [ ] **Step 4: Commit (ask user before pushing/PR)**

```bash
git add docs/deployment/digitalocean.md
git commit -m "docs: DO 1-Click section + lifecycle scripts + restore guide"
```

---

### Task 16: End-to-end validation + submission (manual; involves the user)

No code. Run once the CE PR is merged (the Packer build clones `main`).

- [ ] **Step 1: Confirm secret + trigger a build** — user adds `DIGITALOCEAN_API_TOKEN` (write-scoped) to `bffless/ce` repo secrets; dispatch the **Build DO Marketplace Image** workflow; confirm the job summary names a `bffless-ce-<timestamp>` snapshot and that the `999-img_check.sh` provisioner passed.
- [ ] **Step 2: Droplet test matrix** — create droplets from the snapshot at 1 GB and 4 GB; walk the checklist in `marketplace/digitalocean/README.md` ("Test a snapshot") end-to-end with a real Cloudflare test domain. Fix-forward anything that fails (each fix lands normally; rebuild the image and re-test).
- [ ] **Step 3: Vendor Portal** — user signs up at `cloud.digitalocean.com/vendorportal` (review takes weeks — can start in parallel with Step 2), creates the listing with the snapshot + `listing/` copy, min 1 GB / recommended 2 GB.
- [ ] **Step 4: Post-listing docs flip** — in docs-public, replace the "coming soon" line from Task 15 with the real listing URL/button.

---

## Self-Review

**Spec coverage:**
- Packer dir layout (spec §1) → Tasks 10-12, 14. ✓ (spec's `files/` tree had first-login.sh installed via repo clone — preserved: 030 symlinks/hooks the in-repo path, no copy.)
- `scripts/setup-swap.sh` + first-boot `001-swap` + compose trim (spec "Swap") → Tasks 1, 11. ✓
- First-login flow incl. post-web-bootstrap demotion note (spec §2) → Task 12. ✓ Self-update with timeouts ✓; Ctrl-C/skip keeps hook ✓ (read fallback + hook only removed on applied/success); `bffless-setup` symlink ✓ (Task 11).
- First boot runs `setup.sh --bootstrap` + `start.sh` (spec header) → Task 11 `002-bffless-first-boot`. ✓ Spec §1's older "only first-boot script is 001-swap" sentence is superseded by the header note — resolved in favor of the header (zero-SSH primary path needs services live before login).
- Five lifecycle scripts w/ exact spec behaviors (spec §3) → Tasks 3-7. ✓ All bash/set -e (status.sh documented exception), --help, shellcheck-clean, colored per start.sh, no `/opt/bffless` assumption. `status.sh` covers every spec bullet (version diff via image IDs since tags are usually `latest`).
- Docs: README script table (spec §4) → Task 9 ✓; docs-public 1-Click + kept manual flow → Task 15 ✓; listing copy in git → Task 14 ✓; MOTD ✓ (Task 12).
- CI workflow, dispatch + monthly cron, snapshot in summary, no release coupling (spec §5) → Task 13. ✓
- Testing: shellcheck (Task 8 — net-new CI job since none existed), img_check as final failing provisioner (Task 10, verified exit 1), manual E2E incl. 1 GB/4 GB swap check + second-login no-reprompt + ufw (Task 16 + README checklist), non-DO regression guard (scripts are script-dir-relative; unit tests run them from sandboxes, not `/opt`). ✓
- Out of scope respected: no restore.sh (restore documented manually, Task 15), no other marketplaces, no portal automation. ✓

**Placeholder scan:** all steps carry full file contents or exact edit instructions; the only TODO is the deliberate, user-visible `TODO(listing)` marker in docs (flipped in Task 16 Step 4). ✓

**Type/name consistency:** container names `assethost-*`, profile flags, `compose_profiles` (Tasks 2→5), env seams (`BFFLESS_INSTALL_DIR`, `SETUP_SWAP_ALLOW_NONROOT`), test file paths in Task 8's workflow all match their defining tasks. `first-login.test.sh` referenced in Task 8 is created in Task 12 — both in the same PR. ✓
