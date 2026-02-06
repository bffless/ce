#!/bin/bash

# Test script for zip upload feature
# This script creates a test zip file and uploads it to test the deployment zip endpoint
#
# Usage:
#   TEST_API_KEY=your_key ./test-zip-upload.sh [public|private]
#
#   Examples:
#     ./test-zip-upload.sh              # defaults to private
#     ./test-zip-upload.sh public       # creates public deployment
#     ./test-zip-upload.sh private      # creates private deployment
#
# Environment variables:
#   TEST_API_KEY     - Required: Your API key
#   BACKEND_URL      - Optional: Backend URL (default: http://localhost:3000)
#   TEST_REPOSITORY  - Optional: Repository name (default: test-org/test-repo)

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

echo -e "${VISIBILITY_COLOR}=== Testing ${VISIBILITY_TEXT} Zip Upload Feature ===${NC}\n"

# Configuration
BACKEND_URL="${BACKEND_URL:-http://localhost:3000}"
API_KEY="${TEST_API_KEY}"
REPOSITORY="${TEST_REPOSITORY:-test-org/test-repo}"
COMMIT_SHA=$(echo -n "test-$(date +%s)" | shasum | cut -d' ' -f1 | cut -c1-40)
BRANCH="main"

# Check if API key is provided
if [ -z "$API_KEY" ]; then
  echo -e "${RED}ERROR: TEST_API_KEY environment variable is required${NC}"
  echo ""
  echo "Usage:"
  echo "  TEST_API_KEY=your_key ./test-zip-upload.sh [public|private]"
  echo ""
  echo "Examples:"
  echo "  TEST_API_KEY=wsa_... ./test-zip-upload.sh              # creates private deployment (default)"
  echo "  TEST_API_KEY=wsa_... ./test-zip-upload.sh public       # creates public deployment"
  echo "  TEST_API_KEY=wsa_... ./test-zip-upload.sh private      # creates private deployment"
  exit 1
fi

# Create temporary directory for test files
TEST_DIR=$(mktemp -d)
echo -e "${YELLOW}Created temp directory: $TEST_DIR${NC}\n"

# Create test files
echo -e "${YELLOW}Creating test website files...${NC}"

# Create index.html (dynamic based on visibility)
cat > "$TEST_DIR/index.html" << EOF
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Test Site - Zip Upload</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <div class="container">
    <h1>$VISIBILITY_EMOJI $VISIBILITY_TEXT Test Deployment from Zip</h1>
    <p>This site was deployed as a <strong>$VISIBILITY_TEXT</strong> deployment from a zip file!</p>
    $(if [ "$VISIBILITY" = "private" ]; then
      echo '<p style="color: #ff6b6b; font-weight: bold;">🔐 You are authenticated - this content requires auth to access!</p>'
    else
      echo '<p style="color: #4CAF50; font-weight: bold;">🌐 This content is publicly accessible (no auth required)</p>'
    fi)

    <div class="image-container">
      <img src="assets/logo.svg" alt="Zip Upload Success Logo" width="200" height="200">
    </div>

    <div class="info-box">
      <h2>What's Working:</h2>
      <ul>
        <li>✅ HTML rendered correctly</li>
        <li>✅ CSS styles applied</li>
        <li>✅ SVG image loaded</li>
        <li>✅ Directory structure preserved</li>
        <li>✅ JavaScript loaded (check console)</li>
        $(if [ "$VISIBILITY" = "private" ]; then
          echo '<li>✅ <strong>Private asset authentication working!</strong></li>'
        else
          echo '<li>✅ <strong>Public asset serving working!</strong></li>'
        fi)
      </ul>
    </div>

    <a href="about.html" class="button">Visit About Page</a>
  </div>

  <script src="js/app.js"></script>
</body>
</html>
EOF

# Create style.css
cat > "$TEST_DIR/style.css" << 'EOF'
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}

.container {
  background: white;
  border-radius: 20px;
  padding: 40px;
  max-width: 600px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
  text-align: center;
}

h1 {
  color: #333;
  margin-bottom: 20px;
  font-size: 2em;
}

p {
  color: #666;
  font-size: 1.1em;
  margin-bottom: 30px;
}

