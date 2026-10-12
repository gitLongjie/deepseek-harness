import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import test from 'node:test';

import { createSidecar, installWechatTools } from '../index.mjs';

/** Minimal fake child process speaking the line-JSON sidecar protocol. */
function fakeSpawn(handlers = {}) {
  const calls = [];
  const spawnImpl = (command, args) => {
    const proc = new EventEmitter();
    proc.stdin = new PassThrough();
    proc.stdout = new PassThrough();
    proc.stderr = new PassThrough();
    proc.kill = () => {
      proc.emit('exit', null);
      return true;
    };
    proc.stdin.setEncoding('utf8');
    proc.stdin.on('data', (chunk) => {
      for (const line of String(chunk).split('\n')) {
        if (!line.trim()) continue;
        const request = JSON.parse(line);
        calls.push(request);
        // A falsy reply means "stay silent" (simulates a hung sidecar).
        const reply = handlers.onRequest
          ? handlers.onRequest(request)
          : { ok: true, result: 'ok' };
        if (!reply) continue;
        proc.stdout.write(`${JSON.stringify({ id: request.id, ...reply })}\n`);
      }
    });
    queueMicrotask(() => proc.emit('spawn'));
    return proc;
  };
  return { spawnImpl, calls };
}

test('sidecar round-trips one request per line and serializes calls', async () => {
  const fake = fakeSpawn();
  const sidecar = createSidecar({ spawnImpl: fake.spawnImpl, logger: { warn() {} } });

  assert.equal(await sidecar.call('wechat_doctor', {}), 'ok');
  assert.deepEqual(fake.calls, [{ id: 1, tool: 'wechat_doctor', args: {} }]);

  const replies = await Promise.all([
    sidecar.call('wechat_contacts', { kind: 'group' }),
    sidecar.call('wechat_messages', { chat: 'a' }),
  ]);
  assert.deepEqual(replies, ['ok', 'ok']);
  assert.deepEqual(fake.calls.map((call) => call.tool), ['wechat_doctor', 'wechat_contacts', 'wechat_messages']);
  await sidecar.dispose();
});

test('sidecar rejects an error reply and a timeout', async () => {
  const fake = fakeSpawn({
    onRequest: (request) => (request.tool === 'wechat_send'
      ? { id: request.id, ok: false, error: 'ValueError: 消息内容不能为空' }
      : null),
  });
  const sidecar = createSidecar({ spawnImpl: fake.spawnImpl, logger: { warn() {} } });
  await assert.rejects(
    sidecar.call('wechat_send', { to: 'x', text: '' }),
    /消息内容不能为空/,
  );
  const silent = fakeSpawn({ onRequest: () => false });
  const slow = createSidecar({ spawnImpl: silent.spawnImpl, timeoutMs: 50, logger: { warn() {} } });
  await assert.rejects(slow.call('wechat_doctor', {}), /timed out after 50ms/);
  await Promise.allSettled([sidecar.dispose(), slow.dispose()]);
});

test('sidecar ignores unparseable lines and rejects after an unexpected exit', async () => {
  let once = true;
  const fake = fakeSpawn({
    onRequest: (request) => {
      if (once) {
        once = false;
        return { id: request.id, ok: true, result: 'first' };
      }
      return null;
    },
  });
  const sidecar = createSidecar({ spawnImpl: fake.spawnImpl, timeoutMs: 150, logger: { warn() {} } });
  assert.equal(await sidecar.call('wechat_doctor', {}), 'first');
  await assert.rejects(sidecar.call('wechat_contacts', {}), /timed out|exited unexpectedly/);
  await sidecar.dispose();
});

test('sidecar surfaces a startup failure and recovers on the next call', async () => {
  let broken = true;
  const spawnImpl = () => {
    const proc = new EventEmitter();
    proc.stdin = new PassThrough();
    proc.stdout = new PassThrough();
    proc.stderr = new PassThrough();
    proc.kill = () => true;
    queueMicrotask(() => {
      if (broken) proc.emit('error', new Error('python not found'));
      else proc.emit('spawn');
    });
    return proc;
  };
  const sidecar = createSidecar({ spawnImpl, logger: { warn() {}, error() {} } });
  await assert.rejects(sidecar.call('wechat_doctor', {}), /python not found/);
  broken = false;
  const fake = fakeSpawn();
  // A later successful start must be possible after an earlier failure.
  const recovered = createSidecar({ spawnImpl: fake.spawnImpl, logger: { warn() {} } });
  assert.equal(await recovered.call('wechat_doctor', {}), 'ok');
  await Promise.allSettled([sidecar.dispose(), recovered.dispose()]);
});

test('installWechatTools registers five tools and the prompt section once', async () => {
  const fake = fakeSpawn({
    onRequest: (request) => (request.args && request.args.text === ''
      ? { ok: false, error: 'ValueError: 消息内容不能为空' }
      : { ok: true, result: 'ok' }),
  });
  const sidecar = createSidecar({ spawnImpl: fake.spawnImpl, logger: { warn() {} } });
  const registered = [];
  const sections = [];
  const effects = [];
  const ctx = {
    tools: { register: (definition) => registered.push(definition) },
    systemPrompt: { section: (section) => sections.push(section) },
    effect: (dispose) => {
      effects.push(dispose);
      return dispose;
    },
  };
  const dispose = installWechatTools(ctx, { sidecar });
  assert.deepEqual(
    registered.map((definition) => definition.name).sort(),
    ['wechat_contacts', 'wechat_doctor', 'wechat_group_members', 'wechat_messages', 'wechat_send'],
  );
  assert.equal(sections.length, 1);
  assert.equal(sections[0].name, 'dsh-wechat:tools');
  assert.equal(effects.length, 1);

  const contacts = registered.find((definition) => definition.name === 'wechat_contacts');
  const result = await contacts.execute({ kind: 'group', page: 1 });
  assert.equal(result, 'ok');
  const send = registered.find((definition) => definition.name === 'wechat_send');
  await assert.rejects(send.execute({ to: 'x', text: '' }), /消息内容不能为空|sidecall failed/);
  dispose();
  await sidecar.dispose();
});

test('installWechatTools is a no-op without host tool services', () => {
  const sidecar = createSidecar({ logger: { warn() {} } });
  const dispose = installWechatTools({}, { sidecar });
  assert.equal(typeof dispose, 'function');
  return sidecar.dispose();
});
