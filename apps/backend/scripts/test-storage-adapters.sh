#!/bin/bash

# Test Storage Adapters Script
# This script helps manually test the storage adapters

set -e

BASE_URL="http://localhost:3000"

echo "========================================="
echo "Storage Adapters Test Script"
echo "========================================="
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if backend is running
echo "Checking if backend is running..."
if ! curl -s -f "${BASE_URL}/api/health" > /dev/null 2>&1; then
    echo -e "${RED}❌ Backend is not running!${NC}"
    echo "Please start the backend with: cd apps/backend && pnpm dev"
    exit 1
fi
echo -e "${GREEN}✅ Backend is running${NC}"
echo ""

# Function to test local storage
test_local_storage() {
    echo "========================================="
    echo "Testing Local Storage Adapter"
    echo "========================================="
    
    # Check setup status first
    echo "1. Checking setup status..."
    STATUS=$(curl -s "${BASE_URL}/api/setup/status")
    IS_COMPLETE=$(echo "$STATUS" | grep -o '"isSetupComplete":[^,]*' | cut -d':' -f2)
    CURRENT_STORAGE=$(echo "$STATUS" | grep -o '"storageProvider":"[^"]*"' | cut -d'"' -f4)
    
    if [ "$IS_COMPLETE" = "true" ]; then
        echo -e "${GREEN}✅ Testing existing local storage configuration${NC}"
    else
        echo "2. Configuring local storage..."
        RESPONSE=$(curl -s -X POST "${BASE_URL}/api/setup/storage" \
            -H "Content-Type: application/json" \
            -d '{
                "storageProvider": "local",
                "config": {
                    "localPath": "./test-uploads",
                    "baseUrl": "http://localhost:3000/files"
                }
            }')
        
        if echo "$RESPONSE" | grep -q "successfully"; then
            echo -e "${GREEN}✅ Local storage configured${NC}"
        else
            echo -e "${RED}❌ Failed to configure local storage${NC}"
            echo "Response: $RESPONSE"
            return 1
        fi
    fi
    
    echo ""
    echo "2. Testing storage connection..."
    RESPONSE=$(curl -s -X POST "${BASE_URL}/api/setup/test-storage")
    
    if echo "$RESPONSE" | grep -q '"success":true'; then
        echo -e "${GREEN}✅ Local storage connection test passed${NC}"
        echo "Response: $RESPONSE"
    else
        echo -e "${RED}❌ Local storage connection test failed${NC}"
        echo "Response: $RESPONSE"
        return 1
    fi
    
    echo ""
    echo -e "${GREEN}✅ Local Storage Adapter: ALL TESTS PASSED${NC}"
    echo ""
}

