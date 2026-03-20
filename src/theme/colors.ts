/**
 * App-level color constants
 * Terminal color presets are in src/types/index.ts (COLOR_PRESETS)
 */

export const appColors = {
  background: '#1a1a1a',
  surface: '#242424',
  surfaceHover: '#2e2e2e',
  messageBubble: '#3a3a3a',
  border: '#333333',
  text: '#f5f5f5',
  textSecondary: '#a0a0a0',
  textMuted: '#666666',
  accent: '#d97706',       // BAT claude-code orange
  accentDim: '#92400e',
  error: '#ef4444',
  errorDim: '#7f1d1d',
  success: '#22c55e',
  successDim: '#14532d',
  warning: '#f59e0b',
  info: '#3b82f6',
  codeInline: '#93c5fd',    // light blue, distinct from accent orange

  // Agent preset colors
  agentClaudeCode: '#d97706',
  agentGemini: '#4285f4',
  agentCodex: '#10a37f',
  agentCopilot: '#6e40c9',
  agentTerminal: '#888888',
}

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
}

export const fontSize = {
  xs: 10,
  sm: 12,
  md: 14,
  lg: 16,
  xl: 18,
  xxl: 22,
  title: 28,
}
