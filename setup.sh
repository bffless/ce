#!/bin/sh
# setup.sh - One-command setup for Static Asset Hosting Platform
#
# Usage:
#   sh -c "$(curl -fsSL https://raw.githubusercontent.com/.../setup.sh)"
#
# Or if cloned locally:
#   ./setup.sh
#
# Options:
#   --help              Show this help message
#   --non-interactive   Use environment variables instead of prompts
#   --force             Overwrite existing .env file without prompting
#
# Environment variables (for --non-interactive mode):
#   PRIMARY_DOMAIN      - Your domain (default: localhost)
#   POSTGRES_PASSWORD   - PostgreSQL password (auto-generated if not set)
#   MINIO_ROOT_USER     - MinIO admin user (default: minioadmin)
#   MINIO_ROOT_PASSWORD - MinIO admin password (auto-generated if not set)
#   CERTBOT_EMAIL       - Email for SSL certificates (required for Let's Encrypt)
#   PROXY_MODE          - SSL method: 'cloudflare' (default) or 'none' (Let's Encrypt)
#   REDIS_PASSWORD      - Redis password (auto-generated if not set)
#   SMTP_HOST           - SMTP server hostname (optional)
#   SMTP_PORT           - SMTP server port (default: 587)
#   SMTP_USER           - SMTP username (optional)
#   SMTP_PASSWORD       - SMTP password (optional)
#   SMTP_FROM_ADDRESS   - From email address (optional)
#
# External Services (advanced):
#   ENABLE_POSTGRES     - Set to 'false' to use external PostgreSQL (default: true)
#   DATABASE_URL        - External PostgreSQL connection string (required if ENABLE_POSTGRES=false)
#   ENABLE_MINIO        - Set to 'false' to skip MinIO container (default: true)
#   ENABLE_REDIS        - Set to 'false' to skip Redis container (default: true)

set -e

# =============================================================================
# Configuration
# =============================================================================

# Colors (POSIX-compatible)
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m' # No Color

# Default values
DEFAULT_DOMAIN="localhost"
DEFAULT_MINIO_USER="minioadmin"
DEFAULT_MINIO_BUCKET="assets"
DEFAULT_MINIO_PORT="9000"
DEFAULT_POSTGRES_PORT="5432"

# Script state
INTERACTIVE=true
FORCE_OVERWRITE=false
PROJECT_DIR=""
SSL_GENERATED=false
SMTP_CONFIGURED=false
CERTBOT_AVAILABLE=false
PROXY_MODE="${PROXY_MODE:-cloudflare}"

# =============================================================================
# Helper Functions
# =============================================================================

print_header() {
    echo ""
    printf "${BLUE}+===========================================================================+${NC}\n"
    printf "${BLUE}|                                                                           |${NC}\n"
    printf "${BLUE}|${NC}                         ${BOLD}BFFless - Setup Script${NC}                            ${BLUE}|${NC}\n"
    printf "${BLUE}|                                                                           |${NC}\n"
    printf "${BLUE}+===========================================================================+${NC}\n"
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

print_step() {
    echo ""
    printf "${BOLD}$1${NC}\n"
    echo "────────────────────────────────────────────────────────────"
}

# Check if a command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Generate a random password (POSIX-compatible)
generate_password() {
    length=${1:-32}
    if command_exists openssl; then
        openssl rand -base64 48 | tr -dc 'a-zA-Z0-9' | head -c "$length"
    elif [ -r /dev/urandom ]; then
        tr -dc 'a-zA-Z0-9' < /dev/urandom | head -c "$length"
    else
        # Fallback (less secure, but works)
        date +%s%N | sha256sum | base64 | head -c "$length"
    fi
}

# Generate base64-encoded key
generate_encryption_key() {
    if command_exists openssl; then
        openssl rand -base64 32
    else
        print_error "OpenSSL is required to generate encryption keys"
        exit 1
    fi
}

# Generate hex secret
generate_hex_secret() {
    length=${1:-32}
    if command_exists openssl; then
        openssl rand -hex "$length"
    else
        print_error "OpenSSL is required to generate secrets"
        exit 1
    fi
}

# Cross-platform sed in-place editing
# Usage: sed_inplace 'pattern' file
sed_inplace() {
    if [ "$(uname)" = "Darwin" ]; then
        sed -i '' "$1" "$2"
    else
        sed -i "$1" "$2"
    fi
}

# Set a variable in .env file (handles both KEY= and KEY=value formats)
# Usage: set_env_var KEY value
set_env_var() {
    key="$1"
    value="$2"
    # Escape special characters in value for sed
    escaped_value=$(printf '%s' "$value" | sed 's/[&/\]/\\&/g')
    sed_inplace "s|^${key}=.*|${key}=${escaped_value}|" .env
}

# Uncomment and set a variable in .env file (only first occurrence)
# Usage: uncomment_and_set KEY value
uncomment_and_set() {
    key="$1"
    value="$2"
    # Escape special characters in value for sed
    escaped_value=$(printf '%s' "$value" | sed 's/[&/\]/\\&/g')
    # First try to find commented version and uncomment+set it (first occurrence only)
    if grep -q "^# *${key}=" .env; then
        # Use awk to only replace the first match (cross-platform)
        awk -v key="$key" -v val="$escaped_value" '
            !found && /^# *'"$key"'=/ { print key "=" val; found=1; next }
            { print }
        ' .env > .env.tmp && mv .env.tmp .env
    else
        # If not found as comment, just set the value
        sed_inplace "s|^${key}=.*|${key}=${escaped_value}|" .env
    fi
}

# =============================================================================
# Prerequisite Installation (Debian/Ubuntu)
# =============================================================================

install_docker() {
    print_info "Installing Docker..."

    # Remove old versions
    apt-get remove -y docker docker-engine docker.io containerd runc 2>/dev/null || true

    # Install dependencies
    apt-get update
    apt-get install -y ca-certificates curl gnupg lsb-release

    # Add Docker's official GPG key
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    chmod a+r /etc/apt/keyrings/docker.gpg

    # Set up repository
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null

    # Install Docker
    apt-get update
    apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

    # Start Docker
    systemctl start docker
    systemctl enable docker

    print_success "Docker installed successfully"
}

install_certbot() {
    print_info "Installing Certbot..."
    apt-get update
    apt-get install -y certbot
    print_success "Certbot installed successfully"
}

install_openssl() {
    print_info "Installing OpenSSL..."
    apt-get update
    apt-get install -y openssl
    print_success "OpenSSL installed successfully"
}

# Detect OS type
detect_os() {
    if [ -f /etc/os-release ]; then
        . /etc/os-release
        OS_TYPE="$ID"
        OS_VERSION="$VERSION_ID"
    elif command_exists lsb_release; then
        OS_TYPE=$(lsb_release -si | tr '[:upper:]' '[:lower:]')
        OS_VERSION=$(lsb_release -sr)
    else
        OS_TYPE="unknown"
        OS_VERSION="unknown"
    fi
}

# Check if we can auto-install
can_auto_install() {
    case "$OS_TYPE" in
        ubuntu|debian)
            return 0
            ;;
        *)
            return 1
            ;;
    esac
}

# =============================================================================
# Prerequisite Checks
# =============================================================================

