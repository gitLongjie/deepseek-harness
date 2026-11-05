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

/** Read the legacy apiProxy service without tripping Cordis's un-injected accessor. */
function readApiProxy(ctx) {
  if (ctx === undefined || ctx === null) return undefined;
  try {
    return ctx.apiProxy;
  } catch {
    return undefined;
  }
}

/** The shared owner Peer. Cordis throws when `connection` was not injected. */
function readOwnerPeer(ctx) {
  try {
    const peer = ctx?.connection?.browserPeer;
    if (peer && typeof peer === 'object' && peer.signal) return peer;
  } catch {
    return undefined;
  }
  return undefined;
}

const EMPTY_UPLINK = {
  [Symbol.asyncIterator]() {
    return {
      next: () => Promise.resolve({ done: true, value: undefined }),
      return: () => Promise.resolve({ done: true, value: undefined }),
    };
  },
};

/** Session.list names its only JSON argument `_request`; every other request uses `request`. */
function requestArgs(method, payload) {
  return { [method === 'list' ? '_request' : 'request']: payload ?? {} };
}

/**
 * Adapt the current Host Typert Gateway to the HarnessClient carrier.
 * The plugin already runs inside the Host, so readiness does not call a
 * `host.describe` Remote. Session and Workspace calls pass the owner Peer
 * and one named request object.
 */
export function createApiProxyAdapter(ctx) {
  const gateway = ctx?.typertGateway;
  if (!gateway || typeof gateway.invoke !== 'function'
    || typeof gateway.stream !== 'function'
    || typeof gateway.wireStream?.open !== 'function') {
    throw new TypeError('dsh-im requires the Host typertGateway service; check that DSH has finished loading its Host services');
  }
  const peer = readOwnerPeer(ctx);
  if (!peer) {
    throw new TypeError('dsh-im requires the Host connection owner Peer');
  }
  const accepted = (rpcId, value) => ({ rpcId, result: { ok: true, value } });
  const rejected = (rpcId, error) => ({ rpcId, result: { ok: false, error: transportError(error) } });
  const call = (namespace, method, args, signal) => gateway.invoke({
    namespace, method, args, peer, signal,
  });
  const invoke = (namespace, method) => async ({ rpcId, payload } = {}, signal) => {
    try {
      return accepted(rpcId, await call(namespace, method, requestArgs(method, payload), signal));
    } catch (error) {
      return rejected(rpcId, error);
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
  namespaces.host.describe = async ({ rpcId } = {}) => accepted(rpcId, { ready: true });
  namespaces.workspace.list = async ({ rpcId } = {}, signal) => {
    const controller = new AbortController();
    const joined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    let baseline;
    try {
      const stream = await gateway.stream({
        namespace: 'workspace',
        method: 'follow',
        args: {},
        peer,
        signal: joined,
      });
      for await (const frame of stream) {
        if (frame?.type === 'baseline') {
          baseline = frame.value;
          break;
        }
      }
    } catch (error) {
      if (baseline === undefined) return rejected(rpcId, error);
    } finally {
      controller.abort();
    }
    return baseline === undefined
      ? rejected(rpcId, new Error('Workspace follow returned no baseline'))
      : accepted(rpcId, baseline);
  };
  namespaces.sessions.history = async ({ rpcId, payload } = {}, signal) => {
    try {
      const request = { address: { kind: 'session', sessionId: payload?.sessionId } };
      if (payload?.maxMessages !== undefined) request.maxMessages = payload.maxMessages;
      if (payload?.beforeSeq !== undefined) request.beforeSeq = payload.beforeSeq;
      const page = await call('session', 'events', { request }, signal);
      const records = Array.isArray(page?.records) ? page.records : [];
      const events = records.flatMap((record) => (
        record?.type === 'event' && record.event && typeof record.event === 'object'
          ? [record.event]
          : []
      ));
      return accepted(rpcId, { events });
    } catch (error) {
      return rejected(rpcId, error?.code === 'session/not-found'
        ? Object.assign(new Error(error.message), { code: 'session-not-found', details: error.details ?? {} })
        : error);
    }
  };
  namespaces.sessions.prompt = async ({ rpcId, payload } = {}, signal) => {
    try {
      const request = { ...(payload ?? {}) };
      if (request.requestId === undefined && typeof rpcId === 'string' && rpcId) {
        request.requestId = rpcId;
      }
      return accepted(rpcId, await call('session', 'prompt', { request }, signal));
    } catch (error) {
      return rejected(rpcId, error);
    }
  };
  return {
    ...namespaces,
    respond: async () => ({ accepted: false, reason: 'not-pending' }),
    events: {
      mux: (_request, signal) => adaptEventStream(
        gateway.wireStream.open('$events', { args: {} }, EMPTY_UPLINK, peer, signal),
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
