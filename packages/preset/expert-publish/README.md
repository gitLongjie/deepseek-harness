---
description: "Publish a hireable expert into the running roster when a conversation shares one, without restarting the process."
kind: "package-reference"
---

# @deepseek-ai/dsh-expert-publish

English | [中文](README.zh.md)

## Summary

`dsh-expert-publish` adds a hireable expert to the running expert list from the conversation. A WorkBuddy launch link, or a message that says the user created an expert in 「」, is the request. The card is registered in the current process and stored under the harness home, so the next launch still has it and the current process does not restart.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>

## Use this package

Mount it once on the host, beside the agent-preset registry. It has no required config. `root` overrides the directory; the default is `$DSH_HOME/published-experts`.

```yaml
- id: expert-publish
  name: '@deepseek-ai/dsh-expert-publish'
```

The web profile inserts this row. Every agent sees `publish_expert` because the tool is registered on the host tool service. Hiring the new card starts a new session; the session that published it keeps the composition it already runs.

<a id="understand-the-implementation"></a>

## Understand the implementation

On the first step of a turn whose user text matches, the plugin appends a notice that names the stable id `expert-` plus twelve hex characters of the display name. The model calls `publish_expert` with that id, the persona, and optional tags, prompts, and skill markdown. The call writes `expert.json` and `skills/published-expert/SKILL.md`, then `agentPresets.register`. The same id replaces the previous registration. An id the deployment already registered is refused.

If that turn ends with no `publish_expert` call, the plugin publishes a short card from the share text, and only when that id is not already one it owns. The expert page reads the roster when it opens, so the card is there without restarting.

<details>
<summary>Implementation internals — click to expand</summary>

The child composition is fixed: persona, agent instructions, the platform shell, filesystem tools, present, and a skill directory pointed at the saved folder. The model does not supply plugin rows.

</details>

<a id="further-exploration"></a>

## Further Exploration

- [Agent preset registry](../agent-preset-registry/README.md) — registration and the roster the expert page reads.
- [Expert page](../../client/ui-expert/README.md) — hireable cards.

<a id="model-experience"></a>

## Model Experience

### publish_expert

#### What the model sees

A global tool. The description is the instruction to call it before a share turn ends.

##### Tool description

```markdown
Publish or replace one hireable expert in the running expert list. Call it before the turn ends when the user shares an expert (a WorkBuddy launch link, or a message that says they created an expert in 「」) or asks to add an expert to the expert list. Pass the id from the turn instruction when one is present. The card is usable immediately; do not edit repository presets and do not ask for an application restart. Republishing the same id replaces that expert.
```

#### Token effect

The tool schema is part of the host tool list on every request. A matching share also appends one notice on the first step of that turn.

#### KV Cache effect

The tool schema is part of the stable host tool list. The notice is appended after the user message, so earlier prefixes stay reusable. Replacing an expert does not change the tool schema.

### Share notice

#### What the model sees

On the first step of a matching turn, one user-role notice with source `expert-publish`. `<id>` is the stable id and `<name>` is the parsed display name.

##### Notice

```markdown
This user message shares an expert to add to the expert list. Before this turn ends, call publish_expert once with id "<id>", name "<name>", and a description and persona that carry the expert's job. Include tags, quickPrompts, and skillMarkdown when you have them. Republishing the same id replaces the card. The card is hireable immediately. Do not edit repository preset files and do not ask the user to restart the application.
```

#### Token effect

One notice for the rest of that session once the share turn has run. Later steps of the same turn do not add another.

#### KV Cache effect

Append-only after the user message. A turn that does not match adds nothing.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **The share link is not fetched.** A WorkBuddy launch page does not include the expert's prompt, so the persona is whatever this turn writes. The turn-end card uses only the name and the clause after the dash when the tool was not called.
- **An open expert page does not refresh itself.** The page reads the roster when it is opened. Close it and open 专家 again to see a card published while it was already open.
- **The publishing session does not switch composition.** Hire the card into a new chat.

<a id="dev-note"></a>

### Dev Note

- **2026-11-19** — A shared expert is registered on the live roster and stored under the harness home, so the expert list updates without a process restart.