check_prerequisites() {
    print_step "Checking prerequisites"

    # Detect OS for potential auto-install
    detect_os

    MISSING_DOCKER=false
    MISSING_COMPOSE=false
    MISSING_OPENSSL=false
    DOCKER_NOT_RUNNING=false
    errors=0

    # Check Docker
    if command_exists docker; then
        docker_version=$(docker --version 2>/dev/null | head -n1)
        print_success "Docker: $docker_version"

        # Check if Docker daemon is running
        if ! docker info >/dev/null 2>&1; then
            if docker info 2>&1 | grep -q "permission denied"; then
                print_warning "Docker requires elevated permissions"
                echo "    Either:"
                echo "      1. Run this script with sudo"
                echo "      2. Add your user to the docker group:"
                echo "         sudo usermod -aG docker \$USER"
                echo "         (Log out and back in for changes to take effect)"
            else
                print_error "Docker daemon is not running"
                DOCKER_NOT_RUNNING=true
            fi
            errors=$((errors + 1))
        fi
    else
        print_error "Docker is not installed"
        MISSING_DOCKER=true
        errors=$((errors + 1))
    fi

    # Check Docker Compose (v2 or v1)
    if command_exists docker && docker compose version >/dev/null 2>&1; then
        compose_version=$(docker compose version 2>/dev/null | head -n1)
        print_success "Docker Compose: $compose_version"
    elif command_exists docker-compose; then
        compose_version=$(docker-compose --version 2>/dev/null | head -n1)
        print_success "Docker Compose: $compose_version"
    else
        if [ "$MISSING_DOCKER" = false ]; then
            print_error "Docker Compose is not installed"
            MISSING_COMPOSE=true
            errors=$((errors + 1))
        else
            # Docker Compose comes with Docker, so if Docker is missing, compose will be installed with it
            MISSING_COMPOSE=true
        fi
    fi

    # Check OpenSSL
    if command_exists openssl; then
        openssl_version=$(openssl version 2>/dev/null | head -n1)
        print_success "OpenSSL: $openssl_version"
    else
        print_error "OpenSSL is not installed"
        MISSING_OPENSSL=true
        errors=$((errors + 1))
    fi

    # Check curl (needed for downloading)
    if command_exists curl; then
        curl_version=$(curl --version 2>/dev/null | head -n1)
        print_success "curl: $curl_version"
    else
        print_warning "curl is not installed (optional but recommended)"
    fi

    # Check Git (optional)
    if command_exists git; then
        git_version=$(git --version 2>/dev/null | head -n1)
        print_success "Git: $git_version"
    else
        print_warning "Git is not installed (optional)"
    fi

    # Check certbot (required for production deployments without Cloudflare)
    if command_exists certbot; then
        certbot_version=$(certbot --version 2>/dev/null | head -n1)
        print_success "Certbot: $certbot_version"
        CERTBOT_AVAILABLE=true
    else
        # Will be checked again after we know the domain
        # For now, just note it's missing
        print_warning "Certbot is not installed (needed for SSL certificates)"
        printf "         ${DIM}Not required if using Cloudflare for SSL${NC}\n"
        CERTBOT_AVAILABLE=false
    fi

    # If there are missing prerequisites, offer to install them
    if [ "$errors" -gt 0 ]; then
        echo ""

        # Check if we can auto-install
        if can_auto_install; then
            # Check if running as root
            if [ "$(id -u)" -ne 0 ]; then
                print_error "Missing prerequisites require root to install."
                echo ""
                echo "    Run this script with sudo to auto-install:"
                printf "    ${YELLOW}sudo ./setup.sh${NC}\n"
                echo ""
                exit 1
            fi

            print_info "Missing prerequisites can be installed automatically on $OS_TYPE."
            echo ""
            printf "Install missing prerequisites now? (Y/n): "

            if [ "$INTERACTIVE" = true ]; then
                read -r install_response
            else
                install_response="y"
                echo "y"
            fi

            case "$install_response" in
                [nN][oO]|[nN])
                    print_error "Please install the missing prerequisites and run this script again."
                    exit 1
                    ;;
                *)
                    echo ""
                    # Install missing components
                    if [ "$MISSING_OPENSSL" = true ]; then
                        install_openssl
                    fi

                    if [ "$MISSING_DOCKER" = true ]; then
                        install_docker
                    elif [ "$DOCKER_NOT_RUNNING" = true ]; then
                        print_info "Starting Docker daemon..."
                        systemctl start docker
                        systemctl enable docker
                        print_success "Docker started"
                    fi

                    # Certbot is optional, install if missing
                    if [ "$CERTBOT_AVAILABLE" = false ]; then
                        echo ""
                        printf "${YELLOW}Certbot (SSL Certificates)${NC}\n"
                        echo "Certbot generates free SSL certificates from Let's Encrypt."
                        echo ""
                        printf "${DIM}Note: If you're using Cloudflare as your CDN/proxy, you don't need${NC}\n"
                        printf "${DIM}Certbot. Cloudflare provides Origin Certificates instead.${NC}\n"
                        echo ""
                        printf "Install Certbot for SSL certificates? (y/N): "
                        if [ "$INTERACTIVE" = true ]; then
                            read -r certbot_response
                        else
                            certbot_response="n"
                            echo "n"
                        fi
                        case "$certbot_response" in
                            [yY][eE][sS]|[yY])
                                install_certbot
                                CERTBOT_AVAILABLE=true
                                ;;
                            *)
                                print_warning "Skipping Certbot installation"
                                ;;
                        esac
                    fi

                    echo ""
                    print_success "Prerequisites installed!"
                    echo ""

                    # Re-verify everything is working
                    print_info "Verifying installation..."
                    if command_exists docker && docker info >/dev/null 2>&1; then
                        print_success "Docker is running"
                    else
                        print_error "Docker installation failed or not running"
                        exit 1
                    fi

                    if docker compose version >/dev/null 2>&1; then
                        print_success "Docker Compose is available"
                    else
                        print_error "Docker Compose not available"
                        exit 1
                    fi
                    ;;
            esac
        else
            print_error "Cannot auto-install on $OS_TYPE. Please install manually:"
            echo ""
            if [ "$MISSING_DOCKER" = true ]; then
                echo "    Docker: https://docs.docker.com/get-docker/"
            fi
            if [ "$MISSING_OPENSSL" = true ]; then
                echo "    OpenSSL: Use your package manager"
            fi
            echo ""
            exit 1
        fi
    fi

    echo ""
    print_success "All prerequisites met!"
}

# =============================================================================
# Check for Existing .env File
# =============================================================================

check_existing_env() {
    if [ -f ".env" ]; then
        echo ""
        print_warning "An .env file already exists!"
        echo ""

        if [ "$FORCE_OVERWRITE" = true ]; then
            print_info "Backing up existing .env to .env.backup"
            cp .env .env.backup
            return 0
        fi

        printf "Do you want to overwrite it? (y/N): "
        if [ "$INTERACTIVE" = true ]; then
            read -r response
            case "$response" in
                [yY][eE][sS]|[yY])
                    print_info "Backing up existing .env to .env.backup"
                    cp .env .env.backup
                    ;;
                *)
                    print_info "Setup cancelled. Using existing .env file."
                    exit 0
                    ;;
            esac
        else
            print_error "Use --force to overwrite existing .env file in non-interactive mode"
            exit 1
        fi
    fi
}

# =============================================================================
# Configuration Prompts
# =============================================================================

