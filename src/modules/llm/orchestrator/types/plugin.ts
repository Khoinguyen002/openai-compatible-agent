// Plugin configuration
export type Plugin = {
  id: string; // 'web', 'file-parser', 'response-healing', 'context-compression'
  enabled?: boolean;
  // Additional plugin-specific options
  [key: string]: unknown;
};
