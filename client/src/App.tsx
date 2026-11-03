import { useEffect, useRef, useState } from 'react'
import { HubConnectionBuilder, type HubConnection } from '@microsoft/signalr'
import { Circle, Layer, Line, Stage, Text } from 'react-konva'
import './App.css'

interface TokenDto {
  id: string
  name: string
  color: string
  x: number
  y: number
}

const GRID = 60
const WIDTH = 1200
const HEIGHT = 720
const RADIUS = GRID / 2 - 4
const SEND_INTERVAL_MS = 50

const snap = (v: number) => Math.round((v - GRID / 2) / GRID) * GRID + GRID / 2

function GridLines() {
  const lines = []
  for (let x = 0; x <= WIDTH; x += GRID)
    lines.push(<Line key={`v${x}`} points={[x, 0, x, HEIGHT]} stroke="#3a3347" strokeWidth={1} />)
  for (let y = 0; y <= HEIGHT; y += GRID)
    lines.push(<Line key={`h${y}`} points={[0, y, WIDTH, y]} stroke="#3a3347" strokeWidth={1} />)
  return <>{lines}</>
}

export default function App() {
  const [tokens, setTokens] = useState<TokenDto[]>([])
  const [status, setStatus] = useState('connecting')
  const connection = useRef<HubConnection | null>(null)
  const lastSent = useRef(0)

  useEffect(() => {
    const conn = new HubConnectionBuilder()
      .withUrl('/hubs/game')
      .withAutomaticReconnect()
      .build()
    connection.current = conn

    conn.on('TokenMoved', (t: TokenDto) =>
      setTokens((prev) => prev.map((p) => (p.id === t.id ? t : p))),
    )
    conn.onreconnecting(() => setStatus('reconnecting'))
    conn.onreconnected(async () => {
      setStatus('connected')
      setTokens(await conn.invoke<TokenDto[]>('GetTokens'))
    })
    conn.onclose(() => setStatus('disconnected'))

    conn
      .start()
      .then(async () => {
        setStatus('connected')
        setTokens(await conn.invoke<TokenDto[]>('GetTokens'))
      })
      .catch(() => setStatus('disconnected'))

    return () => {
      void conn.stop()
    }
  }, [])

  const send = (id: string, x: number, y: number) =>
    connection.current?.invoke('MoveToken', id, x, y).catch(() => {})

  return (
    <div className="app">
      <header>
        <h1>Dungeon Theatre</h1>
        <span className={`status ${status}`}>{status}</span>
      </header>
      <Stage width={WIDTH} height={HEIGHT} className="stage">
        <Layer listening={false}>
          <GridLines />
        </Layer>
        <Layer>
          {tokens.map((t) => (
            <Circle
              key={t.id}
              x={t.x}
              y={t.y}
              radius={RADIUS}
              fill={t.color}
              stroke="#e8e0d0"
              strokeWidth={2}
              draggable
              onDragMove={(e) => {
                const now = performance.now()
                if (now - lastSent.current < SEND_INTERVAL_MS) return
                lastSent.current = now
                send(t.id, e.target.x(), e.target.y())
              }}
              onDragEnd={(e) => {
                const x = snap(e.target.x())
                const y = snap(e.target.y())
                e.target.position({ x, y })
                setTokens((prev) => prev.map((p) => (p.id === t.id ? { ...p, x, y } : p)))
                send(t.id, x, y)
              }}
            />
          ))}
          {tokens.map((t) => (
            <Text
              key={`l${t.id}`}
              x={t.x - GRID / 2}
              y={t.y + RADIUS + 2}
              width={GRID}
              align="center"
              text={t.name}
              fill="#e8e0d0"
              fontSize={12}
              listening={false}
            />
          ))}
        </Layer>
      </Stage>
    </div>
  )
}
