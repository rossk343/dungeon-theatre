import { useCallback, useEffect, useRef, useState } from 'react'
import { HubConnectionBuilder, type HubConnection } from '@microsoft/signalr'
import { Image as KonvaImage, Layer, Line, Stage, Text } from 'react-konva'
import useImage from 'use-image'
import {
  createChapter, createScene, createToken, deleteChapter, deleteScene, deleteToken, moveScene, renameChapter,
  replaceSceneImage, setTokenImage,
} from './api'
import { ChapterTree } from './ChapterTree'
import { NewSceneForm, NewTokenForm, SceneSettings } from './SceneSettings'
import { TokenDisc } from './TokenDisc'
import type { Chapter, GameState, GridPreview, Placement, Scene, Token } from './types'
import './App.css'

const SEND_INTERVAL_MS = 50
const MIN_ZOOM = 0.1
const MAX_ZOOM = 4

type View = { x: number; y: number; scale: number }

function fitToViewport(scene: Scene, viewport: { width: number; height: number }): View {
  const scale = Math.min(1, viewport.width / scene.width, viewport.height / scene.height)
  return {
    scale,
    x: (viewport.width - scene.width * scale) / 2,
    y: (viewport.height - scene.height * scale) / 2,
  }
}

const snap = (v: number, grid: number, offset: number) =>
  Math.round((v - offset - grid / 2) / grid) * grid + offset + grid / 2

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
  const [scenes, setScenes] = useState<Scene[]>([])
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [gameName, setGameName] = useState('')
  const [tokens, setTokens] = useState<Token[]>([])
  const [placements, setPlacements] = useState<Placement[]>([])
  const [sceneId, setSceneId] = useState<string | null>(null)
  const [preview, setPreview] = useState<GridPreview | null>(null)
  const [status, setStatus] = useState('connecting')
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(() => localStorage.getItem('sidebarOpen') !== 'false')

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
  const [viewState, setViewState] = useState<{ key: string; view: View } | null>(null)
  const viewKey = scene ? `${scene.id}:${scene.imageUrl ?? ''}` : ''
  const fitView = scene ? fitToViewport(scene, viewport) : { x: 0, y: 0, scale: 1 }
  // The saved view only applies to the scene (and image) it was made for; otherwise show the whole map.
  const view = viewState?.key === viewKey ? viewState.view : fitView

  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) =>
      setViewport({ width: entry.contentRect.width, height: entry.contentRect.height }),
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const zoomAt = (px: number, py: number, factor: number) => {
    const scale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.scale * factor))
    const k = scale / view.scale
    setViewState({
      key: viewKey,
      view: { scale, x: px - (px - view.x) * k, y: py - (py - view.y) * k },
    })
  }

  const joinScene = useCallback(async (id: string) => {
    const conn = connection.current
    if (!conn) return
    sceneRef.current = id
    setSceneId(id)
    setPreview(null)
    const list = await conn.invoke<Placement[]>('JoinScene', id)
    // Ignore the reply if the user already switched again.
    if (sceneRef.current === id) setPlacements(list)
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

  useEffect(() => {
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
    conn.on('SceneDeleted', (id: string) => {
      setScenes((prev) => prev.filter((s) => s.id !== id))
      setPreview((p) => (p?.sceneId === id ? null : p))
      if (sceneRef.current !== id) return
      const next = scenesRef.current.find((s) => s.id !== id)
      if (next) void joinScene(next.id)
      else {
        sceneRef.current = null
        setSceneId(null)
        setPlacements([])
      }
    })

    // Initial load and reconnect both rejoin the current scene.
    const load = async () => {
      const state = await conn.invoke<GameState>('GetState')
      setGameName(state.gameName)
      setChapters(state.chapters)
      setScenes(state.scenes)
      setTokens(state.tokens)
      // Open the first scene in chapter order, not the raw first scene.
      const first = state.chapters.flatMap((c) => state.scenes.filter((s) => s.chapterId === c.id))[0]
      const id = sceneRef.current ?? first?.id
      if (id) await joinScene(id)
      setStatus('connected')
    }

    conn.onreconnecting(() => setStatus('reconnecting'))
    conn.onreconnected(() => void load())
    conn.onclose(() => setStatus('disconnected'))
    conn.start().then(load).catch(() => setStatus('disconnected'))

    return () => {
      void conn.stop()
    }
  }, [joinScene, applyScene, applyChapter, applyToken])

  const invoke = (method: string, ...args: unknown[]) =>
    connection.current?.invoke(method, ...args).catch(() => {})

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

  const handleCreateToken = async (name: string, color: string, maxHp: number, file: File | null) => {
    const t = await run(() => createToken(name, color, maxHp, file))
    if (t) applyToken(t)
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

  const move = (tokenId: string, x: number, y: number) => {
    setPlacements((prev) => prev.map((p) => (p.tokenId === tokenId ? { ...p, x, y } : p)))
    void invoke('MovePlacement', sceneId, tokenId, x, y)
  }

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

  const saveToken = (t: Token, name: string, hp: number) => {
    const next = { ...t, name, hp: Math.min(Math.max(hp, 0), t.maxHp) }
    setTokens((prev) => prev.map((p) => (p.id === t.id ? next : p)))
    void invoke('UpdateToken', t.id, name, hp)
  }

  const tokenById = new Map(tokens.map((t) => [t.id, t]))
  const placed = new Set(placements.map((p) => p.tokenId))

  return (
    <div className="app">
      <header>
        <h1>Dungeon Theatre</h1>
        <span className={`status ${status}`}>{status}</span>
        {gameName && <span className="game-name">{gameName}</span>}
      </header>
      <main>
        <div className="viewport" ref={viewportRef}>
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
            draggable
            className="stage"
            onWheel={(e) => {
              e.evt.preventDefault()
              const pointer = e.target.getStage()?.getPointerPosition()
              if (pointer) zoomAt(pointer.x, pointer.y, Math.exp(-e.evt.deltaY * 0.0015))
            }}
            onDragEnd={(e) => {
              // Token drags bubble up here; only react to the stage itself being panned.
              if (e.target !== e.target.getStage()) return
              setViewState({ key: viewKey, view: { ...view, x: e.target.x(), y: e.target.y() } })
            }}
          >
            <Layer listening={false}>
              <MapImage key={scene.imageUrl ?? 'none'} scene={scene} />
              <GridLines scene={scene} />
            </Layer>
            <Layer>
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
                    onDragMove={(e) => {
                      const now = performance.now()
                      if (now - lastSent.current < SEND_INTERVAL_MS) return
                      lastSent.current = now
                      void invoke('MovePlacement', scene.id, p.tokenId, e.target.x(), e.target.y())
                    }}
                    onDragEnd={(e) => {
                      const x = snap(e.target.x(), scene.gridSize, scene.gridOffsetX)
                      const y = snap(e.target.y(), scene.gridSize, scene.gridOffsetY)
                      e.target.position({ x, y })
                      move(p.tokenId, x, y)
                    }}
                  />
                )
              })}
              {placements.map((p) => {
                const t = tokenById.get(p.tokenId)
                if (!t) return null
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
          </Stage>
          <div className="zoom-controls">
            <button onClick={() => zoomAt(viewport.width / 2, viewport.height / 2, 1 / 1.25)} aria-label="Zoom out">−</button>
            <span>{Math.round(view.scale * 100)}%</span>
            <button onClick={() => zoomAt(viewport.width / 2, viewport.height / 2, 1.25)} aria-label="Zoom in">+</button>
            <button onClick={() => setViewState(null)}>Fit</button>
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
          <ChapterTree
            chapters={chapters}
            scenes={scenes}
            sceneId={sceneId}
            onSelect={(id) => void joinScene(id)}
            onAdd={handleAddChapter}
            onRename={(id, name) => void handleRenameChapter(id, name)}
            onDelete={handleDeleteChapter}
          />
          {savedScene && (
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
          )}
          <NewSceneForm
            busy={uploading}
            chapters={chapters}
            defaultChapterId={savedScene?.chapterId ?? null}
            onCreate={handleCreate}
          />
          <NewTokenForm busy={uploading} onCreate={handleCreateToken} />
          <section className="panel">
            <h2>Tokens</h2>
            {tokens.map((t) => (
              <TokenRow
                key={t.id}
                token={t}
                onScene={placed.has(t.id)}
                onSave={saveToken}
                onAdd={() => addToScene(t.id)}
                onRemove={() => removeFromScene(t.id)}
                onArt={(f) => void handleTokenArt(t, f)}
                onDelete={() => handleDeleteToken(t)}
              />
            ))}
          </section>
        </aside>
      </main>
    </div>
  )
}

function TokenRow(props: {
  token: Token
  onScene: boolean
  onSave: (t: Token, name: string, hp: number) => void
  onAdd: () => void
  onRemove: () => void
  onArt: (file: File) => void
  onDelete: () => void
}) {
  const { token, onScene } = props
  return (
    <div className="token-row">
      {token.imageUrl ? (
        <img className="swatch" src={token.imageUrl} alt="" style={{ borderColor: token.color }} />
      ) : (
        <span className="swatch" style={{ background: token.color }} />
      )}
      {/* Keyed on server values so remote updates reset the inputs. */}
      <input
        key={`n${token.name}`}
        defaultValue={token.name}
        maxLength={40}
        onBlur={(e) => e.target.value.trim() && props.onSave(token, e.target.value, token.hp)}
      />
      <input
        key={`h${token.hp}`}
        type="number"
        min={0}
        max={token.maxHp}
        defaultValue={token.hp}
        onBlur={(e) => props.onSave(token, token.name, Number(e.target.value) || 0)}
      />
      <span>/{token.maxHp}</span>
      <button onClick={onScene ? props.onRemove : props.onAdd}>{onScene ? 'Remove' : 'Add'}</button>
      <label className="icon-button" title="Set token art">
        Art
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (file) props.onArt(file)
          }}
        />
      </label>
      <button className="danger icon-button" title="Delete token" aria-label={`Delete ${token.name}`} onClick={props.onDelete}>
        ✕
      </button>
    </div>
  )
}
