const {
  EQ_GROUPS,
  EQ_RANGE_DB,
  SOUND_PRESETS,
  TEMPO_MAX,
  TEMPO_MIN,
  applySound,
  defaultSoundState,
  getSoundState,
  isDefaultSound,
  normalizeSoundState,
} = require('../../music/sound');
const defaultLibrary = require('../../music/library');

const COMPONENT_PREFIX = 'sound:';
const EQ_STEP_DB = 1;
const TEMPO_STEP = 0.05;
const BAR_HALF = EQ_RANGE_DB;
const KNOBS = [
  ...EQ_GROUPS.map((group, index) => ({ id: group.id, label: group.label, kind: 'eq', index })),
  { id: 'speed', label: 'Speed', kind: 'tempo' },
  { id: 'pitch', label: 'Pitch', kind: 'tempo' },
];
const DEFAULT_KNOB = 'bass';
const SAVED_PREFIX = 'mine:';
const SAVE_NAME_INPUT = 'name';

function findKnob(id) {
  return KNOBS.find((knob) => knob.id === id) ?? KNOBS.find((knob) => knob.id === DEFAULT_KNOB);
}

// Moves one knob by `steps` and returns the new full state; `null` steps puts the knob back to neutral.
function adjustSound(state, knobId, steps) {
  const knob = findKnob(knobId);
  const next = normalizeSoundState(state);
  if (knob.kind === 'eq') {
    next.eq[knob.index] = steps === null ? 0 : next.eq[knob.index] + steps * EQ_STEP_DB;
  } else {
    next[knob.id] = steps === null ? 1 : next[knob.id] + steps * TEMPO_STEP;
  }
  return normalizeSoundState(next);
}

function formatDb(value) {
  if (value === 0) return '0 dB';
  return `${value > 0 ? '+' : ''}${Number.isInteger(value) ? value : value.toFixed(1)} dB`;
}

// A centred text slider: cuts fill to the left of the middle line, boosts to the right.
function eqBar(value) {
  const cells = Math.round(Math.abs(value));
  const left = '─'.repeat(BAR_HALF - (value < 0 ? cells : 0)) + '█'.repeat(value < 0 ? cells : 0);
  const right = '█'.repeat(value > 0 ? cells : 0) + '─'.repeat(BAR_HALF - (value > 0 ? cells : 0));
  return `${left}┃${right}`;
}

function describeSound(state, selectedKnob) {
  const rows = KNOBS.map((knob) => {
    const marker = knob.id === selectedKnob ? '▶' : ' ';
    const label = knob.label.padEnd(8);
    if (knob.kind === 'eq') {
      const value = state.eq[knob.index];
      return `${marker} ${label} ${eqBar(value)} ${formatDb(value)}`;
    }
    return `${marker} ${label} ${state[knob.id].toFixed(2)}x`;
  });
  return `\`\`\`\n${rows.join('\n')}\n\`\`\``;
}

