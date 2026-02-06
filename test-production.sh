#!/bin/bash

# Test Production Docker Compose Setup
# This script helps verify that the production environment is working correctly

set -e

echo "🧪 Testing Production Docker Compose Setup"
echo "=========================================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored output
print_success() {
    echo -e "${GREEN}✓${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

print_info() {
    echo -e "${YELLOW}ℹ${NC} $1"
}

# Check if .env file exists
if [ ! -f .env ]; then
    print_error ".env file not found!"
    echo "  Please create a .env file with required configuration."
    echo "  You can copy from .env.example if it exists."
    exit 1
fi
print_success ".env file found"

# Check if docker-compose is available
if ! command -v docker-compose &> /dev/null; then
    print_error "docker-compose not found!"
    echo "  Please install Docker Compose first."
    exit 1
fi
print_success "docker-compose available"

echo ""
print_info "Checking container status..."
echo ""

# Get container status
docker-compose ps

echo ""
print_info "Checking services health..."
echo ""

# Check PostgreSQL
if docker-compose exec -T postgres pg_isready -U postgres &> /dev/null; then
    print_success "PostgreSQL is healthy"
else
    print_error "PostgreSQL is not responding"
fi

# Check MinIO
if curl -sf http://localhost:9000/minio/health/live &> /dev/null; then
    print_success "MinIO is healthy"
else
    print_error "MinIO is not responding"
fi

# Check Backend API (via nginx)
echo ""
print_info "Testing Backend API (via nginx)..."
BACKEND_RESPONSE=$(curl -s http://localhost/api/health)
if echo "$BACKEND_RESPONSE" | grep -q "ok"; then
    print_success "Backend API is responding via nginx"
    echo "   Response: $BACKEND_RESPONSE"
else
    print_error "Backend API is not responding correctly via nginx"
    echo "   Response: $BACKEND_RESPONSE"
fi

# Check Frontend
echo ""
print_info "Testing Frontend..."
FRONTEND_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost)
if [ "$FRONTEND_RESPONSE" = "200" ]; then
    print_success "Frontend is serving correctly (HTTP $FRONTEND_RESPONSE)"
else
    print_error "Frontend returned HTTP $FRONTEND_RESPONSE"
fi

# Check Swagger Documentation (via nginx)
echo ""
print_info "Testing API Documentation (via nginx)..."
SWAGGER_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost/api/docs)
if [ "$SWAGGER_RESPONSE" = "200" ] || [ "$SWAGGER_RESPONSE" = "301" ] || [ "$SWAGGER_RESPONSE" = "302" ]; then
    print_success "API Documentation available (HTTP $SWAGGER_RESPONSE)"
else
    print_error "API Documentation returned HTTP $SWAGGER_RESPONSE"
fi

echo ""
echo "=========================================="
echo "📋 Access URLs:"
echo "   Frontend:        http://localhost"
echo "   Backend API:     http://localhost/api (via nginx)"
echo "   API Docs:        http://localhost/api/docs (via nginx)"
echo "   MinIO Console:   http://localhost:9001"
echo ""
print_info "Useful commands:"
echo "   View logs:       docker-compose logs -f"
echo "   View backend:    docker-compose logs -f backend"
echo "   Restart service: docker-compose restart backend"
echo "   Stop all:        docker-compose down"
echo "   Clean restart:   docker-compose down -v && docker-compose up -d"
echo ""

