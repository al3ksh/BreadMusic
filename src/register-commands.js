const { REST, Routes } = require('discord.js');
const { loadConfig } = require('./config');
const { commands } = require('./commands');

async function register() {
  const config = loadConfig();
  const rest = new REST({ version: '10' }).setToken(config.token);
  const body = commands.map((command) => command.data.toJSON());

  const route = config.guildId
    ? Routes.applicationGuildCommands(config.clientId, config.guildId)
    : Routes.applicationCommands(config.clientId);

  try {
    console.log('Registering slash commands...');
    await rest.put(route, { body });
    console.log('Registered commands.');
  } catch (error) {
    console.error('Command registration failed:', error?.message ?? error);
    process.exitCode = 1;
  }
}

register();
