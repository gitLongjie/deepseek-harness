/** Shared provider display order for the composer and command model pickers. */

/**
 * Put the gateway route first, then the account and official providers,
 * preserving every other relative order.
 * @param groups - Provider groups in catalog order.
 * @returns a sorted copy; model order within each group is unchanged.
 */
export function orderModelProviders<T extends { readonly id: string }>(groups: readonly T[]): T[] {
  return groups.toSorted((left, right) =>
    (left.id === 'deepagens' ? 0 : left.id === 'deepseek-account' ? 1 : left.id === 'deepseek-official' ? 2 : 3)
      - (right.id === 'deepagens' ? 0 : right.id === 'deepseek-account' ? 1 : right.id === 'deepseek-official' ? 2 : 3))
}
