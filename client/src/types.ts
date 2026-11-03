export interface Token {
  id: string
  name: string
  color: string
  hp: number
  maxHp: number
  speedFeet: number
  imageUrl: string | null
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
}

export interface MoveResult {
  placement: Placement
  accepted: boolean
  reason: string | null
  combat: Combat | null
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
