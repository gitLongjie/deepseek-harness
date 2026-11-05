function endpointFor(domain, path) {
  const origin = domain === 'lark' ? 'https://open.larksuite.com' : 'https://open.feishu.cn';
  return new URL(path, origin);
}

function jsonResponse(body, operation) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error(`${operation} returned a non-JSON response`);
  }
  if (body.code !== 0) {
    throw new Error(`${operation} failed: ${body.msg || `code ${body.code}`}`);
  }
  return body;
}

/** Validate freshly provisioned credentials and read the bot identity. */
export async function verifyFeishuApp({
  appId,
  appSecret,
  domain = 'feishu',
  httpInstance,
  timeoutMs = 15000,
}) {
  if (!appId || !appSecret) throw new Error('Feishu credentials are incomplete');
  if (!httpInstance || typeof httpInstance.request !== 'function') {
    throw new TypeError('Feishu verification requires an HTTP instance');
  }
  const tokenBody = jsonResponse(await httpInstance.request({
    method: 'POST',
    url: endpointFor(domain, '/open-apis/auth/v3/tenant_access_token/internal').href,
    headers: { 'content-type': 'application/json; charset=utf-8' },
    data: { app_id: appId, app_secret: appSecret },
    signal: AbortSignal.timeout(timeoutMs),
    timeout: timeoutMs,
  }), 'Feishu authentication');
  if (!tokenBody.tenant_access_token) {
    throw new Error('Feishu authentication returned no tenant access token');
  }

  const botBody = jsonResponse(await httpInstance.request({
    method: 'GET',
    url: endpointFor(domain, '/open-apis/bot/v3/info/').href,
    headers: { authorization: `Bearer ${tokenBody.tenant_access_token}` },
    signal: AbortSignal.timeout(timeoutMs),
    timeout: timeoutMs,
  }), 'Feishu bot verification');
  const bot = botBody.bot ?? {};
  return Object.freeze({
    appId,
    name: bot.app_name ?? bot.bot_name ?? null,
    openId: bot.open_id ?? null,
    activated: bot.activate_status ?? null,
  });
}

/**
 * Send one private text message to the user who connected the app.
 * This uses the tenant token and does not require the long connection.
 * @param options - app credentials, owner open_id, and text.
 * @returns the Feishu message id when the platform returns one.
 */
export async function postFeishuOwnerMessage({
  appId,
  appSecret,
  domain = 'feishu',
  ownerOpenId,
  text,
  httpInstance,
  timeoutMs = 15000,
}) {
  if (!appId || !appSecret) throw new Error('Feishu credentials are incomplete');
  if (typeof ownerOpenId !== 'string' || !ownerOpenId.trim()) {
    throw new TypeError('Feishu owner open_id is required');
  }
  if (typeof text !== 'string' || !text.trim()) throw new TypeError('Feishu message text is required');
  if (!httpInstance || typeof httpInstance.request !== 'function') {
    throw new TypeError('Feishu send requires an HTTP instance');
  }
  const tokenBody = jsonResponse(await httpInstance.request({
    method: 'POST',
    url: endpointFor(domain, '/open-apis/auth/v3/tenant_access_token/internal').href,
    headers: { 'content-type': 'application/json; charset=utf-8' },
    data: { app_id: appId, app_secret: appSecret },
    signal: AbortSignal.timeout(timeoutMs),
    timeout: timeoutMs,
  }), 'Feishu authentication');
  if (!tokenBody.tenant_access_token) {
    throw new Error('Feishu authentication returned no tenant access token');
  }
  const sent = jsonResponse(await httpInstance.request({
    method: 'POST',
    url: endpointFor(domain, '/open-apis/im/v1/messages?receive_id_type=open_id').href,
    headers: {
      authorization: `Bearer ${tokenBody.tenant_access_token}`,
      'content-type': 'application/json; charset=utf-8',
    },
    data: {
      receive_id: ownerOpenId,
      msg_type: 'text',
      content: JSON.stringify({ text }),
    },
    signal: AbortSignal.timeout(timeoutMs),
    timeout: timeoutMs,
  }), 'Feishu message send');
  const messageId = sent.data?.message_id;
  return Object.freeze({
    messageId: typeof messageId === 'string' && messageId ? messageId : null,
  });
}
