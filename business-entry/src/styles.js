/**
 * Inline CSS for the business-entry group. Scoped with a unique prefix to
 * avoid collisions with other plugins' styles.
 */
export const css = {
  root: 'be_root',
  header: 'be_header',
  headerIcon: 'be_headerIcon',
  headerLabel: 'be_headerLabel',
  chevron: 'be_chevron',
  chevronCollapsed: 'be_chevronCollapsed',
  items: 'be_items',
  item: 'be_item',
  itemActive: 'be_itemActive',
  dot: 'be_dot',
  rail: 'be_rail',
  railButton: 'be_railButton',
}

/** The stylesheet text injected once at factory execution. */
export const stylesheet = `
.${css.root}{box-sizing:border-box;padding-right:var(--dsh-sidebar-inline-padding);flex-direction:column;flex:none;display:flex}
.${css.header}{cursor:pointer;user-select:none;text-align:left;width:100%;height:36px;color:var(--dsw-alias-label-tertiary);background:0 0;border:none;border-radius:8px;align-items:center;gap:6px;padding:0 8px;display:flex}
.${css.header}:hover{background:var(--dsw-alias-interactive-bg-hover)}
.${css.headerIcon}{color:var(--dsw-alias-label-secondary);flex:none}
.${css.headerLabel}{white-space:nowrap;flex:1;min-width:0;font-size:14px;font-weight:500;line-height:22px;overflow:hidden}
.${css.chevron}{color:var(--dsw-alias-label-secondary);transition:transform .15s var(--ds-ease-in-out);flex:none}
.${css.chevronCollapsed}{transform:rotate(-90deg)}
.${css.items}{flex-direction:column;margin:0 0 4px;padding:0;list-style:none;display:flex}
.${css.item}{box-sizing:border-box;cursor:pointer;user-select:none;text-align:left;white-space:nowrap;text-overflow:ellipsis;width:100%;height:32px;color:var(--dsw-alias-label-primary);background:0 0;border:none;border-radius:8px;align-items:center;padding:0 8px 0 28px;font-size:14px;line-height:22px;display:flex;overflow:hidden}
.${css.item}:hover{background:var(--dsw-alias-interactive-bg-hover)}
.${css.itemActive}{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-state-business-primary)}
.${css.dot}{border-radius:50%;flex:none;width:6px;height:6px;margin-right:8px}
@media (prefers-reduced-motion:reduce){.${css.chevron}{transition:none}}
.${css.rail}{flex:none}
.${css.railButton}{cursor:pointer;width:36px;height:36px;color:var(--dsw-alias-label-primary);background:0 0;border:none;border-radius:50%;flex:none;justify-content:center;align-items:center;margin:0 0 12px;padding:0;display:inline-flex}
.${css.railButton}:hover{background:var(--dsw-alias-interactive-bg-hover)}
`
