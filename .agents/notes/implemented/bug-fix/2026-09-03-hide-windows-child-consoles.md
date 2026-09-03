# Agent Note: Hide Windows child consoles

Status: implemented

English | [中文](2026-09-03-hide-windows-child-consoles.zh.md)

## Problem

Local child processes launched by the desktop application could create transient Windows console windows, interrupting the GUI experience.

## Decision

The local subprocess provider sets Node's `windowsHide` spawn option for every child process. The Windows ACL sandbox starts wrapped commands through a separate `CreateProcessAsUserW` path, so the shared Win32 process layer also sets `STARTF_USESHOWWINDOW` with `SW_HIDE` while retaining `STARTF_USESTDHANDLES`. Neither path changes stdio routing or process-tree ownership.

## Alternatives considered

**Set the option in each command consumer.** Rejected because bash, language-server, workflow, and other consumers all share the local subprocess provider; consumer-specific fixes would leave other launch paths visible.

**Change the desktop executable subsystem or redirect all output.** Rejected because the issue is caused by child creation, while stdio remains an intentional part of the subprocess seam and is needed for command results and interactive sessions.

## Consequences

Windows child processes no longer request transient console windows through Node's spawn path. PTY sessions retain their interactive behavior, and non-Windows process-tree behavior is unchanged.

Windows ACL-sandboxed PowerShell and command launches now receive the same hidden-window treatment without the `CREATE_NO_WINDOW` or `CREATE_NEW_CONSOLE` creation flags that the restricted token cannot initialize under.
