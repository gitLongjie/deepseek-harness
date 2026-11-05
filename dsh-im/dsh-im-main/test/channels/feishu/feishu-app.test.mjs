import assert from 'node:assert/strict';
import test from 'node:test';
import { postFeishuOwnerMessage, verifyFeishuApp } from '../../../src/channels/feishu/feishu-app.mjs';

test('verifyFeishuApp validates credentials and returns a safe bot identity', async () => {
  const requests = [];
  const result = await verifyFeishuApp({
    appId: 'cli_test',
    appSecret: 'never-return-this',
    timeoutMs: 1234,
    httpInstance: {
      async request(options) {
        requests.push(options);
        if (requests.length === 1) {
          return { code: 0, tenant_access_token: 'tenant-token' };
        }
        return {
          code: 0,
          bot: { app_name: '北汇星河助手', open_id: 'ou_bot', activate_status: 1 },
        };
      },
    },
  });

  assert.deepEqual(result, {
    appId: 'cli_test',
    name: '北汇星河助手',
    openId: 'ou_bot',
    activated: 1,
  });
  assert.equal('appSecret' in result, false);
  assert.equal(requests[0].method, 'POST');
  assert.equal(requests[0].url, 'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal');
  assert.deepEqual(requests[0].data, { app_id: 'cli_test', app_secret: 'never-return-this' });
  assert.equal(requests[0].timeout, 1234);
  assert.ok(requests[0].signal instanceof AbortSignal);
  assert.equal(requests[1].method, 'GET');
  assert.equal(requests[1].url, 'https://open.feishu.cn/open-apis/bot/v3/info/');
  assert.equal(requests[1].headers.authorization, 'Bearer tenant-token');
  assert.equal(requests[1].timeout, 1234);
  assert.ok(requests[1].signal instanceof AbortSignal);
});

test('verifyFeishuApp rejects invalid credentials before reading bot info', async () => {
  let calls = 0;
  await assert.rejects(verifyFeishuApp({
    appId: 'cli_bad',
    appSecret: 'bad',
    httpInstance: {
      async request() {
        calls += 1;
        return { code: 10003, msg: 'invalid app secret' };
      },
    },
  }), /invalid app secret/);
  assert.equal(calls, 1);
});

test('postFeishuOwnerMessage sends a private text message with the tenant token', async () => {
  const requests = [];
  const result = await postFeishuOwnerMessage({
    appId: 'cli_test',
    appSecret: 'never-return-this',
    ownerOpenId: 'ou_owner',
    text: '画像已写好',
    timeoutMs: 2000,
    httpInstance: {
      async request(options) {
        requests.push(options);
        if (requests.length === 1) return { code: 0, tenant_access_token: 'tenant-token' };
        return { code: 0, data: { message_id: 'om_sent' } };
      },
    },
  });
  assert.deepEqual(result, { messageId: 'om_sent' });
  assert.equal(requests[1].method, 'POST');
  assert.equal(requests[1].url, 'https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=open_id');
  assert.equal(requests[1].headers.authorization, 'Bearer tenant-token');
  assert.deepEqual(requests[1].data, {
    receive_id: 'ou_owner',
    msg_type: 'text',
    content: JSON.stringify({ text: '画像已写好' }),
  });
  assert.equal(JSON.stringify(requests).includes('never-return-this') && requests[1].data.content.includes('never-return-this'), false);
});

test('verifyFeishuApp requires the shared SDK HTTP instance', async () => {
  await assert.rejects(verifyFeishuApp({
    appId: 'cli_test',
    appSecret: 'secret',
  }), /requires an HTTP instance/);
});
