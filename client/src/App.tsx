import { useCallback, useEffect, useRef, useState } from 'react'
import { HubConnectionBuilder, type HubConnection } from '@microsoft/signalr'
import { Circle, Layer, Line, Stage, Text } from 'react-konva'
import './App.css'

interface Token {
  id: string
  name: string
  color: string
  hp: number
  maxHp: number
}

interface Scene {
  id: string
  name: string
  width: number
  height: number
  gridSize: number
}

interface Placement {
  sceneId: string
  tokenId: string
  x: number
  y: number
}

interface GameState {
  scenes: Scene[]
  tokens: Token[]
}

const SEND_INTERVAL_MS = 50

const snap = (v: number, grid: number) => Math.round((v - grid / 2) / grid) * grid + grid / 2

function GridLines({ scene }: { scene: Scene }) {
  const lines = []
  for (let x = 0; x <= scene.width; x += scene.gridSize)
    lines.push(<Line key={`v${x}`} points={[x, 0, x, scene.height]} stroke="#3a3347" strokeWidth={1} />)
  for (let y = 0; y <= scene.height; y += scene.gridSize)
    lines.push(<Line key={`h${y}`} points={[0, y, scene.width, y]} stroke="#3a3347" strokeWidth={1} />)
  return <>{lines}</>
}

export default function App() {
  const [scenes, setScenes] = useState<Scene[]>([])
  const [tokens, setTokens] = useState<Token[]>([])
  const [placements, setPlacements] = useState<Placement[]>([])
  const [sceneId, setSceneId] = useState<string | null>(null)
  const [status, setStatus] = useState('connecting')
  const connection = useRef<HubConnection | null>(null)
  const sceneRef = useRef<string | null>(null)
  const lastSent = useRef(0)

  const scene = scenes.find((s) => s.id === sceneId) ?? null

  const joinScene = useCallback(async (id: string) => {
    const conn = connection.current
    if (!conn) return
    sceneRef.current = id
    setSceneId(id)
    const list = await conn.invoke<Placement[]>('JoinScene', id)
    // Ignore the reply if the user already switched again.
    if (sceneRef.current === id) setPlacements(list)
  }, [])

  useEffect(() => {
    const conn = new HubConnectionBuilder().withUrl('/hubs/game').withAutomaticReconnect().build()
    connection.current = conn

    const upsert = (p: Placement) => {
      if (p.sceneId !== sceneRef.current) return
      setPlacements((prev) =>
        prev.some((x) => x.tokenId === p.tokenId)
          ? prev.map((x) => (x.tokenId === p.tokenId ? p : x))
          : [...prev, p],
      )
    }

    conn.on('PlacementMoved', upsert)
    conn.on('PlacementAdded', upsert)
    conn.on('PlacementRemoved', (sid: string, tokenId: string) => {
      if (sid === sceneRef.current) setPlacements((prev) => prev.filter((p) => p.tokenId !== tokenId))
    })
    conn.on('TokenUpdated', (t: Token) => setTokens((prev) => prev.map((p) => (p.id === t.id ? t : p))))

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
  }, [joinScene])

  const invoke = (method: string, ...args: unknown[]) =>
    connection.current?.invoke(method, ...args).catch(() => {})

  const move = (tokenId: string, x: number, y: number) => {
    setPlacements((prev) => prev.map((p) => (p.tokenId === tokenId ? { ...p, x, y } : p)))
    void invoke('MovePlacement', sceneId, tokenId, x, y)
  }

  const addToScene = (tokenId: string) => {
    if (!scene) return
    const x = snap(scene.width / 2, scene.gridSize)
    const y = snap(scene.height / 2, scene.gridSize)
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
          <Stage width={scene.width} height={scene.height} className="stage">
            <Layer listening={false}>
              <GridLines scene={scene} />
            </Layer>
            <Layer>
              {placements.map((p) => {
                const t = tokenById.get(p.tokenId)
                if (!t) return null
                const radius = scene.gridSize / 2 - 4
                return (
                  <Circle
                    key={p.tokenId}
                    x={p.x}
                    y={p.y}
                    radius={radius}
                    fill={t.color}
                    stroke="#e8e0d0"
                    strokeWidth={2}
                    draggable
                    onDragMove={(e) => {
                      const now = performance.now()
                      if (now - lastSent.current < SEND_INTERVAL_MS) return
                      lastSent.current = now
                      void invoke('MovePlacement', scene.id, p.tokenId, e.target.x(), e.target.y())
                    }}
                    onDragEnd={(e) => {
                      const x = snap(e.target.x(), scene.gridSize)
                      const y = snap(e.target.y(), scene.gridSize)
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
                    listening={false}
                  />
                )
              })}
            </Layer>
          </Stage>
        )}
        <aside>
          <h2>Tokens</h2>
          {tokens.map((t) => (
            <TokenRow
              key={t.id}
              token={t}
              onScene={placed.has(t.id)}
              onSave={saveToken}
              onAdd={() => addToScene(t.id)}
              onRemove={() => removeFromScene(t.id)}
            />
          ))}
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
}) {
  const { token, onScene } = props
  return (
    <div className="token-row">
      <span className="swatch" style={{ background: token.color }} />
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
    </div>
  )
}
