import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { StorageProvider, EmailProvider } from '@/services/setupApi';

// How the instance's TLS/edge traffic is served, chosen in DomainSslStep.
// - 'cloudflare': orange-clouded behind Cloudflare (Cloudflare terminates TLS)
// - 'proxy': another TLS-terminating reverse proxy in front (e.g. a load balancer)
// - 'none': this box terminates TLS directly (Let's Encrypt or pasted cert)
export type ServingMode = 'cloudflare' | 'proxy' | 'none';

// How bootstrap mode obtains its TLS certificate.
// - 'paste': user pastes an existing cert/key (UploadCertificatesRequest)
// - 'letsencrypt': backend issues one directly (issueCertificate/wildcard flow)
export type BootstrapSslMode = 'paste' | 'letsencrypt';

// The full set of step identifiers used anywhere by the setup wizard. Defined
// here (not in SetupWizard.tsx) so both the slice and the wizard component
// reference the SAME type: navigation is by step ID, not by numeric index —
// a numeric `currentStep` against a step list whose shape can change
// mid-session (bootstrap mode's `claim` step disappearing once
// `claimRequired` flips false after a live status refetch) silently
// relocated the user to the wrong step. See Critical-1, final review of the
// zero-SSH web-bootstrap feature.
export type StepId =
  | 'claim'
  | 'admin'
  | 'domain-ssl'
  | 'storage'
  | 'cache'
  | 'email'
  | 'apply'
  | 'complete';

interface SetupWizardState {
  // Wizard navigation. `currentStepId` is the source of truth for "where
  // the user is": it survives `stepOrder` (the currently active step list,
  // computed by SetupWizard from live status/URL data) changing shape mid-
  // session. `null` means "no explicit navigation has happened yet" — the
  // wizard falls back to `stepOrder[0]`, same as the very first render.
  //
  // `stepOrder` mirrors SetupWizard's currently active step list, kept in
  // sync via `setStepOrder`, so relative navigation (`nextWizardStep` /
  // `prevWizardStep`, dispatched blind by individual step components that
  // have no knowledge of the list themselves) can resolve "the next/
  // previous step" without every step component needing to know the list.
  currentStepId: StepId | null;
  stepOrder: StepId[];

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

  // Bootstrap mode: claim token (from ClaimStep, or the `?token=` Platform relay)
  claimToken: string | null;

  // Bootstrap mode: domain chosen in DomainSslStep (consumed by ApplyStep)
  bootstrapDomain: string | null;

  // Bootstrap mode: how traffic reaches this instance (DomainSslStep),
  // driving which of the four serving paths ApplyStep exercises.
  servingMode: ServingMode | null;
  // Bootstrap mode: how the TLS cert is obtained. Preset by setServingMode
  // (see its reducer) and adjustable afterward once servingMode is set.
  bootstrapSslMode: BootstrapSslMode | null;
  // Bootstrap mode: port 80 handling for direct (servingMode 'none') Let's
  // Encrypt HTTP-01 issuance.
  bootstrapPort80: 'closed' | 'redirect' | null;
  // Bootstrap mode: real client IP recovery header/ranges when behind a
  // reverse proxy (servingMode 'proxy').
  bootstrapRealIp: { header: string; ranges: string[] } | null;
  // Bootstrap mode: whether the DNS preflight check (dnsPreflight mutation)
  // has passed for the chosen domain.
  dnsPreflightPassed: boolean;
  // Bootstrap mode: whether the wildcard certificate flow (startWildcard/
  // completeWildcard) has finished issuing.
  wildcardIssued: boolean;

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
    currentStepId: null,
    // Normal-mode's list is fixed regardless of status/data (see
    // computeWizardSteps in SetupWizard.tsx), so it's the sensible default
    // before SetupWizard's own effect syncs the real active list.
    stepOrder: ['admin', 'storage', 'cache', 'email', 'complete'],
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
    // Bootstrap mode
    claimToken: null,
    bootstrapDomain: null,
    servingMode: null,
    bootstrapSslMode: null,
    bootstrapPort80: null,
    bootstrapRealIp: null,
    dnsPreflightPassed: false,
    wildcardIssued: false,
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
    // Wizard navigation — see StepId's doc comment above for why this is
    // id-based rather than a raw numeric index.

