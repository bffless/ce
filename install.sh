#!/bin/sh
# install.sh - Remote installer for Static Asset Hosting Platform
#
# This minimal script downloads the repository and runs the setup script.
#
# Usage:
#   sh -c "$(curl -fsSL https://raw.githubusercontent.com/bffless/ce/main/install.sh)"
#
# Or with custom installation directory:
#   INSTALL_DIR=/opt/asset-host sh -c "$(curl -fsSL https://...)"
#
# Or specify a branch/tag:
#   BRANCH=v1.0.0 sh -c "$(curl -fsSL https://...)"

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

    # Run setup
    print_info "Running setup script..."
    echo ""

    # Pass through any additional arguments, and export the install dir for setup.sh
    # This lets setup.sh include "cd <dir>" in the Next Steps
    BFFLESS_INSTALL_DIR="$ABSOLUTE_INSTALL_DIR" ./setup.sh "$@"
}

# Run main function
main "$@"