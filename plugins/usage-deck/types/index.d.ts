export type Meter = { label: string; percent: number; note: string }

declare module 'claude-code' {
  interface PluginState {
    'usage-deck': { meters: Meter[]; isHidden: boolean; frame: number; isWorking: boolean }
  }
}
