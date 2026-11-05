import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';

import { createApiProxyAdapter, harnessConnection } from '../plugin-src/host/harness-connection.mjs';
import { inject as hostInject } from '../plugin-src/host/index.mjs';

const IM_CHANNELS = [
  'weixin', 'feishu', 'dingtalk', 'wecom', 'qq',
  'slack', 'telegram', 'discord', 'whatsapp',
];
const TEST_WORKSPACE = resolve('/test/workspace');

test('Host connections share the current Cordis root without depending on a webServer', () => {
  const root = {};
  const apiProxy = {};
  const first = harnessConnection({ root, apiProxy });
  const second = harnessConnection({ root, apiProxy });
  assert.deepEqual(first, { apiProxy, interactionScope: root });
  assert.equal(first.interactionScope, second.interactionScope);
  assert.notEqual(first.interactionScope, harnessConnection({ root: {}, apiProxy }).interactionScope);

  const fixtureContext = { apiProxy };
  assert.equal(harnessConnection(fixtureContext).interactionScope, fixtureContext);
});

test('an explicit Harness URL preserves HTTP transport and never reads the Host apiProxy', () => {
  const ctx = { get apiProxy() { throw new Error('must not read local apiProxy'); } };
  const connection = harnessConnection(ctx, { harnessBaseUrl: 'https://harness.example/base/' });
  assert.equal(connection.baseUrl.href, 'https://harness.example/base/');
  assert.deepEqual(Object.keys(connection), ['baseUrl']);
  assert.throws(() => harnessConnection(ctx, { harnessBaseUrl: 'not a URL' }), TypeError);
});

test('a missing Host gateway fails clearly instead of silently falling back to localhost', () => {
  assert.throws(
    () => harnessConnection({ webServer: { port: 3080 } }),
    /requires the Host typertGateway service/,
  );
});

test('the current Connection/Typert Gateway services provide the local HarnessClient carrier', async () => {
  const calls = [];
  const peer = { signal: new AbortController().signal };
  const baseline = { items: [{ path: 'E:\\work', sessionIds: [] }], archivedSessionIds: [], pinnedSessionIds: [] };
  const gateway = {
    async invoke(request) {
      calls.push(request);
      if (request.method === 'events') {
        if (request.args?.request?.address?.sessionId === 'gone') {
          const error = new Error('session "gone" not found');
          error.code = 'session/not-found';
          throw error;
        }
        return { records: [{ type: 'event', event: { type: 'turn/start', seq: 1 } }] };
      }
      return { accepted: true };
    },
    async stream(request) {
      calls.push(request);
      return (async function* () {
        yield { type: 'baseline', value: baseline };
      })();
    },
    wireStream: {
      open(endpoint, payload, uplink, openedPeer, signal) {
        calls.push({ endpoint, payload, uplink, peer: openedPeer, signal });
        return (async function* () {})();
      },
    },
  };
  const adapter = createApiProxyAdapter({
    typertGateway: gateway,
    connection: { browserPeer: peer },
  });
  const described = await adapter.host.describe({ rpcId: 'health' });
  assert.deepEqual(described.result, { ok: true, value: { ready: true } });
  const listed = await adapter.workspace.list({ rpcId: 'rpc-1', payload: {} }, new AbortController().signal);
  assert.deepEqual(listed.result, { ok: true, value: baseline });
  const prompted = await adapter.sessions.prompt({
    rpcId: 'prompt-1',
    payload: { sessionId: 'session-1', mode: 'queue', content: [{ type: 'text', text: 'hi' }] },
  });
  assert.deepEqual(prompted.result, { ok: true, value: { accepted: true } });
  const history = await adapter.sessions.history({
    rpcId: 'history-1',
    payload: { sessionId: 'session-1', maxMessages: 20 },
  });
  assert.deepEqual(history.result, { ok: true, value: { events: [{ type: 'turn/start', seq: 1 }] } });
  const listedSessions = await adapter.sessions.list({ rpcId: 'sessions-1', payload: {} });
  assert.equal(listedSessions.result.ok, true);
  assert.deepEqual(calls.map((call) => ({
    namespace: call.namespace,
    method: call.method,
    args: call.args,
    peer: call.peer,
  })), [
    { namespace: 'workspace', method: 'follow', args: {}, peer },
    {
      namespace: 'session',
      method: 'prompt',
      args: {
        request: {
          sessionId: 'session-1',
          mode: 'queue',
          content: [{ type: 'text', text: 'hi' }],
          requestId: 'prompt-1',
        },
      },
      peer,
    },
    {
      namespace: 'session',
      method: 'events',
      args: { request: { address: { kind: 'session', sessionId: 'session-1' }, maxMessages: 20 } },
      peer,
    },
    { namespace: 'session', method: 'list', args: { _request: {} }, peer },
  ]);
  const missing = await adapter.sessions.history({ rpcId: 'missing', payload: { sessionId: 'gone' } });
  assert.equal(missing.result.ok, false);
  assert.equal(missing.result.error.code, 'session-not-found');
});

