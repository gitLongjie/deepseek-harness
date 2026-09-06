# Agent Note: Model input modality settings

Status: implemented

English | [中文](2026-09-04-model-input-modality-settings.zh.md)

## Problem

The LLM adapters already expose input modality capability and reject image requests for models that do not advertise image input, but the Models settings page did not let users declare that capability for a configured model.

## Decision

The Models settings editor exposes text and image input options in each model row's advanced section. Text is required; image is optional. The pi-ai editor stores the declaration as `input`, while the direct DeepSeek editor stores it as `inputModalities`. Discovered pi-ai models retain the provider-reported modalities when adopted. Validation rejects unknown, duplicate, or text-free declarations before settings are written.

The UI supports only text and image input, which the current LLM message and provider adapters already carry. Video input and output modalities remain deferred until those layers carry the values end to end.

## Alternatives considered

**Add a generic free-form modality field.** Rejected because an unchecked or misspelled value could claim a capability that the request serializer and provider do not support.

**Infer image support from the model ID or endpoint.** Rejected because naming conventions and gateway behavior are not authoritative; the existing adapter capability field is the source used by the request-time image gate.

**Add video and output options at the same time.** Rejected because the current message vocabulary and provider implementations do not carry those modalities.

## Consequences

Users can configure a custom vision model without editing `settings.yaml`, and discovered image capability is preserved when a model is adopted. Enabling image input remains an endpoint claim: an endpoint that rejects the request can still return a provider error. Existing models and omitted modality fields retain their current adapter defaults.

## Verification

The Models settings client tests cover pi-ai and DeepSeek writes, invalid modality rejection, localized labels, and the existing model editing paths. The provider runtime already tests the request-time image capability gate.
