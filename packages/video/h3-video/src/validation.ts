/**
 * Shared request validation for H3 video providers.
 * @module @deepseek-ai/dsh-h3-video/validation
 */

import type { SegmentRequest, ProviderCapabilities } from './types.ts'

/** Thrown for a request a named backend cannot serve; the message is model-safe. */
export class SegmentRequestError extends Error {}

/**
 * Validate a segment request against one backend's capabilities and the MiniMax H3 content rules:
 * exactly one non-empty text item, at most one first and one last frame, image-only ratios stay
 * adaptive, durations inside range, and reference counts inside the published caps (9 images,
 * 3 videos, 3 audios).
 * @param request - the caller-supplied request.
 * @param capabilities - the target backend's limits.
 * @throws SegmentRequestError - when the request violates a rule.
 */
export function validateSegmentRequest(request: SegmentRequest, capabilities: ProviderCapabilities): void {
  const texts = request.inputs.filter(input => input.type === 'text')
  if (texts.length !== 1) {
    throw new SegmentRequestError('a segment needs exactly one text prompt')
  }
  const prompt = texts[0]
  if (prompt?.type !== 'text' || prompt.text.trim().length === 0) {
    throw new SegmentRequestError('the text prompt must be non-empty')
  }
  if (prompt.text.length > 7000) {
    throw new SegmentRequestError('the text prompt exceeds 7000 characters')
  }
  if (!capabilities.resolutions.includes(request.resolution)) {
    throw new SegmentRequestError(`resolution ${request.resolution} is not available on ${capabilities.name}`)
  }
  if (
    !Number.isSafeInteger(request.durationSeconds)
    || request.durationSeconds < capabilities.minDurationSeconds
    || request.durationSeconds > capabilities.maxDurationSeconds
  ) {
    throw new SegmentRequestError(
      `duration ${request.durationSeconds}s is outside ${capabilities.minDurationSeconds}..${capabilities.maxDurationSeconds}s on ${capabilities.name}`,
    )
  }
  const countRole = (role: 'first_frame' | 'last_frame' | 'reference_image'): number =>
    request.inputs.filter(input => input.type === 'image' && input.role === role).length
  if (countRole('first_frame') > 1 || countRole('last_frame') > 1) {
    throw new SegmentRequestError('at most one first_frame and one last_frame image is accepted per request')
  }
  if (countRole('reference_image') > 9) {
    throw new SegmentRequestError('at most 9 reference_image inputs are accepted per request')
  }
  const countType = (type: 'video' | 'audio'): number =>
    request.inputs.filter(input => input.type === type).length
  if (countType('video') > 3) {
    throw new SegmentRequestError('at most 3 reference_video inputs are accepted per request')
  }
  if (countType('audio') > 3) {
    throw new SegmentRequestError('at most 3 reference_audio inputs are accepted per request')
  }
  const hasFrameImage = request.inputs.some(input =>
    input.type === 'image' && (input.role === 'first_frame' || input.role === 'last_frame'))
  const hasReference = request.inputs.some(input =>
    (input.type === 'image' && input.role === 'reference_image')
    || input.type === 'video'
    || input.type === 'audio')
  if (hasFrameImage && hasReference) {
    throw new SegmentRequestError('first/last-frame images and reference inputs cannot mix in one request')
  }
  if (hasFrameImage && request.ratio !== 'adaptive') {
    throw new SegmentRequestError('frame-image requests determine their ratio from the image; use adaptive')
  }
  if (!hasFrameImage && request.ratio === 'adaptive' && !hasReference) {
    throw new SegmentRequestError('text-only requests need an explicit ratio, not adaptive')
  }
  if (!capabilities.multimodalInputs && request.inputs.length > 1) {
    throw new SegmentRequestError(`${capabilities.name} serves text prompts only`)
  }
}
