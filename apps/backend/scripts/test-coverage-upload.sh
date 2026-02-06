#!/bin/bash

# Test script for uploading coverage reports via zip
# This script zips the apps/backend/coverage directory and uploads it
#
# Usage:
#   TEST_API_KEY=your_key ./test-coverage-upload.sh [public|private]
#
#   Examples:
#     ./test-coverage-upload.sh              # defaults to private
#     ./test-coverage-upload.sh public       # creates public deployment
#     ./test-coverage-upload.sh private      # creates private deployment
#
# Environment variables:
#   TEST_API_KEY     - Required: Your API key
#   BACKEND_URL      - Optional: Backend URL (default: http://localhost:3000)
#   TEST_REPOSITORY  - Optional: Repository name (default: test-org/test-repo)
#

set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Determine visibility from first argument (defaults to private)
VISIBILITY="${1:-private}"
if [ "$VISIBILITY" != "public" ] && [ "$VISIBILITY" != "private" ]; then
  echo -e "${RED}ERROR: Invalid argument. Use 'public' or 'private'${NC}"
  echo "Usage: $0 [public|private]"
  exit 1
fi

# Set isPublic flag based on visibility
if [ "$VISIBILITY" = "public" ]; then
  IS_PUBLIC="true"
  VISIBILITY_EMOJI="🌐"
  VISIBILITY_TEXT="PUBLIC"
  VISIBILITY_COLOR="${GREEN}"
else
  IS_PUBLIC="false"
  VISIBILITY_EMOJI="🔒"
  VISIBILITY_TEXT="PRIVATE"
  VISIBILITY_COLOR="${BLUE}"
fi

echo -e "${VISIBILITY_COLOR}=== Uploading Coverage Report as ${VISIBILITY_TEXT} Deployment ===${NC}\n"

# Configuration
BACKEND_URL="${BACKEND_URL:-http://localhost:3000}"
API_KEY="${TEST_API_KEY}"
REPOSITORY="${TEST_REPOSITORY:-test-org/test-repo}"
COMMIT_SHA=$(echo -n "coverage-$(date +%s)" | shasum | cut -d' ' -f1 | cut -c1-40)
BRANCH="main"

# Check if API key is provided
if [ -z "$API_KEY" ]; then
  echo -e "${RED}ERROR: TEST_API_KEY environment variable is required${NC}"
  echo ""
  echo "Usage:"
  echo "  TEST_API_KEY=your_key ./test-coverage-upload.sh [public|private]"
  echo ""
  echo "Examples:"
  echo "  TEST_API_KEY=wsa_... ./test-coverage-upload.sh              # creates private deployment (default)"
  echo "  TEST_API_KEY=wsa_... ./test-coverage-upload.sh public       # creates public deployment"
  echo "  TEST_API_KEY=wsa_... ./test-coverage-upload.sh private      # creates private deployment"
  exit 1
fi

# Get the script directory and project root
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$( cd "$SCRIPT_DIR/../../.." && pwd )"
COVERAGE_DIR="$PROJECT_ROOT/apps/backend/coverage"

# Check if coverage directory exists
if [ ! -d "$COVERAGE_DIR" ]; then
  echo -e "${RED}ERROR: Coverage directory not found: $COVERAGE_DIR${NC}"
  echo "Please run tests with coverage first to generate the coverage report."
  exit 1
fi

# Create temporary directory for zip file
TEMP_DIR=$(mktemp -d)
echo -e "${YELLOW}Created temp directory: $TEMP_DIR${NC}\n"

# Create the zip file with preserved directory structure
ZIP_FILE="$TEMP_DIR/coverage.zip"
echo -e "${YELLOW}Creating zip file with coverage data...${NC}"
echo "Coverage source: $COVERAGE_DIR"
echo ""

# Change to project root to preserve the apps/backend/coverage path structure
cd "$PROJECT_ROOT"

# Zip the coverage directory while maintaining the apps/backend/coverage structure
zip -q -r "$ZIP_FILE" apps/backend/coverage/

# Get file count and size
FILE_COUNT=$(unzip -l "$ZIP_FILE" | grep -c "apps/backend/coverage/" || echo "0")
FILE_SIZE=$(ls -lh "$ZIP_FILE" | awk '{print $5}')

