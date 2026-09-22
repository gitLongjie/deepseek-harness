# Agent Note: Workspace file reads extract office-document text

Status: implemented

English | [中文](2026-09-22-workspace-document-text-extraction.zh.md)

## Problem

Office documents in the Sidebar preview showed only the unsupported empty state: the preview owner listed `doc`, `docx`, and `odt` among the suffixes "whose bytes are never readable text", so it never issued a read, and the Host's text endpoint would have refused those bytes anyway (`FS_NOT_TEXT` / NUL check). The same files stayed opaque to any other consumer of `workspaceFiles.read`.

Any converter-based fix has a platform-encoding trap. macOS `textutil -convert txt` writes UTF-16 with a byte-order mark unless `-encoding UTF-8` is stated; a preview that trusted the default would show re-encoded noise. And `textutil` does not exist off macOS, so a single hardcoded command would fail loudly on Linux and Windows rather than degrade gracefully.

## Decision

`workspaceFiles.read` now extracts text for `.doc`, `.docx`, and `.odt`, and the preview treats those suffixes as readable so the plain-text fallback pages them like any text file.

The converter is resolved explicitly before anything spawns (`src/document-text.ts`). On macOS every covered suffix goes to `textutil`; off macOS `soffice` is the first choice, with `pandoc` backing up `.docx`/`.odt` and `catdoc` backing up legacy `.doc`. Each style owns its argv, and the encoding is stated in the argv rather than trusted from defaults: `textutil -convert txt -encoding UTF-8 -stdout`, `pandoc --to=plain --wrap=none`, `catdoc -d utf-8`, and `soffice --headless --convert-to txt:Text --outdir <tmp>` with a private `-env:UserInstallation` profile so a desktop LibreOffice holding the default profile cannot block the run. soffice writes an outfile instead of stdout, so its style owns the temp outdir, the expected `<stem>.txt`, and its cleanup.

No output is trusted either. Converted bytes are decoded with a strict (`fatal`) UTF-8 decoder and one leading byte-order mark is stripped, so a converter that ignored its encoding argument fails the read with `workspace-file/conversion-failed` instead of feeding the preview mojibake. The child's failure and a missing soffice outfile land on the same code; an unavailable converter is its own `workspace-file/no-converter`, and converted text above `maxFileBytes` fails `too-large` like any complete-file read. Cancellation rethrows the abort rather than wrapping it.

The preview pages lazily, so a naive integration would rerun the converter once per page. Converted text is cached per absolute path keyed by the stat `version` the page already carries, holding the most recent four documents; a changed version converts again. Every converter command is a Config field (`documentText.textutilPath`/`sofficePath`/`pandocPath`/`catdocPath`, plus `enabled`), because installs differ per host; resolution checks the configured command against PATH (PATHEXT-aware on Windows) or the named absolute file. The internals (platform, availability, byte-capturing no-shell runner) are a constructor-injected seam, so tests stub them without any real converter installed.

On the client, the three suffixes leave the unviewable list — with extraction available, their bytes are no longer "never readable text" — and two failure codes get named lines in the preview's locale dictionary, so a host without converters shows an actionable message instead of the generic one.

## Alternatives considered

**Convert in the client with a JS parser (mammoth, jszip).** Adds a browser dependency per format, duplicates extraction quality the platform tools already have, and does nothing for non-preview consumers of the same reads.

**Extract in the `dsh-fs` backend.** Text extraction is not a filesystem concern; every backend would reimplement it, and the wire failure codes and caps belong to this service.

**Convert per page without a cache.** Correct but costs one child process per scrolled page on a document a reader is paging through.

**Trust each tool's default encoding and re-encode afterwards.** That is the UTF-16 trap: decoding textutil's default output as UTF-8 yields noise with NULs. Stating the encoding in argv and verifying the result keeps both ends honest.

**Cover `.xls`/`.ppt`/iWork suffixes too.** The listed converters either cannot extract them or degrade them to lossy CSV-like output; the client keeps those suffixes unviewable until a converter claims them.

## Consequences

`read` on a covered document returns pages of extracted text with the same wire shape as any text page; `absolutePath` and `version` still name the original document, so change observation and reload behave as before. Hosts without a converter fail those reads with a named, localizable code instead of the blanket not-text, and `documentText.enabled: false` restores exactly that blanket refusal. Extraction spends one child process per file version and holds up to four converted documents in memory, bounded by `maxFileBytes` each. The wire gains two `RemoteErrorDetailsMap` entries; nothing else on the endpoint's surface moves.

## Testing

`packages/api/workspace-files/tests/document-text.spec.ts` pins the suffix gate, the per-platform resolve order (textutil on macOS; soffice, then pandoc/catdoc, off macOS), the argv of every style including textutil's explicit `-encoding UTF-8`, soffice's outfile route and its missing-outfile failure, strict UTF-8 refusal of BOM-led UTF-16 output, abort rethrow, the version-keyed single conversion across pages, the two wire failure codes, the converted-text cap, the disabled-config fall-through to not-text, the uncovered-suffix pass-through, and the config schema defaults. `packages/client/ui-sidebar-documentpreview/tests/document-unviewable.client.spec.ts` moves the three suffixes to the readable side and keeps spreadsheets, presentations, and iWork documents unviewable.