prompt_configuration() {
    print_step "Configuration"

    echo "Please provide the following configuration values."
    echo "Press Enter to accept the default value shown in brackets."
    echo ""

    # Primary domain
    printf "Primary domain [${DEFAULT_DOMAIN}]: "
    if [ "$INTERACTIVE" = true ]; then
        read -r PRIMARY_DOMAIN
    else
        echo "$PRIMARY_DOMAIN"
    fi
    PRIMARY_DOMAIN=${PRIMARY_DOMAIN:-$DEFAULT_DOMAIN}

    # CDN/Proxy mode (only for non-localhost domains)
    if [ "$PRIMARY_DOMAIN" != "localhost" ]; then
        echo ""
        printf "${YELLOW}SSL Certificate Method${NC}\n"
        echo ""
        echo "  1. Cloudflare (Recommended) - Free SSL, DDoS protection, CDN"
        echo "     Use Origin Certificates from Cloudflare. No certbot needed."
        echo ""
        echo "  2. Let's Encrypt - Free SSL certificates"
        echo "     Requires certbot and port 80 open for verification."
        echo ""
        printf "Choice [1]: "
        if [ "$INTERACTIVE" = true ]; then
            read -r proxy_choice
            case "$proxy_choice" in
                2)
                    PROXY_MODE="none"
                    ;;
                *)
                    # Default to Cloudflare (option 1 or empty)
                    PROXY_MODE="cloudflare"
                    ;;
            esac
        else
            echo "$PROXY_MODE"
        fi

        if [ "$PROXY_MODE" = "cloudflare" ]; then
            print_success "Cloudflare selected (recommended)"
            echo ""
            printf "  ${DIM}Full setup guide: https://docs.bffless.com/deployment/ssl-certificates${NC}\n"
        else
            print_info "Let's Encrypt selected"
        fi
    fi

    # PostgreSQL password
    printf "PostgreSQL password [auto-generate]: "
    if [ "$INTERACTIVE" = true ]; then
        read -r POSTGRES_PASSWORD
    else
        echo "(auto-generated)"
    fi
    if [ -z "$POSTGRES_PASSWORD" ]; then
        POSTGRES_PASSWORD=$(generate_password 32)
        print_info "Generated PostgreSQL password"
    fi

    # MinIO user
    printf "MinIO root user [${DEFAULT_MINIO_USER}]: "
    if [ "$INTERACTIVE" = true ]; then
        read -r MINIO_ROOT_USER
    else
        echo "$MINIO_ROOT_USER"
    fi
    MINIO_ROOT_USER=${MINIO_ROOT_USER:-$DEFAULT_MINIO_USER}

    # MinIO password
    printf "MinIO root password [auto-generate]: "
    if [ "$INTERACTIVE" = true ]; then
        read -r MINIO_ROOT_PASSWORD
    else
        echo "(auto-generated)"
    fi
    if [ -z "$MINIO_ROOT_PASSWORD" ]; then
        MINIO_ROOT_PASSWORD=$(generate_password 32)
        print_info "Generated MinIO password"
    fi

    # Redis password
    printf "Redis password [auto-generate]: "
    if [ "$INTERACTIVE" = true ]; then
        read -r REDIS_PASSWORD
    else
        echo "(auto-generated)"
    fi
    if [ -z "$REDIS_PASSWORD" ]; then
        REDIS_PASSWORD=$(generate_password 32)
        print_info "Generated Redis password"
    fi

    # Certbot email (required for non-localhost, non-Cloudflare)
    if [ "$PRIMARY_DOMAIN" != "localhost" ] && [ "$PROXY_MODE" != "cloudflare" ]; then
        echo ""
        printf "${YELLOW}SSL Certificate Email (Required)${NC}\n"
        echo "Let's Encrypt requires an email for certificate expiration notices."
        echo ""
        while [ -z "$CERTBOT_EMAIL" ] || [ "$CERTBOT_EMAIL" = "skip" ]; do
            printf "Email address for SSL certificates: "
            if [ "$INTERACTIVE" = true ]; then
                read -r CERTBOT_EMAIL
                if [ -z "$CERTBOT_EMAIL" ]; then
                    print_error "Email is required for SSL certificates"
                fi
            else
                if [ -z "$CERTBOT_EMAIL" ]; then
                    print_error "CERTBOT_EMAIL environment variable is required for non-localhost domains"
                    exit 1
                fi
                echo "$CERTBOT_EMAIL"
            fi
        done
        print_success "SSL email: $CERTBOT_EMAIL"
    fi

    # SMTP configuration (optional)
    echo ""
    printf "${YELLOW}Email Configuration (Optional)${NC}\n"
    echo "Configure SMTP for password reset and notifications."
    echo "You can skip this and configure later in Admin Settings."
    echo ""

    printf "Configure SMTP now? (y/N): "
    if [ "$INTERACTIVE" = true ]; then
        read -r configure_smtp
    else
        configure_smtp="${SMTP_HOST:+y}"
        echo "${configure_smtp:-n}"
    fi

    if [ "$configure_smtp" = "y" ] || [ "$configure_smtp" = "Y" ]; then
        printf "SMTP Host: "
        if [ "$INTERACTIVE" = true ]; then
            read -r SMTP_HOST
        else
            echo "$SMTP_HOST"
        fi

        printf "SMTP Port [587]: "
        if [ "$INTERACTIVE" = true ]; then
            read -r SMTP_PORT
        else
            echo "${SMTP_PORT:-587}"
        fi
        SMTP_PORT=${SMTP_PORT:-587}

        printf "SMTP Username (optional): "
        if [ "$INTERACTIVE" = true ]; then
            read -r SMTP_USER
        else
            echo "${SMTP_USER:-}"
        fi

        printf "SMTP Password (optional): "
        if [ "$INTERACTIVE" = true ]; then
            read -rs SMTP_PASSWORD
            echo ""
        else
            echo "(hidden)"
        fi

        printf "From Email Address: "
        if [ "$INTERACTIVE" = true ]; then
            read -r SMTP_FROM_ADDRESS
        else
            echo "$SMTP_FROM_ADDRESS"
        fi

        printf "From Name [Static Asset Hosting Platform]: "
        if [ "$INTERACTIVE" = true ]; then
            read -r SMTP_FROM_NAME
        else
            echo "${SMTP_FROM_NAME:-Static Asset Hosting Platform}"
        fi
        SMTP_FROM_NAME=${SMTP_FROM_NAME:-Static Asset Hosting Platform}

        SMTP_CONFIGURED=true
        print_success "SMTP configuration collected"
    else
        print_warning "SMTP skipped - password reset will not work until configured"
        SMTP_CONFIGURED=false
    fi

    echo ""
    print_success "Configuration collected"
}

# =============================================================================
# Secret Generation
# =============================================================================

generate_secrets() {
    print_step "Generating secure secrets"

    echo "Creating cryptographically secure secrets..."
    echo ""

    # Generate encryption key (base64, 32 bytes = 256 bits)
    ENCRYPTION_KEY=$(generate_encryption_key)
    print_success "Generated ENCRYPTION_KEY (AES-256)"

    # Generate JWT secret (base64, 32 bytes = 256 bits)
    JWT_SECRET=$(generate_encryption_key)
    print_success "Generated JWT_SECRET"

    # Generate API key salt (base64, 32 bytes = 256 bits)
    API_KEY_SALT=$(generate_encryption_key)
    print_success "Generated API_KEY_SALT"

    echo ""
    print_success "All secrets generated"
}

# =============================================================================
# Environment File Creation
# =============================================================================

