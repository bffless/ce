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

# =============================================================================
# Helper Functions
# =============================================================================

print_header() {
    echo ""
    printf "${BLUE}╔═══════════════════════════════════════════════════════════════════════════╗${NC}\n"
    printf "${BLUE}║                                                                           ║${NC}\n"
    printf "${BLUE}║${NC}                               ${BOLD}Bffless                     ${NC}                ${BLUE}║${NC}\n"
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

    echo ""
    printf "${BLUE}╔═══════════════════════════════════════════════════════════════════════════╗${NC}\n"
    printf "${BLUE}║${NC}                       ${BOLD}Bffless is running - finish setup in a browser${NC}      ${BLUE}║${NC}\n"
    printf "${BLUE}╚═══════════════════════════════════════════════════════════════════════════╝${NC}\n"
    echo ""
    if [ -n "$claim_token" ]; then
        printf "  ${BOLD}Claim token:${NC} ${YELLOW}${claim_token}${NC}\n"
    else
        print_warning "Could not read ONBOARDING_TOKEN from .env - check $ABSOLUTE_INSTALL_DIR/.env"
    fi
    echo ""
    printf "${BOLD}Next steps:${NC}\n"
    echo ""
    printf "  ${CYAN}1.${NC} Open the setup wizard:\n"
    echo ""
    printf "     ${YELLOW}https://${server_ip}${NC}\n"
    printf "     ${DIM}(a browser certificate warning is expected here)${NC}\n"
    echo ""
    printf "  ${CYAN}2.${NC} Or point a domain at this server first, then use it instead:\n"
    echo ""
    echo "     Cloudflare: A records for @ and *, SSL/TLS mode: Full"
    printf "     ${YELLOW}https://admin.<your-domain>${NC}\n"
    echo ""
    printf "  ${CYAN}3.${NC} Enter the claim token above to finish setup.\n"
    echo ""
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