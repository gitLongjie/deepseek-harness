/**
 * Connect to this Host directly unless an external Harness URL was configured.
 * The local carrier adapts the current Connection/Typert Gateway services to
 * the stable HarnessClient carrier expected by channel implementations.
 */
export function harnessConnection(ctx, config = {}) {
  if (config.harnessBaseUrl !== undefined) {
    return { baseUrl: new URL(config.harnessBaseUrl) };
  }
  // Cordis contexts throw on a property read for an un-injected service, so
  // the legacy apiProxy half is probed behind a catch instead of a truthiness
  // check on the accessor itself.
  const legacyApiProxy = readApiProxy(ctx);
  if (legacyApiProxy) {
    return {
      apiProxy: legacyApiProxy,
      interactionScope: ctx.root ?? ctx,
    };
  }
  return {
    apiProxy: createApiProxyAdapter(ctx),
    // Cordis child contexts share one root; different Hosts must not share
    // ownership of pending questions and approvals.
    interactionScope: ctx.root ?? ctx,
  };
}

/** Adapt the current Host transport after the ApiProxy service was removed. */
/** Read the legacy apiProxy service without tripping Cordis's un-injected accessor. */
function readApiProxy(ctx) {
  if (ctx === undefined || ctx === null) return undefined;
  try {
    return ctx.apiProxy;
  } catch {
    return undefined;
  }
}

export function createApiProxyAdapter(ctx) {
  const gateway = ctx?.typertGateway;
  if (!gateway || typeof gateway.invoke !== 'function' || typeof gateway.wireStream?.open !== 'function') {
    throw new TypeError('dsh-im requires the Host typertGateway service; check that DSH has finished loading its Host services');
  }
  const invoke = (namespace, method) => async ({ rpcId, payload } = {}, signal) => {
    try {
      return {
        rpcId,
        result: { ok: true, value: await gateway.invoke({ namespace, method, args: payload ?? {}, signal }) },
      };
    } catch (error) {
      return {
        rpcId,
        result: { ok: false, error: transportError(error) },
      };
    }
  };
  const namespaces = {
    host: {},
    workspace: {},
    sessions: {},
    llm: {},
  };
  const methods = {
    host: ['describe'],
    workspace: ['list', 'create', 'rename', 'delete', 'insertBefore', 'insertSessionBefore', 'archiveSession'],
    sessions: ['list', 'search', 'create', 'history', 'models', 'selectModel', 'rename', 'fork', 'prompt', 'attachment', 'updateQueue', 'cancel'],
    llm: ['models'],
  };
  for (const [namespace, names] of Object.entries(methods)) {
    for (const method of names) {
      const wireNamespace = namespace === 'sessions' ? 'session' : namespace;
      namespaces[namespace][method] = invoke(wireNamespace, method);
    }
  }
  return {
    ...namespaces,
    respond: async () => ({ accepted: false, reason: 'not-pending' }),
    events: {
      mux: (_request, signal) => adaptEventStream(
        gateway.wireStream.open('$events', { args: {} }, signal),
        signal,
      ),
    },
  };
}

async function* adaptEventStream(streamPromise, signal) {
  const stream = await streamPromise;
  for await (const frame of stream) {
    if (signal?.aborted) return;
    if (frame?.type === 'emit') {
      yield { rpcId: '', payload: { type: frame.event, ...arrayPayload(frame.args) } };
    } else if (frame?.type === 'waterfall') {
      yield { rpcId: frame.eventId, payload: { type: frame.event, ...frame.request } };
    }
  }
}

function arrayPayload(args) {
  if (!Array.isArray(args)) return {};
  return args.reduce((payload, value, index) => {
    payload[index] = value;
    return payload;
  }, {});
}

function transportError(error) {
  return {
    code: typeof error?.code === 'string' ? error.code : 'internal',
    message: error instanceof Error ? error.message : String(error),
    details: error?.details && typeof error.details === 'object' ? error.details : {},
  };
}
