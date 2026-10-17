/**
 * The business-entry group's viewing store: which rows the group shows, which
 * row the user last picked, and the status of the launch that pick started.
 * It is a declared store rather than component state because the shell
 * unmounts the whole browsing region's wide content when the sidebar settles
 * into its rail, so a local value would drop the disclosure, the highlight,
 * and the failure notice on every collapse. Module level exports the factory
 * only (a module-level handle would pin the store identity across plugin
 * reloads); register() receives the factory and the nav derives its
 * PropsStore share from the return type.
 */

/**
 * Create the business-entry viewing store handle.
 * @returns the store handle (spec + type + identity + factory in one).
 */
export function createBusinessEntryStore(defineStore) {
  return defineStore({
    init: () => ({
      expanded: true,
      selected: undefined,
      pending: undefined,
      error: undefined,
      /** The entry whose past runs are disclosed, if any. */
      historyFor: undefined,
    }),
    actions: {
      setExpanded: (d, expanded) => { d.expanded = expanded },
      select: (d, id) => { d.selected = id },
      /** Mark one entry as launching and clear the previous failure. */
      beginLaunch: (d, id) => { d.pending = id; d.error = undefined },
      /** The launch settled: the row is clickable again. */
      endLaunch: (d) => { d.pending = undefined },
      /** The launch failed: report the reason on the group, not on the row. */
      failLaunch: (d, message) => { d.pending = undefined; d.error = message },
      /** Dismiss the standing failure notice. */
      clearError: (d) => { d.error = undefined },
      /** Disclose one entry's past runs, or close whichever is open. */
      toggleHistory: (d, id) => { d.historyFor = d.historyFor === id ? undefined : id },
    },
  })
}
