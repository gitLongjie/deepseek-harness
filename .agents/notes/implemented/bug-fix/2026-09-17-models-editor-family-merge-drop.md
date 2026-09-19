# Agent Note: Restore the adapter-declared editor families the dsh 0.1.6-alpha.1 merge dropped

Status: implemented

English | [中文](2026-09-17-models-editor-family-merge-drop.zh.md)

## Problem

The merge of upstream dsh 0.1.6-alpha.1 (bb1a3b16bb) lost the client side of the declared editor families (introduced in 921b4e1213): `ProviderDirectoryEntry` lost the `editorFamily` field, `joinProviderDirectory` stopped copying it from `LlmConfigurableProvider`, and `targetOf` stopped handing it to `ProviderEditor`. The adapters (`llm-deepseek`, `llm-pi-ai`) still declare the family on the directory wire, so every Models-page card resolved to the unknown layout and rendered only the "Other fields live in settings.yaml" hint — no API-key field, no base URL, no model catalog. 71 section tests failed with "no customized fold".

## Decision

Restore the three dropped pieces: the `editorFamily` field on `ProviderDirectoryEntry`, its copy in `joinProviderDirectory` (`packages/client/ui-settings-models/src/client/store.ts`), and its propagation through `targetOf` (`packages/client/ui-settings-models/src/client/ModelsSection.tsx`). The three upstream test fixtures that predate the declared-family design scripted directory answers without `editorFamily`; they now name the family the real adapters declare, and the direct `ProviderEditor` mount without a family keeps asserting the hint.

## Alternatives considered

**Adopt upstream's namespace-id inference** (`llm-pi-ai` → pi-ai inside the client). The declared-family design exists precisely so a new adapter namespace curates its card by declaring a family rather than by being hardcoded in the client; the wire type, host-side validation, and both adapters kept that design through the merge, so only the client consumption needed restoring.

## Consequences

Editing a provider on the Models page opens its curated visual card again — key, base URL, display name and protocol for declared routes, and the model catalog with discovery. The settings.yaml hint remains the card for namespaces whose adapter declares no family. Upstream tests scripted against the inference design are now fixtures of the declared design; a future namespace must declare its family on the directory entry to get a curated card.
