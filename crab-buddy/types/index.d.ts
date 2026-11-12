// true once /crab-away took the crab out of this chat; /crab puts him back
export type CrabAway = boolean
// the chat's latest prompt, cut short: how the crab's menu names the chat
export type CrabTitle = string

declare module 'claude-code' {
  interface PluginState {
    'crab-buddy': { isAway: CrabAway; title: CrabTitle }
  }
}
