async function deleteInteractionReply(interaction) {
  if (!interaction) return;
  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.deleteReply();
    }
  } catch (error) {
    if (error.code !== 10008) {
      console.error('Failed to delete interaction reply:', error);
    }
  }
}

module.exports = {
  deleteInteractionReply,
};
