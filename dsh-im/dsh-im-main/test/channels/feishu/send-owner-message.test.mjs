import assert from 'node:assert/strict';
import test from 'node:test';
import { MultiBotDshFeishuController } from '../../../src/channels/feishu/multi-bot-controller.mjs';
import { installFeishuSendTool } from '../../../plugin-src/host/channels/feishu/send-tool.mjs';

function controllerFor(bots, { secret = 'app-secret', postOwnerMessage } = {}) {
  const secrets = new Map(bots.map((bot) => [bot.secretRef, secret]));
  return new MultiBotDshFeishuController({
    registerApp() { return new Promise(() => {}); },
    async verifyApp() { return { name: 'bot', openId: 'ou_bot', activated: 2 }; },
    credentials: {
      async resolve(ref) {
        return secrets.has(ref) ? { value: secrets.get(ref) } : undefined;
      },
      async set() {},
      async unset() {},
    },
    configStore: { list: () => bots.map((bot) => structuredClone(bot)) },
    async createRuntime() { throw new Error('runtime must stay down'); },
    postOwnerMessage,
  });
}

const bot = {
  id: 'bot_one',
  appId: 'cli_one',
  secretRef: 'DSH_FEISHU_APP_SECRET_ONE',
  ownerOpenIds: ['ou_owner'],
  domain: 'feishu',
  botName: '北汇星河',
  botOpenId: 'ou_bot',
  activated: 2,
};

test('sendToOwner delivers while the long connection is down', async () => {
  const calls = [];
  const controller = controllerFor([bot], {
    postOwnerMessage: async (options) => {
      calls.push(options);
      return { messageId: 'om_1' };
    },
  });
  assert.deepEqual(await controller.sendToOwner('  你好  '), {
    sent: true,
    botId: 'bot_one',
    messageId: 'om_1',
  });
  assert.equal(calls[0].appSecret, 'app-secret');
  assert.equal(calls[0].ownerOpenId, 'ou_owner');
  assert.equal(calls[0].text, '你好');
  assert.equal(calls[0].appId, 'cli_one');
});

test('sendToOwner refuses to guess among multiple bots', async () => {
  const controller = controllerFor([
    bot,
    { ...bot, id: 'bot_two', appId: 'cli_two', secretRef: 'DSH_FEISHU_APP_SECRET_TWO' },
  ], { postOwnerMessage: async () => ({ messageId: 'om_unused' }) });
  await assert.rejects(controller.sendToOwner('你好'), (error) => error.code === 'feishu-bot-ambiguous');
});

test('the Feishu send tool calls the bound bot without a live IM session', async () => {
  const calls = [];
  const sections = [];
  const controller = controllerFor([bot], {
    postOwnerMessage: async (options) => {
      calls.push(options);
      return { messageId: 'om_tool' };
    },
  });
  const tools = [];
  const installed = installFeishuSendTool({
    tools: { register: (definition) => tools.push(definition) },
    systemPrompt: { section: (section) => sections.push(section) },
  }, controller);
  assert.equal(installed, true);
  assert.equal(tools[0].name, 'dsh_feishu_send');
  assert.deepEqual(await tools[0].execute({ text: '第七节' }), {
    sent: true,
    botId: 'bot_one',
    messageId: 'om_tool',
  });
  assert.equal(calls[0].text, '第七节');
  assert.equal(sections[0].name, 'dsh-feishu:send');
});
