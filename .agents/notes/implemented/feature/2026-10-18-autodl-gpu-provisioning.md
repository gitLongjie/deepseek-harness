# Agent Note: The local video backend provisions its own AutoDL GPU

Status: implemented

English | [中文](2026-10-18-autodl-gpu-provisioning.zh.md)

## Problem

`h3-video`'s local backend rendered only against a ComfyUI server somebody else kept running. `comfy.url` was a fixed address, so a machine without a usable GPU had no path to local generation, and an operator who rented GPU time had to create the instance, start ComfyUI, copy keyframes into it, and release it by hand while the render ran. The deployment this note targets rents AutoDL container instances for 768P H3 segments; it wants the harness to create that instance when work arrives, use it across the whole render, and stop paying when the work ends, with the account token resolved from configuration.

## Decision

A `comfy.gpu` row makes the local backend own its machine. The row is anchored by `gpuSpecUuid`; a row without it leaves the GPU unmanaged and `comfy.url` applies. It carries the AutoDL compute specification, boot image, CUDA floor, GPU count, disk expansion, data centers, instance name, boot command, service port, poll/boot/probe/request timeouts, and the idle policy (`idleTimeoutMs`, `idleAction`, `releaseOnDispose`).

The lifecycle is a vendor-neutral seam. `GpuVendor` exposes instance operations (`list`, `create`, `status`, `powerOn`, `powerOff`, `release`, `serviceUrl`), and `GpuInstancePool` owns exactly one instance: it reuses an account instance named `instanceName`, powers a stopped one back on, waits for `status: running`, reads the mapped service domain from the instance snapshot, probes `/system_stats` until ComfyUI answers, and exposes the resolved origin. Vendors contribute no fields to the pool; `createAutoDLVendor` binds AutoDL's creation body.

The ComfyUI provider takes its origin from the pool per operation (`resolveBaseUrl`), so the first submission of a render boots the instance and polling keeps using the origin the pool cached. Client-side, AutoDL's `{ code, msg, data, request_id }` envelope is unwrapped or raised as `AutoDLError`; the two GET endpoints send their fields as query parameters because `fetch` refuses a body on GET; a scheme-less `service_<port>_domain` becomes `https://…` while a value that already names its scheme is used as authored.

`submit` acquires the pool for a local route before enqueuing, `poll` releases the task's hold when it settles or throws, and `cancel` does the same, so the idle timer measures real work rather than submission. A boot that fails after creating an instance arms the same timer, because the instance still bills. Explicit `stop` and `release` refuse while a task is live, so a model-issued release cannot tear down the machine under a render; disposal forces release when `releaseOnDispose` asks for it. `idleAction` defaults to `power_off` — it ends GPU billing and keeps the installed environment — while `release` deletes the instance and its disk.

Image conditioning works without a local input directory: when `comfy.inputDir` is absent, keyframes and reference images are uploaded through ComfyUI's `/upload/image` endpoint. `comfy.gpu` therefore refuses `comfy.inputDir` and `comfy.url` at load, because the instance supplies the address and the process cannot write a remote directory.

The token reference is the part of the row the `./settings` overlay owns: the Plugins card edits `gpuApiTokenRef` and writes the secret through the credentials domain, while the compute specification, boot image, instance name, and start command stay in the composition. The token resolves through `ctx.credentials` on every request, so a rotated credential takes effect without reloading the composition. A literal `apiToken` exists for test setups.

Three service methods and the `video_gpu` tool expose the lifecycle to the model: `gpuStatus` (refreshing the vendor state when an instance is tracked), `gpuUp` (boot or reuse, waiting for ComfyUI), and `gpuDown('stop' | 'release')`. A local `video_render` boots the instance implicitly; `video_gpu up` only surfaces a boot failure earlier.

## Alternatives considered

- **Give the ComfyUI provider vendor calls.** Rejected: the provider would carry AutoDL's envelope, endpoints, and boot choreography, and a second backend would duplicate them. The pool owns the lifecycle and the provider only asks for an origin.
- **Require a pre-started instance and keep `comfy.url`.** Rejected: the operator keeps paying between renders and repeats the manual create/release chore, which is the problem this note exists for.
- **Fall back to the hosted API when the boot fails.** Rejected: the hosted backend bills per second, and the composition's contract is that no call path switches cost models implicitly. A failed boot fails the segment with a model-safe reason.
- **A separate cloud-GPU package.** Deferred: one consumer exists today, and a package boundary would add a manifest, aggregate entry, and documentation for a seam with a single implementation. `GpuVendor` keeps the vendor swap inside `h3-video` until a second consumer appears.
- **Send AutoDL's snapshot and status as GET with a JSON body.** Rejected: the standard forbids it and the global `fetch` throws; the live API accepts the fields as query parameters.
- **Release on idle by default.** Rejected: release destroys the instance disk, so the default stops the instance and leaves deletion to the explicit action or `releaseOnDispose`.

## Consequences

- A local render can run on hardware this machine does not have. The first submission of a render waits for create, boot, and ComfyUI readiness (bounded by `bootTimeoutMs`), so a render's first `job_output` arrives later than the generation time alone.
- Cost control is explicit: the idle timer starts when the last task settles, and a literal policy decides between stopping and releasing. A crashed process leaves at most one instance until an operator or the next `video_gpu` call acts on it.
- New failure modes reach the model: no stock, a boot timeout, a boot command that never starts ComfyUI, and a missing token all fail the local submission with a reason naming the instance.
- Image conditioning changed shape for remote servers: `/upload/image` is now a second upload path, and the `comfy.inputDir` known limitation narrowed to local deployments.
- The configuration surface grew by one row. The AutoDL instance name is account-global, so two harness processes sharing an account and `instanceName` reuse the same instance instead of owning one each.

## References

- [AutoDL container-instance Pro API](https://api.autodl.com/docs/instance_pro_api/) — create, snapshot, status, list, power on/off, release, and the compute-spec table.
- [AutoDL API authentication](https://api.autodl.com/docs/common_api/) — the `Authorization` header carrying the developer token.
- [H3 video generation tools](2026-09-29-h3-video-generation-tools.md) — the seam, its providers, and the materials-first flow this extends.
