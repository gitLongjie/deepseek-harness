export const FEISHU_SEND_TOOL = 'dsh_feishu_send';

/**
 * Register the bound-app private-message tool.
 * A Web session has no Feishu chat of its own; this sends to the user who connected the app.
 * @param ctx - Host context with the tool registry.
 * @param controller - Feishu controller that can send to the connecting user.
 * @returns whether the tool was registered.
 */
export function installFeishuSendTool(ctx, controller) {
  if (typeof ctx?.tools?.register !== 'function'
    || typeof controller?.sendToOwner !== 'function') return false;
  ctx.tools.register({
    name: FEISHU_SEND_TOOL,
    description: 'Send a private Feishu text message to the user who connected the bound Feishu app. This does not post to a group webhook and does not require the long connection to be up.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        text: {
          type: 'string',
          description: 'Message text to deliver in the private chat with the bot.',
        },
        botId: {
          type: 'string',
          description: 'Bound bot id. Omit when only one Feishu bot is connected.',
        },
      },
      required: ['text'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          sent: { type: 'boolean' },
          botId: { type: 'string' },
          messageId: { type: ['string', 'null'] },
        },
        required: ['sent', 'botId', 'messageId'],
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.sent
          ? `Sent a private Feishu message from ${value.botId}.`
          : 'Feishu message was not sent.',
      }],
    },
    async execute(args) {
      const text = args?.text;
      const botId = typeof args?.botId === 'string' && args.botId.trim()
        ? args.botId.trim()
        : undefined;
      return controller.sendToOwner(text, botId === undefined ? {} : { botId });
    },
  });
  ctx.systemPrompt?.section?.({
    name: 'dsh-feishu:send',
    order: 116,
    text: `When the user asks to send text to Feishu, call ${FEISHU_SEND_TOOL}. It delivers a private message to the person who connected the bound Feishu app. It cannot address a group that has no stored chat id.`,
  });
  return true;
}