echo -e "${GREEN}✓ Zip file created${NC}"
echo "  Size: $FILE_SIZE"
echo "  Files: $FILE_COUNT"
echo "  Path structure: apps/backend/coverage/ (preserved)"
echo ""

# Upload zip file
echo -e "${YELLOW}Uploading $VISIBILITY_TEXT coverage deployment via zip...${NC}"
echo "Repository: $REPOSITORY"
echo "Commit SHA: $COMMIT_SHA"
echo "Branch: $BRANCH"
echo "Visibility: $VISIBILITY_TEXT (isPublic=$IS_PUBLIC)"
echo ""

RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$BACKEND_URL/api/deployments/zip" \
  -H "X-API-Key: $API_KEY" \
  -F "file=@$ZIP_FILE" \
  -F "repository=$REPOSITORY" \
  -F "commitSha=$COMMIT_SHA" \
  -F "branch=$BRANCH" \
  -F "isPublic=$IS_PUBLIC" \
  -F "description=Coverage report - $VISIBILITY_TEXT deployment")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" = "201" ]; then
  echo -e "${GREEN}✓ Upload successful!${NC}\n"
  echo "Response:"
  echo "$BODY" | jq '.' 2>/dev/null || echo "$BODY"

  # Extract URLs from response
  SHA_URL=$(echo "$BODY" | jq -r '.urls.sha' 2>/dev/null || echo "")
  BRANCH_URL=$(echo "$BODY" | jq -r '.urls.branch' 2>/dev/null || echo "")

  if [ -n "$SHA_URL" ]; then
    echo ""
    echo -e "${VISIBILITY_COLOR}Deployment URLs ($VISIBILITY_TEXT):${NC}"
    echo "  SHA URL:    $SHA_URL"
    [ -n "$BRANCH_URL" ] && echo "  Branch URL: $BRANCH_URL"
    echo ""
    echo -e "${YELLOW}Access the coverage report:${NC}"

    if [ "$VISIBILITY" = "private" ]; then
      echo -e "  ${RED}Without auth (should return 404):${NC}"
      echo "    curl $SHA_URL/apps/backend/coverage/index.html"
      echo ""
      echo -e "  ${GREEN}With API key (should return content):${NC}"
      echo "    curl -H 'X-API-Key: \$API_KEY' $SHA_URL/apps/backend/coverage/index.html"
      echo ""
      echo -e "  ${GREEN}With session (from browser - login first):${NC}"
      echo "    Open in browser: $SHA_URL/apps/backend/coverage/index.html"
      echo ""
      echo -e "  ${BLUE}Other coverage files:${NC}"
      echo "    lcov.info:     $SHA_URL/apps/backend/coverage/lcov.info"
      echo "    clover.xml:    $SHA_URL/apps/backend/coverage/clover.xml"
      echo "    coverage.json: $SHA_URL/apps/backend/coverage/coverage-final.json"
    else
      echo -e "  ${GREEN}Direct access (no auth required):${NC}"
      echo "    curl $SHA_URL/apps/backend/coverage/index.html"
      echo ""
      echo -e "  ${GREEN}Or open in browser:${NC}"
      echo "    HTML Report: $SHA_URL/apps/backend/coverage/index.html"
      echo ""
      echo -e "  ${BLUE}Other coverage files:${NC}"
      echo "    lcov.info:     $SHA_URL/apps/backend/coverage/lcov.info"
      echo "    clover.xml:    $SHA_URL/apps/backend/coverage/clover.xml"
      echo "    coverage.json: $SHA_URL/apps/backend/coverage/coverage-final.json"
    fi
  fi
else
  echo -e "${RED}✗ Upload failed with status $HTTP_CODE${NC}\n"
  echo "Response:"
  echo "$BODY"
  CLEANUP=1
fi

# Cleanup
echo ""
echo -e "${YELLOW}Cleaning up temporary files...${NC}"
rm -rf "$TEMP_DIR"
echo -e "${GREEN}✓ Cleanup complete${NC}"

if [ "$HTTP_CODE" = "201" ]; then
  echo ""
  echo -e "${VISIBILITY_COLOR}=== $VISIBILITY_TEXT Coverage Report Deployment Completed Successfully ===${NC}"
  exit 0
else
  exit 1
fi

