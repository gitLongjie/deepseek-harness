import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChatNodeViewProps, TurnTailOwnerProps } from '../contract/slots.ts'
import { AssistantMarkdown, type AssistantMarkdownProps } from './AssistantMarkdown.tsx'

/** Streaming, settled, and interrupted Assistant states share one keyed renderer instance. */
export const AssistantNodeView = memo(function AssistantNodeView({
  node, useTurnData, turnProcess, openFile, renderMessageImages, fileMentions, t,
}: ChatNodeViewProps<'assistant-step'>) {
  const data = node.data
  const turn = node.location.kind === 'turn' || node.location.kind === 'step'
    ? node.location.turn
    : undefined
  const tail = useTurnData('turn-tail')
  const owner = useMemo<TurnTailOwnerProps | undefined>(() => {
    if (turn?.status !== 'closed' || data.finalNode === undefined) return undefined
    if (tail?.closing?.finalNode.seq !== data.finalNode.seq) return undefined
    return { turn, seq: data.finalNode.seq, openFile }
  }, [data.finalNode, openFile, tail, turn])
  const mentions = useMemo(
    () => owner === undefined ? undefined : fileMentions(owner),
    [fileMentions, owner],
  )
  const reasoningHidden = turnProcess !== undefined
    && turnProcess.foldable
    && turnProcess.spec.answerStep === data.step
    && turnProcess.spec.inlineReasoning
    && !turnProcess.open
  const revealProcess = useCallback(() => { turnProcess?.setOpen(true) }, [turnProcess])
  return (
    <DeferredAssistantMarkdown
      blocks={data.blocks}
      streaming={data.status === 'running'}
      interrupted={data.status === 'interrupted'}
      renderMessageImages={renderMessageImages}
      reasoningHidden={reasoningHidden}
      revealProcess={revealProcess}
      mentions={mentions}
      t={t}
    />
  )
})

/**
 * Keep large settled answers out of the initial render until they approach
 * the viewport. Streaming and interrupted answers stay live because the tail
 * must remain visible while a turn is active or being stopped.
 * @param props - Assistant markdown and its rendering dependencies.
 * @returns the rendered answer, or a browser-owned deferred subtree.
 */
function DeferredAssistantMarkdown(props: AssistantMarkdownProps) {
  const { streaming, interrupted } = props
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [visible, setVisible] = useState(streaming || interrupted === true)

  useEffect(() => {
    if (visible || streaming || interrupted === true) return
    const host = hostRef.current
    if (host === null || typeof IntersectionObserver === 'undefined') {
      setVisible(true)
      return
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some(entry => entry.isIntersecting)) {
        setVisible(true)
        observer.disconnect()
      }
    }, { rootMargin: '800px 0px' })
    observer.observe(host)
    return () => { observer.disconnect() }
  }, [interrupted, streaming, visible])

  if (visible || streaming || interrupted === true) return <AssistantMarkdown {...props} />
  return <div ref={hostRef} aria-hidden="true" data-deferred-assistant="" />
}
