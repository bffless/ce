#!/bin/sh
# install.sh - Remote installer for Static Asset Hosting Platform
#
# This minimal script downloads the repository and runs the setup script.
#
# Default (zero-SSH web bootstrap): installs OS dependencies (via
# setup.sh --bootstrap), starts the stack, and hands off to the browser -
# no terminal onboarding prompts. Prints a claim token + URL to finish
# setup at https://admin.<your-domain> (or https://<server-ip>).
#
#   sh -c "$(curl -fsSL https://bffless.dev/install.sh)"
#
# Or with custom installation directory:
#   INSTALL_DIR=/opt/bffless sh -c "$(curl -fsSL https://...)"
#
# Or specify a branch/tag:
#   BRANCH=v1.0.0 sh -c "$(curl -fsSL https://...)"
#
# For the old terminal-based onboarding wizard instead of the web bootstrap:
#   sh -c "$(curl -fsSL https://...)" -- --interactive
#
# Any other arguments are passed through to setup.sh unchanged (e.g.
# --non-interactive with PRIMARY_DOMAIN/CERTBOT_EMAIL env vars for a
# scripted, cert-bearing install) - setup.sh's own flow prints next steps
# and this script does not auto-start the stack in that case.

set -e

# =============================================================================
# Configuration
# =============================================================================

# Repository configuration
REPO_URL="${REPO_URL:-https://github.com/bffless/ce.git}"
BRANCH="${BRANCH:-main}"

# Installation directory (default: current directory)
INSTALL_DIR="${INSTALL_DIR:-./ce}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m' # No Color

# Number of columns between the box-drawing borders in print_header() and
# print_web_bootstrap_banner() (both boxes are the same width).
BOX_WIDTH=75

# =============================================================================
# Helper Functions
# =============================================================================