create_env_file() {
    print_step "Creating .env file from .env.example"

    # Determine if this is production or local
    if [ "$PRIMARY_DOMAIN" = "localhost" ]; then
        COOKIE_SECURE="false"
        FRONTEND_URL="http://localhost"
        COOKIE_DOMAIN=""
    else
        COOKIE_SECURE="true"
        FRONTEND_URL="https://www.${PRIMARY_DOMAIN}"
        COOKIE_DOMAIN=".${PRIMARY_DOMAIN}"
    fi

    # Copy .env.example as the base (preserves all comments and documentation)
    cp .env.example .env
    print_info "Copied .env.example to .env"

    # ─────────────────────────────────────────────────────────────────────────
    # Set security secrets (generated values)
    # ─────────────────────────────────────────────────────────────────────────
    set_env_var "ENCRYPTION_KEY" "$ENCRYPTION_KEY"
    set_env_var "JWT_SECRET" "$JWT_SECRET"
    set_env_var "API_KEY_SALT" "$API_KEY_SALT"

    # ─────────────────────────────────────────────────────────────────────────
    # Set database configuration
    # ─────────────────────────────────────────────────────────────────────────
    set_env_var "POSTGRES_PASSWORD" "$POSTGRES_PASSWORD"

    # ─────────────────────────────────────────────────────────────────────────
    # Set domain configuration
    # ─────────────────────────────────────────────────────────────────────────
    set_env_var "PRIMARY_DOMAIN" "$PRIMARY_DOMAIN"
    set_env_var "FRONTEND_URL" "$FRONTEND_URL"

    # ─────────────────────────────────────────────────────────────────────────
    # Set cookie configuration
    # ─────────────────────────────────────────────────────────────────────────
    set_env_var "COOKIE_SECURE" "$COOKIE_SECURE"
    if [ -n "$COOKIE_DOMAIN" ]; then
        uncomment_and_set "COOKIE_DOMAIN" "$COOKIE_DOMAIN"
    fi

    # ─────────────────────────────────────────────────────────────────────────
    # Set MinIO configuration
    # ─────────────────────────────────────────────────────────────────────────
    set_env_var "MINIO_ROOT_USER" "$MINIO_ROOT_USER"
    set_env_var "MINIO_ROOT_PASSWORD" "$MINIO_ROOT_PASSWORD"
    set_env_var "MINIO_ACCESS_KEY" "$MINIO_ROOT_USER"
    set_env_var "MINIO_SECRET_KEY" "$MINIO_ROOT_PASSWORD"

    # ─────────────────────────────────────────────────────────────────────────
    # Set cache configuration (memory is default, user can enable Redis later)
    # ─────────────────────────────────────────────────────────────────────────
    # Note: CACHE_TYPE defaults to 'memory' in .env.example
    # If user wants Redis, they should also set ENABLE_REDIS=true
    set_env_var "REDIS_PASSWORD" "$REDIS_PASSWORD"

    # ─────────────────────────────────────────────────────────────────────────
    # Set SSL configuration (for non-localhost)
    # ─────────────────────────────────────────────────────────────────────────
    if [ -n "$CERTBOT_EMAIL" ]; then
        uncomment_and_set "CERTBOT_EMAIL" "$CERTBOT_EMAIL"
    fi

    # ─────────────────────────────────────────────────────────────────────────
    # Set proxy mode (for Cloudflare CDN support)
    # ─────────────────────────────────────────────────────────────────────────
    if [ "$PROXY_MODE" = "cloudflare" ]; then
        uncomment_and_set "PROXY_MODE" "cloudflare"
        # Cloudflare handles SSL at the edge (Universal SSL covers *.domain.com)
        # so disable the Let's Encrypt wildcard SSL flow and related UI elements
        echo "" >> .env
        echo "# Cloudflare SSL - disabled because Cloudflare handles SSL at edge" >> .env
        echo "FEATURE_WILDCARD_SSL=false" >> .env
        echo "FEATURE_WILDCARD_SSL_BANNER=false" >> .env
    fi

    # ─────────────────────────────────────────────────────────────────────────
    # Set SMTP configuration (if provided)
    # ─────────────────────────────────────────────────────────────────────────
    if [ "$SMTP_CONFIGURED" = true ]; then
        uncomment_and_set "SMTP_HOST" "$SMTP_HOST"
        uncomment_and_set "SMTP_PORT" "${SMTP_PORT:-587}"
        uncomment_and_set "SMTP_SECURE" "${SMTP_SECURE:-false}"
        if [ -n "$SMTP_USER" ]; then
            uncomment_and_set "SMTP_USER" "$SMTP_USER"
        fi
        if [ -n "$SMTP_PASSWORD" ]; then
            uncomment_and_set "SMTP_PASSWORD" "$SMTP_PASSWORD"
        fi
        if [ -n "$SMTP_FROM_ADDRESS" ]; then
            uncomment_and_set "EMAIL_FROM_ADDRESS" "$SMTP_FROM_ADDRESS"
        fi
        if [ -n "$SMTP_FROM_NAME" ]; then
            uncomment_and_set "EMAIL_FROM_NAME" "$SMTP_FROM_NAME"
        fi
    fi

    echo ""
    if [ "$SMTP_CONFIGURED" = true ]; then
        print_success ".env file created (with SMTP configuration)"
    else
        print_success ".env file created"
        print_warning "SMTP not configured - password reset disabled until configured"
    fi
}

# =============================================================================
# Verification
# =============================================================================

verify_configuration() {
    print_step "Verifying configuration"

    # Check .env file exists and is readable
    if [ -f ".env" ]; then
        print_success ".env file exists"
    else
        print_error ".env file was not created"
        exit 1
    fi

    # Verify critical values are set
    if grep -q "^ENCRYPTION_KEY=.\+$" .env; then
        print_success "ENCRYPTION_KEY is set"
    else
        print_error "ENCRYPTION_KEY is missing"
        exit 1
    fi

    if grep -q "^POSTGRES_PASSWORD=.\+$" .env; then
        print_success "POSTGRES_PASSWORD is set"
    else
        print_error "POSTGRES_PASSWORD is missing"
        exit 1
    fi

    if grep -q "^JWT_SECRET=.\+$" .env; then
        print_success "JWT_SECRET is set"
    else
        print_error "JWT_SECRET is missing"
        exit 1
    fi

    if grep -q "^API_KEY_SALT=.\+$" .env; then
        print_success "API_KEY_SALT is set"
    else
        print_error "API_KEY_SALT is missing"
        exit 1
    fi

    echo ""
    print_success "Configuration verified"
}

# =============================================================================
# SSL Certificate Generation
# =============================================================================

generate_ssl_certificates() {
    # Skip if localhost - no SSL needed
    if [ "$PRIMARY_DOMAIN" = "localhost" ]; then
        SSL_GENERATED=false
        return 0
    fi

    # Cloudflare mode: use Origin Certificates instead of Let's Encrypt
    if [ "$PROXY_MODE" = "cloudflare" ]; then
        print_step "SSL Certificate Setup (Cloudflare Origin Certificate)"

        mkdir -p ssl

        # Check if certificates already exist
        if [ -f "ssl/fullchain.pem" ] && [ -f "ssl/privkey.pem" ]; then
            print_success "Found existing certificate files in ssl/"
            chmod 644 ssl/fullchain.pem
            chmod 600 ssl/privkey.pem
            SSL_GENERATED=true
            return 0
        fi

        if [ "$INTERACTIVE" = true ]; then
            echo ""
            echo "Cloudflare Origin Certificates encrypt traffic between Cloudflare"
            echo "and your server."
            echo ""
            printf "${YELLOW}Before continuing, you need to:${NC}\n"
            echo ""
            echo "  1. Add your domain to Cloudflare (point nameservers)"
            echo "  2. Create DNS A records for: @, www, admin, minio, *"
            echo "  3. Generate an Origin Certificate in Cloudflare Dashboard"
            echo ""
            printf "${CYAN}Full guide: https://docs.bffless.com/deployment/ssl-certificates${NC}\n"
            echo ""

            printf "Do you have your Origin Certificate ready? (y/N): "
            read -r cert_ready
            case "$cert_ready" in
                [yY][eE][sS]|[yY])
                    echo ""
                    # Read Origin Certificate
                    printf "${BOLD}Paste your Origin Certificate PEM below.${NC}\n"
                    echo "When finished, enter a blank line:"
                    echo ""
                    CERT_CONTENT=""
                    while IFS= read -r line; do
                        if [ -z "$line" ] && echo "$CERT_CONTENT" | grep -q "END CERTIFICATE"; then
                            break
                        fi
                        if [ -n "$CERT_CONTENT" ]; then
                            CERT_CONTENT="${CERT_CONTENT}
