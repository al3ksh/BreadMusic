const { REST, Routes } = require('discord.js');
const { loadConfig } = require('./config');
const { commands } = require('./commands');

async function register() {
  const config = loadConfig();
  const rest = new REST({ version: '10' }).setToken(config.token);
  const body = commands.map((command) => command.data.toJSON());
  const isGuildId = (value) => /^\d{17,20}$/.test(String(value || '').trim());
  const cleanupGuildIds = [...new Set([
    ...(config.commandCleanupGuildIds || []),
    config.guildId,
    ...(config.commandGuildIds || []),
  ].map((guildId) => String(guildId).trim()).filter(isGuildId))];

  try {
    for (const guildId of cleanupGuildIds) {
      await rest.put(Routes.applicationGuildCommands(config.clientId, guildId), { body: [] });
      console.log(`Removed old commands for guild ${guildId}.`);
    }
    const existingGlobalCommands = await rest.get(Routes.applicationCommands(config.clientId));
    const entryPoint = Array.isArray(existingGlobalCommands)
      ? existingGlobalCommands.find((command) => command.type === 4)
      : null;
    const globalBody = entryPoint
      ? [...body, pickEntryPointCommandFields(entryPoint)]
      : body;

    if (entryPoint) {
      console.log(`Preserving Activity Entry Point command ${entryPoint.name || entryPoint.id}.`);
    }
    console.log('Registering global slash commands...');
    await rest.put(Routes.applicationCommands(config.clientId), { body: globalBody });
    console.log('Registered global commands. Discord may take up to an hour to propagate changes.');
    process.exitCode = 0;
  } catch (error) {
    console.error('Command registration failed:', error?.message ?? error);
    process.exitCode = 1;
  }
}

function pickEntryPointCommandFields(command) {
  const fields = [
    'id',
    'name',
    'name_localizations',
    'description',
    'description_localizations',
    'type',
    'handler',
    'integration_types',
    'contexts',
    'default_member_permissions',
    'dm_permission',
    'default_permission',
    'nsfw',
  ];

  return Object.fromEntries(fields
    .filter((field) => typeof command[field] !== 'undefined')
    .map((field) => [field, command[field]]));
}

register()
  .then(() => process.exit(process.exitCode || 0))
  .catch((error) => {
    console.error('Command registration failed:', error?.message ?? error);
    process.exit(1);
  });
