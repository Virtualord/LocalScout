/**
 * Query keys.
 *
 * Centralised so an invalidation after a mutation cannot drift from the query
 * it belongs to. The alternative is string literals scattered across screens,
 * which is how a list quietly stops refreshing after an action.
 */
export const queryKeys = {
  health: ['health'] as const,
  metrics: ['metrics'] as const,
  runs: ['runs'] as const,
  run: (id: string) => ['runs', id] as const,
  leads: (filters: Record<string, unknown>) => ['leads', filters] as const,
  lead: (id: string) => ['leads', id] as const,
};
