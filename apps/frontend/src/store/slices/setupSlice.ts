import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { StorageProvider, EmailProvider } from '@/services/setupApi';

interface SetupWizardState {
  // Current step (1-5)
  currentStep: number;

  // Step 1: Admin account
  adminEmail: string;
  adminPassword: string;

  // Step 2: Storage
  storageProvider: StorageProvider | null;
  storageConfig: Record<string, unknown>;
  connectionTested: boolean;
  connectionSuccess: boolean;

  // Step 3: Cache
  cacheConfigured: boolean;
  cacheSkipped: boolean;

  // Step 4: Email (multi-provider support)
  emailProvider: EmailProvider | null;
  emailConfig: Record<string, unknown>;
  emailConfigured: boolean;
  emailSkipped: boolean;

  // Legacy SMTP fields (kept for backwards compatibility)
  smtpConfigured: boolean;
  smtpSkipped: boolean;

  // General
  isSubmitting: boolean;
  error: string | null;
}

interface OnboardingState {
  // Post-login onboarding
  hasCompletedOnboarding: boolean;
  onboardingStep: number;
  createdProjectId: string | null;
  createdApiKey: string | null;
}

interface SetupState {
  // From API
  isSetupComplete: boolean;
  hasAdminUser: boolean;
  configuredStorageProvider: string | null;

  // Wizard state
  wizard: SetupWizardState;

  // Post-login onboarding
  onboarding: OnboardingState;
}

// Helper to safely get localStorage (handles SSR)
const getStoredOnboardingStatus = (): boolean => {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem('hasCompletedOnboarding') === 'true';
};

const initialState: SetupState = {
  isSetupComplete: false,
  hasAdminUser: false,
  configuredStorageProvider: null,

  wizard: {
    currentStep: 1,
    adminEmail: '',
    adminPassword: '',
    storageProvider: 'minio', // Default to MinIO
    storageConfig: {},
    connectionTested: false,
    connectionSuccess: false,
    // Cache
    cacheConfigured: false,
    cacheSkipped: false,
    // Email provider (new)
    emailProvider: null,
    emailConfig: {},
    emailConfigured: false,
    emailSkipped: false,
    // Legacy SMTP
    smtpConfigured: false,
    smtpSkipped: false,
    isSubmitting: false,
    error: null,
  },

  onboarding: {
    hasCompletedOnboarding: getStoredOnboardingStatus(),
    onboardingStep: 1,
    createdProjectId: null,
    createdApiKey: null,
  },
};

