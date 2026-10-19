// Register the bot webhook: TELEGRAM_BOT_TOKEN=... TELEGRAM_WEBHOOK_SECRET=... node scripts/telegram-setup.mjs https://<service>.run.app
const [base] = process.argv.slice(2);
const token = process.env.TELEGRAM_BOT_TOKEN;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
if (!base || !token || !secret) {
  console.error('Usage: TELEGRAM_BOT_TOKEN=... TELEGRAM_WEBHOOK_SECRET=... node scripts/telegram-setup.mjs https://<service-url>');
  process.exit(1);
}
const call = async (method, body) => {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!result.ok) throw new Error(`${method}: ${result.description}`);
  return result.result;
};
await call('setWebhook', { url: new URL('/telegram/webhook', base).href, secret_token: secret, allowed_updates: ['message'], drop_pending_updates: true });
await call('setMyCommands', { commands: [{ command: 'start', description: 'Как пользоваться' }, { command: 'help', description: 'Подсказка' }] });
console.log('Webhook set:', new URL('/telegram/webhook', base).href);