    // Sync point: called by SetupWizard whenever its computed active step
    // list changes shape. If the current step id is no longer present in
    // the new list, resets to "unset" (null) rather than leaving a dangling
    // id around — the render layer falls back to the new list's first step,
    // the same defensive fallback used for a never-navigated session.
    setStepOrder: (state, action: PayloadAction<StepId[]>) => {
      state.wizard.stepOrder = action.payload;
      if (
        state.wizard.currentStepId !== null &&
        !action.payload.includes(state.wizard.currentStepId)
      ) {
        state.wizard.currentStepId = null;
      }
    },

    setWizardStep: (state, action: PayloadAction<StepId>) => {
      state.wizard.currentStepId = action.payload;
    },

    nextWizardStep: (state) => {
      const order = state.wizard.stepOrder;
      const idx = state.wizard.currentStepId ? order.indexOf(state.wizard.currentStepId) : -1;
      // Unset (never navigated yet) or an id no longer present in the list
      // (defensive — setStepOrder already resets to null in that case) is
      // treated as "currently viewing position 0", matching the render
      // layer's own fallback (`stepOrder[0]`) — so advancing from there
      // moves to position 1, not back to position 0.
      const base = idx === -1 ? 0 : idx;
      const nextIdx = base + 1;
      // No upper clamp beyond the list's own length: the wizard's step
      // COUNT is mode-dependent (5 steps normally, up to 7 in bootstrap
      // mode). Nothing dispatches nextWizardStep from the final step of
      // either list, so this is safe.
      if (nextIdx < order.length) {
        state.wizard.currentStepId = order[nextIdx];
      }
    },

    prevWizardStep: (state) => {
      const order = state.wizard.stepOrder;
      const idx = state.wizard.currentStepId ? order.indexOf(state.wizard.currentStepId) : -1;
      const base = idx === -1 ? 0 : idx;
      if (base > 0) {
        state.wizard.currentStepId = order[base - 1];
      }
      // base === 0 (already at/before the first step, or unset): no-op,
      // matches the old "if currentStep > 1" guard.
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

    // Bootstrap mode: claim token (from ClaimStep input, or the `?token=` Platform relay)
    setClaimToken: (state, action: PayloadAction<string | null>) => {
      state.wizard.claimToken = action.payload;
    },

    // Bootstrap mode: domain chosen in DomainSslStep (consumed by ApplyStep)
    setBootstrapDomain: (state, action: PayloadAction<string | null>) => {
      state.wizard.bootstrapDomain = action.payload;
    },

    // Bootstrap mode: how traffic reaches this instance. Presets sslMode
    // ('paste' for cloudflare/proxy — both expect a cert the user already
    // has; null for 'none' — direct requires an explicit LE-vs-BYO choice)
    // and clears every downstream choice made under the previous mode, since
    // none of them are guaranteed valid once the serving path changes.
    setServingMode: (state, action: PayloadAction<ServingMode>) => {
      state.wizard.servingMode = action.payload;
      state.wizard.bootstrapSslMode =
        action.payload === 'none' ? null : 'paste';
      state.wizard.bootstrapPort80 = null;
      state.wizard.bootstrapRealIp = null;
      state.wizard.dnsPreflightPassed = false;
      state.wizard.wildcardIssued = false;
    },

    setBootstrapSslMode: (state, action: PayloadAction<BootstrapSslMode | null>) => {
      state.wizard.bootstrapSslMode = action.payload;
    },

    setBootstrapPort80: (state, action: PayloadAction<'closed' | 'redirect' | null>) => {
      state.wizard.bootstrapPort80 = action.payload;
    },

    setBootstrapRealIp: (
      state,
      action: PayloadAction<{ header: string; ranges: string[] } | null>
    ) => {
      state.wizard.bootstrapRealIp = action.payload;
    },

    setDnsPreflightPassed: (state, action: PayloadAction<boolean>) => {
      state.wizard.dnsPreflightPassed = action.payload;
    },

    setWildcardIssued: (state, action: PayloadAction<boolean>) => {
      state.wizard.wildcardIssued = action.payload;
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
  setStepOrder,
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
  // Bootstrap mode actions
  setClaimToken,
  setBootstrapDomain,
  setServingMode,
  setBootstrapSslMode,
  setBootstrapPort80,
  setBootstrapRealIp,
  setDnsPreflightPassed,
  setWildcardIssued,
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