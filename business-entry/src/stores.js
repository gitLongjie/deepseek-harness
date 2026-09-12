/**
 * The business-entry group's viewing store: which rows the group shows and
 * which row the user last picked. It is a declared store rather than component
 * state because the shell unmounts the whole browsing region's wide content
 * when the sidebar settles into its rail, so a local value would drop the
 * disclosure and the highlight on every collapse. Module level exports the
 * factory only (a module-level handle would pin the store identity across
 * plugin reloads); register() receives the factory and the nav derives its
 * PropsStore share from the return type.
 */

/**
 * Create the business-entry viewing store handle.
 * @returns the store handle (spec + type + identity + factory in one).
 */
export function createBusinessEntryStore(defineStore) {
  return defineStore({
    init: () => ({ expanded: true, selected: undefined }),
    actions: {
      setExpanded: (d, expanded) => { d.expanded = expanded },
      select: (d, id) => { d.selected = id },
    },
  })
}
