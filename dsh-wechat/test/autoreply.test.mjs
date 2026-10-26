import assert from 'node:assert/strict';
import test from 'node:test';

import { createMiniHarnessClient, createAutoReply } from '../autoreply.mjs';

let sessionSeq = 100;

/** Fake typertGateway: one scripted turn per prompt. */
function fakeGateway({ reply = '自动回复内容', failTurn = false } = {}) {
  const prompts = [];
  const sessions = [];
  const created = [];
  let nextSeq = 1;
  const makeEvent = (type, data) => ({ seq: nextSeq++, type, data });
  const gateway = {
    prompts,
    sessions,
    async invoke({ namespace, method, args }) {
      if (namespace === 'workspace') {
        if (method === 'list') return { items: [] };
        if (method === 'create') {
          const workspaceId = `ws-${created.length + 1}`;
          created.push({ path: args.path, workspaceId });
          return { workspace: { workspaceId } };
        }
      }
      if (namespace === 'session') {
        if (method === 'create') {
          const sessionId = `session-${sessionSeq++}`;
          sessions.push({ sessionId, workspaceId: args.workspaceId, events: [] });
          return { sessionId };
        }
        const session = sessions.find((entry) => entry.sessionId === args.sessionId);
        if (!session) throw new Error(`unknown session ${args.sessionId}`);
        if (method === 'history') {
          return { events: [...session.events] };
        }
        if (method === 'prompt') {
          prompts.push(args);
          session.events.push(makeEvent('turn/start', { turn: 't1' }));
          session.events.push(makeEvent('user/message', {
            source: { kind: 'user', rpcId: args.requestId },
            message: {},
          }));
          session.events.push(makeEvent('assistant/message', {
            turn: 't1',
            message: { content: [{ type: 'text', text: reply }] },
          }));
          session.events.push(makeEvent('turn/end', {
            turn: 't1',
            reason: failTurn ? { kind: 'failed' } : { kind: 'completed' },
          }));
          return { accepted: true };
        }
      }
      throw new Error(`unexpected gateway call ${namespace}.${method}`);
    },
  };
  return gateway;
}

/** Fake sidecar with a scripted inbox per chat. */
function fakeSidecar({ inbox = {}, selfNickname = '小呆' } = {}) {
  const calls = [];
  const sent = [];
  const state = new Map(); // chat → { watermark, deliver }
  const sidecar = {
    calls,
    sent,
    inbox,
    addMessages(chat, messages) {
      const entry = state.get(chat) ?? { watermark: null, log: [] };
      for (const message of messages) entry.log.push(message);
      state.set(chat, entry);
      inbox[chat] = entry;
    },
    async call(tool, args) {
      calls.push({ tool, args });
      if (tool === 'wechat_doctor') {
        return JSON.stringify({ account: { nickname: selfNickname } });
      }
      if (tool === 'wechat_messages') {
        const entry = inbox[args.chat];
        const since = Number(args.since_seq) || 0;
        const items = (entry?.log ?? [])
          .filter((message) => (Number(message.seq) || 0) > since)
          .sort((left, right) => left.seq - right.seq);
        return JSON.stringify({
          chat: args.chat.includes('@chatroom') ? args.chat : `wxid_${args.chat}`,
          items,
        });
      }
      if (tool === 'wechat_send') {
        sent.push({ to: args.to, text: args.text });
        return JSON.stringify({ sent: true, to: args.to });
      }
      throw new Error(`unexpected sidecar tool ${tool}`);
    },
    async dispose() {},
  };
  return sidecar;
}

const quietLogger = { info() {}, warn() {}, error() {} };

test('mini harness client resolves a workspace, creates a session, and polls one reply', async () => {
  const gateway = fakeGateway({ reply: '你好，收到' });
  const client = createMiniHarnessClient({ gateway });
  const workspaceId = await client.workspaceIdFor('D:/ws');
  assert.equal(workspaceId, 'ws-1');
  const sessionId = await client.createSession({ workspaceId });
  const answer = await client.ask(sessionId, '在吗', { pollMs: 1 });
  assert.equal(answer, '你好，收到');
  const prompt = gateway.prompts[0];
  assert.equal(prompt.mode, 'queue');
  assert.equal(prompt.content[0].text, '在吗');
  assert.match(prompt.requestId, /^dsh-wechat-ar-/);
});

test('mini harness client surfaces a failed turn', async () => {
  const gateway = fakeGateway({ failTurn: true });
  const client = createMiniHarnessClient({ gateway });
  const workspaceId = await client.workspaceIdFor('D:/ws');
  const sessionId = await client.createSession({ workspaceId });
  await assert.rejects(client.ask(sessionId, 'x', { pollMs: 1 }), /did not complete/);
});

