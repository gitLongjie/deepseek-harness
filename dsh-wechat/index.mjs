import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createAutoReply } from './autoreply.mjs';

export const name = 'dsh-wechat-tools';
export const inject = [];

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_SERVICE_SCRIPT = resolve(HERE, 'service', 'wechat_service.py');
const DEFAULT_TIMEOUT_MS = 90_000;
const SEND_TIMEOUT_MS = 300_000;

const TOOL_NAMES = Object.freeze([
  'wechat_doctor',
  'wechat_contacts',
  'wechat_group_members',
  'wechat_messages',
  'wechat_send',
]);

function textResult(value) {
  return String(value ?? '');
}

function toolDefinitions(call) {
  return Object.freeze({
    wechat_doctor: Object.freeze({
      name: 'wechat_doctor',
      description: 'Check the local WeChat integration: logged-in account, contact count, database readability, and send-side window state. Call this first when other wechat tools fail.',
      parameters: Object.freeze({
        type: 'object',
        additionalProperties: false,
        properties: Object.freeze({}),
        required: [],
      }),
      async execute() {
        return textResult(await call('wechat_doctor', {}));
      },
    }),
    wechat_contacts: Object.freeze({
      name: 'wechat_contacts',
      description: 'List contacts from the logged-in WeChat account\'s local address book: friends, group chats, or official accounts, with pagination and keyword search.',
      parameters: Object.freeze({
        type: 'object',
        additionalProperties: false,
        properties: Object.freeze({
          kind: Object.freeze({
            type: 'string',
            enum: Object.freeze(['person', 'group', 'official', 'all']),
            description: 'person = friends and other contacts, group = group chats, official = official accounts, all = everything.',
          }),
          keyword: Object.freeze({
            type: 'string',
            description: 'Optional filter by nickname, remark, or wxid.',
          }),
          page: Object.freeze({ type: 'number', description: 'Page number starting at 1.' }),
          page_size: Object.freeze({ type: 'number', description: 'Items per page, 1-200.' }),
        }),
        required: [],
      }),
      async execute(args) {
        return textResult(await call('wechat_contacts', args ?? {}));
      },
    }),
    wechat_group_members: Object.freeze({
      name: 'wechat_group_members',
      description: 'List the members of one WeChat group chat (nickname, remark, wxid, owner flag), with pagination.',
      parameters: Object.freeze({
        type: 'object',
        additionalProperties: false,
        properties: Object.freeze({
          group: Object.freeze({
            type: 'string',
            description: 'Group display name or chatroom id (ends with @chatroom).',
          }),
          page: Object.freeze({ type: 'number', description: 'Page number starting at 1.' }),
          page_size: Object.freeze({ type: 'number', description: 'Items per page, 1-500.' }),
        }),
        required: Object.freeze(['group']),
      }),
      async execute(args) {
        return textResult(await call('wechat_group_members', args ?? {}));
      },
    }),
    wechat_messages: Object.freeze({
      name: 'wechat_messages',
      description: 'Read messages of one WeChat conversation (a friend or a group). Without since_seq returns the most recent messages; with since_seq returns only newer messages for incremental monitoring. Keep polling intervals at tens of seconds — tight polling can trigger WeChat risk control.',
      parameters: Object.freeze({
        type: 'object',
        additionalProperties: false,
        properties: Object.freeze({
          chat: Object.freeze({
            type: 'string',
            description: 'Nickname, remark, wxid, or chatroom id of the conversation.',
          }),
          limit: Object.freeze({ type: 'number', description: 'Max messages to return, 1-100.' }),
          since_seq: Object.freeze({
            type: 'number',
            description: 'Watermark: only return messages with seq greater than this value. Use the largest seq from the previous call.',
          }),
        }),
        required: Object.freeze(['chat']),
      }),
      async execute(args) {
        return textResult(await call('wechat_messages', args ?? {}));
      },
    }),
    wechat_send: Object.freeze({
      name: 'wechat_send',
      description: 'Send a text message to a WeChat contact or group through the local WeChat window. Requires WeChat logged in with a usable window and an interactive desktop session; the call briefly drives the window.',
      parameters: Object.freeze({
        type: 'object',
        additionalProperties: false,
        properties: Object.freeze({
          to: Object.freeze({
            type: 'string',
            description: 'Nickname, remark, wxid, or chatroom id of the recipient.',
          }),
          text: Object.freeze({ type: 'string', description: 'Message text to send.' }),
        }),
        required: Object.freeze(['to', 'text']),
      }),
      async execute(args) {
        return textResult(await call('wechat_send', args ?? {}, SEND_TIMEOUT_MS));
      },
    }),
  });
}

