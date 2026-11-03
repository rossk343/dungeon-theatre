import { useCallback, useEffect, useRef, useState } from 'react'
import { HubConnectionBuilder, type HubConnection } from '@microsoft/signalr'
import { Image as KonvaImage, Layer, Line, Stage, Text } from 'react-konva'
import useImage from 'use-image'
import { createScene, createToken, deleteScene, deleteToken, replaceSceneImage, setTokenImage } from './api'
import { NewSceneForm, NewTokenForm, SceneSettings } from './SceneSettings'
import { TokenDisc } from './TokenDisc'
import type { GameState, GridPreview, Placement, Scene, Token } from './types'
import './App.css'

const SEND_INTERVAL_MS = 50
const SIDEBAR_WIDTH = 400

const snap = (v: number, grid: number, offset: number) =>
  Math.round((v - offset - grid / 2) / grid) * grid + offset + grid / 2

const byName = (a: Scene, b: Scene) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)

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
  const [tokens, setTokens] = useState<Token[]>([])
  const [placements, setPlacements] = useState<Placement[]>([])
  const [sceneId, setSceneId] = useState<string | null>(null)
  const [preview, setPreview] = useState<GridPreview | null>(null)
  const [status, setStatus] = useState('connecting')
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [viewportWidth, setViewportWidth] = useState(window.innerWidth)
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
  const fit = scene ? Math.min(1, Math.max(0.2, (viewportWidth - SIDEBAR_WIDTH) / scene.width)) : 1

  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

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
      prev.some((x) => x.id === s.id) ? prev.map((x) => (x.id === s.id ? s : x)) : [...prev, s].sort(byName),
    )
    setPreview((p) => (p?.sceneId === s.id ? null : p))
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
      setScenes(state.scenes)
      setTokens(state.tokens)
      const id = sceneRef.current ?? state.scenes[0]?.id
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
  }, [joinScene, applyScene, applyToken])

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

  const handleCreate = async (name: string, file: File) => {
    const s = await run(() => createScene(name, file))
    if (s) {
      applyScene(s)
      await joinScene(s.id)
    }
    return s !== null
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
        <nav>
          {scenes.map((s) => (
            <button
              key={s.id}
              className={s.id === sceneId ? 'active' : ''}
              onClick={() => void joinScene(s.id)}
            >
              {s.name}
            </button>
          ))}
        </nav>
      </header>
      <main>
        {scene && (
          <Stage
            width={scene.width * fit}
            height={scene.height * fit}
            scaleX={fit}
            scaleY={fit}
            className="stage"
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
        )}
        <aside>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {savedScene && (
            <SceneSettings
              key={`${savedScene.id}:${savedScene.name}:${savedScene.gridSize}:${savedScene.gridOffsetX}:${savedScene.gridOffsetY}:${savedScene.imageUrl}`}
              scene={savedScene}
              busy={uploading}
              onPreview={setPreview}
              onSave={saveGrid}
              onReplaceImage={(f) => void handleReplaceImage(f)}
              onRename={renameScene}
              onDelete={handleDeleteScene}
            />
          )}
          <NewSceneForm busy={uploading} onCreate={handleCreate} />
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
