# Agent Note: The cwd prompt variable returns under the working-directory service

Status: implemented

English | [中文](2026-11-03-cwd-prompt-variable.zh.md)

## Problem

Upstream release v0.2.1-alpha.1 removed the agent loop's built-in `{{cwd}}` prompt variable ([upgrade guide](../../../../docs/upgrade-guide/v0.2.1-alpha.1/working-directory/guide.md)): it read `Session.header.cwd`, the original project directory, so a Session that had changed its directory with `working_directory({ cd })` still interpolated the old path, and the directory already reached the model as required user context. Templates that kept the reference started failing assembly with `unknown prompt variable "{{cwd}}"`, which is the designed fail-loud behavior.

The shipped expert presets were written after that removal but kept directory clauses in their persona prefixes — `工作目录是 {{cwd}}。` — with comments claiming the variable resolves from the agent's workspace. Every run of one of those experts in the OEM desktop failed before any model request, because nothing registers `cwd` anymore.

## Decision

The `cwd` prompt variable returns, registered by the working-directory service — the owner of the effective directory — instead of the agent loop. The provider resolves the Session's **effective** directory (the projection state, including committed `cd` changes and recovery), not `header.cwd`: the misleading semantics that motivated the upstream removal stay gone, and the value follows directory changes within one Session. An assembly without an Agent leaves the variable without a value, so a template referencing it there still fails strictly, same as every other prompt variable.

This deliberately differs from the upgrade guide's migration advice (drop the clause, rely on user context): the shipped expert personas use the clause as identity prose, and strict-fail assembly turns that prose into a run failure. Personas that do not reference `{{cwd}}` are unaffected; the working-directory context section remains the canonical model-visible directory statement.

## Alternatives considered

**Fix the presets instead.** Removing the `{{cwd}}` clauses from the expert personas matches the upgrade guide and deletes the runtime dependency, but the templates live in shipped preset directories across the OEM lines, and every future persona author hits the same latent trap the presets already hit. Registering the variable makes the documented template contract ("`{{model}}` and `{{cwd}}` resolve from the agent's own route and workspace") true.

**Re-register it in the agent loop.** The loop is not the directory owner and has no access to the effective-directory projection; registering there either re-introduces the `header.cwd` semantics or duplicates the projection read. The working-directory service already participates in every assembly through its context contribution.

## Consequences

- Expert and persona templates may interpolate `{{cwd}}` again; the value is the effective directory at assembly time and can differ from `Session.header.cwd`.
- The variable is absent on agent-less assemblies; templates referencing it there fail assembly strictly.
- [working-directory guide](../../../../docs/upgrade-guide/v0.2.1-alpha.1/working-directory/guide.md) stays as the historical record of the loop-owned removal; the working-directory README documents the service-owned variable.
