/** Chat-completions transport for the Deepagens gateway route. */
import { LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, PreparedAdapterCall, StreamChunk } from '@deepseek-ai/dsh-llm'
import type { DeepSeekAdapterOptions } from './common/types.ts'
import { ChatCompletionsAdapter } from './protocols/chat-completions/adapter.ts'
import { DeepSeekFileStore } from './common/file-store.ts'

/** Gateway route whose wire protocol is fixed to OpenAI chat completions. */
export class DeepSeekAdapter extends LlmAdapter {
  private readonly inner: ChatCompletionsAdapter

  constructor(dependencies: DeepSeekAdapterOptions) {
    super()
    const files = dependencies.resolveFiles?.() ?? new DeepSeekFileStore()
    this.inner = new ChatCompletionsAdapter({
      ...dependencies,
      options: dependencies.options,
      resolveFiles: () => files,
    })
  }

  override providerInfo(provider: string) { return this.inner.providerInfo(provider) }
  override providerRetryPolicy(provider: string) { return this.inner.providerRetryPolicy(provider) }
  override listModels(provider: string) { return this.inner.listModels(provider) }
  override resolveModel(provider: string, model: string, signal?: AbortSignal) {
    return this.inner.resolveModel(provider, model, signal)
  }
  override imageRequestPricing(provider: string, model: string) {
    return this.inner.imageRequestPricing(provider, model)
  }
  override prepareCall(provider: string, model: string, signal?: AbortSignal): Promise<PreparedAdapterCall> {
    return this.inner.prepareCall(provider, model, signal)
  }
  stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    return this.inner.stream(options)
  }
}
