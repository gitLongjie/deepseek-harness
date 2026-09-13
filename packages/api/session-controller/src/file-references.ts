/** Session Controller adapter for Agent-scoped file-reference discovery. */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-file-reference'
import type {
  FileImportRequest, FileImportValue, FileReferenceCandidate,
} from '@deepseek-ai/dsh-file-reference/types'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host owner of the `fileReferences` Remote namespace. */
    sessionFileReferences: SessionFileReferences
  }
}

/** Host Remote adapter over the composed file-reference provider. */
export class SessionFileReferences extends TypertRemoteService {
  static inject = ['fileReferences', 'typert']

  /** @param ctx - Host context carrying the selected file-reference provider. */
  constructor(ctx: Context) {
    super(ctx, 'sessionFileReferences', { namespace: 'fileReferences' })
  }

  /**
   * List file and directory candidates for one Agent's working directory.
   * @param agent - target Agent resolved from the Session identity on the wire.
   * @param query - path text following `@` or `@"`.
   * @param signal - caller cancellation.
   * @returns deterministic path-only candidates from the composed provider.
   */
  @Remote
  list(
    agent: Agent,
    query: string,
    signal: AbortSignal,
  ): Promise<FileReferenceCandidate[]> {
    return this.ctx.fileReferences.list(agent, query, signal)
  }

  /**
   * Store one externally sourced file inside the Agent's workspace so `@`
   * mentions and the filesystem tools can address it.
   * @param agent - target Agent resolved from the Session identity on the wire.
   * @param request - proposed bare file name and canonical base64 bytes.
   * @param signal - caller cancellation; aborting removes the partial copy.
   * @returns the stored copy's workspace-relative forward-slash path.
   */
  @Remote
  import(
    agent: Agent,
    request: FileImportRequest,
    signal: AbortSignal,
  ): Promise<FileImportValue> {
    return this.ctx.fileReferences.import(agent, request, signal)
  }
}

export default SessionFileReferences
