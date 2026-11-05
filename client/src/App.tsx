import { useCallback, useEffect, useRef, useState } from 'react'
import { HubConnectionBuilder, type HubConnection } from '@microsoft/signalr'
import Konva from 'konva'
import { Circle, Group, Image as KonvaImage, Layer, Line, Rect, Stage, Text } from 'react-konva'
import useImage from 'use-image'
import {
  createChapter, createScene, createToken, deleteChapter, deleteScene, deleteToken, getAuthStatus, getSession, joinAsGuest,
  login, logout, moveScene, regenerateInvite, register, renameChapter, replaceSceneImage, setTokenImage,
} from './api'
import { AuthScreen } from './AuthScreen'
import { ChapterTree } from './ChapterTree'
import { InitiativeTracker } from './InitiativeTracker'
import { NewSceneForm, NewTokenForm, SceneSettings } from './SceneSettings'
import { TokenDisc } from './TokenDisc'
import { getHealthColor, getHealthCondition } from './tokenHealth'
import type { Chapter, Combat, DiceRoll, FogArea, FogPoint, GameState, GridPreview, MoveResult, MovementResetResult, Placement, Scene, Session, Token, Wall } from './types'
import './App.css'

const SEND_INTERVAL_MS = 50
const MIN_ZOOM = 0.1
const MAX_ZOOM = 4

type View = {
  x: number
  y: number
  scale: number
  viewportWidth?: number
  viewportHeight?: number
}

type SharedView = {
  centerX: number
  centerY: number
  zoom: number
}

const VIEWS_KEY = 'sceneViews'

// Views survive reloads; anything malformed is dropped.
function loadViews(): Record<string, View> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(VIEWS_KEY) ?? '{}')
    if (!raw || typeof raw !== 'object') return {}
    const ok = (v: unknown): v is View => {
      if (!v || typeof v !== 'object') return false
      const view = v as Record<string, unknown>
      return (
        ['x', 'y', 'scale'].every((k) => typeof view[k] === 'number' && Number.isFinite(view[k])) &&
        (view.viewportWidth === undefined || (typeof view.viewportWidth === 'number' && view.viewportWidth > 0)) &&
        (view.viewportHeight === undefined || (typeof view.viewportHeight === 'number' && view.viewportHeight > 0))
      )
    }
    return Object.fromEntries(Object.entries(raw).filter(([, v]) => ok(v)))
  } catch {
    return {}
  }
}

function fitToViewport(scene: Scene, viewport: { width: number; height: number }): View {
  const scale = Math.min(MAX_ZOOM, viewport.width / scene.width, viewport.height / scene.height)
  return {
    scale,
    x: (viewport.width - scene.width * scale) / 2,
    y: (viewport.height - scene.height * scale) / 2,
    viewportWidth: viewport.width,
    viewportHeight: viewport.height,
  }
}

function adaptViewToViewport(
  scene: Scene,
  saved: View,
  viewport: { width: number; height: number },
): View {
  if (!saved.viewportWidth || !saved.viewportHeight)
    return fitToViewport(scene, viewport)
  if (saved.viewportWidth === viewport.width && saved.viewportHeight === viewport.height) return saved

  const oldViewport = { width: saved.viewportWidth, height: saved.viewportHeight }
  const oldFit = fitToViewport(scene, oldViewport)
  const nextFit = fitToViewport(scene, viewport)
  const isFit =
    Math.abs(saved.scale - oldFit.scale) < 0.001 &&
    Math.abs(saved.x - oldFit.x) < 1 &&
    Math.abs(saved.y - oldFit.y) < 1
  if (isFit) return nextFit

  const scale = saved.scale * (nextFit.scale / oldFit.scale)
  const centerX = (oldViewport.width / 2 - saved.x) / saved.scale
  const centerY = (oldViewport.height / 2 - saved.y) / saved.scale
  return {
    scale,
    x: viewport.width / 2 - centerX * scale,
    y: viewport.height / 2 - centerY * scale,
    viewportWidth: viewport.width,
    viewportHeight: viewport.height,
  }
}

function viewFromShared(
  scene: Scene,
  sharedView: SharedView,
  viewport: { width: number; height: number },
): View {
  const fit = fitToViewport(scene, viewport)
  const scale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, fit.scale * sharedView.zoom))
  return {
    scale,
    x: viewport.width / 2 - sharedView.centerX * scale,
    y: viewport.height / 2 - sharedView.centerY * scale,
    viewportWidth: viewport.width,
    viewportHeight: viewport.height,
  }
}

function shareableView(
  scene: Scene,
  view: View,
  viewport: { width: number; height: number },
): SharedView {
  const fit = fitToViewport(scene, viewport)
  return {
    centerX: (viewport.width / 2 - view.x) / view.scale,
    centerY: (viewport.height / 2 - view.y) / view.scale,
    zoom: view.scale / fit.scale,
  }
}

// Middle-button panning is handled manually on the stage, so Konva drags only react to the left button.
Konva.dragButtons = [0]

const snap = (v: number, grid: number, offset: number) =>
  Math.round((v - offset - grid / 2) / grid) * grid + offset + grid / 2

// True when segment a-b touches or crosses segment c-d.
function segmentsIntersect(a: FogPoint, b: FogPoint, c: FogPoint, d: FogPoint): boolean {
  const cross = (o: FogPoint, p: FogPoint, q: FogPoint) => (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x)
  const onSegment = (p: FogPoint, q: FogPoint, r: FogPoint) =>
    Math.min(p.x, q.x) <= r.x && r.x <= Math.max(p.x, q.x) && Math.min(p.y, q.y) <= r.y && r.y <= Math.max(p.y, q.y)
  const d1 = cross(c, d, a)
  const d2 = cross(c, d, b)
  const d3 = cross(a, b, c)
  const d4 = cross(a, b, d)
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true
  return (d1 === 0 && onSegment(c, d, a)) || (d2 === 0 && onSegment(c, d, b)) ||
    (d3 === 0 && onSegment(a, b, c)) || (d4 === 0 && onSegment(a, b, d))
}

// Flat [x, y, ...] polygon of what is visible from a point within `radius`, blocked by wall segments.
function computeVisibility(ox: number, oy: number, radius: number, allWalls: Wall[]): number[] {
  const walls = allWalls.filter((w) =>
    Math.min(w.x1, w.x2) <= ox + radius && Math.max(w.x1, w.x2) >= ox - radius &&
    Math.min(w.y1, w.y2) <= oy + radius && Math.max(w.y1, w.y2) >= oy - radius)
  const angles: number[] = []
  const arcSteps = 72
  for (let i = 0; i < arcSteps; i++) angles.push((i / arcSteps) * Math.PI * 2 - Math.PI)
  for (const w of walls) {
    for (const [px, py] of [[w.x1, w.y1], [w.x2, w.y2]]) {
      const a = Math.atan2(py - oy, px - ox)
      angles.push(a - 0.0001, a, a + 0.0001)
    }
  }
  angles.sort((a, b) => a - b)
  const points: number[] = []
  for (const angle of angles) {
    const dx = Math.cos(angle)
    const dy = Math.sin(angle)
    let nearest = radius
    for (const w of walls) {
      const sx = w.x2 - w.x1
      const sy = w.y2 - w.y1
      const denom = dx * sy - dy * sx
      if (Math.abs(denom) < 1e-9) continue
      const t = ((w.x1 - ox) * sy - (w.y1 - oy) * sx) / denom
      const u = ((w.x1 - ox) * dy - (w.y1 - oy) * dx) / denom
      // A small overshoot closes hairline gaps where two walls meet.
      const slack = 1.5 / Math.hypot(sx, sy)
      if (t >= 0 && u >= -slack && u <= 1 + slack && t < nearest) nearest = t
    }
    points.push(ox + dx * nearest, oy + dy * nearest)
  }
  return points
}

const bySort = (a: { sortOrder: number; name: string }, b: { sortOrder: number; name: string }) =>
  a.sortOrder - b.sortOrder || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)

function MapImage({ scene }: { scene: Scene }) {
  const [image] = useImage(scene.imageUrl ?? '')
  if (!scene.imageUrl || !image) return null
  return <KonvaImage image={image} width={scene.width} height={scene.height} />
}

