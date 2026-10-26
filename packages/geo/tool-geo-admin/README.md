---
description: "Model-facing 深度云海 tools (sites, articles, categories) over the GEO multi-site content backend, plus the geo-admin settings namespace and credential reference they read."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-geo-admin

English | [中文](README.zh.md)

## Summary

`@deepseek-ai/dsh-tool-geo-admin` gives the model a typed surface over a 深度云海 (GEO multi-site) content backend: sites, articles (read, create, update, delete), categories, GEO keyword tasks (list, retry), and brand-visibility reports (list, read, generate, follow the job). Every call signs in with the account configured in the `geo-admin` settings namespace; the password stays in the credential store under `GEO_ADMIN_PASSWORD` and is resolved per call. The package also ships the host row that registers that namespace.

## Table of Contents

- [Use this package](#use-this-package)
- [Tools](#tools)
- [Settings and credentials](#settings-and-credentials)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Use this package

The package has two entries:

- `.` — the model-facing tools. A preset mounts it beside its persona; the tools register into that session's `tools` registry.
- `./settings` — the host row that registers the `geo-admin` namespace and publishes the live view. It is a **host** row: `settings.register` is once-per-process, so a preset must never mount it.

```yaml
- id: geo-admin-settings
  name: '@deepseek-ai/dsh-tool-geo-admin/settings'
  config:
    baseUrl: http://localhost:8001
    username: article-bot

- id: tool-geo-admin
  name: '@deepseek-ai/dsh-tool-geo-admin'
```

Composition config is the base layer; a value saved on the settings page overlays it. The launching environment can seed that base through `GEO_ADMIN_BASE_URL` / `GEO_ADMIN_USERNAME`, and `GEO_ADMIN_PASSWORD` in the environment satisfies the credential reference.

## Tools

| Tool | Effect |
|---|---|
| `geo_sites_list` | Sites the account may publish to (`id`, `name`, `domain`, `code`, `role`). |
| `geo_news_list` | One page of articles, filtered by site, category, keyword, or publish state. |
| `geo_article_get` | One stored article by id. |
| `geo_categories_list` | Content categories, optionally scoped to a site or keyword. |
| `geo_article_publish` | Create an article, then read the stored record back. |
| `geo_article_update` | Change some fields (or the publish state), then read the stored record back. |
| `geo_article_delete` | Delete one article; the backend refuses while publish or placement records reference it. |
| `geo_tasks_list` | One page of GEO keyword tasks, filtered by site, batch, platform, status, or keyword. |
| `geo_task_retry` | Retry one failed GEO task. |
| `geo_reports_list` | One page of brand-visibility reports across the account's sites. |
| `geo_report_get` | One report: QA and citation counts, QA window, the target brand's visibility score, and the brand ranking. |
| `geo_report_generate` | Start a report generation for a site; costs model calls. |
| `geo_report_job` | Follow one report-generation job. |

A create is not retried: the backend's `POST /api/v1/news` has no idempotency key, so a blind retry would create a second article. A delete is not retried either: its refusal (publish or placement records) is a state the user has to resolve.

## Settings and credentials

| Field | Meaning |
|---|---|
| `baseUrl` | Backend origin, for example `http://localhost:8001`. |
| `username` | Account the tools sign in as; it needs the `content.news` permission on each target site, and `geotool.reports.all` to list reports across sites. |
| `GEO_ADMIN_PASSWORD` (credential) | That account's password. Stored through the credentials domain, never in the settings document. |

Every request refuses redirects: the sign-in request carries the password and authenticated calls carry a bearer token, so a relocated endpoint must fail here rather than forward either to another origin.

No runtime invariant companion is published: the settings registration and the per-session tool registry already own their state, and this package adds no relation that independent observations could diverge on.

## Model Experience

### Model-facing contract

#### What the model sees

The thirteen tools appear only in a session whose preset mounts this package. Their descriptions state the confirmation rules (draft by default, read back after a write, no blind retry, report generation costs model calls), and their results render as short text: a site list, a page of rows, one article, one report with its brand ranking, or one job's status. A missing deployment row, an unset field, or an unset password fails with the Settings → Plugins → 深度云海 path in the message, so the model can name the fix instead of guessing.

#### Token effect

Each result is bounded by the request that produced it: one site list, one page of rows, one article summary, one report projection, or one job. `geo_news_list` returns the backend's list projection, not article bodies, so a large article does not enter the transcript unless the model reads it directly; `geo_report_get` carries the brand ranking but not the full diagnosis text.

#### KV Cache effect

None. Tool schemas and results are part of the request, so the usual tool-catalog caching rules apply; the password is resolved per call and never enters the request prefix.

## Known Limitations and Deferred Work

- **A delete can be refused.** The backend refuses while publish or placement records reference the article; the tool reports that reason and leaves the resolution to the user.
- **No bulk operations.** Each call addresses one site, article, task, report, or page.
- **The list projection is the backend's.** `geo_news_list` returns the columns the backend's list endpoint projects, not the full article body; `geo_reports_list` carries the report row, not its diagnosis.
- **Report generation is asynchronous.** The start call returns a job; the report exists only after `geo_report_job` reports `succeeded`.
- **Plaintext at rest.** The password lives in the harness credential store, which the same OS user (and therefore the agent's own tool processes) can read; the tools never hand its value to the model.

### Dev Note

The tools are thin REST adapters over the backend's `/api/v1` surface: every call signs in with the configured username and the per-call `GEO_ADMIN_PASSWORD` credential, carries the resulting bearer token, and refuses redirects. The `./settings` entry registers the `geo-admin` namespace once per process and publishes the live view the desktop settings card reads.
