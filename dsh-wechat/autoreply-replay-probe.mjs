// -*- coding: utf-8 -*-
/**Replay probe: rewind the watermark so the poll loop replays the latest
 * real inbound message end-to-end (real DB read → real prompt → send path).
 * Sends are blocked; nothing reaches WeChat.
 * node autoreply-replay-probe.mjs [chat] */

import { createSidecar } from './index.mjs';
import { createAutoReply } from './autoreply.mjs';

const WATCHED = process.argv[2] ?? '阿威宇宙';
const quiet = { info: () => {}, warn: () => {}, error: console.error };

const prompts = [];
let lastRequestId = 'x';
const turnEvents = []; // filled only after a prompt is accepted
const gateway = {
  async invoke({ namespace, method, args }) {
    if (namespace === 'workspace') {
      if (method === 'list') return { items: [{ path: 'D:/probe', workspaceId: 'ws-probe' }] };
      if (method === 'create') return { workspace: { workspaceId: 'ws-probe' } };
    }
    if (namespace === 'session') {
      if (method === 'create') return { sessionId: 'probe-session' };
      if (method === 'history') {
        return { events: [...turnEvents] };
      }
      if (method === 'prompt') {
        lastRequestId = args.requestId;
        prompts.push(args.content?.[0]?.text ?? '');
        turnEvents.length = 0;
        turnEvents.push(
          { seq: 1, type: 'turn/start', data: { turn: 't1' } },
          { seq: 2, type: 'user/message', data: { source: { rpcId: lastRequestId } } },
          { seq: 3, type: 'assistant/message', data: { turn: 't1', message: { content: [{ type: 'text', text: '【已记录，不发送】' }] } } },
          { seq: 4, type: 'turn/end', data: { turn: 't1', reason: { kind: 'completed' } } },
        );
        return { accepted: true };
      }
    }
    throw new Error(`unexpected ${namespace}.${method}`);
  },
};

const realSidecar = createSidecar({ logger: quiet });
let sendReached = false;
const guardSidecar = {
  async call(tool, args, timeout) {
    if (tool === 'wechat_send') {
      sendReached = true;
      console.log('REACHED-SEND (blocked):', JSON.stringify(args).slice(0, 100));
      return JSON.stringify({ sent: false, blocked: true });
    }
    return realSidecar.call(tool, args, timeout);
  },
  dispose: () => {},
};

const autoReply = createAutoReply({
  sidecar: guardSidecar,
  gateway,
  chats: [WATCHED],
  logger: quiet,
  groupOnlyWhenMentioned: false,
  prepareWorkspace: async () => {},
});

await autoReply.tickOnce(); // baseline at the current highest seq

const latest = JSON.parse(await realSidecar.call('wechat_messages', { chat: WATCHED, limit: 10 }));
const inbound = latest.items.filter((m) => !m.is_self && m.content);
if (inbound.length === 0) {
  console.log('NO_INBOUND_MESSAGE_TO_REPLAY');
  await realSidecar.dispose();
  process.exit(1);
}
const target = inbound.at(-1);
console.log('replaying real message seq', target.seq, 'from', target.sender, ':', String(target.content).slice(0, 40));
await autoReply.debugRewind(WATCHED, target.seq - 1);
await autoReply.tickOnce();

console.log('captured prompts:', prompts.length);
console.log('send reached:', sendReached);
console.log('--- prompt head ---');
console.log((prompts[0] ?? '(none)').slice(0, 300));
await realSidecar.dispose();
console.log(prompts.length > 0 && sendReached ? 'REPLAY_PROBE_OK' : 'REPLAY_PROBE_FAILED');
