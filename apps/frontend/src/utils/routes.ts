/**
 * URL route helper functions for the application.
 * Provides type-safe route generation for common navigation patterns.
 */

export const routes = {
  /** Repository base path */
  repository: (owner: string, name: string) => `/repo/${owner}/${name}`,

  /** Repository settings page */
  repositorySettings: (owner: string, name: string) => `/repo/${owner}/${name}/settings`,

  /** Deployments tab (default) */
  deployments: (owner: string, name: string) => `/repo/${owner}/${name}/deployments`,

  /** Branches tab */
  branches: (owner: string, name: string) => `/repo/${owner}/${name}/branches`,

  /** Aliases tab */
  aliases: (owner: string, name: string) => `/repo/${owner}/${name}/aliases`,

  /** Proxy rule sets list page */
  proxyRules: (owner: string, name: string) => `/repo/${owner}/${name}/proxy-rules`,

  /** Rule set detail page showing all rules */
  ruleSet: (owner: string, name: string, ruleSetId: string) =>
    `/repo/${owner}/${name}/proxy-rules/${ruleSetId}`,

  /** New rule creation page */
  newRule: (owner: string, name: string, ruleSetId: string) =>
    `/repo/${owner}/${name}/proxy-rules/${ruleSetId}/new`,

  /** Edit rule page */
  editRule: (owner: string, name: string, ruleSetId: string, ruleId: string) =>
    `/repo/${owner}/${name}/proxy-rules/${ruleSetId}/${ruleId}`,
};
