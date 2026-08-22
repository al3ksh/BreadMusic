const path = require('node:path');

async function main() {
  const token = process.env.DISCORD_TOKEN;
  if (!token) throw new Error('DISCORD_TOKEN missing');

  const api = 'https://discord.com/api/v10';
  const headers = {
    Authorization: `Bot ${token}`,
    'Content-Type': 'application/json',
  };

  let recipientId = String(process.env.DISCORD_ALERT_DM_USER_ID || '').trim();
  if (!/^\d{17,20}$/.test(recipientId)) {
    const appRes = await fetch(`${api}/oauth2/applications/@me`, { headers });
    if (!appRes.ok) throw new Error(`application fetch failed: ${appRes.status}`);
    const app = await appRes.json();
    recipientId = app?.team ? String(app.team.owner_user_id ?? app.team.owner?.id ?? '') : String(app?.owner?.id ?? '');
  }
  if (!/^\d{17,20}$/.test(recipientId)) {
    throw new Error('could not resolve alert DM recipient');
  }

  const channelRes = await fetch(`${api}/users/@me/channels`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ recipient_id: recipientId }),
  });
  if (!channelRes.ok) throw new Error(`dm channel failed: ${channelRes.status}`);
  const channel = await channelRes.json();

  const embed = {
    title: '\u{1F9EA} Test: Bread monitoring',
    description: [
      '**To jest wiadomość testowa systemu alertów.**',
      '',
      'Gdy coś będzie trwale niedziałające, dostanisz taki sam embed:',
      '- \u{1F534} czerwony – awaria (Discord WS / Lavalink / dysk)',
      '- \u{1F7E0} pomarańczowy – ostrzeżenie (Gemini, autoplay classic działa dalej)',
      '- \u{1F7E2} zielony – „Resolved" po powrocie usługi',
      '',
      'Alerty lecą dopiero po kilku kolejnych błędach i raz na epizod – bez spamu.',
    ].join('\n'),
    color: 0xf59e0b,
    footer: { text: 'Bread monitoring' },
    timestamp: new Date().toISOString(),
  };

  const messageRes = await fetch(`${api}/channels/${channel.id}/messages`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ embeds: [embed] }),
  });
  if (!messageRes.ok) throw new Error(`message failed: ${messageRes.status}`);

  console.log(`Test alert DM sent to user ${recipientId}.`);
}

main().catch((error) => {
  console.error('Test alert failed:', error.message);
  process.exit(1);
});