const setupSlice = createSlice({
  name: 'setup',
  initialState,
  reducers: {
    // Wizard navigation
    setWizardStep: (state, action: PayloadAction<number>) => {
      state.wizard.currentStep = action.payload;
    },

    nextWizardStep: (state) => {
      if (state.wizard.currentStep < 5) {
        state.wizard.currentStep += 1;
      }
    },

    prevWizardStep: (state) => {
      if (state.wizard.currentStep > 1) {
        state.wizard.currentStep -= 1;
      }
    },

    // Admin credentials
    setAdminCredentials: (
      state,
      action: PayloadAction<{ email: string; password: string }>
    ) => {
      state.wizard.adminEmail = action.payload.email;
      state.wizard.adminPassword = action.payload.password;
    },

    // Storage configuration
    setStorageProvider: (state, action: PayloadAction<StorageProvider>) => {
      state.wizard.storageProvider = action.payload;
      state.wizard.storageConfig = {};
      state.wizard.connectionTested = false;
      state.wizard.connectionSuccess = false;
    },

    setStorageConfig: (state, action: PayloadAction<Record<string, unknown>>) => {
      state.wizard.storageConfig = action.payload;
      state.wizard.connectionTested = false;
      state.wizard.connectionSuccess = false;
    },

    setConnectionResult: (
      state,
      action: PayloadAction<{ tested: boolean; success: boolean }>
    ) => {
      state.wizard.connectionTested = action.payload.tested;
      state.wizard.connectionSuccess = action.payload.success;
    },

    // Cache configuration
    setCacheConfigured: (state, action: PayloadAction<boolean>) => {
      state.wizard.cacheConfigured = action.payload;
    },

    setCacheSkipped: (state, action: PayloadAction<boolean>) => {
      state.wizard.cacheSkipped = action.payload;
    },

    // Email Provider (new multi-provider support)
    setEmailProvider: (state, action: PayloadAction<EmailProvider>) => {
      state.wizard.emailProvider = action.payload;
      state.wizard.emailConfig = {};
    },

    setEmailConfig: (state, action: PayloadAction<Record<string, unknown>>) => {
      state.wizard.emailConfig = action.payload;
    },

    setEmailConfigured: (state, action: PayloadAction<boolean>) => {
      state.wizard.emailConfigured = action.payload;
      // Also set legacy field for backwards compatibility
      state.wizard.smtpConfigured = action.payload;
    },

    setEmailSkipped: (state, action: PayloadAction<boolean>) => {
      state.wizard.emailSkipped = action.payload;
      // Also set legacy field for backwards compatibility
      state.wizard.smtpSkipped = action.payload;
    },

    // Legacy SMTP (kept for backwards compatibility)
    setSmtpConfigured: (state, action: PayloadAction<boolean>) => {
      state.wizard.smtpConfigured = action.payload;
      state.wizard.emailConfigured = action.payload;
    },

    setSmtpSkipped: (state, action: PayloadAction<boolean>) => {
      state.wizard.smtpSkipped = action.payload;
      state.wizard.emailSkipped = action.payload;
    },

    // Error handling
    setWizardError: (state, action: PayloadAction<string | null>) => {
      state.wizard.error = action.payload;
    },

    setIsSubmitting: (state, action: PayloadAction<boolean>) => {
      state.wizard.isSubmitting = action.payload;
    },

    // Setup status (from API)
    setSetupStatus: (
      state,
      action: PayloadAction<{
        isSetupComplete: boolean;
        hasAdminUser: boolean;
        storageProvider: string | null;
      }>
    ) => {
      state.isSetupComplete = action.payload.isSetupComplete;
      state.hasAdminUser = action.payload.hasAdminUser;
      state.configuredStorageProvider = action.payload.storageProvider;
    },

    // Onboarding
    setOnboardingStep: (state, action: PayloadAction<number>) => {
      state.onboarding.onboardingStep = action.payload;
    },

    setCreatedProject: (state, action: PayloadAction<string>) => {
      state.onboarding.createdProjectId = action.payload;
    },

    setCreatedApiKey: (state, action: PayloadAction<string>) => {
      state.onboarding.createdApiKey = action.payload;
    },

    completeOnboarding: (state) => {
      state.onboarding.hasCompletedOnboarding = true;
      if (typeof window !== 'undefined') {
        localStorage.setItem('hasCompletedOnboarding', 'true');
      }
    },

    resetOnboarding: (state) => {
      state.onboarding.hasCompletedOnboarding = false;
      state.onboarding.onboardingStep = 1;
      state.onboarding.createdProjectId = null;
      state.onboarding.createdApiKey = null;
      if (typeof window !== 'undefined') {
        localStorage.removeItem('hasCompletedOnboarding');
      }
    },

    // Reset wizard state
    resetWizard: (state) => {
      state.wizard = initialState.wizard;
    },
  },
});

export const {
  setWizardStep,
  nextWizardStep,
  prevWizardStep,
  setAdminCredentials,
  setStorageProvider,
  setStorageConfig,
  setConnectionResult,
  // Cache configuration actions
  setCacheConfigured,
  setCacheSkipped,
  // Email provider actions (new)
  setEmailProvider,
  setEmailConfig,
  setEmailConfigured,
  setEmailSkipped,
  // Legacy SMTP actions (kept for backwards compatibility)
  setSmtpConfigured,
  setSmtpSkipped,
  setWizardError,
  setIsSubmitting,
  setSetupStatus,
  setOnboardingStep,
  setCreatedProject,
  setCreatedApiKey,
  completeOnboarding,
  resetOnboarding,
  resetWizard,
} = setupSlice.actions;

export default setupSlice.reducer;