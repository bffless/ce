#!/bin/bash
# Quick setup script with LOCAL storage
# Usage: ./scripts/setup-local.sh

set -e  # Exit on error

API_URL="http://localhost:3000"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@example.com}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-SecurePassword123!}"
LOCAL_PATH="${LOCAL_PATH:-./uploads}"

echo "🚀 Setting up Asset Host with LOCAL storage..."
echo "   API: $API_URL"
echo "   Admin Email: $ADMIN_EMAIL"
echo ""

# 1. Check if setup is already complete
echo "📋 Checking setup status..."
STATUS=$(curl -s "$API_URL/api/setup/status")
IS_COMPLETE=$(echo $STATUS | jq -r '.isSetupComplete')

if [ "$IS_COMPLETE" = "true" ]; then
  echo "❌ Setup already complete! Run 'pnpm db:reset-setup' first to reset."
  exit 1
fi

# 2. Initialize system (create admin user)
echo "👤 Creating admin user..."
INIT_RESPONSE=$(curl -s -X POST "$API_URL/api/setup/initialize" \
  -H "Content-Type: application/json" \
  -d "{
    \"email\": \"$ADMIN_EMAIL\",
    \"password\": \"$ADMIN_PASSWORD\"
  }")

USER_ID=$(echo $INIT_RESPONSE | jq -r '.userId // empty')
if [ -z "$USER_ID" ]; then
  echo "❌ Failed to create admin user:"
  echo $INIT_RESPONSE | jq '.'
  exit 1
fi

echo "✅ Admin user created: $ADMIN_EMAIL (ID: $USER_ID)"

# 3. Configure local storage
echo ""
echo "💾 Configuring LOCAL storage..."
STORAGE_RESPONSE=$(curl -s -X POST "$API_URL/api/setup/storage" \
  -H "Content-Type: application/json" \
  -d "{
    \"storageProvider\": \"local\",
    \"config\": {
      \"localPath\": \"$LOCAL_PATH\"
    }
  }")

STORAGE_PROVIDER=$(echo $STORAGE_RESPONSE | jq -r '.storageProvider // empty')
if [ -z "$STORAGE_PROVIDER" ]; then
  echo "❌ Failed to configure storage:"
  echo $STORAGE_RESPONSE | jq '.'
  exit 1
fi

echo "✅ Storage configured: $STORAGE_PROVIDER (path: $LOCAL_PATH)"

# 4. Test storage connection
echo ""
echo "🧪 Testing storage connection..."
TEST_RESPONSE=$(curl -s -X POST "$API_URL/api/setup/test-storage")
TEST_SUCCESS=$(echo $TEST_RESPONSE | jq -r '.success')

if [ "$TEST_SUCCESS" = "true" ]; then
  echo "✅ Storage test passed"
else
  echo "⚠️  Storage test result:"
  echo $TEST_RESPONSE | jq '.'
fi

# 5. Complete setup
echo ""
echo "🏁 Completing setup..."
COMPLETE_RESPONSE=$(curl -s -X POST "$API_URL/api/setup/complete" \
  -H "Content-Type: application/json" \
  -d '{"confirm": true}')

IS_COMPLETE=$(echo $COMPLETE_RESPONSE | jq -r '.isSetupComplete // empty')
if [ "$IS_COMPLETE" != "true" ]; then
  echo "❌ Failed to complete setup:"
  echo $COMPLETE_RESPONSE | jq '.'
  exit 1
fi

echo "✅ Setup completed successfully!"

# 6. Show final status
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✨ Asset Host Setup Complete!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📊 Final Status:"
curl -s "$API_URL/api/setup/status" | jq '.'
echo ""
echo "🔐 Admin Credentials:"
echo "   Email:    $ADMIN_EMAIL"
echo "   Password: $ADMIN_PASSWORD"
echo ""
echo "💾 Storage:"
echo "   Type: LOCAL"
echo "   Path: $LOCAL_PATH"
echo ""
echo "🌐 API Documentation:"
echo "   http://localhost:3000/api/docs"
echo ""