function GridLines({ scene }: { scene: Scene }) {
  const lines = []
  for (let x = scene.gridOffsetX; x <= scene.width; x += scene.gridSize)
    lines.push(<Line key={`v${x}`} points={[x, 0, x, scene.height]} stroke="rgba(232,224,208,0.35)" strokeWidth={1} />)
  for (let y = scene.gridOffsetY; y <= scene.height; y += scene.gridSize)
    lines.push(<Line key={`h${y}`} points={[0, y, scene.width, y]} stroke="rgba(232,224,208,0.35)" strokeWidth={1} />)
  return <>{lines}</>
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [hasUsers, setHasUsers] = useState(false)
  const [authError, setAuthError] = useState<string | null>(null)
  const [scenes, setScenes] = useState<Scene[]>([])
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [gameName, setGameName] = useState('')
  const [tokens, setTokens] = useState<Token[]>([])
  const [placements, setPlacements] = useState<Placement[]>([])
  const [dragPreview, setDragPreview] = useState<{ tokenId: string; x: number; y: number } | null>(null)
  const [combat, setCombat] = useState<Combat | null>(null)
  const [lastDiceRoll, setLastDiceRoll] = useState<DiceRoll | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const noticeTimer = useRef<number | undefined>(undefined)
  const [sceneId, setSceneId] = useState<string | null>(null)
  const [activeSceneId, setActiveSceneId] = useState<string | null>(null)
  const [preview, setPreview] = useState<GridPreview | null>(null)
  const [fogDrawing, setFogDrawing] = useState(false)
  const [pendingFogPoints, setPendingFogPoints] = useState<FogPoint[]>([])
  const [fogCursor, setFogCursor] = useState<FogPoint | null>(null)
  const [fogScreenCursor, setFogScreenCursor] = useState<FogPoint | null>(null)
  const [hoveredFogId, setHoveredFogId] = useState<string | null>(null)
  const [wallDrawing, setWallDrawing] = useState(false)
  const [wallStart, setWallStart] = useState<FogPoint | null>(null)
  const [wallCursor, setWallCursor] = useState<FogPoint | null>(null)
  const [hoveredWallId, setHoveredWallId] = useState<string | null>(null)
  const [measureActive, setMeasureActive] = useState(false)
  const [measureLine, setMeasureLine] = useState<{ start: FogPoint; end: FogPoint; dragging: boolean } | null>(null)

  useEffect(() => {
    if (!measureActive) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (measureLine) setMeasureLine(null)
      else setMeasureActive(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [measureActive, measureLine])

  useEffect(() => {
    if (!wallDrawing) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      // First Esc ends the current chain; a second one leaves wall mode.
      if (wallStart) setWallStart(null)
      else {
        setWallDrawing(false)
        setWallCursor(null)
        setFogScreenCursor(null)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [wallDrawing, wallStart])

  useEffect(() => {
    if (!fogDrawing) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setFogDrawing(false)
      setPendingFogPoints([])
      setFogCursor(null)
      setFogScreenCursor(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [fogDrawing])
  const [status, setStatus] = useState('connecting')
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(() => localStorage.getItem('sidebarOpen') !== 'false')
  const [sidebarTab, setSidebarTab] = useState<'chapters' | 'scene' | 'tokens'>('chapters')
  const isGm = session?.user.role === 'gm'

  useEffect(() => {
    let active = true
    Promise.all([getAuthStatus(), getSession()])
      .then(([authStatus, currentSession]) => {
        if (!active) return
        setHasUsers(authStatus.hasUsers)
        setSession(currentSession)
      })
      .catch((e: unknown) => {
        if (active) setAuthError(e instanceof Error ? e.message : 'Could not load sign-in status.')
      })
      .finally(() => {
        if (active) setAuthLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  const toggleSidebar = () =>
    setSidebarOpen((open) => {
      localStorage.setItem('sidebarOpen', String(!open))
      return !open
    })
  const connection = useRef<HubConnection | null>(null)
  const sceneRef = useRef<string | null>(null)
  const scenesRef = useRef<Scene[]>([])
  const lastSent = useRef(0)

  useEffect(() => {
    scenesRef.current = scenes
  }, [scenes])

  const savedScene = scenes.find((s) => s.id === sceneId) ?? null
  // The preview only applies to the scene it was made for.
  const scene: Scene | null =
    savedScene && preview?.sceneId === savedScene.id ? { ...savedScene, ...preview } : savedScene
  const viewportRef = useRef<HTMLDivElement>(null)
  const [viewport, setViewport] = useState({ width: 800, height: 600 })
  const [views, setViews] = useState<Record<string, View>>(loadViews)
  const viewKey = scene ? `${scene.id}:${scene.imageUrl ?? ''}` : ''
  const fitView = scene ? fitToViewport(scene, viewport) : { x: 0, y: 0, scale: 1 }
  // Each scene (and image) remembers its own view; one never visited shows the whole map.
  const savedView = views[viewKey]
  const view = scene && savedView ? adaptViewToViewport(scene, savedView, viewport) : fitView
  const setView = (v: View) =>
    setViews((prev) => ({
      ...prev,
      [viewKey]: { ...v, viewportWidth: viewport.width, viewportHeight: viewport.height },
    }))

  useEffect(() => {
    localStorage.setItem(VIEWS_KEY, JSON.stringify(views))
  }, [views])

  useEffect(() => {
    if (!session) return
    const el = viewportRef.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) =>
      setViewport({ width: entry.contentRect.width, height: entry.contentRect.height }),
    )
    observer.observe(el)
    setViewport({ width: el.clientWidth, height: el.clientHeight })
    return () => observer.disconnect()
  }, [session])

  const zoomAt = (px: number, py: number, factor: number) => {
    const scale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.scale * factor))
    const k = scale / view.scale
    setView({ scale, x: px - (px - view.x) * k, y: py - (py - view.y) * k })
  }

  const joinScene = useCallback(async (id: string) => {
    const conn = connection.current
    if (!conn) return
    sceneRef.current = id
    setSceneId(id)
    setFogDrawing(false)
    setPendingFogPoints([])
    setFogCursor(null)
    setWallDrawing(false)
    setWallStart(null)
    setWallCursor(null)
    setMeasureActive(false)
    setMeasureLine(null)
    setPreview(null)
    setCombat(null)
    const [list, state] = await Promise.all([
      conn.invoke<Placement[]>('JoinScene', id),
      conn.invoke<Combat>('GetCombat', id),
    ])
    // Ignore the reply if the user already switched again.
    if (sceneRef.current === id) {
      setPlacements(list)
      setCombat(state)
    }
  }, [])

  const applyScene = useCallback((s: Scene) => {
    setScenes((prev) =>
      (prev.some((x) => x.id === s.id) ? prev.map((x) => (x.id === s.id ? s : x)) : [...prev, s]).sort(bySort),
    )
    setPreview((p) => (p?.sceneId === s.id ? null : p))
  }, [])

  const applyChapter = useCallback((c: Chapter) => {
    setChapters((prev) =>
      (prev.some((x) => x.id === c.id) ? prev.map((x) => (x.id === c.id ? c : x)) : [...prev, c]).sort(bySort),
    )
  }, [])

  const applyToken = useCallback((t: Token) => {
    setTokens((prev) =>
      prev.some((x) => x.id === t.id)
        ? prev.map((x) => (x.id === t.id ? t : x))
        : [...prev, t].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
    )
  }, [])

  const userId = session?.user.id

  useEffect(() => {
    if (!userId) return
    const conn = new HubConnectionBuilder().withUrl('/hubs/game').withAutomaticReconnect().build()
    connection.current = conn

    const upsertPlacement = (p: Placement) => {
      if (p.sceneId !== sceneRef.current) return
      setPlacements((prev) =>
        prev.some((x) => x.tokenId === p.tokenId)
          ? prev.map((x) => (x.tokenId === p.tokenId ? p : x))
          : [...prev, p],
      )
    }

    conn.on('PlacementMoved', upsertPlacement)
    conn.on('PlacementAdded', upsertPlacement)
    conn.on('PlacementRemoved', (sid: string, tokenId: string) => {
      if (sid === sceneRef.current) setPlacements((prev) => prev.filter((p) => p.tokenId !== tokenId))
    })
    conn.on('TokenAdded', applyToken)
    conn.on('CombatUpdated', (c: Combat) => {
      if (c.sceneId === sceneRef.current) setCombat(c)
    })
    conn.on('DiceRolled', (roll: DiceRoll) => setLastDiceRoll(roll))
    conn.on('TokenUpdated', applyToken)
    conn.on('TokenDeleted', (id: string) => {
      setTokens((prev) => prev.filter((t) => t.id !== id))
      setPlacements((prev) => prev.filter((p) => p.tokenId !== id))
    })
    conn.on('ChapterAdded', applyChapter)
    conn.on('ChapterUpdated', applyChapter)
    conn.on('ChapterDeleted', (id: string) => setChapters((prev) => prev.filter((c) => c.id !== id)))
    conn.on('SceneAdded', applyScene)
    conn.on('SceneUpdated', applyScene)
    conn.on('ActiveSceneChanged', (id: string | null, sharedView?: SharedView) => {
      setActiveSceneId(id)
      if (!id) return
      const applyView = () => {
        if (isGm || !sharedView || sceneRef.current !== id) return
        const activeScene = scenesRef.current.find((item) => item.id === id)
        const viewportElement = viewportRef.current
        if (!activeScene || !viewportElement) return
        const size = { width: viewportElement.clientWidth, height: viewportElement.clientHeight }
        const key = `${activeScene.id}:${activeScene.imageUrl ?? ''}`
        setViews((previous) => ({
          ...previous,
          [key]: viewFromShared(activeScene, sharedView, size),
        }))
      }
      if (sceneRef.current === id) {
        applyView()
        return
      }
      void joinScene(id)
        .then(applyView)
        .catch((e: unknown) =>
          setError(e instanceof Error ? e.message : 'Could not open the active scene.'),
        )
    })
    conn.on('PlayerViewChanged', (id: string, sharedView: SharedView) => {
      if (isGm || sceneRef.current !== id) return
      const currentScene = scenesRef.current.find((item) => item.id === id)
      const viewportElement = viewportRef.current
      if (!currentScene || !viewportElement) return
      const size = { width: viewportElement.clientWidth, height: viewportElement.clientHeight }
      const key = `${currentScene.id}:${currentScene.imageUrl ?? ''}`
      setViews((previous) => ({
        ...previous,
        [key]: viewFromShared(currentScene, sharedView, size),
      }))
    })
    conn.on('SceneDeleted', (id: string, nextActiveSceneId: string | null) => {
      setScenes((prev) => prev.filter((s) => s.id !== id))
      setActiveSceneId(nextActiveSceneId)
      setPreview((p) => (p?.sceneId === id ? null : p))
      if (sceneRef.current !== id) return
      const next = nextActiveSceneId ?? scenesRef.current.find((s) => s.id !== id)?.id
      if (next) void joinScene(next)
      else {
        sceneRef.current = null
        setSceneId(null)
        setPlacements([])
        setCombat(null)
      }
    })

    // Initial load and reconnect both rejoin the current scene.
    const load = async () => {
      const state = await conn.invoke<GameState>('GetState')
      setGameName(state.gameName)
      setChapters(state.chapters)
      setScenes(state.scenes)
      setTokens(state.tokens)
      setActiveSceneId(state.activeSceneId)
      // Players always join the GM's active scene; the GM may browse another scene locally.
      const first = state.chapters.flatMap((c) => state.scenes.filter((s) => s.chapterId === c.id))[0]
      const id = isGm ? sceneRef.current ?? state.activeSceneId ?? first?.id : state.activeSceneId ?? first?.id
      if (id) await joinScene(id)
      setStatus('connected')
    }

    conn.onreconnecting(() => setStatus('reconnecting'))
    conn.onreconnected(() => void load().catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not reconnect.')))
    conn.onclose(() => setStatus('disconnected'))
    conn.start().then(load).catch(async (e: unknown) => {
      setStatus('disconnected')
      try {
        const current = await getSession()
        if (!current) setSession(null)
        else setError(e instanceof Error ? e.message : 'Could not connect to the game.')
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : 'Could not connect to the game.')
      }
    })

    return () => {
      void conn.stop()
    }
  }, [userId, isGm, joinScene, applyScene, applyChapter, applyToken])

  const invoke = async <T,>(method: string, ...args: unknown[]): Promise<T | undefined> => {
    try {
      return await connection.current?.invoke<T>(method, ...args)
    } catch (e) {
      setError(e instanceof Error ? e.message : `Could not complete ${method}.`)
      return undefined
    }
  }

  const run = async <T,>(action: () => Promise<T>): Promise<T | null> => {
    setUploading(true)
    setError(null)
    try {
      return await action()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed.')
      return null
    } finally {
      setUploading(false)
    }
  }

  const handleLogin = async (username: string, password: string) => {
    const next = await login(username, password)
    setStatus('connecting')
    setSession(next)
    setAuthError(null)
    setError(null)
    return next
  }

  const handleRegister = async (username: string, password: string, displayName: string, inviteCode: string) => {
    const next = await register(username, password, displayName, inviteCode)
    setStatus('connecting')
    setSession(next)
    setHasUsers(true)
    setAuthError(null)
    setError(null)
    return next
  }

  const handleGuest = async (displayName: string, inviteCode: string) => {
    const next = await joinAsGuest(displayName, inviteCode)
    setStatus('connecting')
    setSession(next)
    setHasUsers(true)
    setAuthError(null)
    setError(null)
    return next
  }

  const handleLogout = async () => {
    try {
      await logout()
      setStatus('disconnected')
      setSession(null)
      setScenes([])
      setChapters([])
      setTokens([])
      setPlacements([])
      setCombat(null)
      setActiveSceneId(null)
      sceneRef.current = null
      setSceneId(null)
      setGameName('')
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not sign out.')
    }
  }

  const handleRegenerateInvite = async () => {
    try {
      const inviteCode = await regenerateInvite()
      setSession((current) => (current ? { ...current, inviteCode } : current))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not generate an invite code.')
    }
  }

  const handleCreate = async (chapterId: string, name: string, file: File) => {
    const s = await run(() => createScene(chapterId, name, file))
    if (s) {
      applyScene(s)
      await joinScene(s.id)
    }
    return s !== null
  }

  const handleAddChapter = async (name: string) => {
    const c = await run(() => createChapter(name))
    if (c) applyChapter(c)
    return c !== null
  }

  const handleRenameChapter = async (chapterId: string, name: string) => {
    const c = await run(() => renameChapter(chapterId, name))
    if (c) applyChapter(c)
  }

  const handleDeleteChapter = (chapterId: string) => void run(() => deleteChapter(chapterId))

  const handleMoveScene = async (chapterId: string) => {
    if (!savedScene) return
    const s = await run(() => moveScene(savedScene.id, chapterId))
    if (s) applyScene(s)
  }

  const handleReplaceImage = async (file: File) => {
    if (!savedScene) return
    const s = await run(() => replaceSceneImage(savedScene.id, file))
    if (s) applyScene(s)
  }

  const handleDeleteScene = () => {
    if (savedScene) void run(() => deleteScene(savedScene.id))
  }

  const renameScene = (name: string) => {
    if (!savedScene) return
    applyScene({ ...savedScene, name })
    void invoke('RenameScene', savedScene.id, name)
  }

  const handleCreateToken = async (
    name: string,
    color: string,
    maxHp: number,
    speedFeet: number,
    armorClass: number,
    visionFeet: number,
    lightFeet: number,
    isPlayer: boolean,
    file: File | null,
  ) => {
    const t = await run(() =>
      createToken(name, color, maxHp, speedFeet, armorClass, visionFeet, lightFeet, isPlayer, file),
    )
    if (t) {
      applyToken(t)
      // NPCs belong to the scene they're created in.
      if (!isPlayer) addToScene(t.id)
    }
    return t !== null
  }

  const handleTokenArt = async (token: Token, file: File) => {
    const t = await run(() => setTokenImage(token.id, file))
    if (t) applyToken(t)
  }

  const handleDeleteToken = (token: Token) => {
    if (window.confirm(`Delete "${token.name}" from every scene? This can't be undone.`))
      void run(() => deleteToken(token.id))
  }

  const saveGrid = (gridSize: number, offsetX: number, offsetY: number) => {
    if (!savedScene) return
    applyScene({ ...savedScene, gridSize, gridOffsetX: offsetX, gridOffsetY: offsetY })
    void invoke('UpdateSceneGrid', savedScene.id, gridSize, offsetX, offsetY)
  }

  const saveFogAreas = (fogAreas: FogArea[]) => {
    if (!savedScene) return
    void invoke<Scene | null>('UpdateSceneFog', savedScene.id, fogAreas).then((updated) => {
      if (updated) applyScene(updated)
    })
  }

  const saveTokenLighting = (token: Token, visionFeet: number, lightFeet: number) => {
    const next = { ...token, visionFeet, lightFeet }
    setTokens((prev) => prev.map((item) => (item.id === token.id ? next : item)))
    void invoke<Token | null>('UpdateTokenLighting', token.id, visionFeet, lightFeet).then((updated) => {
      if (updated) applyToken(updated)
    })
  }

  const saveWalls = (walls: Wall[]) => {
    if (!savedScene) return
    applyScene({ ...savedScene, walls })
    void invoke<Scene | null>('UpdateSceneWalls', savedScene.id, walls).then((updated) => {
      if (updated) applyScene(updated)
    })
  }

  // Walls are placed freely by default; hold Shift to snap to grid line intersections.
  // Either way a point near an existing wall end joins it so corners have no gaps.
  const snapWallPoint = (point: FogPoint, snapToGrid: boolean): FogPoint => {
    if (!scene) return point
    const clamp = (value: number, max: number) => Math.min(max, Math.max(0, value))
    const snapLine = (value: number, offset: number) =>
      Math.round((value - offset) / scene.gridSize) * scene.gridSize + offset
    const placed = snapToGrid
      ? {
          x: clamp(snapLine(point.x, scene.gridOffsetX), scene.width),
          y: clamp(snapLine(point.y, scene.gridOffsetY), scene.height),
        }
      : { x: clamp(point.x, scene.width), y: clamp(point.y, scene.height) }
    const joinDistance = 12 / view.scale
    let best: FogPoint | null = null
    let bestDistance = joinDistance
    for (const wall of scene.walls) {
      for (const end of [{ x: wall.x1, y: wall.y1 }, { x: wall.x2, y: wall.y2 }]) {
        const distance = Math.hypot(end.x - placed.x, end.y - placed.y)
        if (distance <= bestDistance) {
          best = end
          bestDistance = distance
        }
      }
    }
    return best ?? placed
  }

  const finishFogPolygon = (points: FogPoint[] = pendingFogPoints) => {
    if (points.length < 3 || !scene) return
    saveFogAreas([...scene.fogAreas, { id: crypto.randomUUID(), points }])
    setPendingFogPoints([])
    setFogCursor(null)
    setFogDrawing(false)
  }

  const isNearFogStart = (point: FogPoint) =>
    pendingFogPoints.length >= 3 &&
    Math.hypot(point.x - pendingFogPoints[0].x, point.y - pendingFogPoints[0].y) <= 10 / view.scale

  const overFogStart = fogCursor !== null && isNearFogStart(fogCursor)

  const showNotice = (text: string) => {
    setNotice(text)
    window.clearTimeout(noticeTimer.current)
    noticeTimer.current = window.setTimeout(() => setNotice(null), 3000)
  }

  // Optimistic: the server has the final say and a rejected move snaps the token back.
  const commitMove = async (tokenId: string, x: number, y: number, node: Konva.Node) => {
    setPlacements((prev) => prev.map((p) => (p.tokenId === tokenId ? { ...p, x, y } : p)))
    const id = sceneRef.current
    const original = placements.find((p) => p.tokenId === tokenId)
    const restore = () => {
      if (!original) return
      node.position({ x: original.x, y: original.y })
      setPlacements((prev) => prev.map((p) => (p.tokenId === tokenId ? original : p)))
    }
    let result: MoveResult | null | undefined
    try {
      result = await connection.current?.invoke<MoveResult | null>('MovePlacement', id, tokenId, x, y)
    } catch (e) {
      restore()
      setError(e instanceof Error ? e.message : 'Could not move token.')
      return
    }
    if (sceneRef.current !== id) return
    if (!result) {
      restore()
      showNotice('Move could not be confirmed.')
      return
    }
    if (result.combat) setCombat(result.combat)
    if (!result.accepted) {
      const { x: rx, y: ry } = result.placement
      node.position({ x: rx, y: ry })
      setPlacements((prev) => prev.map((p) => (p.tokenId === tokenId ? { ...p, x: rx, y: ry } : p)))
      showNotice(result.reason ?? 'Move not allowed.')
    }
  }

  const focusToken = (tokenId: string) => {
    const p = placements.find((x) => x.tokenId === tokenId)
    if (!p || !scene) return
    const scale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, viewport.height / (scene.gridSize * 8)))
    setView({ scale, x: viewport.width / 2 - p.x * scale, y: viewport.height / 2 - p.y * scale })
  }

  const combatCall = (method: string, ...args: unknown[]) => void invoke(method, sceneId, ...args)

  const addToScene = (tokenId: string) => {
    if (!scene) return
    const x = snap(scene.width / 2, scene.gridSize, scene.gridOffsetX)
    const y = snap(scene.height / 2, scene.gridSize, scene.gridOffsetY)
    setPlacements((prev) => [...prev, { sceneId: scene.id, tokenId, x, y }])
    void invoke('AddPlacement', scene.id, tokenId, x, y)
  }

  const removeFromScene = (tokenId: string) => {
    setPlacements((prev) => prev.filter((p) => p.tokenId !== tokenId))
    void invoke('RemovePlacement', sceneId, tokenId)
  }

  const saveToken = (t: Token, name: string, hp: number, speedFeet: number, armorClass: number) => {
    const next = { ...t, name, hp: Math.min(Math.max(hp, 0), t.maxHp), speedFeet, armorClass }
    setTokens((prev) => prev.map((p) => (p.id === t.id ? next : p)))
    void invoke('UpdateToken', t.id, name, hp, speedFeet, armorClass)
  }

  const resetMovement = async () => {
    const result = await invoke<MovementResetResult>('ResetMovement', sceneId)
    if (!result) return
    setPlacements((prev) =>
      prev.map((placement) =>
        placement.tokenId === result.placement.tokenId ? result.placement : placement,
      ),
    )
    setCombat(result.combat)
  }

  const changeTokenKind = async (tokenId: string, isPlayer: boolean) => {
    const token = await invoke<Token | null>('SetTokenKind', tokenId, isPlayer)
    if (token) applyToken(token)
  }

  const handleSetActiveScene = async (id: string) => {
    const targetScene = scenes.find((item) => item.id === id)
    if (!targetScene) return
    const targetKey = `${targetScene.id}:${targetScene.imageUrl ?? ''}`
    const targetView =
      scene?.id === targetScene.id
        ? view
        : views[targetKey]
          ? adaptViewToViewport(targetScene, views[targetKey], viewport)
          : fitToViewport(targetScene, viewport)
    const sharedView = shareableView(targetScene, targetView, viewport)
    const activeId = await invoke<string | null>(
      'SetActiveScene',
      id,
      sharedView.centerX,
      sharedView.centerY,
      sharedView.zoom,
    )
    if (!activeId) return
    setActiveSceneId(activeId)
    if (sceneRef.current !== activeId) {
      try {
        await joinScene(activeId)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not open the active scene.')
      }
    }
  }

  const handleSharePlayerView = () => {
    if (!scene || scene.id !== activeSceneId || fitView.scale <= 0) return
    const sharedView = shareableView(scene, view, viewport)
    void invoke('SetPlayerView', scene.id, sharedView.centerX, sharedView.centerY, sharedView.zoom)
  }

  const tokenById = new Map(tokens.map((t) => [t.id, t]))
  const placed = new Set(placements.map((p) => p.tokenId))
  const measureBlocked =
    !!scene && !!measureLine &&
    scene.walls.some((w) => segmentsIntersect(measureLine.start, measureLine.end, { x: w.x1, y: w.y1 }, { x: w.x2, y: w.y2 }))
  const npcTokens = tokens.filter((t) => !t.isPlayer)
  const renderTokenRow = (t: Token, asGm: boolean) => (
    <TokenRow
      key={t.id}
      token={t}
      isGm={asGm}
      onScene={placed.has(t.id)}
      onSave={saveToken}
      onSaveLighting={saveTokenLighting}
      onAdd={() => addToScene(t.id)}
      onRemove={() => removeFromScene(t.id)}
      onArt={(f) => void handleTokenArt(t, f)}
      onDelete={() => handleDeleteToken(t)}
      onKindChange={(isPlayer) => void changeTokenKind(t.id, isPlayer)}
    />
  )
  const turnStartToken = combat?.active && combat.currentTokenId
    ? tokenById.get(combat.currentTokenId)
    : undefined
  const turnStartPlacement = combat?.active && combat.currentTokenId
    ? placements.find((p) => p.tokenId === combat.currentTokenId)
    : undefined
  const currentTurnPosition =
    dragPreview?.tokenId === combat?.currentTokenId
      ? dragPreview
      : turnStartPlacement
  const turnStartX = combat?.active ? combat.turnStartX : null
  const turnStartY = combat?.active ? combat.turnStartY : null
  const showTurnStartMarker =
    !!turnStartToken &&
    !!currentTurnPosition &&
    typeof turnStartX === 'number' &&
    typeof turnStartY === 'number' &&
    (currentTurnPosition.x !== turnStartX || currentTurnPosition.y !== turnStartY)
  const sceneWalls = scene?.walls
  const sceneGridSize = scene?.gridSize
  const sceneFeetPerSquare = scene?.feetPerSquare
  const visionSources = (() => {
    if (!sceneWalls || !sceneGridSize || !sceneFeetPerSquare) return []
    const tokensById = new Map(tokens.map((t) => [t.id, t]))
    const pixelsPerFoot = sceneGridSize / sceneFeetPerSquare
    return placements.flatMap((placement) => {
      const token = tokensById.get(placement.tokenId)
      if (!token?.isPlayer) return []
      const lightRadius = token.lightFeet * pixelsPerFoot
      const visibleRadius = Math.max(token.visionFeet * pixelsPerFoot, lightRadius)
      if (visibleRadius <= 0) return []
      const polygon = computeVisibility(placement.x, placement.y, visibleRadius, sceneWalls)
      const lightPolygon = lightRadius > 0
        ? computeVisibility(placement.x, placement.y, lightRadius, sceneWalls)
        : null
      return [{ polygon, lightPolygon }]
    })
  })()

  if (authLoading) {
    return <main className="auth-shell"><p>Entering the campaign hall…</p></main>
  }
  if (authError) {
    return (
      <main className="auth-shell">
        <section className="auth-panel">
          <h1>Dungeon Theatre</h1>
          <p className="error" role="alert">{authError}</p>
          <button onClick={() => window.location.reload()}>Try again</button>
        </section>
      </main>
    )
  }
  if (!session) {
    return (
      <AuthScreen
        hasUsers={hasUsers}
        onLogin={handleLogin}
        onRegister={handleRegister}
        onGuest={handleGuest}
      />
    )
  }

  return (
    <div className="app">
      <header>
        <h1>Dungeon Theatre</h1>
        <span className={`status ${status}`}>{status}</span>
        {gameName && <span className="game-name">{gameName}</span>}
        <span className="signed-in">
          {session.user.displayName} · {isGm ? 'GM' : 'Player'}{session.user.isGuest ? ' · Guest' : ''}
        </span>
        {isGm && session.inviteCode && (
          <span className="invite-code">
            Invite: <code>{session.inviteCode}</code>
            <button onClick={() => void handleRegenerateInvite()}>New code</button>
          </span>
        )}
        <button onClick={() => void handleLogout()}>Sign out</button>
      </header>
      <main>
        <InitiativeTracker
          combat={combat}
          isGm={isGm}
          canNext={
            isGm ||
            (combat?.active === true && tokenById.get(combat.currentTokenId ?? '')?.isPlayer === true)
          }
          tokens={tokenById}
          placements={placements}
          onFocus={focusToken}
          onSetInitiative={(tokenId, n) => combatCall('SetInitiative', tokenId, n)}
          onSetHealth={(token, hp) => saveToken(token, token.name, hp, token.speedFeet, token.armorClass ?? 10)}
          onRemove={(tokenId) => combatCall('RemoveInitiative', tokenId)}
          onStart={() => combatCall('StartCombat')}
          onNext={() => combatCall('NextTurn')}
          onEnd={() => combatCall('EndCombat')}
          onResetMovement={() => void resetMovement()}
          lastDiceRoll={lastDiceRoll}
          onRollDice={(sides, count, modifier) =>
            void invoke<DiceRoll>('RollDice', sides, count, modifier).then((roll) => {
              if (roll) setLastDiceRoll(roll)
            })
          }
        />
        <div className="viewport" ref={viewportRef}>
          {notice && (
            <div className="notice" role="status">
              {notice}
            </div>
          )}
          <button
            className="sidebar-toggle"
            onClick={toggleSidebar}
            aria-expanded={sidebarOpen}
            aria-label={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
            title={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
          >
            {sidebarOpen ? '»' : '«'}
          </button>
        {scene && (
          <>
          <Stage
            width={viewport.width}
            height={viewport.height}
            x={view.x}
            y={view.y}
            scaleX={view.scale}
            scaleY={view.scale}
            draggable={!(isGm && (fogDrawing || wallDrawing)) && !measureActive}
            className={`stage${fogDrawing || wallDrawing || measureActive ? ' drawing-fog' : ''}${fogDrawing && overFogStart ? ' closing-fog' : ''}${hoveredFogId && !fogDrawing && !wallDrawing ? ' hover-fog' : ''}${hoveredWallId && !fogDrawing && !wallDrawing ? ' hover-fog' : ''}`}
            onClick={(e) => {
              if (e.evt.button !== 0) return
              if (isGm && wallDrawing && scene) {
                const raw = e.target.getStage()?.getRelativePointerPosition()
                if (!raw) return
                const point = snapWallPoint(raw, e.evt.shiftKey)
                if (!wallStart) {
                  setWallStart(point)
                } else if (point.x === wallStart.x && point.y === wallStart.y) {
                  setWallStart(null)
                } else {
                  saveWalls([...scene.walls, {
                    id: crypto.randomUUID(), x1: wallStart.x, y1: wallStart.y, x2: point.x, y2: point.y,
                  }])
                  setWallStart(point)
                }
                return
              }
              if (!isGm || !fogDrawing || !scene) return
              const point = e.target.getStage()?.getRelativePointerPosition()
              if (!point) return
              if (isNearFogStart(point)) {
                finishFogPolygon()
                return
              }
              setPendingFogPoints((previous) => [
                ...previous,
                {
                  x: Math.min(scene.width, Math.max(0, point.x)),
                  y: Math.min(scene.height, Math.max(0, point.y)),
                },
              ])
            }}
            onDblClick={(e) => {
              // The two clicks of a double-click each added a point at the same spot.
              if (e.evt.button !== 0 || !isGm || !fogDrawing) return
              finishFogPolygon(pendingFogPoints.slice(0, -1))
            }}
            onMouseMove={(e) => {
              if (measureActive && measureLine?.dragging) {
                const point = e.target.getStage()?.getRelativePointerPosition()
                if (point) setMeasureLine({ ...measureLine, end: { x: point.x, y: point.y } })
                return
              }
              if (!isGm || !(fogDrawing || wallDrawing) || !scene) return
              const stage = e.target.getStage()
              const point = stage?.getRelativePointerPosition()
              if (point) {
                if (wallDrawing) setWallCursor(snapWallPoint(point, e.evt.shiftKey))
                else setFogCursor({ x: point.x, y: point.y })
              }
              const screen = stage?.getPointerPosition()
              if (screen) setFogScreenCursor({ x: screen.x, y: screen.y })
            }}
            onMouseLeave={() => setFogScreenCursor(null)}
            onMouseUp={(e) => {
              if (e.evt.button !== 0 || !measureLine?.dragging) return
              // A bare click without dragging clears the measurement.
              if (measureLine.start.x === measureLine.end.x && measureLine.start.y === measureLine.end.y)
                setMeasureLine(null)
              else setMeasureLine({ ...measureLine, dragging: false })
            }}
            onMouseDown={(e) => {
              if (e.evt.button === 0 && measureActive) {
                const point = e.target.getStage()?.getRelativePointerPosition()
                if (point) {
                  const start = { x: point.x, y: point.y }
                  setMeasureLine({ start, end: start, dragging: true })
                }
                return
              }
              if (e.evt.button !== 1) return
              // Middle-button hold pans the map in every mode, including while drawing.
              e.evt.preventDefault()
              const start = { x: e.evt.clientX, y: e.evt.clientY, viewX: view.x, viewY: view.y }
              const stageContainer = e.target.getStage()?.container()
              stageContainer?.style.setProperty('cursor', 'grabbing')
              const onMove = (event: MouseEvent) =>
                setView({
                  ...view,
                  x: start.viewX + event.clientX - start.x,
                  y: start.viewY + event.clientY - start.y,
                })
              const onUp = () => {
                stageContainer?.style.removeProperty('cursor')
                window.removeEventListener('mousemove', onMove)
                window.removeEventListener('mouseup', onUp)
              }
              window.addEventListener('mousemove', onMove)
              window.addEventListener('mouseup', onUp)
            }}
            onWheel={(e) => {
              e.evt.preventDefault()
              const pointer = e.target.getStage()?.getPointerPosition()
              if (pointer) zoomAt(pointer.x, pointer.y, Math.exp(-e.evt.deltaY * 0.0015))
            }}
            onDragEnd={(e) => {
              // Token drags bubble up here; only react to the stage itself being panned.
              if (e.target !== e.target.getStage()) return
              setView({ ...view, x: e.target.x(), y: e.target.y() })
            }}
          >
            <Layer listening={false}>
              <MapImage key={scene.imageUrl ?? 'none'} scene={scene} />
              <GridLines scene={scene} />
            </Layer>
            <Layer>
              {showTurnStartMarker && turnStartToken &&
                typeof turnStartX === 'number' && typeof turnStartY === 'number' && (
                <TokenDisc
                  key={`turn-start-${turnStartToken.id}`}
                  token={turnStartToken}
                  x={turnStartX}
                  y={turnStartY}
                  radius={scene.gridSize / 2 - 4}
                  opacity={0.3}
                  draggable={false}
                  onDragMove={() => {}}
                  onDragEnd={() => {}}
                />
              )}
              {placements.map((p) => {
                const t = tokenById.get(p.tokenId)
                if (!t) return null
                const radius = scene.gridSize / 2 - 4
                return (
                  <TokenDisc
                    key={p.tokenId}
                    token={t}
                    x={p.x}
                    y={p.y}
                    radius={radius}
                    active={combat?.active === true && combat.currentTokenId === p.tokenId}
                    draggable={
                      (isGm && !fogDrawing && !wallDrawing && !measureActive) ||
                      (t.isPlayer &&
                        (!combat?.active || combat.currentTokenId === p.tokenId) && !fogDrawing && !wallDrawing && !measureActive)
                    }
                    onDragMove={(e) => {
                      setDragPreview({ tokenId: p.tokenId, x: e.target.x(), y: e.target.y() })
                      const now = performance.now()
                      if (now - lastSent.current < SEND_INTERVAL_MS) return
                      lastSent.current = now
                      void invoke('PreviewPlacement', scene.id, p.tokenId, e.target.x(), e.target.y())
                    }}
                    onDragEnd={(e) => {
                      const x = snap(e.target.x(), scene.gridSize, scene.gridOffsetX)
                      const y = snap(e.target.y(), scene.gridSize, scene.gridOffsetY)
                      e.target.position({ x, y })
                      setDragPreview(null)
                      void commitMove(p.tokenId, x, y, e.target)
                    }}
                  />
                )
              })}
              {placements.map((p) => {
                const t = tokenById.get(p.tokenId)
                if (!t) return null
                const healthCondition = getHealthCondition(t.hp, t.maxHp)
                if (!isGm && !t.isPlayer)
                  return (
                    <Group
                      key={`l${p.tokenId}`}
                      x={p.x - scene.gridSize / 2}
                      y={p.y + scene.gridSize / 2 - 2}
                      listening={false}
                    >
                      <Text text={t.name} width={scene.gridSize} align="center" fill="#e8e0d0" fontSize={12} />
                      <Rect
                        x={scene.gridSize / 2 - 4}
                        y={14}
                        width={8}
                        height={8}
                        fill={getHealthColor(healthCondition)}
                        cornerRadius={1}
                      />
                    </Group>
                  )
                return (
                  <Text
                    key={`l${p.tokenId}`}
                    x={p.x - scene.gridSize / 2}
                    y={p.y + scene.gridSize / 2 - 2}
                    width={scene.gridSize}
                    align="center"
                    text={`${t.name} ${t.hp}/${t.maxHp}`}
                    fill="#e8e0d0"
                    fontSize={12}
                    shadowColor="black"
                    shadowBlur={4}
                    listening={false}
                  />
                )
              })}
            </Layer>
            <Layer listening={isGm && !fogDrawing && !wallDrawing && !measureActive}>
              {!isGm && (
                <>
                  <Rect
                    width={scene.width}
                    height={scene.height}
                    fill="#000"
                    listening={false}
                  />
                  {visionSources.map((source, index) => (
                    <Line
                      key={`vision-${index}`}
                      points={source.polygon}
                      closed
                      fill="black"
                      globalCompositeOperation="destination-out"
                      listening={false}
                    />
                  ))}
                  {visionSources.filter((source) => source.lightPolygon).map((source, index) => (
                    <Line
                      key={`light-${index}`}
                      points={source.lightPolygon ?? []}
                      closed
                      fill="rgba(255,190,105,0.12)"
                      listening={false}
                    />
                  ))}
                  {scene.fogAreas.map((area) => (
                    <Line
                      key={area.id}
                      points={area.points.flatMap((point) => [point.x, point.y])}
                      closed
                      fill="#08070c"
                      listening={false}
                    />
                  ))}
                </>
              )}
              {isGm && scene.fogAreas.map((area) => (
                <Line
                  key={area.id}
                  points={area.points.flatMap((point) => [point.x, point.y])}
                  closed
                  fill={hoveredFogId === area.id ? 'rgba(224,179,65,0.35)' : 'rgba(8,7,12,0.25)'}
                  stroke={hoveredFogId === area.id ? '#fff3c4' : '#e0b341'}
                  strokeWidth={hoveredFogId === area.id ? 3 : 2}
                  onMouseEnter={() => setHoveredFogId(area.id)}
                  onMouseLeave={() => setHoveredFogId((current) => (current === area.id ? null : current))}
                  onClick={(e) => {
                    e.cancelBubble = true
                    setHoveredFogId(null)
                    if (window.confirm('Remove this fog area?'))
                      saveFogAreas(scene.fogAreas.filter((current) => current.id !== area.id))
                  }}
                />
              ))}
              {isGm && scene.walls.map((wall) => (
                <Line
                  key={wall.id}
                  points={[wall.x1, wall.y1, wall.x2, wall.y2]}
                  stroke={hoveredWallId === wall.id ? '#ff8f6b' : '#c2553b'}
                  strokeWidth={hoveredWallId === wall.id ? 6 : 4}
                  lineCap="round"
                  hitStrokeWidth={14}
                  onMouseEnter={() => setHoveredWallId(wall.id)}
                  onMouseLeave={() => setHoveredWallId((current) => (current === wall.id ? null : current))}
                  onClick={(e) => {
                    e.cancelBubble = true
                    setHoveredWallId(null)
                    if (window.confirm('Remove this wall?'))
                      saveWalls(scene.walls.filter((current) => current.id !== wall.id))
                  }}
                />
              ))}
              {isGm && wallDrawing && wallStart && wallCursor && (
                <Line
                  points={[wallStart.x, wallStart.y, wallCursor.x, wallCursor.y]}
                  stroke="#ff8f6b"
                  strokeWidth={3}
                  dash={[6, 4]}
                  lineCap="round"
                  listening={false}
                />
              )}
              {isGm && wallDrawing && wallCursor && (
                <Circle
                  x={wallCursor.x}
                  y={wallCursor.y}
                  radius={5 / view.scale}
                  fill="#ff8f6b"
                  listening={false}
                />
              )}
              {isGm && fogDrawing && pendingFogPoints.length > 0 && (
                <Line
                  points={[
                    ...pendingFogPoints.flatMap((point) => [point.x, point.y]),
                    ...(fogCursor ? [fogCursor.x, fogCursor.y] : []),
                  ]}
                  closed={pendingFogPoints.length >= 3}
                  fill={pendingFogPoints.length >= 3 ? 'rgba(224,179,65,0.15)' : undefined}
                  stroke="#e0b341"
                  strokeWidth={2}
                  dash={[6, 4]}
                  listening={false}
                />
              )}
              {isGm && fogDrawing && pendingFogPoints.length > 0 && (
                <Circle
                  x={pendingFogPoints[0].x}
                  y={pendingFogPoints[0].y}
                  radius={(overFogStart ? 8 : 5) / view.scale}
                  fill={overFogStart ? '#fff3c4' : '#e0b341'}
                  stroke="#1a1208"
                  strokeWidth={1 / view.scale}
                  listening={false}
                />
              )}
              {measureLine && (() => {
                const colour = measureBlocked ? '#ff5a4d' : '#8fd3ff'
                return (
                <>
                  <Line
                    points={[measureLine.start.x, measureLine.start.y, measureLine.end.x, measureLine.end.y]}
                    stroke={colour}
                    strokeWidth={3 / view.scale}
                    dash={[8 / view.scale, 5 / view.scale]}
                    lineCap="round"
                    listening={false}
                  />
                  <Circle x={measureLine.start.x} y={measureLine.start.y} radius={5 / view.scale} fill={colour} listening={false} />
                  <Circle x={measureLine.end.x} y={measureLine.end.y} radius={5 / view.scale} fill={colour} listening={false} />
                </>
                )
              })()}
            </Layer>
          </Stage>
          {measureActive && measureLine && measureLine.start !== measureLine.end && (() => {
            const dx = measureLine.end.x - measureLine.start.x
            const dy = measureLine.end.y - measureLine.start.y
            // Same rule as movement: squares counted by the larger axis, diagonals cost the same.
            const squares = Math.max(Math.abs(dx), Math.abs(dy)) / scene.gridSize
            const feet = Math.round(squares * scene.feetPerSquare)
            return (
              <div
                className={`measure-label${measureBlocked ? ' blocked' : ''}`}
                style={{
                  left: view.x + measureLine.end.x * view.scale + 14,
                  top: view.y + measureLine.end.y * view.scale + 14,
                }}
              >
                {feet} ft · {squares.toFixed(1)} sq{measureBlocked ? ' · blocked by wall' : ''}
              </div>
            )
          })()}
          {isGm && fogDrawing && fogScreenCursor && (
            <div
              className="fog-tooltip"
              style={{ left: fogScreenCursor.x + 16, top: fogScreenCursor.y + 16 }}
            >
              {overFogStart
                ? 'Click to close the shape'
                : pendingFogPoints.length === 0
                  ? 'Click to place the first point'
                  : pendingFogPoints.length < 3
                    ? 'Click to add a point'
                    : 'Click to add a point · click the first point or double-click to finish'}
            </div>
          )}
          {isGm && wallDrawing && fogScreenCursor && (
            <div
              className="fog-tooltip"
              style={{ left: fogScreenCursor.x + 16, top: fogScreenCursor.y + 16 }}
            >
              {wallStart
                ? 'Click to place the wall end · click the same point to stop · Shift snaps to grid'
                : 'Click to start a wall · Shift snaps to grid'}
            </div>
          )}
          <div className="zoom-controls">
            <button onClick={() => zoomAt(viewport.width / 2, viewport.height / 2, 1 / 1.25)} aria-label="Zoom out">−</button>
            <span>{Math.round(view.scale * 100)}%</span>
            <button onClick={() => zoomAt(viewport.width / 2, viewport.height / 2, 1.25)} aria-label="Zoom in">+</button>
            <button onClick={() =>
                setViews((prev) => {
                  const { [viewKey]: _, ...rest } = prev
                  return rest
                })
              }>Fit</button>
            <button
              className={measureActive ? 'active' : undefined}
              aria-pressed={measureActive}
              title="Drag on the map to measure a distance (Esc to clear)"
              onClick={() => {
                setMeasureActive((active) => !active)
                setMeasureLine(null)
                setFogDrawing(false)
                setPendingFogPoints([])
                setFogCursor(null)
                setWallDrawing(false)
                setWallStart(null)
                setWallCursor(null)
              }}
            >
              {measureActive ? 'Measuring…' : 'Measure'}
            </button>
            {isGm && (
              <>
              <button
                className={fogDrawing ? 'active' : undefined}
                aria-pressed={fogDrawing}
                onClick={() => {
                  setFogDrawing((drawing) => !drawing)
                  setPendingFogPoints([])
                  setFogCursor(null)
                  setWallDrawing(false)
                  setWallStart(null)
                  setWallCursor(null)
                  setMeasureActive(false)
                  setMeasureLine(null)
                }}
              >
                {fogDrawing ? 'Drawing fog…' : 'Draw fog'}
              </button>
              <button
                className={wallDrawing ? 'active' : undefined}
                aria-pressed={wallDrawing}
                onClick={() => {
                  setWallDrawing((drawing) => !drawing)
                  setWallStart(null)
                  setWallCursor(null)
                  setFogDrawing(false)
                  setPendingFogPoints([])
                  setFogCursor(null)
                  setMeasureActive(false)
                  setMeasureLine(null)
                }}
              >
                {wallDrawing ? 'Drawing walls…' : 'Draw walls'}
              </button>
              {wallDrawing && <span className="fog-hint">Esc ends a wall, again leaves</span>}
              {fogDrawing && (
                <>
                  <span className="fog-hint">Esc cancels</span>
                  <button disabled={pendingFogPoints.length < 3} onClick={() => finishFogPolygon()}>
                    Finish area
                  </button>
                  <button onClick={() => {
                    setFogDrawing(false)
                    setPendingFogPoints([])
                    setFogCursor(null)
                  }}>
                    Cancel
                  </button>
                </>
              )}
              </>
            )}
            {isGm && (
              <button
                onClick={handleSharePlayerView}
                disabled={scene?.id !== activeSceneId}
                title={scene?.id === activeSceneId ? 'Show players this map view' : 'Switch to the active scene to share its view'}
              >
                Show players
              </button>
            )}
          </div>
          </>
        )}
        </div>
        <aside className={sidebarOpen ? undefined : 'collapsed'}>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {isGm ? (
            <>
              <div className="sidebar-tabs" role="tablist" aria-label="GM sections">
                <button
                  id="sidebar-tab-chapters"
                  role="tab"
                  aria-selected={sidebarTab === 'chapters'}
                  aria-controls="sidebar-tabpanel"
                  className={sidebarTab === 'chapters' ? 'active' : ''}
                  onClick={() => setSidebarTab('chapters')}
                >
                  Chapters
                </button>
                <button
                  id="sidebar-tab-scene"
                  role="tab"
                  aria-selected={sidebarTab === 'scene'}
                  aria-controls="sidebar-tabpanel"
                  className={sidebarTab === 'scene' ? 'active' : ''}
                  onClick={() => setSidebarTab('scene')}
                >
                  Scene
                </button>
                <button
                  id="sidebar-tab-tokens"
                  role="tab"
                  aria-selected={sidebarTab === 'tokens'}
                  aria-controls="sidebar-tabpanel"
                  className={sidebarTab === 'tokens' ? 'active' : ''}
                  onClick={() => setSidebarTab('tokens')}
                >
                  Tokens
                </button>
              </div>
              <div
                id="sidebar-tabpanel"
                role="tabpanel"
                aria-labelledby={`sidebar-tab-${sidebarTab}`}
              >
                {sidebarTab === 'chapters' && (
                  <>
                    <ChapterTree
                      chapters={chapters}
                      scenes={scenes}
                      sceneId={sceneId}
                      activeSceneId={activeSceneId}
                      onSetActiveScene={(id) => void handleSetActiveScene(id)}
                      onSelect={(id) => void joinScene(id)}
                      onAdd={handleAddChapter}
                      onRename={(id, name) => void handleRenameChapter(id, name)}
                      onDelete={handleDeleteChapter}
                    />
                    <NewSceneForm
                      busy={uploading}
                      chapters={chapters}
                      defaultChapterId={savedScene?.chapterId ?? null}
                      onCreate={handleCreate}
                    />
                  </>
                )}
                {sidebarTab === 'scene' && (
                  savedScene ? (
                    <>
                      <SceneSettings
                        key={`${savedScene.id}:${savedScene.chapterId}:${savedScene.name}:${savedScene.gridSize}:${savedScene.gridOffsetX}:${savedScene.gridOffsetY}:${savedScene.imageUrl}`}
                        scene={savedScene}
                        chapters={chapters}
                        busy={uploading}
                        onPreview={setPreview}
                        onSave={saveGrid}
                        onReplaceImage={(f) => void handleReplaceImage(f)}
                        onRename={renameScene}
                        onMove={(id) => void handleMoveScene(id)}
                        onDelete={handleDeleteScene}
                      />
                      <NewTokenForm kind="npc" busy={uploading} onCreate={handleCreateToken} />
                      <section className="panel">
                        <h2>NPCs</h2>
                        {npcTokens.filter((t) => placed.has(t.id)).map((t) => renderTokenRow(t, true))}
                        {!npcTokens.some((t) => placed.has(t.id)) && (
                          <p className="hint">No NPCs in this scene yet.</p>
                        )}
                        {npcTokens.some((t) => !placed.has(t.id)) && (
                          <>
                            <h3>Not in this scene</h3>
                            {npcTokens.filter((t) => !placed.has(t.id)).map((t) => renderTokenRow(t, true))}
                          </>
                        )}
                      </section>
                    </>
                  ) : <section className="panel"><p className="hint">Select a scene from Chapters to edit its settings.</p></section>
                )}
                {sidebarTab === 'tokens' && (
                  <>
                    <NewTokenForm kind="player" busy={uploading} onCreate={handleCreateToken} />
                    <section className="panel">
                      <h2>Players</h2>
                      {tokens.filter((t) => t.isPlayer).map((t) => renderTokenRow(t, true))}
                      {!tokens.some((t) => t.isPlayer) && <p className="hint">No player tokens yet.</p>}
                    </section>
                  </>
                )}
              </div>
            </>
          ) : (
            <section className="panel">
              <h2>Players</h2>
              {tokens.filter((t) => t.isPlayer).map((t) => renderTokenRow(t, false))}
              {!tokens.some((t) => t.isPlayer) && <p className="hint">No player tokens yet.</p>}
            </section>
          )}
        </aside>
      </main>
    </div>
  )
}

function TokenRow(props: {
  token: Token
  isGm: boolean
  onScene: boolean
  onSave: (t: Token, name: string, hp: number, speedFeet: number, armorClass: number) => void
  onSaveLighting: (t: Token, visionFeet: number, lightFeet: number) => void
  onAdd: () => void
  onRemove: () => void
  onArt: (file: File) => void
  onDelete: () => void
  onKindChange: (isPlayer: boolean) => void
}) {
  const { token, isGm, onScene } = props
  const canEdit = isGm || token.isPlayer
  const healthCondition = getHealthCondition(token.hp, token.maxHp)
  return (
    <div className={`token-row ${isGm ? 'gm-token-row' : 'player-token-row'}`}>
      {canEdit ? (
        <label className="token-art-trigger" title="Change token art">
          {token.imageUrl ? (
            <img className="swatch" src={token.imageUrl} alt="" style={{ borderColor: token.color }} />
          ) : (
            <span className="swatch" style={{ background: token.color }} />
          )}
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            aria-label={`Change ${token.name} art`}
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (file) props.onArt(file)
            }}
          />
        </label>
      ) : token.imageUrl ? (
        <img className="swatch" src={token.imageUrl} alt="" style={{ borderColor: token.color }} />
      ) : (
        <span className="swatch" style={{ background: token.color }} />
      )}
      {/* Keyed on server values so remote updates reset the inputs. */}
      <label className="token-field token-name-field">
        <span>Name</span>
        <input
          key={`n${token.name}`}
          className="token-name-input"
          defaultValue={token.name}
          maxLength={40}
          aria-label={`${token.name} name`}
          disabled={!canEdit}
          onBlur={(e) => e.target.value.trim() && props.onSave(token, e.target.value, token.hp, token.speedFeet, token.armorClass ?? 10)}
        />
      </label>
      {isGm || token.isPlayer ? (
        <label className="token-field token-hp-field">
          <span>HP</span>
          <div className="token-stat token-hp">
            <input
              key={`h${token.hp}`}
              type="number"
              min={0}
              max={token.maxHp}
              aria-label={`${token.name} HP`}
              defaultValue={token.hp}
              disabled={!canEdit}
              onBlur={(e) => props.onSave(token, token.name, Number(e.target.value) || 0, token.speedFeet, token.armorClass ?? 10)}
            />
            <span>/{token.maxHp}</span>
          </div>
        </label>
      ) : (
        <span
          className={`npc-health ${healthCondition}`}
          aria-label={`${token.name} health: ${healthCondition}`}
          role="img"
        />
      )}
      <label className="token-field token-speed-field">
        <span>Speed</span>
        <div className="token-stat token-speed">
          <input
            key={`s${token.speedFeet}`}
            type="number"
            min={0}
            max={999}
            title="Speed (ft)"
            aria-label={`${token.name} speed in feet`}
            defaultValue={token.speedFeet}
            disabled={!canEdit}
            onBlur={(e) => {
              const n = Math.round(Number(e.target.value))
              if (e.target.value !== '' && n >= 0 && n <= 999) props.onSave(token, token.name, token.hp, n, token.armorClass ?? 10)
              else e.target.value = String(token.speedFeet)
            }}
          />
          <span>ft</span>
        </div>
      </label>
      {(isGm || token.isPlayer) && <label className="token-field token-ac-field">
        <span>AC</span>
        <input
          key={`a${token.armorClass}`}
          type="number"
          min={0}
          max={99}
          aria-label={`${token.name} Armour Class`}
          defaultValue={token.armorClass ?? 10}
          disabled={!canEdit}
          onBlur={(e) => {
            const n = Math.round(Number(e.target.value))
            if (e.target.value !== '' && n >= 0 && n <= 99)
              props.onSave(token, token.name, token.hp, token.speedFeet, n)
            else e.target.value = String(token.armorClass ?? 10)
          }}
        />
      </label>}
      {isGm && (
        <div className="token-lighting-fields">
          <label className="token-field">
            <span>Vision (ft)</span>
            <input
              key={`v${token.visionFeet}`}
              type="number"
              min={0}
              max={999}
              aria-label={`${token.name} vision in feet`}
              defaultValue={token.visionFeet}
              onBlur={(e) => {
                const n = Math.round(Number(e.target.value))
                if (e.target.value !== '' && n >= 0 && n <= 999)
                  props.onSaveLighting(token, n, token.lightFeet)
                else e.target.value = String(token.visionFeet)
              }}
            />
          </label>
          <label className="token-field">
            <span>Light (ft)</span>
            <input
              key={`l${token.lightFeet}`}
              type="number"
              min={0}
              max={999}
              aria-label={`${token.name} light radius in feet`}
              defaultValue={token.lightFeet}
              onBlur={(e) => {
                const n = Math.round(Number(e.target.value))
                if (e.target.value !== '' && n >= 0 && n <= 999)
                  props.onSaveLighting(token, token.visionFeet, n)
                else e.target.value = String(token.lightFeet)
              }}
            />
          </label>
        </div>
      )}
      {isGm && (
        <select
          aria-label={`${token.name} token type`}
          value={String(token.isPlayer)}
          onChange={(e) => props.onKindChange(e.target.value === 'true')}
        >
          <option value="false">NPC</option>
          <option value="true">Player</option>
        </select>
      )}
      {isGm && <button onClick={onScene ? props.onRemove : props.onAdd}>{onScene ? 'Remove' : 'Add'}</button>}
      {isGm && (
        <button className="danger icon-button" title="Delete token" aria-label={`Delete ${token.name}`} onClick={props.onDelete}>
          ✕
        </button>
      )}
    </div>
  )
}
