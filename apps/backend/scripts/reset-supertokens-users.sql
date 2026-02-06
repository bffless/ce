-- Reset SuperTokens user data
-- This clears all SuperTokens authentication data while keeping your application's users table
-- 
-- Usage:
--   docker exec -i assethost-postgres psql -U postgres -d assethost < scripts/reset-supertokens-users.sql
--   OR
--   psql postgresql://postgres:devpassword@localhost:5432/assethost -f scripts/reset-supertokens-users.sql

-- Clear SuperTokens user-related tables
-- Using DO block to handle tables that may not exist
-- Note: Tables are prefixed with 'supertokens_' when POSTGRESQL_TABLE_NAMES_PREFIX is set
DO $$
BEGIN
  -- Core authentication tables (with prefix)
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'supertokens__emailpassword_users') THEN
    TRUNCATE TABLE supertokens__emailpassword_users CASCADE;
  ELSIF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'supertokens_emailpassword_users') THEN
    TRUNCATE TABLE supertokens_emailpassword_users CASCADE;
  ELSIF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'emailpassword_users') THEN
    -- Fallback for tables without prefix (old setup)
    TRUNCATE TABLE emailpassword_users CASCADE;
  END IF;
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'supertokens__emailpassword_user_to_tenant') THEN
    TRUNCATE TABLE supertokens__emailpassword_user_to_tenant CASCADE;
  ELSIF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'supertokens_emailpassword_user_to_tenant') THEN
    TRUNCATE TABLE supertokens_emailpassword_user_to_tenant CASCADE;
  ELSIF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'emailpassword_user_to_tenant') THEN
    TRUNCATE TABLE emailpassword_user_to_tenant CASCADE;
  END IF;
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'supertokens__all_auth_recipe_users') THEN
    TRUNCATE TABLE supertokens__all_auth_recipe_users CASCADE;
  ELSIF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'supertokens_all_auth_recipe_users') THEN
    TRUNCATE TABLE supertokens_all_auth_recipe_users CASCADE;
  ELSIF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'all_auth_recipe_users') THEN
    TRUNCATE TABLE all_auth_recipe_users CASCADE;
  END IF;
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'supertokens__session_info') THEN
    TRUNCATE TABLE supertokens__session_info CASCADE;
  ELSIF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'supertokens_session_info') THEN
    TRUNCATE TABLE supertokens_session_info CASCADE;
  ELSIF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'session_info') THEN
    TRUNCATE TABLE session_info CASCADE;
  END IF;
  
  -- Email verification (with prefix)
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'supertokens__emailverification_verified_emails') THEN
    TRUNCATE TABLE supertokens__emailverification_verified_emails CASCADE;
  ELSIF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'supertokens_emailverification_verified_emails') THEN
    TRUNCATE TABLE supertokens_emailverification_verified_emails CASCADE;
  ELSIF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'emailverification_verified_emails') THEN
    TRUNCATE TABLE emailverification_verified_emails CASCADE;
  END IF;
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'supertokens__emailverification_tokens') THEN
    TRUNCATE TABLE supertokens__emailverification_tokens CASCADE;
  ELSIF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'supertokens_emailverification_tokens') THEN
    TRUNCATE TABLE supertokens_emailverification_tokens CASCADE;
  ELSIF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'emailverification_tokens') THEN
    TRUNCATE TABLE emailverification_tokens CASCADE;
  END IF;
  
  -- Passwordless (with prefix)
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'supertokens__passwordless_users') THEN
    TRUNCATE TABLE supertokens__passwordless_users CASCADE;
  ELSIF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'supertokens_passwordless_users') THEN
    TRUNCATE TABLE supertokens_passwordless_users CASCADE;
  ELSIF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'passwordless_users') THEN
    TRUNCATE TABLE passwordless_users CASCADE;
  END IF;
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'supertokens__passwordless_devices') THEN
    TRUNCATE TABLE supertokens__passwordless_devices CASCADE;
  ELSIF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'supertokens_passwordless_devices') THEN
    TRUNCATE TABLE supertokens_passwordless_devices CASCADE;
  ELSIF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'passwordless_devices') THEN
    TRUNCATE TABLE passwordless_devices CASCADE;
  END IF;
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'supertokens__passwordless_codes') THEN
    TRUNCATE TABLE supertokens__passwordless_codes CASCADE;
  ELSIF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'supertokens_passwordless_codes') THEN
    TRUNCATE TABLE supertokens_passwordless_codes CASCADE;
  ELSIF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'passwordless_codes') THEN
    TRUNCATE TABLE passwordless_codes CASCADE;
  END IF;
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'supertokens__passwordless_user_to_tenant') THEN
    TRUNCATE TABLE supertokens__passwordless_user_to_tenant CASCADE;
  ELSIF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'supertokens_passwordless_user_to_tenant') THEN
    TRUNCATE TABLE supertokens_passwordless_user_to_tenant CASCADE;
  ELSIF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'passwordless_user_to_tenant') THEN
    TRUNCATE TABLE passwordless_user_to_tenant CASCADE;
  END IF;
  
  -- OAuth/Third party (with prefix)
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'supertokens__thirdparty_users') THEN
    TRUNCATE TABLE supertokens__thirdparty_users CASCADE;
  ELSIF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'supertokens_thirdparty_users') THEN
    TRUNCATE TABLE supertokens_thirdparty_users CASCADE;
  ELSIF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'thirdparty_users') THEN
    TRUNCATE TABLE thirdparty_users CASCADE;
  END IF;
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'supertokens__thirdparty_user_to_tenant') THEN
    TRUNCATE TABLE supertokens__thirdparty_user_to_tenant CASCADE;
  ELSIF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'supertokens_thirdparty_user_to_tenant') THEN
    TRUNCATE TABLE supertokens_thirdparty_user_to_tenant CASCADE;
  ELSIF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'thirdparty_user_to_tenant') THEN
    TRUNCATE TABLE thirdparty_user_to_tenant CASCADE;
  END IF;
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'supertokens__oauth_sessions') THEN
    TRUNCATE TABLE supertokens__oauth_sessions CASCADE;
  ELSIF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'supertokens_oauth_sessions') THEN
    TRUNCATE TABLE supertokens_oauth_sessions CASCADE;
  ELSIF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'oauth_sessions') THEN
    TRUNCATE TABLE oauth_sessions CASCADE;
  END IF;
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'supertokens__oauth_m2m_tokens') THEN
    TRUNCATE TABLE supertokens__oauth_m2m_tokens CASCADE;
  ELSIF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'supertokens_oauth_m2m_tokens') THEN
    TRUNCATE TABLE supertokens_oauth_m2m_tokens CASCADE;
  ELSIF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'oauth_m2m_tokens') THEN
    TRUNCATE TABLE oauth_m2m_tokens CASCADE;
  END IF;
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'supertokens__oauth_logout_challenges') THEN
    TRUNCATE TABLE supertokens__oauth_logout_challenges CASCADE;
  ELSIF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'supertokens_oauth_logout_challenges') THEN
    TRUNCATE TABLE supertokens_oauth_logout_challenges CASCADE;
  ELSIF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'oauth_logout_challenges') THEN
    TRUNCATE TABLE oauth_logout_challenges CASCADE;
  END IF;
  
  -- TOTP (with prefix)
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'supertokens__totp_users') THEN
    TRUNCATE TABLE supertokens__totp_users CASCADE;
  ELSIF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'supertokens_totp_users') THEN
    TRUNCATE TABLE supertokens_totp_users CASCADE;
  ELSIF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'totp_users') THEN
    TRUNCATE TABLE totp_users CASCADE;
  END IF;
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'supertokens__totp_user_devices') THEN
    TRUNCATE TABLE supertokens__totp_user_devices CASCADE;
  ELSIF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'supertokens_totp_user_devices') THEN
    TRUNCATE TABLE supertokens_totp_user_devices CASCADE;
  ELSIF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'totp_user_devices') THEN
    TRUNCATE TABLE totp_user_devices CASCADE;
  END IF;
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'supertokens__totp_used_codes') THEN
    TRUNCATE TABLE supertokens__totp_used_codes CASCADE;
  ELSIF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'supertokens_totp_used_codes') THEN
    TRUNCATE TABLE supertokens_totp_used_codes CASCADE;
  ELSIF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'totp_used_codes') THEN
    TRUNCATE TABLE totp_used_codes CASCADE;
  END IF;
  
  -- Optional tables (may not exist, with prefix)
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'supertokens__user_roles') THEN
    TRUNCATE TABLE supertokens__user_roles CASCADE;
  ELSIF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'supertokens_userroles') THEN
    TRUNCATE TABLE supertokens_userroles CASCADE;
  ELSIF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'userroles') THEN
    TRUNCATE TABLE userroles CASCADE;
  END IF;
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'supertokens__user_metadata') THEN
    TRUNCATE TABLE supertokens__user_metadata CASCADE;
  ELSIF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'supertokens_usermetadata') THEN
    TRUNCATE TABLE supertokens_usermetadata CASCADE;
  ELSIF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'usermetadata') THEN
    TRUNCATE TABLE usermetadata CASCADE;
  END IF;
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'supertokens__dashboard_user_sessions') THEN
    TRUNCATE TABLE supertokens__dashboard_user_sessions CASCADE;
  ELSIF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'supertokens_dashboard_user_sessions') THEN
    TRUNCATE TABLE supertokens_dashboard_user_sessions CASCADE;
  ELSIF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'dashboard_user_sessions') THEN
    TRUNCATE TABLE dashboard_user_sessions CASCADE;
  END IF;

  -- User ID mapping (IMPORTANT: Clear this to allow fresh userid_mapping creation)
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'supertokens__userid_mapping') THEN
    TRUNCATE TABLE supertokens__userid_mapping CASCADE;
  ELSIF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'supertokens_userid_mapping') THEN
    TRUNCATE TABLE supertokens_userid_mapping CASCADE;
  ELSIF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'userid_mapping') THEN
    TRUNCATE TABLE userid_mapping CASCADE;
  END IF;
END $$;

-- Note: We keep these SuperTokens tables as they're configuration:
-- - apps (app configuration)
-- - app_id_to_user_id (mappings)
-- - jwt_signing_keys (JWT keys)
-- - session_access_token_signing_keys (session keys)
-- - key_value (internal config)

-- Also note: Your application's users table is NOT affected
-- You may want to clear it separately if needed:
-- TRUNCATE TABLE users CASCADE;

SELECT 'SuperTokens user data cleared successfully!' as message;