${line}"
                        else
                            CERT_CONTENT="${line}"
                        fi
                    done

                    if [ -z "$CERT_CONTENT" ]; then
                        print_error "No certificate provided"
                        echo ""
                        echo "  You can add the certificate later by saving it to ssl/fullchain.pem"
                        SSL_GENERATED=false
                        return 0
                    fi

                    printf '%s\n' "$CERT_CONTENT" > ssl/fullchain.pem
                    print_success "Origin Certificate saved to ssl/fullchain.pem"
                    echo ""

                    # Read Private Key
                    printf "${BOLD}Paste your Private Key PEM below.${NC}\n"
                    echo "When finished, enter a blank line:"
                    echo ""
                    KEY_CONTENT=""
                    while IFS= read -r line; do
                        if [ -z "$line" ] && echo "$KEY_CONTENT" | grep -q "END.*KEY"; then
                            break
                        fi
                        if [ -n "$KEY_CONTENT" ]; then
                            KEY_CONTENT="${KEY_CONTENT}
${line}"
                        else
                            KEY_CONTENT="${line}"
                        fi
                    done

                    if [ -z "$KEY_CONTENT" ]; then
                        print_error "No private key provided"
                        echo ""
                        echo "  You can add the private key later by saving it to ssl/privkey.pem"
                        SSL_GENERATED=false
                        return 0
                    fi

                    printf '%s\n' "$KEY_CONTENT" > ssl/privkey.pem
                    print_success "Private Key saved to ssl/privkey.pem"

                    # Set file permissions
                    chmod 644 ssl/fullchain.pem
                    chmod 600 ssl/privkey.pem

                    echo ""
                    print_success "Cloudflare Origin Certificate ready in ssl/"
                    SSL_GENERATED=true
                    ;;
                *)
                    echo ""
                    print_warning "Skipping SSL certificate setup"
                    echo ""
                    echo "  Complete these steps before starting the platform:"
                    echo ""
                    echo "  1. Follow the Cloudflare setup guide:"
                    printf "     ${CYAN}https://docs.bffless.com/deployment/ssl-certificates${NC}\n"
                    echo ""
                    echo "  2. Save your Origin Certificate to:"
                    echo "     ssl/fullchain.pem   - Origin Certificate"
                    echo "     ssl/privkey.pem     - Private Key"
                    echo ""
                    SSL_GENERATED=false
                    ;;
            esac
        else
            # Non-interactive mode: certificates must already exist
            print_warning "Cloudflare Origin Certificate files not found in ssl/"
            echo ""
            echo "  To complete SSL setup, save your Cloudflare Origin Certificate files:"
            echo ""
            echo "    ssl/fullchain.pem   - Origin Certificate PEM"
            echo "    ssl/privkey.pem     - Private Key PEM"
            echo ""
            echo "  Full guide: https://docs.bffless.com/deployment/ssl-certificates"
            echo ""
            SSL_GENERATED=false
        fi

        return 0
    fi

    # For production domains, SSL is required
    print_step "SSL Certificate Setup (Required)"

    # Check certbot is installed
    if [ "$CERTBOT_AVAILABLE" != true ]; then
        print_error "Certbot is required for SSL certificate generation"
        echo ""
        echo "  Install certbot and run setup again:"
        echo "    apt-get install certbot  (Debian/Ubuntu)"
        echo "    brew install certbot     (macOS)"
        echo ""
        exit 1
    fi

    echo "SSL certificates will be generated for:"
    echo "  - ${PRIMARY_DOMAIN}"
    echo "  - www.${PRIMARY_DOMAIN}"
    echo "  - admin.${PRIMARY_DOMAIN}"
    echo "  - minio.${PRIMARY_DOMAIN}"
    echo ""
    printf "${YELLOW}Required DNS Configuration:${NC}\n"
    echo ""
    echo "  Add these A records in your DNS provider (Cloudflare, Namecheap, Route53, etc.):"
    echo ""
    printf "  ${CYAN}Type    Name              Value${NC}\n"
    echo "  ────    ────              ─────"
    printf "  A       @                 <your-server-ip>\n"
    printf "  A       www               <your-server-ip>\n"
    printf "  A       admin             <your-server-ip>\n"
    printf "  A       minio             <your-server-ip>\n"
    printf "  A       *                 <your-server-ip>  ${DIM}(for subdomain mappings)${NC}\n"
    echo ""
    printf "  ${DIM}Get your server IP: curl -4 ifconfig.me${NC}\n"
    echo ""
    printf "${YELLOW}Additional Requirements:${NC}\n"
    echo "  - Port 80 must be open (for Let's Encrypt verification)"
    echo "  - Wait 5-15 minutes for DNS propagation after adding records"
    echo ""

    # Get this server's public IP
    print_info "Checking DNS configuration..."
    echo ""

    SERVER_IP=""
    if command_exists curl; then
        SERVER_IP=$(curl -4 -s --max-time 5 ifconfig.me 2>/dev/null || curl -4 -s --max-time 5 icanhazip.com 2>/dev/null || echo "")
    fi

    if [ -z "$SERVER_IP" ]; then
        print_warning "Could not determine server's public IP"
        echo "  Skipping automatic DNS verification"
        echo ""
    else
        printf "  Server IP: ${CYAN}${SERVER_IP}${NC}\n"
        echo ""
    fi

    # Check DNS records for each domain
    DNS_OK=true
    DNS_ERRORS=""

    if [ -n "$SERVER_IP" ] && command_exists dig; then
        for domain in "${PRIMARY_DOMAIN}" "www.${PRIMARY_DOMAIN}" "admin.${PRIMARY_DOMAIN}" "minio.${PRIMARY_DOMAIN}"; do
            RESOLVED_IP=$(dig +short "$domain" 2>/dev/null | tail -n1)
            if [ "$RESOLVED_IP" = "$SERVER_IP" ]; then
                printf "  ${GREEN}✓${NC} ${domain} → ${RESOLVED_IP}\n"
            elif [ -z "$RESOLVED_IP" ]; then
                printf "  ${RED}✗${NC} ${domain} → ${RED}(no record found)${NC}\n"
                DNS_OK=false
                DNS_ERRORS="${DNS_ERRORS}\n    - ${domain}: No A record found"
            else
                printf "  ${RED}✗${NC} ${domain} → ${RESOLVED_IP} ${RED}(expected ${SERVER_IP})${NC}\n"
                DNS_OK=false
                DNS_ERRORS="${DNS_ERRORS}\n    - ${domain}: Points to ${RESOLVED_IP}, expected ${SERVER_IP}"
            fi
        done
        echo ""
    elif [ -n "$SERVER_IP" ] && command_exists host; then
        for domain in "${PRIMARY_DOMAIN}" "www.${PRIMARY_DOMAIN}" "admin.${PRIMARY_DOMAIN}" "minio.${PRIMARY_DOMAIN}"; do
            RESOLVED_IP=$(host "$domain" 2>/dev/null | grep "has address" | head -n1 | awk '{print $NF}')
            if [ "$RESOLVED_IP" = "$SERVER_IP" ]; then
                printf "  ${GREEN}✓${NC} ${domain} → ${RESOLVED_IP}\n"
            elif [ -z "$RESOLVED_IP" ]; then
                printf "  ${RED}✗${NC} ${domain} → ${RED}(no record found)${NC}\n"
                DNS_OK=false
                DNS_ERRORS="${DNS_ERRORS}\n    - ${domain}: No A record found"
            else
                printf "  ${RED}✗${NC} ${domain} → ${RESOLVED_IP} ${RED}(expected ${SERVER_IP})${NC}\n"
                DNS_OK=false
                DNS_ERRORS="${DNS_ERRORS}\n    - ${domain}: Points to ${RESOLVED_IP}, expected ${SERVER_IP}"
            fi
        done
        echo ""
    else
        print_warning "Neither 'dig' nor 'host' available - cannot verify DNS"
        DNS_OK=false
    fi

    # Handle DNS check results
    if [ "$DNS_OK" = true ]; then
        print_success "All DNS records are correctly configured!"
        echo ""
    else
        print_error "DNS is not correctly configured"
        if [ -n "$DNS_ERRORS" ]; then
            echo ""
            echo "  Issues found:"
            printf "$DNS_ERRORS\n"
        fi
        echo ""

        # Allow retry loop in interactive mode
        if [ "$INTERACTIVE" = true ]; then
            while true; do
                echo ""
                printf "Options:\n"
                printf "  ${CYAN}[r]${NC} Retry DNS check (after configuring DNS)\n"
                printf "  ${CYAN}[s]${NC} Skip SSL for now (configure manually later)\n"
                printf "  ${CYAN}[q]${NC} Quit setup\n"
                echo ""
                printf "Choice [r/s/q]: "
                read -r dns_choice
                case "$dns_choice" in
                    [rR])
                        echo ""
                        print_info "Rechecking DNS..."
                        echo ""
                        # Re-run DNS check
                        DNS_OK=true
                        DNS_ERRORS=""
                        for domain in "${PRIMARY_DOMAIN}" "www.${PRIMARY_DOMAIN}" "admin.${PRIMARY_DOMAIN}" "minio.${PRIMARY_DOMAIN}"; do
                            if command_exists dig; then
                                RESOLVED_IP=$(dig +short "$domain" 2>/dev/null | tail -n1)
                            elif command_exists host; then
                                RESOLVED_IP=$(host "$domain" 2>/dev/null | grep "has address" | head -n1 | awk '{print $NF}')
                            fi
                            if [ "$RESOLVED_IP" = "$SERVER_IP" ]; then
                                printf "  ${GREEN}✓${NC} ${domain} → ${RESOLVED_IP}\n"
                            elif [ -z "$RESOLVED_IP" ]; then
                                printf "  ${RED}✗${NC} ${domain} → ${RED}(no record found)${NC}\n"
                                DNS_OK=false
                            else
                                printf "  ${RED}✗${NC} ${domain} → ${RESOLVED_IP} ${RED}(expected ${SERVER_IP})${NC}\n"
                                DNS_OK=false
                            fi
                        done
                        echo ""
                        if [ "$DNS_OK" = true ]; then
                            print_success "All DNS records are now correctly configured!"
                            echo ""
                            break
                        else
                            print_error "DNS still not configured correctly"
                        fi
                        ;;
                    [sS])
                        echo ""
                        print_warning "Skipping SSL certificate generation."
                        echo ""
                        echo "  After configuring DNS, run this command to generate certificates:"
                        echo ""
                        printf "  ${YELLOW}certbot certonly --standalone --email ${CERTBOT_EMAIL} -d ${PRIMARY_DOMAIN} -d www.${PRIMARY_DOMAIN} -d admin.${PRIMARY_DOMAIN} -d minio.${PRIMARY_DOMAIN}${NC}\n"
                        echo ""
                        echo "  Then copy the certificates to the ssl/ directory:"
                        echo ""
                        printf "  ${YELLOW}mkdir -p ssl${NC}\n"
                        printf "  ${YELLOW}cp /etc/letsencrypt/live/${PRIMARY_DOMAIN}/fullchain.pem ssl/${NC}\n"
                        printf "  ${YELLOW}cp /etc/letsencrypt/live/${PRIMARY_DOMAIN}/privkey.pem ssl/${NC}\n"
                        echo ""
                        print_info "Setup will continue, but the platform won't work until SSL is configured."
                        echo ""
                        SSL_GENERATED=false
                        return 0
                        ;;
                    [qQ])
                        echo ""
                        print_info "Setup cancelled. Your .env file has been created."
                        echo "  Run ./setup.sh again after configuring DNS."
                        echo ""
                        exit 0
                        ;;
                    *)
                        print_error "Invalid choice. Please enter r, s, or q."
                        ;;
                esac
            done
        else
            # Non-interactive mode: just skip
            print_warning "SSL certificates cannot be generated until DNS is configured."
            echo ""
            echo "  After configuring DNS, run this command to generate certificates:"
            echo ""
            printf "  ${YELLOW}certbot certonly --standalone --email ${CERTBOT_EMAIL} -d ${PRIMARY_DOMAIN} -d www.${PRIMARY_DOMAIN} -d admin.${PRIMARY_DOMAIN} -d minio.${PRIMARY_DOMAIN}${NC}\n"
            echo ""
            SSL_GENERATED=false
            return 0
        fi
    fi

    # Check if port 80 is available
    if command_exists lsof; then
        if lsof -i :80 >/dev/null 2>&1; then
            print_error "Port 80 is already in use. Cannot run certbot in standalone mode."
            echo ""
            echo "  Stop the service using port 80 and run setup again."
            echo "  Check what's using port 80: lsof -i :80"
            echo ""
            SSL_GENERATED=false
            return 0
        fi
    fi

    echo ""
    print_info "Running certbot in standalone mode..."
    echo ""

    # Create ssl directory
    mkdir -p ssl

    # Run certbot with standalone mode (uses its own temporary web server)
    if certbot certonly --standalone \
        --non-interactive \
        --agree-tos \
        --email "$CERTBOT_EMAIL" \
        -d "${PRIMARY_DOMAIN}" \
        -d "www.${PRIMARY_DOMAIN}" \
        -d "admin.${PRIMARY_DOMAIN}" \
        -d "minio.${PRIMARY_DOMAIN}"; then

        print_success "SSL certificates generated successfully!"
        echo ""

        # Copy certificates to project ssl directory
        print_info "Copying certificates to project ssl/ directory..."

        # Copy the certificate files (following symlinks)
        cp -L "/etc/letsencrypt/live/${PRIMARY_DOMAIN}/fullchain.pem" ssl/fullchain.pem
        cp -L "/etc/letsencrypt/live/${PRIMARY_DOMAIN}/privkey.pem" ssl/privkey.pem

        # Set appropriate permissions
        chmod 644 ssl/fullchain.pem
        chmod 600 ssl/privkey.pem

        # Generate self-signed wildcard certificate (used by nginx catch-all server block)
        # This is a placeholder that allows nginx to start. Users can configure
        # a real wildcard certificate later via the Admin UI.
        print_info "Generating temporary wildcard certificate for *.${PRIMARY_DOMAIN}..."

        openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
            -keyout "ssl/wildcard.${PRIMARY_DOMAIN}.key" \
            -out "ssl/wildcard.${PRIMARY_DOMAIN}.crt" \
            -subj "/CN=*.${PRIMARY_DOMAIN}" \
            -addext "subjectAltName=DNS:*.${PRIMARY_DOMAIN}" \
            2>/dev/null

        chmod 644 "ssl/wildcard.${PRIMARY_DOMAIN}.crt"
        chmod 600 "ssl/wildcard.${PRIMARY_DOMAIN}.key"

        print_success "Certificates ready in ssl/ directory"
        echo ""
        echo "  ssl/fullchain.pem                    - Main cert (Let's Encrypt)"
        echo "  ssl/privkey.pem                      - Main key (Let's Encrypt)"
        echo "  ssl/wildcard.${PRIMARY_DOMAIN}.crt   - Wildcard cert (temporary)"
        echo "  ssl/wildcard.${PRIMARY_DOMAIN}.key   - Wildcard key (temporary)"
        echo ""
        printf "  ${DIM}Note: The wildcard cert is self-signed. Configure a real wildcard${NC}\n"
        printf "  ${DIM}certificate in the Admin UI under Settings > SSL.${NC}\n"
        echo ""
        SSL_GENERATED=true
    else
        print_error "Failed to generate SSL certificates"
        echo ""
        echo "  Common issues:"
        echo "    - DNS not propagated yet (wait 5-15 minutes)"
        echo "    - Port 80 blocked by firewall"
        echo "    - Domain not pointing to this server"
        echo ""
        echo "  Verify DNS is configured correctly:"
        echo "    dig ${PRIMARY_DOMAIN}"
        echo "    dig www.${PRIMARY_DOMAIN}"
        echo ""
        echo "  You can generate certificates manually later."
        echo ""
        SSL_GENERATED=false
    fi
}

