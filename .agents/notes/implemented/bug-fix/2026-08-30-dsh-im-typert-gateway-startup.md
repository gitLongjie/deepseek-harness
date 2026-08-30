# dsh-im uses the current Host Remote gateway

English | [中文](2026-08-30-dsh-im-typert-gateway-startup.zh.md)

The Desktop profile no longer provides the removed `apiProxy` service. dsh-im now waits for `connection`, `credentials`, and `typertGateway`, and adapts Gateway unary calls to the existing HarnessClient carrier. This keeps plugin activation aligned with the Host composition after the ApiProxy removal.

The adapter is local-only; explicit `harnessBaseUrl` configuration continues to use the HTTP/WebSocket carrier. The event response path remains unavailable for the legacy local interaction client until it is migrated to the Gateway Remote Event result endpoint.
