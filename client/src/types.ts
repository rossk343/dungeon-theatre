export interface Token {
  id: string
  name: string
  color: string
  hp: number
  maxHp: number
  imageUrl: string | null
}

export interface Scene {
  id: string
  name: string
  width: number
  height: number
  gridSize: number
  gridOffsetX: number
  gridOffsetY: number
  imageUrl: string | null
}

export interface Placement {
  sceneId: string
  tokenId: string
  x: number
  y: number
}

export interface GameState {
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
