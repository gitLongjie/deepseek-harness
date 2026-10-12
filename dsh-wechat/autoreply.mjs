import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Minimal harness session client for auto-reply: create a session in a
 * workspace, submit one queued prompt, and poll session.history until the
 * turn ends, mirroring dsh-im's poll loop (no event-stream subscription).
 * Transport is the in-process Host typertGateway service.
 */
export function createMiniHarnessClient({ gateway, namespace = 'session' } = {}) {
  if (!gateway || typeof gateway.invoke !== 'function') {
    throw new TypeError('autoReply requires the Host typertGateway service');
  }
  const rpc = async (method, payload, { signal } = {}) => {
    const result = await gateway.invoke({ namespace, method, args: payload ?? {}, signal });
    if (result && typeof result === 'object' && result.ok === false) {
      throw new Error(`${method}: ${result.error?.message ?? 'harness rpc failed'}`);
    }
    return result;
  };
  const workspaceRpc = async (method, payload = {}) => gateway.invoke({
    namespace: 'workspace',
    method,
    args: payload,
  });

  async function workspaceIdFor(path) {
    const { items } = await workspaceRpc('list', {});
    const existing = (items ?? []).find((item) => item.path === path);
    if (existing) return existing.workspaceId;
    const created = await workspaceRpc('create', { path });
    return created.workspace.workspaceId;
  }

  async function createSession({ workspaceId, agentPreset } = {}) {
    const payload = { workspaceId };
    if (agentPreset != null) payload.agentPreset = agentPreset;
    const created = await rpc('create', payload);
    return created.sessionId;
  }

  async function ask(sessionId, text, { timeoutMs = 600_000, signal, pollMs = 1_000 } = {}) {
    // requestId is persisted on the accepted user message as source.rpcId,
    // which is how the poll loop recognises its own prompt's turn.
    const requestId = `dsh-wechat-ar-${randomUUID()}`;
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const before = await rpc('history', { sessionId, maxMessages: 1 }, { signal });
    let lastSeq = Math.max(-1, ...(before.events ?? []).map((entry) => entry.seq ?? -1));
    await rpc('prompt', {
      requestId,
      sessionId,
      mode: 'queue',
      content: [{ type: 'text', text }],
      clientTimeZone: timeZone,
    }, { signal });
    return waitForReply(sessionId, requestId, lastSeq, { timeoutMs, signal, pollMs });
  }

  async function waitForReply(sessionId, promptRpcId, baselineSeq, { timeoutMs, signal, pollMs }) {
    const deadline = Date.now() + timeoutMs;
    let lastSeq = baselineSeq;
    let openTurn = null;
    let targetTurn = null;
    let latestText = '';
    let finished = false;
    let reason = null;
    while (Date.now() < deadline) {
      signal?.throwIfAborted();
      await new Promise((resolve) => setTimeout(resolve, pollMs));
      const { events = [] } = await rpc('history', { sessionId, maxMessages: 50 }, { signal });
      const ordered = [...events].sort((left, right) => (left.seq ?? -1) - (right.seq ?? -1));
      for (const event of ordered) {
        const seq = event.seq ?? -1;
        if (seq <= lastSeq) continue;
        lastSeq = seq;
        if (event.type === 'turn/start') {
          openTurn = event.data?.turn ?? null;
        } else if (event.type === 'user/message'
          && event.data?.source?.rpcId === promptRpcId) {
          targetTurn = openTurn;
        } else if (event.type === 'turn/end' && targetTurn !== null
          && event.data?.turn === targetTurn) {
          finished = true;
          reason = event.data?.reason ?? null;
        } else if (event.type === 'assistant/message' && targetTurn !== null
          && event.data?.turn === targetTurn) {
          const text = (event.data?.message?.content ?? [])
            .filter((part) => part.type === 'text' && typeof part.text === 'string')
            .map((part) => part.text)
            .join('\n')
            .trim();
          if (text) latestText = text;
        }
      }
      if (finished) {
        const reasonKind = reason == null ? 'completed' : (reason.kind ?? String(reason));
        if (reasonKind !== 'completed') {
          throw new Error(`harness turn did not complete: ${JSON.stringify(reason)}`);
        }
        return latestText;
      }
    }
    throw new Error('harness-reply-timeout');
  }

  return Object.freeze({ workspaceIdFor, createSession, ask });
}

export const DEFAULT_AUTOREPLY_WORKSPACE = () => join(
  homedir(), '.dsh', 'dsh-wechat', 'autoreply',
);

export const DEFAULT_PROMPT_HEADER = '你是微信自动回复助手。下面是微信会话里收到的新消息（每行一条，格式为「发送者：内容」）。'
  + '请直接输出要发给对方的中文回复正文，不要解释、不要引号。';

/**
 * Poll watched chats for new inbound messages and answer each through a
 * per-chat harness session, then send the answer back with wechat_send.
 */
