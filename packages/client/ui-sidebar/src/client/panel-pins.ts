/** In-memory pin choices for the global panel launchers. */
import { createSnapshotStore, type ObservableSnapshot } from '@deepseek-ai/dsh-client-store'

/** Secondary panel launchers shown in More by default. */
const DEFAULT_UNPINNED: readonly string[] = ['plugins', 'schedule-work']

/** Unpinned panel ids and their only mutation. */
export interface PanelPins {
  /** Unpinned panel ids; ids of panels that are not registered stay listed. */
  readonly unpinned: ObservableSnapshot<readonly string[]>
  /**
   * Pin or unpin one panel launcher.
   * @param id - Panel id.
   * @param pinned - Whether the launcher is manually pinned.
   */
  readonly setPinned: (id: string, pinned: boolean) => void
}

/**
 * Create the in-memory panel pin list; the snapshot keeps its reference until the list changes.
 * @returns Unpinned panel ids and the pin mutation.
 */
export function createPanelPins(): PanelPins {
  const store = createSnapshotStore<{ readonly unpinned: readonly string[] }>({ unpinned: DEFAULT_UNPINNED })
  return {
    unpinned: { getSnapshot: () => store.getSnapshot().unpinned, subscribe: listener => store.subscribe(listener) },
    setPinned: (id, pinned) => {
      const current = store.getSnapshot().unpinned
      if (pinned !== current.includes(id)) return
      store.set({ unpinned: pinned ? current.filter(entry => entry !== id) : [...current, id] })
    },
  }
}
