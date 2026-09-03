#!/bin/sh
set -e
/usr/local/bin/render-main-conf.sh

# Never let one bad per-domain file keep nginx from starting: quarantine it
# (`<name>.invalid`) and let the backend regenerate it. A failure anywhere
# else still stops the container — that is a real problem, not a leftover.
/usr/local/bin/nginx-boot-guard.sh
exec "$@"
