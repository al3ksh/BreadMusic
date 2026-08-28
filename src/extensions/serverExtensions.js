const path = require('path');

function parseExtensionPaths(value) {
  return String(value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function createServerExtensionHost(value = process.env.BREAD_SERVER_EXTENSION_PATHS) {
  const extensions = [];
  for (const configuredPath of parseExtensionPaths(value)) {
    if (!path.isAbsolute(configuredPath)) {
      console.warn(`[Extensions] Ignoring non-absolute module path: ${configuredPath}`);
      continue;
    }
    try {
      const extension = require(configuredPath);
      if (!extension || typeof extension !== 'object') throw new Error('module must export an object');
      extensions.push(extension);
      console.log(`[Extensions] Loaded ${extension.name || path.basename(configuredPath)}`);
    } catch (error) {
      console.error(`[Extensions] Failed to load ${configuredPath}:`, error.message);
    }
  }

  return {
    count: extensions.length,
    async resolveGuildAccess(context) {
      for (const extension of extensions) {
        if (typeof extension.resolveGuildAccess !== 'function') continue;
        const capabilities = await extension.resolveGuildAccess(context);
        if (capabilities) return capabilities;
      }
      return null;
    },
    attach(app, context) {
      for (const extension of extensions) {
        if (typeof extension.attach === 'function') extension.attach(app, context);
      }
    },
  };
}

module.exports = { createServerExtensionHost, parseExtensionPaths };