test('a gateway without the owner Peer fails before any Remote call', () => {
  assert.throws(
    () => createApiProxyAdapter({
      typertGateway: {
        invoke() {},
        stream() {},
        wireStream: { open() {} },
      },
    }),
    /owner Peer/,
  );
});

test('Host and all IM channel plugins wait for the Typert Gateway rather than a webServer', async () => {
  assert.ok(hostInject.includes('typertGateway'));
  assert.equal(hostInject.includes('apiProxy'), false);
  assert.equal(hostInject.includes('webServer'), false);
  for (const channel of IM_CHANNELS) {
    const { inject } = await import(`../plugin-src/host/channels/${channel}/index.mjs`);
    assert.ok(inject.includes('typertGateway'), channel);
    assert.equal(inject.includes('apiProxy'), false, channel);
    assert.equal(inject.includes('webServer'), false, channel);
  }
});

async function assembledHarness(channel, ctx, config = {}) {
  const { createProductionController } = await import(
    `../plugin-src/host/channels/${channel}/production.mjs`
  );
  const constructed = {};
  class ConfigStore {
    async load() { return this; }
    list() { return []; }
  }
  class Harness {
    constructor(options) { constructed.harness = options; }
    stopManagedProcess() {}
  }
  class Controller {
    constructor(options) { constructed.controller = options; }
    async initialize() {}
    async close() {}
  }
  class Runtime {
    constructor(options) { constructed.runtime = options; }
  }
  const production = await createProductionController(ctx, {
    workspace: TEST_WORKSPACE,
    ...config,
  }, {
    ConfigStore,
    HarnessClient: Harness,
    Controller,
    Runtime,
    FeishuRuntime: Runtime,
    api: {},
    deviceAuth: {},
    qrAuth: {},
    lark: {},
    proxyEnv: {},
    workspaces: {
      async reconcile() {},
      async ensure() {},
      decorateStatus(value) { return value; },
    },
    createConnectionSupervisor: () => ({
      ready: Promise.resolve(),
      start() { return this; },
      async close() {},
    }),
  });
  try {
    if (channel === 'office') {
      constructed.controller.createRuntime({});
      constructed.runtime.createHarness({ workspace: TEST_WORKSPACE });
    }
    return constructed.harness;
  } finally {
    await production.close();
  }
}

for (const channel of [...IM_CHANNELS, 'office']) {
  test(`${channel} production uses its Host gateway with no webServer or listening port`, async () => {
    const apiProxy = {};
    const root = {};
    const options = await assembledHarness(channel, { credentials: {}, apiProxy, root });
    assert.equal(options.apiProxy, apiProxy);
    assert.equal(options.interactionScope, root);
    assert.equal(Object.hasOwn(options, 'baseUrl'), false);
    assert.equal(options.workspace, TEST_WORKSPACE);
    assert.equal(options.autostart, false);
  });

  test(`${channel} production preserves an explicitly configured Harness URL`, async () => {
    const options = await assembledHarness(channel, {
      credentials: {},
      get apiProxy() { throw new Error('explicit URL must not use local apiProxy'); },
    }, { harnessBaseUrl: 'http://127.0.0.1:43210/custom/' });
    assert.equal(options.baseUrl.href, 'http://127.0.0.1:43210/custom/');
    assert.equal(Object.hasOwn(options, 'apiProxy'), false);
    assert.equal(Object.hasOwn(options, 'interactionScope'), false);
    assert.equal(options.autostart, false);
  });
}
