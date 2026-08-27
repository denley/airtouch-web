// Shared state contract between the bridge server and the web app.

export type AcMode = 'auto' | 'heat' | 'dry' | 'fan' | 'cool'
export type FanSpeed =
  | 'auto'
  | 'quiet'
  | 'low'
  | 'medium'
  | 'high'
  | 'powerful'
  | 'turbo'
  | 'intelligent'
export type AcPower = 'off' | 'on' | 'awayOff' | 'awayOn' | 'sleep'
export type ZonePower = 'off' | 'on' | 'turbo'

export interface AcAbility {
  name: string
  startZone: number
  zoneCount: number
  modes: AcMode[]
  fanSpeeds: FanSpeed[]
  minCool: number
  maxCool: number
  minHeat: number
  maxHeat: number
}

export interface TimerState {
  enabled: boolean
  hour: number
  minute: number
}

export interface AcState {
  id: number
  name: string
  power: AcPower
  mode: AcMode
  fanSpeed: FanSpeed
  setpoint: number | null
  currentTemp: number | null
  turbo: boolean
  bypass: boolean
  spill: boolean
  timerSet: boolean
  errorCode: number
  errorText: string | null
  timers: { on: TimerState; off: TimerState } | null
  ability: AcAbility | null
}

export interface ZoneState {
  id: number
  name: string
  power: ZonePower
  controlMethod: 'temp' | 'percent'
  openPercent: number
  setpoint: number | null
  currentTemp: number | null
  hasSensor: boolean
  spill: boolean
  lowBattery: boolean
  /** The reading hasn't changed for hours — the sensor may have stopped reporting. */
  tempStale?: boolean
}

export type ConnectionStatus = 'unconfigured' | 'connecting' | 'connected' | 'disconnected'

export interface ConnectionState {
  status: ConnectionStatus
  consoleIp?: string
  consoleName?: string
  airtouchId?: string
  version?: string
}

export interface AppState {
  connection: ConnectionState
  acs: AcState[]
  zones: ZoneState[]
}

export interface DiscoveredConsole {
  ip: string
  consoleId?: string
  name?: string
  airtouchId?: string
}

// Commands the web app can send over the WebSocket.
export type Command =
  | { cmd: 'connect'; ip: string; name?: string }
  | { cmd: 'discover' }
  | { cmd: 'ac.power'; ac: number; state: 'on' | 'off' | 'away' | 'sleep' }
  | { cmd: 'ac.mode'; ac: number; mode: AcMode }
  | { cmd: 'ac.fan'; ac: number; speed: FanSpeed }
  | { cmd: 'ac.setpoint'; ac: number; value: number }
  | { cmd: 'ac.quickTimer'; ac: number; type: 'on' | 'off'; minutes: number }
  | { cmd: 'ac.cancelTimer'; ac: number; type: 'on' | 'off' }
  | { cmd: 'zone.power'; zone: number; state: ZonePower }
  | { cmd: 'zone.percent'; zone: number; value: number }
  | { cmd: 'zone.setpoint'; zone: number; value: number }
  | { cmd: 'zones.allPower'; state: ZonePower }

export type ServerMessage =
  | { type: 'state'; state: AppState }
  | { type: 'discovered'; consoles: DiscoveredConsole[] }
  | { type: 'error'; error: string }
