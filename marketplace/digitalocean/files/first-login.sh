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
    # shellcheck disable=SC1091
    ( [ -f bootstrap/instance.env ] && . bootstrap/instance.env && echo "${STATE:-}" ) 2>/dev/null
}

# ---- Already configured? Point at the admin panel and get out of the way. --
if [ "$(instance_state)" = "applied" ]; then
    # shellcheck disable=SC1091
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
echo "  Note: some browsers drop the ?token= part of the link at the certificate"
echo "  warning — if the wizard doesn't show your token prefilled, paste it manually:"
echo -e "  Claim token (paste into the wizard if the link loses it):  ${BOLD}${claim_token}${NC}"
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