# =============================================================================
# Next Steps
# =============================================================================

print_next_steps() {
    echo ""
    printf "${GREEN}+===========================================================================+${NC}\n"
    printf "${GREEN}|                                                                           |${NC}\n"
    printf "${GREEN}|${NC}                              ${BOLD}Setup Complete!${NC}                              ${GREEN}|${NC}\n"
    printf "${GREEN}|                                                                           |${NC}\n"
    printf "${GREEN}+===========================================================================+${NC}\n"
    echo ""

    # Show SSL status
    if [ "$SSL_GENERATED" = true ]; then
        if [ "$PROXY_MODE" = "cloudflare" ]; then
            printf "${GREEN}✓ Cloudflare Origin Certificate saved to ssl/${NC}\n"
        else
            printf "${GREEN}✓ SSL certificates generated and copied to ssl/${NC}\n"
        fi
        echo ""
    fi

    printf "${BOLD}Next Steps:${NC}\n"
    echo ""

    step=1

    # Cloudflare-specific next steps
    if [ "$PROXY_MODE" = "cloudflare" ]; then
        if [ "$SSL_GENERATED" != true ]; then
            printf "  ${CYAN}${step}.${NC} Save your Cloudflare Origin Certificate:\n"
            echo ""
            echo "     Generate in Cloudflare Dashboard: SSL/TLS > Origin Server > Create Certificate"
            echo "     Include hostnames: ${PRIMARY_DOMAIN} and *.${PRIMARY_DOMAIN}"
            echo ""
            printf "     ${YELLOW}# Save certificate and key to ssl/ directory${NC}\n"
            printf "     ${YELLOW}nano ssl/fullchain.pem   # paste Origin Certificate${NC}\n"
            printf "     ${YELLOW}nano ssl/privkey.pem     # paste Private Key${NC}\n"
            printf "     ${YELLOW}chmod 644 ssl/fullchain.pem${NC}\n"
            printf "     ${YELLOW}chmod 600 ssl/privkey.pem${NC}\n"
            echo ""
            step=$((step + 1))
        fi

        printf "  ${CYAN}${step}.${NC} Configure Cloudflare DNS (proxied, orange cloud):\n"
        echo ""
        printf "     ${YELLOW}${PRIMARY_DOMAIN}${NC}         → A record → ${YELLOW}<your-server-ip>${NC}  (Proxied)\n"
        printf "     ${YELLOW}www.${PRIMARY_DOMAIN}${NC}     → A record → ${YELLOW}<your-server-ip>${NC}  (Proxied)\n"
        printf "     ${YELLOW}admin.${PRIMARY_DOMAIN}${NC}   → A record → ${YELLOW}<your-server-ip>${NC}  (Proxied)\n"
        printf "     ${YELLOW}minio.${PRIMARY_DOMAIN}${NC}   → A record → ${YELLOW}<your-server-ip>${NC}  (Proxied)\n"
        printf "     ${YELLOW}*.${PRIMARY_DOMAIN}${NC}       → A record → ${YELLOW}<your-server-ip>${NC}  (Proxied)\n"
        echo ""
        step=$((step + 1))

        printf "  ${CYAN}${step}.${NC} Set Cloudflare SSL mode to ${BOLD}Full (Strict)${NC}:\n"
        echo ""
        echo "     Cloudflare Dashboard > SSL/TLS > Overview > Full (strict)"
        echo ""
        step=$((step + 1))

    # Standard Let's Encrypt next steps (only if not localhost and SSL wasn't generated)
    elif [ "$PRIMARY_DOMAIN" != "localhost" ] && [ "$SSL_GENERATED" != true ]; then
        printf "  ${CYAN}${step}.${NC} Configure DNS records (if not already done):\n"
        echo ""
        echo "     Point these records to your server IP:"
        echo ""
        printf "     ${YELLOW}${PRIMARY_DOMAIN}${NC}         → A record → ${YELLOW}<your-server-ip>${NC}\n"
        printf "     ${YELLOW}www.${PRIMARY_DOMAIN}${NC}     → A record → ${YELLOW}<your-server-ip>${NC}\n"
        printf "     ${YELLOW}admin.${PRIMARY_DOMAIN}${NC}   → A record → ${YELLOW}<your-server-ip>${NC}\n"
        printf "     ${YELLOW}minio.${PRIMARY_DOMAIN}${NC}   → A record → ${YELLOW}<your-server-ip>${NC}\n"
        printf "     ${YELLOW}*.${PRIMARY_DOMAIN}${NC}       → A record → ${YELLOW}<your-server-ip>${NC}  ${DIM}(for subdomain mappings)${NC}\n"
        echo ""
        printf "     ${DIM}Or use CNAME records pointing to ${PRIMARY_DOMAIN}${NC}\n"
        printf "     ${DIM}Wait 5-15 minutes for DNS propagation${NC}\n"
        echo ""
        step=$((step + 1))

        # SSL instructions (only if SSL wasn't generated)
        printf "  ${CYAN}${step}.${NC} Generate SSL certificates:\n"
        echo ""
        printf "     ${YELLOW}certbot certonly --standalone \\\\${NC}\n"
        printf "       ${YELLOW}-d ${PRIMARY_DOMAIN} \\\\${NC}\n"
        printf "       ${YELLOW}-d www.${PRIMARY_DOMAIN} \\\\${NC}\n"
        printf "       ${YELLOW}-d admin.${PRIMARY_DOMAIN} \\\\${NC}\n"
        printf "       ${YELLOW}-d minio.${PRIMARY_DOMAIN}${NC}\n"
        echo ""
        echo "     Then copy certificates:"
        printf "     ${YELLOW}mkdir -p ssl${NC}\n"
        printf "     ${YELLOW}cp /etc/letsencrypt/live/${PRIMARY_DOMAIN}/fullchain.pem ssl/${NC}\n"
        printf "     ${YELLOW}cp /etc/letsencrypt/live/${PRIMARY_DOMAIN}/privkey.pem ssl/${NC}\n"
        echo ""
        step=$((step + 1))
    fi

    # Change directory (if installed via install.sh)
    if [ -n "$BFFLESS_INSTALL_DIR" ]; then
        printf "  ${CYAN}${step}.${NC} Change to the installation directory:\n"
        echo ""
        printf "     ${YELLOW}cd ${BFFLESS_INSTALL_DIR}${NC}\n"
        echo ""
        step=$((step + 1))
    fi

    # Start platform
    printf "  ${CYAN}${step}.${NC} Start the platform:\n"
    echo ""
    printf "     ${YELLOW}./start.sh${NC}\n"
    echo ""
    printf "     ${DIM}Or with options:${NC}\n"
    printf "     ${YELLOW}./start.sh --all${NC}       ${DIM}# Start all services (MinIO + Redis)${NC}\n"
    printf "     ${YELLOW}./start.sh --minimal${NC}   ${DIM}# Start without optional services${NC}\n"
    echo ""
    step=$((step + 1))

    # Wait for services
    printf "  ${CYAN}${step}.${NC} Wait for all services to start (about 30-60 seconds)\n"
    echo ""
    printf "     ${YELLOW}docker compose logs -f${NC}  # Watch logs\n"
    printf "     ${YELLOW}docker compose ps${NC}       # Check status\n"
    echo ""
    step=$((step + 1))

    # Open browser
    printf "  ${CYAN}${step}.${NC} Open your browser:\n"
    echo ""
    if [ "$PRIMARY_DOMAIN" != "localhost" ]; then
        printf "     ${YELLOW}https://www.${PRIMARY_DOMAIN}${NC}         - Main application\n"
        printf "     ${YELLOW}https://admin.${PRIMARY_DOMAIN}${NC}       - Admin panel\n"
        printf "     ${YELLOW}https://minio.${PRIMARY_DOMAIN}${NC}       - MinIO console\n"
    else
        printf "     ${YELLOW}http://localhost${NC}\n"
    fi
    echo ""
    step=$((step + 1))

    # Complete wizard
    printf "  ${CYAN}${step}.${NC} Complete the setup wizard:\n"
    echo "     - Create your admin account"
    echo "     - Configure storage (MinIO is pre-configured)"
    echo "     - Test connection and complete setup"
    echo ""

    printf "${BOLD}Important Files:${NC}\n"
    echo ""
    printf "  ${CYAN}.env${NC}                        - Environment configuration (KEEP SECRET)\n"
    printf "  ${CYAN}start.sh${NC}                    - Startup script (reads .env, applies profiles)\n"
    printf "  ${CYAN}docker-compose.yml${NC}          - Docker service definitions\n"
    printf "  ${CYAN}ssl/${NC}                        - SSL certificates (if generated)\n"
    echo ""
    printf "${YELLOW}⚠ Security Note:${NC}\n"
    echo "  Keep your .env file secure. It contains sensitive secrets that"
    echo "  cannot be recovered if lost. Back it up safely!"
    echo ""

    printf "${BOLD}Advanced: External PostgreSQL${NC}\n"
    echo ""
    echo "  To use an external PostgreSQL database instead of Docker:"
    echo ""
    echo "  1. Edit .env BEFORE running start.sh:"
    printf "     ${YELLOW}ENABLE_POSTGRES=false${NC}\n"
    printf "     ${YELLOW}DATABASE_URL=\"postgresql://user:pass@your-host:5432/assethost\"${NC}\n"
    printf "     ${YELLOW}SUPERTOKENS_DATABASE_URL=\"postgresql://user:pass@your-host:5432/supertokens\"${NC}\n"
    echo ""
    echo "  IMPORTANT:"
    echo "  - Always quote URLs if they contain special characters like &"
    echo "  - You need TWO databases: one for app data, one for SuperTokens auth"
    echo "  - Create both databases before starting (e.g., 'assethost' and 'supertokens')"
    echo ""
    echo "  2. Ensure your external database is accessible and both databases exist"
    echo ""
    echo "  This saves ~256MB RAM. See .env.example for cloud provider examples"
    echo "  (AWS RDS, Google Cloud SQL, Azure, DigitalOcean)."
    echo ""
}