export function createAutoReply({
  sidecar,
  gateway,
  chats,
  logger = console,
  pollIntervalMs = 30_000,
  workspace,
  agentPreset,
  groupOnlyWhenMentioned = true,
  promptHeader = DEFAULT_PROMPT_HEADER,
  replyTimeoutMs = 600_000,
  sendTimeoutMs = 300_000,
  prepareWorkspace = async (path) => mkdir(path, { recursive: true }),
} = {}) {
  if (!sidecar) throw new TypeError('autoReply requires the wechat sidecar');
  if (!Array.isArray(chats) || chats.length === 0 || chats.some((c) => !String(c ?? '').trim())) {
    throw new TypeError('autoReply.chats 必须是非空的会话名数组（昵称/备注/wxid/群号）');
  }
  if (!Number.isFinite(pollIntervalMs) || pollIntervalMs < 20_000) {
    throw new TypeError('autoReply.pollIntervalMs 不能低于 20000（微信风控：禁止高频轮询）');
  }

  const client = createMiniHarnessClient({ gateway });
  const state = new Map(); // chat → { watermark, sessionId }
  let timer = null;
  let running = false;
  let selfNickname = null;
  const workspacePath = workspace ?? DEFAULT_AUTOREPLY_WORKSPACE();
  let workspaceId = null;

  async function ensureWorkspace() {
    if (workspaceId) return workspaceId;
    await prepareWorkspace(workspacePath);
    workspaceId = await client.workspaceIdFor(workspacePath);
    return workspaceId;
  }

  async function ensureSession(chat) {
    const entry = state.get(chat);
    if (entry?.sessionId) return entry.sessionId;
    const sessionId = await client.createSession({
      workspaceId: await ensureWorkspace(),
      ...(agentPreset != null ? { agentPreset } : {}),
    });
    logger.info?.(`[dsh-wechat] auto-reply session for ${chat}: ${sessionId}`);
    return sessionId;
  }

  async function readSelfNickname() {
    if (selfNickname !== null) return selfNickname;
    try {
      const doctor = JSON.parse(await sidecar.call('wechat_doctor', {}));
      selfNickname = doctor?.account?.nickname || '';
    } catch {
      selfNickname = '';
    }
    return selfNickname;
  }

  function buildPrompt(messages, chat) {
    const lines = messages.map((message) => `${message.sender || '对方'}：${message.content}`);
    return [promptHeader, `会话：${chat}`, '', ...lines].join('\n');
  }

  async function pollChat(chat) {
    let entry = state.get(chat);
    if (!entry) {
      entry = { watermark: null, sessionId: null };
      state.set(chat, entry);
    }
    const payload = JSON.parse(await sidecar.call('wechat_messages', {
      chat,
      limit: 100,
      since_seq: entry.watermark ?? 0,
    }));
    const items = Array.isArray(payload.items) ? payload.items : [];
    const highestSeq = items.reduce((max, item) => Math.max(max, Number(item.seq) || 0), 0);
    if (entry.watermark === null) {
      // First poll after start: adopt the current watermark and never answer history.
      entry.watermark = highestSeq;
      logger.info?.(`[dsh-wechat] auto-reply baseline for ${chat}: seq ${highestSeq}`);
      return;
    }
    const fresh = items.filter((item) => (
      !item.is_self && item.content && (Number(item.seq) || 0) > entry.watermark
    ));
    entry.watermark = Math.max(entry.watermark, highestSeq);
    if (fresh.length === 0) return;

    const isGroup = String(payload.chat ?? '').endsWith('@chatroom');
    if (isGroup && groupOnlyWhenMentioned) {
      const nickname = await readSelfNickname();
      const mentioned = nickname && fresh.some((item) => item.content.includes(`@${nickname}`));
      if (!mentioned) return;
    }

    const sessionId = await ensureSession(chat);
    entry.sessionId = sessionId;
    const answer = await client.ask(sessionId, buildPrompt(fresh, chat), {
      timeoutMs: replyTimeoutMs,
    });
    if (!answer || !answer.trim()) {
      logger.warn?.(`[dsh-wechat] auto-reply produced no answer for ${chat}`);
      return;
    }
    await sidecar.call('wechat_send', { to: chat, text: answer.trim() }, sendTimeoutMs);
    logger.info?.(`[dsh-wechat] auto-reply answered ${chat}`);
  }

  async function tick() {
    if (running) return;
    running = true;
    try {
      for (const chat of chats) {
        try {
          await pollChat(chat);
        } catch (error) {
          logger.warn?.(`[dsh-wechat] auto-reply poll failed for ${chat}:`, error?.message ?? error);
        }
      }
    } finally {
      running = false;
    }
  }

  return Object.freeze({
    start() {
      if (timer) return;
      // Prime the baseline shortly after start instead of waiting a full interval.
      setTimeout(() => void tick(), 3_000).unref?.();
      timer = setInterval(() => void tick(), pollIntervalMs);
      timer.unref?.();
      logger.info?.(`[dsh-wechat] auto-reply started for ${chats.length} chat(s) every ${pollIntervalMs}ms`);
    },
    stop() {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
    },
    async tickOnce() {
      await tick();
    },
    /**
     * Diagnostics/tests only: lower a chat's watermark so older messages
     * replay as new on the next tick. Never used by the runtime loop.
     */
    async debugRewind(chat, toSeq) {
      const entry = state.get(chat);
      if (!entry || entry.watermark === null) {
        throw new Error(`no baseline for ${chat} yet; run tickOnce first`);
      }
      entry.watermark = toSeq;
    },
  });
}
