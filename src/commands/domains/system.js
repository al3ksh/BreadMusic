const createSystemCommands = (context) => {
  const {
    SlashCommandBuilder,
  } = context;
  return [
  {
    data: new SlashCommandBuilder().setName('ping').setDescription('Check latency.'),
    async execute(interaction) {
      const { resource } = await interaction.reply({ content: 'Ping...', withResponse: true });
      const latency = resource.message.createdTimestamp - interaction.createdTimestamp;
      await interaction.editReply(`Pong! Websocket: ${interaction.client.ws.ping}ms | RTT: ${latency}ms`);
    },
  },
  ];
};

module.exports = { createSystemCommands };
