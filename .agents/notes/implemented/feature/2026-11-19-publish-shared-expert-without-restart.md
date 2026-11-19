# Agent Note: A shared expert joins the running roster

Status: implemented

English | [中文](2026-11-19-publish-shared-expert-without-restart.zh.md)

## Problem

Pasting a WorkBuddy expert share, then asking for that expert in the DeepWork expert list, edited `apps/desktop/config/agent-presets/` and required a full process restart. The roster is built when the process starts. Files written into the deployment tree are invisible until the next boot, and a restart drops the conversation the user is in.

## Decision

`@deepseek-ai/dsh-expert-publish` is a host plugin. A user message that contains a WorkBuddy launch URL or 「创建了一个专家「名称」」 makes the first step of that turn tell the model to call `publish_expert` with a stable id derived from the display name. The tool writes the expert under `$DSH_HOME/published-experts/<id>/` and calls `agentPresets.register` in the current process. The same id replaces that registration. If the turn ends without the call, and this plugin does not already own the id, it registers a short card from the share text.

The child composition is fixed: persona, instructions, the platform shell, filesystem tools, present, and the saved skill directory. The model does not choose plugin rows. The expert page reads `agentPresets.list` when it opens, so the card is hireable into a new session without restarting. The next boot loads the same directory.

## Alternatives considered

**Keep writing a preset directory into the deployment tree.** Rejected: that directory is included only at boot, so every new expert requires a restart, and a later checkout can overwrite it.

**Install a profile patch through plugin_manager and rely on HMR.** Rejected: a profile with no HMR reports restart-required, which is the outcome this change removes. The registry already accepts a live `register` call.

**Fetch the WorkBuddy launch page and copy its prompt.** Rejected: that page is a client-rendered shell and does not contain the expert prompt. The persona has to be written in the turn.

## Consequences

- A matching share becomes a card in the current process. The user opens 专家 and hires it into a new chat.
- The session that handled the share keeps its current composition.
- An expert page that is already open does not update until it is opened again.
- A deployment id cannot be replaced by this tool. Calling `publish_expert` again with an id this plugin owns replaces that card. The turn-end fallback does not replace an id this plugin already owns, so a later share of the same name leaves the longer persona in place when the tool is not called again.