.image-container {
  margin: 30px 0;
  padding: 20px;
  background: #f8f9fa;
  border-radius: 10px;
  display: inline-block;
}

.info-box {
  background: #e8f5e9;
  border-left: 4px solid #4CAF50;
  padding: 20px;
  margin: 30px 0;
  text-align: left;
  border-radius: 5px;
}

.info-box h2 {
  color: #2e7d32;
  margin-bottom: 15px;
  font-size: 1.3em;
}

.info-box ul {
  list-style: none;
  padding-left: 0;
}

.info-box li {
  padding: 8px 0;
  color: #333;
  font-size: 1em;
}

.button {
  display: inline-block;
  background: #4CAF50;
  color: white;
  padding: 12px 30px;
  text-decoration: none;
  border-radius: 25px;
  font-weight: bold;
  margin-top: 20px;
  transition: background 0.3s;
}

.button:hover {
  background: #45a049;
}
EOF

# Create about.html (dynamic based on visibility)
cat > "$TEST_DIR/about.html" << EOF
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>About - Zip Upload Test</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <div class="container">
    <h1>$VISIBILITY_EMOJI About This $VISIBILITY_TEXT Deployment</h1>
    <p>This demonstrates the zip upload feature with <strong>$VISIBILITY_TEXT deployment</strong> support!</p>

    <div class="info-box">
      <h2>Features:</h2>
      <ul>
        <li>✅ Single zip file upload</li>
        <li>✅ Directory structure preserved</li>
        <li>✅ Multiple file types supported</li>
        <li>✅ Public URL generation</li>
        <li>✅ Alias system integration</li>
        $(if [ "$VISIBILITY" = "private" ]; then
          echo '<li>✅ <strong>Private deployment (isPublic=false)</strong></li>'
          echo '<li>✅ <strong>Requires session OR API key authentication</strong></li>'
          echo '<li>✅ <strong>Returns 404 when not authenticated</strong></li>'
        else
          echo '<li>✅ <strong>Public deployment (isPublic=true)</strong></li>'
          echo '<li>✅ <strong>No authentication required</strong></li>'
          echo '<li>✅ <strong>Accessible by anyone</strong></li>'
        fi)
      </ul>
    </div>

    <a href="index.html" class="button">Back to Home</a>
  </div>
</body>
</html>
EOF

# Create assets directory and SVG image
mkdir -p "$TEST_DIR/assets"
cat > "$TEST_DIR/assets/logo.svg" << 'EOF'
<svg width="200" height="200" xmlns="http://www.w3.org/2000/svg">
  <!-- Background circle -->
  <circle cx="100" cy="100" r="95" fill="#4CAF50" stroke="#2E7D32" stroke-width="3"/>

  <!-- Checkmark -->
  <path d="M 50 100 L 80 130 L 150 60"
        stroke="white"
        stroke-width="15"
        stroke-linecap="round"
        stroke-linejoin="round"
        fill="none"/>

  <!-- Text -->
  <text x="100" y="180"
        font-family="Arial, sans-serif"
        font-size="20"
        font-weight="bold"
        fill="white"
        text-anchor="middle">
    ZIP UPLOAD
  </text>
</svg>
EOF

# Create nested directory structure
mkdir -p "$TEST_DIR/js"
cat > "$TEST_DIR/js/app.js" << EOF
console.log('🚀 $VISIBILITY_TEXT test app loaded from zip deployment!');
console.log('✅ JavaScript is working correctly');
console.log('📦 All assets loaded successfully');
$(if [ "$VISIBILITY" = "private" ]; then
  echo "console.log('🔒 You are authenticated - private deployment access granted!');"
else
  echo "console.log('🌐 Public deployment - accessible to everyone!');"
fi)

// Add a simple animation
document.addEventListener('DOMContentLoaded', () => {
  const container = document.querySelector('.container');
  if (container) {
    container.style.opacity = '0';
    container.style.transform = 'translateY(20px)';

    setTimeout(() => {
      container.style.transition = 'opacity 0.5s, transform 0.5s';
      container.style.opacity = '1';
      container.style.transform = 'translateY(0)';
    }, 100);
  }
});
EOF

echo -e "${GREEN}✓ Test files created${NC}\n"

