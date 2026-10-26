// -*- coding: utf-8 -*-
/**Zero-disturbance live probe: watch one active group, record prompts,
 * never send anything back to WeChat.  node autoreply-live-probe.mjs */

import { createSidecar } from './index.mjs';
import { createAutoReply } from './autoreply.mjs';

const WATCHED = process.argv[2] ?? '阿威宇宙';
const quiet = { info: (...a) => console.log('[info]', ...a), warn: () => {}, error: console.error };

const prompts = [];
const gateway = {
  async invoke({ namespace, method, args }) {
    if (namespace === 'workspace') {
      if (method === 'list') return { items: [{ path: 'D:/probe', workspaceId: 'ws-probe' }] };
      if (method === 'create') return { workspace: { workspaceId: 'ws-probe' } };
    }
    if (namespace === 'session') {
      if (method === 'create') return { sessionId: 'probe-session' };
      if (method === 'history') {
        return { events: [
          { seq: 1, type: 'turn/start', data: { turn: 't1' } },
          { seq: 2, type: 'user/message', data: { source: { rpcId: args.lastRequestId } } },
          { seq: 3, type: 'assistant/message', data: { turn: 't1', message: { content: [{ type: 'text', text: '【已记录，不发送】' }] } } },
          { seq: 4, type: 'turn/end', data: { turn: 't1', reason: { kind: 'completed' } } },
        ] };
      }
      if (method === 'prompt') {
        prompts.push(args.content?.[0]?.text ?? '');
        this.lastRequestId = args.requestId;
        return { accepted: true };
      }
    }
    throw new Error(`unexpected ${namespace}.${method}`);
  },
};

const sendGuard = async (tool, args, timeout) => {
  if (tool === 'wechat_send') {
    console.log('BLOCKED-LIVE-SEND (probe mode):', JSON.stringify(args).slice(0, 120));
    return JSON.stringify({ sent: false, blocked: true });
  }
  return sidecar.call(tool, args, timeout);
};

const sidecar = createSidecar({ logger: quiet });
const autoReply = createAutoReply({
  sidecar: { call: sendGuard, dispose: () => {} },
  gateway,
  chats: [WATCHED],
  logger: quiet,
  groupOnlyWhenMentioned: false,
  prepareWorkspace: async () => {},
});

console.log('baseline tick...');
await autoReply.tickOnce();
console.log('watching for 70s — ask someone to message the group, or wait for organic traffic...');
for (let round = 1; round <= 7; round += 1) {
  await new Promise((r) => setTimeout(r, 10_000));
  await autoReply.tickOnce();
  if (prompts.length > 0) break;
}
console.log('captured prompts:', prompts.length);
for (const p of prompts) console.log('--- prompt ---\n' + p.slice(0, 400));
await sidecar.dispose();
console.log(prompts.length > 0 ? 'PROBE_OK' : 'PROBE_NO_MESSAGE_SEEN');
