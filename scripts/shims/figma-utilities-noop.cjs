/**
 * No-op shim for @create-figma-plugin/utilities
 * Used by headless agent runner to bypass Figma-specific IPC.
 */
module.exports = {
  on: function() {},
  emit: function() {},
  once: function() {},
};