function buildSoundPanel(context, { guildId, state, knob = DEFAULT_KNOB, saved = [] }) {
  const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder,
    BRAND_COLORS,
  } = context;
  const selected = findKnob(knob);
  const presetLabel = state.preset ? SOUND_PRESETS[state.preset].label : 'Off';

  const embed = new EmbedBuilder()
    .setTitle('🎚️ Sound')
    .setDescription(`Preset: **${presetLabel}**${isDefaultSound(state) ? ' · flat' : ''}\n${describeSound(state, selected.id)}`)
    .setColor(BRAND_COLORS.secondary ?? BRAND_COLORS.primary)
    .setFooter({ text: 'Changes apply live and stay in sync with the Activity and dashboard.' });

  const presetMenu = new StringSelectMenuBuilder()
    .setCustomId(`${COMPONENT_PREFIX}${guildId}:preset:${selected.id}`)
    .setPlaceholder('Preset')
    .addOptions(
      { label: 'No preset', value: 'off', description: 'Just the EQ, speed and pitch below.', default: !state.preset },
      ...Object.entries(SOUND_PRESETS).map(([value, preset]) => ({
        label: preset.label,
        value,
        description: preset.description.slice(0, 100),
        default: state.preset === value,
      })),
      // 1 + 9 built-in presets + up to 15 saved ones fits the 25-option limit.
      ...saved.slice(0, 15).map((entry) => ({
        label: `⭐ ${entry.name}`.slice(0, 100),
        value: `${SAVED_PREFIX}${entry.id}`,
        description: 'Your saved sound: preset, EQ, speed and pitch.',
      })),
    );

  const knobMenu = new StringSelectMenuBuilder()
    .setCustomId(`${COMPONENT_PREFIX}${guildId}:knob`)
    .setPlaceholder('Pick what the buttons change')
    .addOptions(KNOBS.map((entry) => ({
      label: entry.label,
      value: entry.id,
      description: entry.kind === 'eq' ? `Equalizer, ±${EQ_RANGE_DB} dB` : `${TEMPO_MIN}x to ${TEMPO_MAX}x`,
      default: entry.id === selected.id,
    })));

  const step = selected.kind === 'eq' ? `${EQ_STEP_DB} dB` : `${TEMPO_STEP}x`;
  const button = (action, label, style = ButtonStyle.Secondary) => new ButtonBuilder()
    .setCustomId(`${COMPONENT_PREFIX}${guildId}:${action}:${selected.id}`)
    .setLabel(label)
    .setStyle(style);

  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(presetMenu),
      new ActionRowBuilder().addComponents(knobMenu),
      new ActionRowBuilder().addComponents(
        button('down', `${selected.label} −${step}`),
        button('up', `${selected.label} +${step}`, ButtonStyle.Primary),
        button('zero', `Center ${selected.label}`),
        button('reset', 'Reset all', ButtonStyle.Danger),
        button('saveas', 'Save as…', ButtonStyle.Success),
      ),
    ],
  };
}