# =============================================================================
# Help
# =============================================================================

print_help() {
    echo "Static Asset Hosting Platform - Setup Script"
    echo ""
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  --help              Show this help message"
    echo "  --non-interactive   Use environment variables instead of prompts"
    echo "  --force             Overwrite existing .env file without prompting"
    echo ""
    echo "Environment variables (for --non-interactive mode):"
    echo "  PRIMARY_DOMAIN      Your domain (default: localhost)"
    echo "  POSTGRES_PASSWORD   PostgreSQL password (auto-generated if not set)"
    echo "  MINIO_ROOT_USER     MinIO admin user (default: minioadmin)"
    echo "  MINIO_ROOT_PASSWORD MinIO admin password (auto-generated if not set)"
    echo "  CERTBOT_EMAIL       Email for SSL certificates (required for Let's Encrypt)"
    echo "  PROXY_MODE          SSL method: 'cloudflare' (default) or 'none' (Let's Encrypt)"
    echo "  SMTP_HOST           SMTP server hostname (optional)"
    echo "  SMTP_PORT           SMTP port (default: 587)"
    echo "  SMTP_USER           SMTP username (optional)"
    echo "  SMTP_PASSWORD       SMTP password (optional)"
    echo "  SMTP_FROM_ADDRESS   From email address (optional)"
    echo ""
    echo "External services (advanced - edit .env after setup):"
    echo "  ENABLE_POSTGRES     Set to 'false' to use external PostgreSQL"
    echo "  DATABASE_URL        External PostgreSQL connection string"
    echo "  ENABLE_MINIO        Set to 'false' to skip MinIO container"
    echo "  ENABLE_REDIS        Set to 'false' to skip Redis container"
    echo ""
    echo "Examples:"
    echo "  # Interactive setup"
    echo "  ./setup.sh"
    echo ""
    echo "  # Non-interactive with all defaults (localhost)"
    echo "  ./setup.sh --non-interactive"
    echo ""
    echo "  # Non-interactive with custom domain"
    echo "  PRIMARY_DOMAIN=example.com CERTBOT_EMAIL=admin@example.com ./setup.sh --non-interactive"
    echo ""
    echo "  # Force overwrite existing .env"
    echo "  ./setup.sh --force"
    echo ""
    echo "  # After setup, use external PostgreSQL (edit .env then run start.sh):"
    echo "  # ENABLE_POSTGRES=false"
    echo "  # DATABASE_URL=\"postgresql://user:pass@db.example.com:5432/mydb\""
    echo ""
}

