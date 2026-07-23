#!/bin/sh
set -e
/usr/local/bin/render-main-conf.sh
exec "$@"