# Create zip file
ZIP_FILE="$TEST_DIR/deployment.zip"
echo -e "${YELLOW}Creating zip file...${NC}"
cd "$TEST_DIR"
zip -q -r deployment.zip index.html style.css about.html assets/ js/
cd - > /dev/null

echo -e "${GREEN}✓ Zip file created: $(ls -lh "$ZIP_FILE" | awk '{print $5}')${NC}\n"

# Upload zip file
echo -e "${YELLOW}Uploading $VISIBILITY_TEXT deployment via zip...${NC}"
echo "Repository: $REPOSITORY"
echo "Commit SHA: $COMMIT_SHA"
echo "Branch: $BRANCH"
echo "Visibility: $VISIBILITY_TEXT (isPublic=$IS_PUBLIC)"
echo "Base Path: / (auto-creates preview alias)"
echo ""

RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$BACKEND_URL/api/deployments/zip" \
  -H "X-API-Key: $API_KEY" \
  -F "file=@$ZIP_FILE" \
  -F "repository=$REPOSITORY" \
  -F "commitSha=$COMMIT_SHA" \
  -F "branch=$BRANCH" \
  -F "isPublic=$IS_PUBLIC" \
  -F "basePath=/" \
  -F "description=Test $VISIBILITY_TEXT deployment from zip upload")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" = "201" ]; then
  echo -e "${GREEN}✓ Upload successful!${NC}\n"
  echo "Response:"
  echo "$BODY" | jq '.' 2>/dev/null || echo "$BODY"

  # Extract URLs from response
  SHA_URL=$(echo "$BODY" | jq -r '.urls.sha' 2>/dev/null || echo "")
  BRANCH_URL=$(echo "$BODY" | jq -r '.urls.branch' 2>/dev/null || echo "")

  # Extract aliases - look for auto-generated preview alias
  ALIASES=$(echo "$BODY" | jq -r '.aliases[]' 2>/dev/null || echo "")
  PREVIEW_ALIAS=""
  for alias in $ALIASES; do
    # Preview aliases contain the short SHA
    SHORT_SHA=$(echo "$COMMIT_SHA" | cut -c1-6 | tr '[:upper:]' '[:lower:]')
    if [[ "$alias" == "${SHORT_SHA}"* ]]; then
      PREVIEW_ALIAS="$alias"
      break
    fi
  done

  if [ -n "$SHA_URL" ]; then
    echo ""
    echo -e "${VISIBILITY_COLOR}Deployment URLs ($VISIBILITY_TEXT):${NC}"
    echo "  SHA URL:    $SHA_URL"
    [ -n "$BRANCH_URL" ] && echo "  Branch URL: $BRANCH_URL"

    if [ -n "$PREVIEW_ALIAS" ]; then
      echo ""
      echo -e "${VISIBILITY_COLOR}Preview Alias (auto-generated):${NC}"
      echo "  Alias Name: $PREVIEW_ALIAS"
      echo ""
      echo -e "${YELLOW}Test preview alias (local without nginx):${NC}"
      echo "  curl $BACKEND_URL/public/subdomain-alias/$PREVIEW_ALIAS/index.html"
    fi

    echo ""
    echo -e "${YELLOW}Test the deployment:${NC}"

    if [ "$VISIBILITY" = "private" ]; then
      echo -e "  ${RED}Without auth (should return 404):${NC}"
      echo "    curl $SHA_URL"
      echo ""
      echo -e "  ${GREEN}With API key (should return content):${NC}"
      echo "    curl -H 'X-API-Key: \$API_KEY' $SHA_URL"
      echo ""
      echo -e "  ${GREEN}With session (from browser - login first):${NC}"
      echo "    Open in browser: $SHA_URL"
    else
      echo -e "  ${GREEN}Direct access (no auth required):${NC}"
      echo "    curl $SHA_URL"
      echo ""
      echo -e "  ${GREEN}Or open in browser:${NC}"
      echo "    $SHA_URL"
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
rm -rf "$TEST_DIR"
echo -e "${GREEN}✓ Cleanup complete${NC}"

if [ "$HTTP_CODE" = "201" ]; then
  echo ""
  echo -e "${VISIBILITY_COLOR}=== $VISIBILITY_TEXT Deployment Test Completed Successfully ===${NC}"
  exit 0
else
  exit 1
fi