# =============================================================================
# Cleanup Previous Installation
# =============================================================================

cleanup_previous_install() {
    print_step "Cleaning up previous installation"

    # Clean up old nginx config files
    NGINX_SITES_DIR="./docker/nginx/sites-enabled"
    if [ -d "$NGINX_SITES_DIR" ]; then
        # Count existing config files (excluding .gitkeep and .gitignore)
        CONFIG_COUNT=$(find "$NGINX_SITES_DIR" -name "*.conf" 2>/dev/null | wc -l | tr -d ' ')

        if [ "$CONFIG_COUNT" -gt 0 ]; then
            print_info "Found $CONFIG_COUNT old nginx config files"

            # Remove domain-*.conf, redirect-*.conf, and primary-content.conf
            rm -f "$NGINX_SITES_DIR"/domain-*.conf 2>/dev/null || true
            rm -f "$NGINX_SITES_DIR"/redirect-*.conf 2>/dev/null || true
            rm -f "$NGINX_SITES_DIR"/primary-content.conf 2>/dev/null || true

            print_success "Removed old nginx config files"
        else
            print_success "No old nginx config files to clean up"
        fi
    else
        print_info "Creating nginx sites-enabled directory"
        mkdir -p "$NGINX_SITES_DIR"
    fi

    echo ""
    print_success "Cleanup complete"
}

# =============================================================================
# Main
# =============================================================================

main() {
    # Parse arguments
    while [ "$#" -gt 0 ]; do
        case "$1" in
            --help|-h)
                print_help
                exit 0
                ;;
            --non-interactive)
                INTERACTIVE=false
                ;;
            --force)
                FORCE_OVERWRITE=true
                ;;
            *)
                print_error "Unknown option: $1"
                echo "Use --help for usage information"
                exit 1
                ;;
        esac
        shift
    done

    # Print header
    print_header

    # Run setup steps
    check_prerequisites
    check_existing_env
    cleanup_previous_install
    prompt_configuration
    generate_secrets
    create_env_file
    verify_configuration
    generate_ssl_certificates
    print_next_steps
}

# Run main function
main "$@"