export interface Token {
  id: string
  name: string
  color: string
  hp: number
  maxHp: number
  speedFeet: number
  armorClass: number | null
  visionFeet: number
  lightFeet: number
  isPlayer: boolean
  imageUrl: string | null
}

export interface AuthUser {
  id: string
  displayName: string
  role: 'gm' | 'player'
  isGuest: boolean
}

export interface Session {
  user: AuthUser
  inviteCode: string | null
}

export interface InitiativeEntry {
  tokenId: string
  initiative: number
}

export interface Combat {
  sceneId: string
  active: boolean
  round: number
  currentTokenId: string | null
  movedFeet: number
  entries: InitiativeEntry[]
  turnStartX: number | null
  turnStartY: number | null
}

export interface DiceGroup {
  count: number
  sides: number
}

export interface DiceRoll {
  roller: string
  groups: (DiceGroup & { rolls: number[] })[]
  modifier: number
  total: number
}

export interface MoveResult {
  placement: Placement
  accepted: boolean
  reason: string | null
  combat: Combat | null
}

export interface MovementResetResult {
  placement: Placement
  combat: Combat
}

export interface Chapter {
  id: string
  name: string
  sortOrder: number
}

export interface Scene {
  id: string
  chapterId: string
  name: string
  sortOrder: number
  width: number
  height: number
  gridSize: number
  gridOffsetX: number
  gridOffsetY: number
  feetPerSquare: number
  imageUrl: string | null
  fogAreas: FogArea[]
  walls: Wall[]
}

export interface Wall {
  id: string
  x1: number
  y1: number
  x2: number
  y2: number
}

export interface FogPoint {
  x: number
  y: number
}

export interface FogArea {
  id: string
  points: FogPoint[]
}

export interface Placement {
  sceneId: string
  tokenId: string
  x: number
  y: number
}

export interface GameState {
  gameName: string
  chapters: Chapter[]
  scenes: Scene[]
  tokens: Token[]
  activeSceneId: string | null
}

// Unsaved calibration shown live on the canvas before it is committed.
export interface GridPreview {
  sceneId: string
  gridSize: number
  gridOffsetX: number
  gridOffsetY: number
}

export const MIN_GRID = 10
export const MAX_GRID = 500