test('auto-reply skips history on the first poll, then answers new messages once', async () => {
  const sidecar = fakeSidecar();
  sidecar.addMessages('张三', [
    { seq: 10, is_self: false, content: '旧消息', sender: '张三' },
  ]);
  const autoReply = createAutoReply({
    sidecar,
    gateway: fakeGateway({ reply: '回复：好的' }),
    chats: ['张三'],
    logger: quietLogger,
    prepareWorkspace: async () => {},
  });

  await autoReply.tickOnce(); // baseline
  assert.deepEqual(sidecar.sent, []);

  sidecar.addMessages('张三', [
    { seq: 11, is_self: false, content: '在吗？', sender: '张三' },
  ]);
  await autoReply.tickOnce();
  assert.deepEqual(sidecar.sent, [{ to: '张三', text: '回复：好的' }]);

  await autoReply.tickOnce(); // watermark already past seq 11: no double reply
  assert.equal(sidecar.sent.length, 1);
  autoReply.stop();
});

test('auto-reply never answers its own outgoing messages', async () => {
  const sidecar = fakeSidecar();
  sidecar.addMessages('张三', [{ seq: 10, is_self: false, content: '基线', sender: '张三' }]);
  const autoReply = createAutoReply({
    sidecar,
    gateway: fakeGateway(),
    chats: ['张三'],
    logger: quietLogger,
    prepareWorkspace: async () => {},
  });
  await autoReply.tickOnce();
  // Only the bot's own reply arrived since the watermark.
  sidecar.addMessages('张三', [{ seq: 11, is_self: true, content: '回复：好的', sender: '我' }]);
  await autoReply.tickOnce();
  assert.deepEqual(sidecar.sent, []);
  autoReply.stop();
});

test('auto-reply only answers mentioned messages in groups when configured', async () => {
  const sidecar = fakeSidecar({ selfNickname: '小呆' });
  sidecar.addMessages('产品群', [{ seq: 1, is_self: false, content: '基线', sender: 'a' }]);
  const autoReply = createAutoReply({
    sidecar,
    gateway: fakeGateway(),
    chats: ['123@chatroom'],
    logger: quietLogger,
    prepareWorkspace: async () => {},
  });
  // Register the chatroom payload: addMessages keys must match the watched name.
  sidecar.addMessages('123@chatroom', [{ seq: 1, is_self: false, content: '基线', sender: 'a' }]);
  await autoReply.tickOnce();

  sidecar.addMessages('123@chatroom', [
    { seq: 2, is_self: false, content: '普通聊天不回', sender: 'a' },
  ]);
  await autoReply.tickOnce();
  assert.deepEqual(sidecar.sent, []);

  sidecar.addMessages('123@chatroom', [
    { seq: 3, is_self: false, content: '@小呆 帮我查一下', sender: 'b' },
  ]);
  await autoReply.tickOnce();
  assert.equal(sidecar.sent.length, 1);
  assert.equal(sidecar.sent[0].to, '123@chatroom');
  autoReply.stop();
});

test('auto-reply rejects tight polling and empty chat lists at construction', async () => {
  const sidecar = fakeSidecar();
  assert.throws(() => createAutoReply({
    sidecar, gateway: fakeGateway(), chats: ['x'], pollIntervalMs: 5_000, logger: quietLogger,
  }), /pollIntervalMs/);
  assert.throws(() => createAutoReply({
    sidecar, gateway: fakeGateway(), chats: [], logger: quietLogger,
  }), /chats/);
});

test('auto-reply keeps polling other chats after one chat fails', async () => {
  const sidecar = fakeSidecar();
  const failingSidecar = {
    ...sidecar,
    async call(tool, args) {
      if (args.chat === '坏会话') throw new Error('sidecar down');
      return sidecar.call(tool, args);
    },
  };
  sidecar.addMessages('张三', [{ seq: 10, is_self: false, content: '基线', sender: '张三' }]);
  const autoReply = createAutoReply({
    sidecar: failingSidecar,
    gateway: fakeGateway({ reply: '收到' }),
    chats: ['坏会话', '张三'],
    logger: quietLogger,
    prepareWorkspace: async () => {},
  });
  await autoReply.tickOnce();
  sidecar.addMessages('张三', [{ seq: 11, is_self: false, content: '你好', sender: '张三' }]);
  await autoReply.tickOnce();
  assert.deepEqual(sidecar.sent, [{ to: '张三', text: '收到' }]);
  autoReply.stop();
});