const createSoundCommands = (context) => {
  const {
    SlashCommandBuilder,
    MessageFlags,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ActionRowBuilder,
    ensurePlayer,
    assertDJ,
    CommandError,
    queuePersist,
    library = defaultLibrary,
  } = context;

  async function commit(interaction, player, state) {
    const applied = await applySound(player, state);
    await queuePersist(player);
    try {
      await interaction.client.musicUI?.refresh(player);
    } catch {
      // The now-playing message is cosmetic; the sound change already went through.
    }
    return applied;
  }

  const savedFor = (interaction) => library.listSounds(interaction.user?.id);
  const panel = (interaction, guildId, state, knob) =>
    buildSoundPanel(context, { guildId, state, knob, saved: savedFor(interaction) });

  function savedSound(interaction, idOrName) {
    const entry = library.findSound(interaction.user?.id, idOrName);
    if (!entry) throw new CommandError('You have no saved sound with that name. Save one with **Save as…** in `/sound`.');
    return entry;
  }

  return [
    {
      componentPrefix: COMPONENT_PREFIX,
      data: new SlashCommandBuilder()
        .setName('sound')
        .setDescription('Equalizer, presets, speed and pitch.')
        .addStringOption((option) => option
          .setName('preset')
          .setDescription('Switch preset straight away (the panel still opens).')
          .addChoices(
            { name: 'No preset', value: 'off' },
            ...Object.entries(SOUND_PRESETS).map(([value, preset]) => ({ name: preset.label, value })),
          ))
        .addStringOption((option) => option
          .setName('saved')
          .setDescription('Load one of your saved sounds.')
          .setAutocomplete(true))
        .addStringOption((option) => option
          .setName('forget')
          .setDescription('Delete one of your saved sounds.')
          .setAutocomplete(true))
        .addBooleanOption((option) => option
          .setName('reset')
          .setDescription('Reset everything to flat before opening the panel.')),
      async autocomplete(interaction) {
        const term = String(interaction.options.getFocused() ?? '').toLowerCase();
        const choices = savedFor(interaction)
          .filter((entry) => entry.name.toLowerCase().includes(term))
          .slice(0, 25)
          .map((entry) => ({ name: entry.name, value: entry.id }));
        await interaction.respond(choices);
      },
      async execute(interaction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const forget = interaction.options.getString('forget');
        if (forget) {
          const removed = library.removeSound(interaction.user?.id, forget);
          if (!removed) throw new CommandError('You have no saved sound with that name.');
          await interaction.editReply(`Deleted your saved sound **${removed.name}**.`);
          return;
        }

        const { player, config } = await ensurePlayer(interaction, { requireSameChannel: true });
        assertDJ(interaction, config);

        let state = getSoundState(player);
        const preset = interaction.options.getString('preset');
        const saved = interaction.options.getString('saved');
        const reset = interaction.options.getBoolean('reset') === true;
        if (reset || preset || saved) {
          state = reset ? defaultSoundState() : state;
          if (saved) state = normalizeSoundState(savedSound(interaction, saved).sound);
          if (preset) state = { ...state, preset: preset === 'off' ? null : preset };
          state = await commit(interaction, player, state);
        }
        await interaction.editReply(panel(interaction, interaction.guildId, state));
      },
      async handleComponent(interaction) {
        const [guildId, action, knobId] = interaction.customId.slice(COMPONENT_PREFIX.length).split(':');
        if (guildId !== interaction.guildId) throw new CommandError('This panel belongs to another server.');

        // Opening the name prompt must be the first reply, so it skips the player lookup.
        if (action === 'saveas') {
          await interaction.showModal(new ModalBuilder()
            .setCustomId(`${COMPONENT_PREFIX}${guildId}:save:${findKnob(knobId).id}`)
            .setTitle('Save this sound')
            .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder()
              .setCustomId(SAVE_NAME_INPUT)
              .setLabel('Name')
              .setPlaceholder('Late night bass')
              .setStyle(TextInputStyle.Short)
              .setMaxLength(library.LIBRARY_LIMITS.soundName)
              .setRequired(true))));
          return;
        }

        const { player, config } = await ensurePlayer(interaction, { requireSameChannel: true });
        const current = getSoundState(player);

        // Saving only copies the current sound into your own library, so it needs no DJ rights.
        if (action === 'save') {
          const result = library.saveSound(interaction.user?.id, interaction.fields.getTextInputValue(SAVE_NAME_INPUT), current);
          if (!result.ok) {
            throw new CommandError(result.reason === 'limit'
              ? `You can keep up to ${library.LIBRARY_LIMITS.sounds} saved sounds. Delete one with \`/sound forget\`.`
              : 'Give the sound a name.');
          }
          await interaction.update(panel(interaction, guildId, current, knobId));
          await interaction.followUp({
            content: `⭐ ${result.replaced ? 'Updated' : 'Saved'} **${result.entry.name}**. Load it from the preset menu or with \`/sound saved\`.`,
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        assertDJ(interaction, config);
        if (action === 'knob') {
          await interaction.update(panel(interaction, guildId, current, interaction.values?.[0]));
          return;
        }

        let next;
        if (action === 'preset') {
          const value = interaction.values?.[0] ?? '';
          if (value.startsWith(SAVED_PREFIX)) next = savedSound(interaction, value.slice(SAVED_PREFIX.length)).sound;
          else next = { ...current, preset: value === 'off' ? null : value };
        } else if (action === 'up') next = adjustSound(current, knobId, 1);
        else if (action === 'down') next = adjustSound(current, knobId, -1);
        else if (action === 'zero') next = adjustSound(current, knobId, null);
        else if (action === 'reset') next = defaultSoundState();
        else return;

        const state = await commit(interaction, player, normalizeSoundState(next));
        await interaction.update(panel(interaction, guildId, state, knobId));
      },
    },
  ];
};

module.exports = { createSoundCommands, buildSoundPanel, SAVED_PREFIX, adjustSound, eqBar, KNOBS, COMPONENT_PREFIX };