# Centers a title within a $BOX_WIDTH-column field for the box-drawing
# banners. $1 is the plain (no ANSI codes) text, used to compute padding via
# ${#var} so future copy edits stay centered instead of relying on
# hand-counted spaces; $2 is the (optionally colored) text actually printed.
# Echoes "<left-pad><text><right-pad>" with no trailing newline.
center_line() {
    plain="$1"
    styled="$2"
    text_len=${#plain}
    total_pad=$((BOX_WIDTH - text_len))
    if [ "$total_pad" -lt 0 ]; then
        total_pad=0
    fi
    left_pad=$((total_pad / 2))
    right_pad=$((total_pad - left_pad))
    printf '%*s%b%*s' "$left_pad" '' "$styled" "$right_pad" ''
}

print_header() {
    echo ""
    printf "${BLUE}╔═══════════════════════════════════════════════════════════════════════════╗${NC}\n"
    printf "${BLUE}║                                                                           ║${NC}\n"
    printf "${BLUE}║${NC}%s${BLUE}║${NC}\n" "$(center_line "Bffless" "${BOLD}Bffless${NC}")"
    printf "${BLUE}║                                                                           ║${NC}\n"
    printf "${BLUE}╚═══════════════════════════════════════════════════════════════════════════╝${NC}\n"
    echo ""
}

print_success() {
    printf "${GREEN}✓ $1${NC}\n"
}

print_warning() {
    printf "${YELLOW}⚠ $1${NC}\n"
}

print_error() {
    printf "${RED}✗ $1${NC}\n"
}

print_info() {
    printf "${CYAN}ℹ $1${NC}\n"
}

# Check if a command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Best-effort public IP detection, for the "open https://<ip>" fallback in
# the web-bootstrap banner. Never fails the script - falls back to a
# placeholder string if both lookups come up empty.
detect_server_ip() {
    server_ip=$(curl -fsSL -m 3 https://api.ipify.org 2>/dev/null || true)
    if [ -z "$server_ip" ]; then
        server_ip=$(hostname -I 2>/dev/null | awk '{print $1}')
    fi
    if [ -z "$server_ip" ]; then
        server_ip="<server-ip>"
    fi
    echo "$server_ip"
}

# Final banner for the default (web-bootstrap) flow: reads the claim token
# setup.sh --bootstrap minted into .env and points the user at the browser.
print_web_bootstrap_banner() {
    claim_token=$(grep '^ONBOARDING_TOKEN=' .env 2>/dev/null | cut -d '=' -f2-)
    server_ip=$(detect_server_ip)

    # With a claim token, the wizard links below carry it as `?token=` so
    # the browser has it without retyping; without one (unreadable .env),
    # fall back to bare URLs and rely on the manual-entry line below.
    if [ -n "$claim_token" ]; then
        ip_url="https://${server_ip}/setup?token=${claim_token}"
        domain_url="https://admin.<your-domain>/setup?token=${claim_token}"
        step1_line1="Open the setup wizard - this link carries your claim token, so it"
        step1_line2="skips straight to account setup (no claim screen to fill in):"
    else
        ip_url="https://${server_ip}"
        domain_url="https://admin.<your-domain>"
        step1_line1="Open the setup wizard:"
        step1_line2=""
    fi

    banner_title="Bffless is running - finish setup in a browser"
    echo ""
    printf "${BLUE}╔═══════════════════════════════════════════════════════════════════════════╗${NC}\n"
    printf "${BLUE}║${NC}%s${BLUE}║${NC}\n" "$(center_line "$banner_title" "${BOLD}${banner_title}${NC}")"
    printf "${BLUE}╚═══════════════════════════════════════════════════════════════════════════╝${NC}\n"
    echo ""
    if [ -n "$claim_token" ]; then
        printf "  ${BOLD}Claim token:${NC} ${YELLOW}${claim_token}${NC}\n"
        printf "  ${DIM}(only needed if you type the URL in by hand instead of clicking a link below)${NC}\n"
    else
        print_warning "Could not read ONBOARDING_TOKEN from .env - check $ABSOLUTE_INSTALL_DIR/.env"
    fi
    echo ""
    printf "${BOLD}Next steps:${NC}\n"
    echo ""
    printf "  ${CYAN}1.${NC} %s\n" "$step1_line1"
    if [ -n "$step1_line2" ]; then
        printf "     %s\n" "$step1_line2"
    fi
    echo ""
    printf "     ${YELLOW}${ip_url}${NC}\n"
    printf "     ${DIM}(a browser certificate warning is expected here)${NC}\n"
    echo ""
    printf "  ${CYAN}2.${NC} Or point a domain at this server first, then use it instead:\n"
    echo ""
    echo "     Cloudflare: A records for @ and *, SSL/TLS mode: Full"
    printf "     ${YELLOW}${domain_url}${NC}\n"
    echo ""
    if [ -n "$claim_token" ]; then
        printf "  ${CYAN}3.${NC} Typed the URL in by hand instead? Paste the claim token above when\n"
        printf "     the wizard's claim-token screen asks for it.\n"
        echo ""
    fi
}

# =============================================================================
# Main Installation
# =============================================================================

main() {
    print_header

    # Check for required tools
    if ! command_exists git; then
        print_error "Git is required but not installed."
        echo ""
        echo "Install git first:"
        echo "  apt-get update && apt-get install -y git  (Debian/Ubuntu)"
        echo "  yum install git                           (CentOS/RHEL)"
        echo "  brew install git                          (macOS)"
        echo ""
        exit 1
    fi

    # Check if installation directory exists
    if [ -d "$INSTALL_DIR" ]; then
        print_warning "Directory $INSTALL_DIR already exists."
        echo ""
        printf "Do you want to continue? This will pull the latest changes. (y/N): "
        read -r response
        case "$response" in
            [yY][eE][sS]|[yY])
                print_info "Updating existing installation..."
                cd "$INSTALL_DIR"
                git fetch origin
                git checkout "$BRANCH"
                git pull origin "$BRANCH"
                ;;
            *)
                print_info "Installation cancelled."
                echo ""
                echo "To use a different directory, run:"
                echo "  INSTALL_DIR=/path/to/install sh -c \"\$(curl -fsSL https://...)\""
                echo ""
                exit 0
                ;;
        esac
    else
        # Clone repository
        print_info "Cloning repository to $INSTALL_DIR..."
        git clone --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
        cd "$INSTALL_DIR"
    fi

    print_success "Repository ready!"
    echo ""

    # Check if setup script exists
    if [ ! -f "setup.sh" ]; then
        print_error "Setup script not found at setup.sh"
        exit 1
    fi

    # Make setup script executable
    chmod +x setup.sh

    # Get absolute path to pass to setup.sh
    ABSOLUTE_INSTALL_DIR=$(pwd)

    # Pull --interactive (if present) out of the argument list. It requests
    # the old terminal onboarding wizard instead of the default web
    # bootstrap; any remaining arguments are passed through to setup.sh
    # exactly as before. Rebuilt via quoted `set --` (never a flattened
    # string) so arguments with spaces/globs/quotes survive intact.
    interactive_requested=false
    for arg in "$@"; do
        if [ "$arg" = "--interactive" ]; then
            interactive_requested=true
        fi
    done

    if [ "$interactive_requested" = true ]; then
        # Strip --interactive while preserving every other argument
        # verbatim (no word-splitting/glob risk from re-parsing a string).
        first=true
        for arg in "$@"; do
            [ "$arg" = "--interactive" ] && continue
            if [ "$first" = true ]; then
                set -- "$arg"
                first=false
            else
                set -- "$@" "$arg"
            fi
        done
        [ "$first" = true ] && set --

        # Old behavior, exactly: terminal onboarding wizard, no auto-start.
        print_info "Running setup script (interactive)..."
        echo ""
        BFFLESS_INSTALL_DIR="$ABSOLUTE_INSTALL_DIR" ./setup.sh "$@"
        return 0
    fi

    if [ "$#" -eq 0 ]; then
        # Default: zero-SSH web bootstrap. Installs OS dependencies (Docker,
        # etc. via setup.sh's check_prerequisites), mints a claim token, and
        # starts the stack. No terminal prompts - onboarding moves to the
        # browser from here.
        print_info "Running non-interactive bootstrap setup..."
        echo ""
        bootstrap_exit=0
        BFFLESS_INSTALL_DIR="$ABSOLUTE_INSTALL_DIR" ./setup.sh --bootstrap || bootstrap_exit=$?
        if [ "$bootstrap_exit" -ne 0 ]; then
            print_error "Bootstrap setup failed (exit $bootstrap_exit). Not starting the stack."
            exit "$bootstrap_exit"
        fi

        if [ ! -f "start.sh" ]; then
            print_error "Start script not found at start.sh"
            exit 1
        fi

        chmod +x start.sh 2>/dev/null || true
        print_info "Starting the platform..."
        echo ""
        ./start.sh

        print_web_bootstrap_banner
        return 0
    fi

    # Any other arguments: passthrough to setup.sh unchanged (current
    # behavior). setup.sh's own flow prints its next steps; we don't
    # auto-start the stack here.
    print_info "Running setup script..."
    echo ""
    BFFLESS_INSTALL_DIR="$ABSOLUTE_INSTALL_DIR" ./setup.sh "$@"
}

# Run main function
main "$@"