# Function to test MinIO storage
test_minio_storage() {
    echo "========================================="
    echo "Testing MinIO Storage Adapter"
    echo "========================================="
    
    # Check if MinIO is running
    echo "1. Checking if MinIO is running..."
    if ! curl -s -f "http://localhost:9000/minio/health/live" > /dev/null 2>&1; then
        echo -e "${YELLOW}⚠️  MinIO is not running${NC}"
        echo "To start MinIO: docker-compose -f docker-compose.dev.yml up -d minio"
        echo "Skipping MinIO tests..."
        return 0
    fi
    echo -e "${GREEN}✅ MinIO is running${NC}"
    
    # Check setup status first
    echo ""
    echo "2. Checking setup status..."
    STATUS=$(curl -s "${BASE_URL}/api/setup/status")
    IS_COMPLETE=$(echo "$STATUS" | grep -o '"isSetupComplete":[^,]*' | cut -d':' -f2)
    CURRENT_STORAGE=$(echo "$STATUS" | grep -o '"storageProvider":"[^"]*"' | cut -d'"' -f4)
    
    if [ "$IS_COMPLETE" = "true" ]; then
        echo -e "${GREEN}✅ Testing existing MinIO storage configuration${NC}"
    else
        echo "3. Configuring MinIO storage..."
        RESPONSE=$(curl -s -X POST "${BASE_URL}/api/setup/storage" \
            -H "Content-Type: application/json" \
            -d '{
                "storageProvider": "minio",
                "config": {
                    "endpoint": "localhost",
                    "port": 9000,
                    "useSSL": false,
                    "accessKey": "minioadmin",
                    "secretKey": "minioadmin",
                    "bucket": "test-assets"
                }
            }')
        
        if echo "$RESPONSE" | grep -q "successfully"; then
            echo -e "${GREEN}✅ MinIO storage configured${NC}"
        else
            echo -e "${RED}❌ Failed to configure MinIO storage${NC}"
            echo "Response: $RESPONSE"
            return 1
        fi
    fi
    
    echo ""
    echo "3. Testing storage connection..."
    RESPONSE=$(curl -s -X POST "${BASE_URL}/api/setup/test-storage")
    
    if echo "$RESPONSE" | grep -q '"success":true'; then
        echo -e "${GREEN}✅ MinIO storage connection test passed${NC}"
        echo "Response: $RESPONSE"
    else
        echo -e "${RED}❌ MinIO storage connection test failed${NC}"
        echo "Response: $RESPONSE"
        return 1
    fi
    
    echo ""
    echo -e "${GREEN}✅ MinIO Storage Adapter: ALL TESTS PASSED${NC}"
    echo ""
}

# Main test execution - Check current state first
echo "Checking current setup state..."
STATUS=$(curl -s "${BASE_URL}/api/setup/status")
IS_COMPLETE=$(echo "$STATUS" | grep -o '"isSetupComplete":[^,]*' | cut -d':' -f2)
CURRENT_STORAGE=$(echo "$STATUS" | grep -o '"storageProvider":"[^"]*"' | cut -d'"' -f4)

if [ "$IS_COMPLETE" = "true" ]; then
    echo -e "${GREEN}✅ Setup is complete${NC}"
    echo -e "Current storage provider: ${YELLOW}$CURRENT_STORAGE${NC}"
    echo ""
    echo "Options:"
    echo "1) Test current storage ($CURRENT_STORAGE)"
    echo "2) Switch to different storage (requires reset)"
    read -p "Enter choice [1-2]: " choice
    
    case $choice in
        1)
            # Test current storage
            if [ "$CURRENT_STORAGE" = "local" ]; then
                test_local_storage
            elif [ "$CURRENT_STORAGE" = "minio" ]; then
                test_minio_storage
            else
                echo -e "${RED}Unknown storage type: $CURRENT_STORAGE${NC}"
                exit 1
            fi
            ;;
        2)
            echo ""
            echo -e "${YELLOW}To switch storage providers:${NC}"
            echo "  1. Run: pnpm db:reset-setup"
            echo "  2. Run: pnpm setup:local  (or pnpm setup:minio)"
            echo "  3. Re-run this test script"
            exit 0
            ;;
        *)
            echo -e "${RED}Invalid choice${NC}"
            exit 1
            ;;
    esac
else
    echo -e "${YELLOW}⚠️  Setup not complete${NC}"
    echo ""
    echo "Which adapter would you like to configure and test?"
    echo "1) Local Storage"
    echo "2) MinIO Storage"
    read -p "Enter choice [1-2]: " choice
    
    case $choice in
        1)
            test_local_storage
            ;;
        2)
            test_minio_storage
            ;;
        *)
            echo -e "${RED}Invalid choice${NC}"
            exit 1
            ;;
    esac
fi

echo ""
echo "========================================="
echo -e "${GREEN}Storage Adapter Tests Complete!${NC}"
echo "========================================="
echo ""
echo "Next steps:"
echo "  - Check backend logs for detailed output"
echo "  - Verify files in ./test-uploads (for local storage)"
echo "  - Verify bucket in MinIO console at http://localhost:9001"
echo ""