/**
 * Manage the Python sidecar process: lazy start, one request in flight at a
 * time, line-delimited JSON protocol over stdio, and clean shutdown.
 */
export function createSidecar({
  python = 'python',
  serviceScript = DEFAULT_SERVICE_SCRIPT,
  spawnImpl = spawn,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  logger = console,
  env = process.env,
} = {}) {
  let child = null;
  let starting = null;
  let nextId = 1;
  let queue = Promise.resolve();
  let disposed = false;

  function start() {
    if (disposed) return Promise.reject(new Error('dsh-wechat sidecar is disposed'));
    if (child) return Promise.resolve(child);
    if (starting) return starting;
    starting = new Promise((resolveStart, rejectStart) => {
      let settled = false;
      let stderrTail = '';
      let handle = null;
      const failFast = (reason) => {
        if (settled) return;
        settled = true;
        starting = null;
        child = null;
        rejectStart(new Error(`${reason}${stderrTail ? `; sidecar stderr: ${stderrTail.slice(-400)}` : ''}`));
      };
      let proc;
      try {
        proc = spawnImpl(python, [serviceScript], {
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true,
          // Belt and braces with the sidecar's own reconfigure: Windows Python
          // defaults piped stdio to the ANSI code page outside UTF-8 shells,
          // which mojibakes every non-ASCII tool argument and result.
          env: { ...env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
        });
      } catch (error) {
        failFast(`failed to spawn ${python}: ${error.message}`);
        return;
      }
      proc.on('error', (error) => {
        if (settled && handle) return;
        failFast(`failed to start ${python}: ${error.message}`);
      });
      proc.on('exit', () => {
        if (settled && handle) {
          const failure = new Error('WeChat sidecar exited unexpectedly; retry the call.');
          for (const [, pending] of handle.pending) {
            clearTimeout(pending.timer);
            pending.reject(failure);
          }
          handle.pending.clear();
          if (child === handle) child = null;
          return;
        }
        failFast(`the WeChat sidecar exited during startup${stderrTail ? `: ${stderrTail.slice(-400)}` : ''}`);
      });
      proc.stderr?.setEncoding('utf8');
      proc.stderr?.on('data', (chunk) => {
        stderrTail = (stderrTail + chunk).slice(-800);
        logger.warn?.(`[dsh-wechat] sidecar stderr: ${String(chunk).trim()}`);
      });
      const stdout = createInterface({ input: proc.stdout });
      proc.on('spawn', () => {
        if (settled) return;
        settled = true;
        handle = {
          proc,
          stdout,
          pending: new Map(),
        };
        child = handle;
        stdout.on('line', (line) => {
          if (!line.trim()) return;
          let message;
          try {
            message = JSON.parse(line);
          } catch {
            logger.warn?.(`[dsh-wechat] sidecar sent an unparseable line: ${line.slice(0, 200)}`);
            return;
          }
          const pending = handle.pending.get(message.id);
          if (!pending) return;
          handle.pending.delete(message.id);
          clearTimeout(pending.timer);
          if (message.ok) pending.resolve(message.result);
          else pending.reject(new Error(message.error ?? 'sidecall failed'));
        });
        resolveStart(handle);
      });
    });
    return starting;
  }

  async function call(tool, args, timeout = timeoutMs) {
    if (disposed) throw new Error('dsh-wechat sidecar is disposed');
    const run = async () => {
      const handle = await start();
      return new Promise((resolveCall, rejectCall) => {
        const id = nextId;
        nextId += 1;
        const timer = setTimeout(() => {
          handle.pending.delete(id);
          rejectCall(new Error(`WeChat tool ${tool} timed out after ${timeout}ms`));
        }, timeout);
        handle.pending.set(id, {
          resolve: resolveCall,
          reject: rejectCall,
          timer,
        });
        handle.proc.stdin.write(`${JSON.stringify({ id, tool, args: args ?? {} })}\n`, (error) => {
          if (error) {
            handle.pending.delete(id);
            clearTimeout(timer);
            rejectCall(new Error(`WeChat sidecar stdin write failed: ${error.message}`));
          }
        });
      });
    };
    const result = queue.then(run, run);
    queue = result.then(() => undefined, () => undefined);
    return result;
  }

  async function dispose() {
    disposed = true;
    const handle = child;
    child = null;
    if (!handle) return;
    await new Promise((resolveExit) => {
      handle.proc.once('exit', resolveExit);
      handle.proc.kill();
      setTimeout(resolveExit, 3_000).unref?.();
    });
  }

  return Object.freeze({
    call,
    dispose,
    tools: TOOL_NAMES,
  });
}

export function installWechatTools(ctx, {
  sidecar = createSidecar(),
  logger = ctx?.logger && typeof ctx.logger === 'function' ? ctx.logger(name) : (ctx?.logger ?? console),
} = {}) {
  if (typeof ctx?.tools?.register !== 'function'
    || typeof ctx?.systemPrompt?.section !== 'function') {
    logger.warn?.('[dsh-wechat] host context has no tools/systemPrompt services; tools not registered');
    return () => {};
  }
  const definitions = toolDefinitions((tool, args, timeout) => sidecar.call(tool, args, timeout));
  for (const toolName of TOOL_NAMES) {
    ctx.tools.register(definitions[toolName]);
  }
  ctx.systemPrompt.section({
    name: 'dsh-wechat:tools',
    order: 116,
    text: 'WeChat desktop tools operate the local, logged-in personal WeChat account: wechat_contacts lists the address book (persons/groups/official accounts), wechat_group_members lists one group\'s members, wechat_messages reads a conversation with a since_seq watermark for incremental monitoring (poll at tens-of-seconds intervals, never per-second), and wechat_send sends text through the WeChat window. Prefer wechat_doctor first when results look wrong.',
  });
  const dispose = () => {
    void sidecar.dispose();
  };
  ctx.effect?.(dispose, 'dsh-wechat: stop the WeChat sidecar');
  return dispose;
}

export async function apply(ctx, config = {}) {
  const logger = typeof ctx?.logger === 'function'
    ? ctx.logger(name)
    : (ctx?.logger ?? console);
  const sidecar = createSidecar({
    python: config.python ?? process.env.DSH_WECHAT_PYTHON ?? 'python',
    serviceScript: config.serviceScript
      ? resolve(String(config.serviceScript))
      : DEFAULT_SERVICE_SCRIPT,
    logger,
  });
  const installer = (target) => installWechatTools(target, { sidecar, logger });
  if (typeof ctx?.inject === 'function') {
    ctx.inject(['tools', 'systemPrompt'], installer);
  } else {
    installer(ctx);
  }
  const autoReplyConfig = config.autoReply;
  let stopAutoReply = null;
  if (autoReplyConfig?.enabled === true) {
    if (typeof ctx?.inject !== 'function') {
      logger.error?.('[dsh-wechat] autoReply requires a Cordis context with ctx.inject');
    } else {
      ctx.inject(['typertGateway'], (gatewayCtx) => {
        try {
          const autoReply = createAutoReply({
            sidecar,
            gateway: gatewayCtx.typertGateway,
            chats: autoReplyConfig.chats,
            logger,
            ...(autoReplyConfig.pollIntervalMs !== undefined
              ? { pollIntervalMs: autoReplyConfig.pollIntervalMs } : {}),
            ...(autoReplyConfig.workspace !== undefined
              ? { workspace: autoReplyConfig.workspace } : {}),
            ...(autoReplyConfig.agentPreset !== undefined
              ? { agentPreset: autoReplyConfig.agentPreset } : {}),
            ...(autoReplyConfig.groupOnlyWhenMentioned !== undefined
              ? { groupOnlyWhenMentioned: autoReplyConfig.groupOnlyWhenMentioned } : {}),
            ...(autoReplyConfig.promptHeader !== undefined
              ? { promptHeader: autoReplyConfig.promptHeader } : {}),
          });
          autoReply.start();
          stopAutoReply = () => autoReply.stop();
        } catch (error) {
          logger.error?.('[dsh-wechat] autoReply failed to start; tools keep working:', error);
        }
      });
    }
  }
  return () => {
    stopAutoReply?.();
    void sidecar.dispose();
  };
}

export function createWechatPlugin(config) {
  return Object.freeze({ name, inject, apply: (ctx) => apply(ctx, config) });
}

export default apply;
