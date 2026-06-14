import { createContext, useContext, ReactNode } from 'react';

/**
 * Provides the list of project secret NAMES (never values) to the pipeline
 * editor so ExpressionInput can suggest `secrets.<NAME>` without prop-drilling
 * through every handler config component.
 *
 * Defaults to an empty list when no provider is present, so ExpressionInput used
 * outside the pipeline editor simply offers no secret suggestions.
 */
const SecretsContext = createContext<string[]>([]);

export function SecretNamesProvider({
  secretNames,
  children,
}: {
  secretNames: string[];
  children: ReactNode;
}) {
  return <SecretsContext.Provider value={secretNames}>{children}</SecretsContext.Provider>;
}

export function useSecretNames(): string[] {
  return useContext(SecretsContext);
}
