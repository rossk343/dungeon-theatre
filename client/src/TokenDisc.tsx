import { Circle, Group, Image as KonvaImage, Line } from 'react-konva'
import type Konva from 'konva'
import useImage from 'use-image'
import type { Token } from './types'

interface TokenDiscProps {
  token: Token
  x: number
  y: number
  radius: number
  active?: boolean
  targeted?: boolean
  opacity?: number
  draggable: boolean
  onSelect?: () => void
  onDragMove: (e: Konva.KonvaEventObject<DragEvent>) => void
  onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => void
}

// Art is cropped to fill the disc (like CSS object-fit: cover).
function Art({ url, radius }: { url: string; radius: number }) {
  const [image] = useImage(url)
  if (!image) return null
  const size = radius * 2
  const scale = Math.max(size / image.width, size / image.height)
  const w = image.width * scale
  const h = image.height * scale
  return (
    <Group
      clipFunc={(ctx) => {
        ctx.arc(0, 0, radius, 0, Math.PI * 2)
      }}
    >
      <KonvaImage image={image} x={-w / 2} y={-h / 2} width={w} height={h} />
    </Group>
  )
}

// Sword cursor (tip at the top-left) shown over NPCs that can be attacked.
const SWORD_PATHS = "M3 3L20 20M15 25L25 15M22 22L28 28"
const SWORD_CURSOR =
  `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32'%3E` +
  `%3Cpath d='${SWORD_PATHS}' stroke='%231a1208' stroke-width='6' stroke-linecap='round' fill='none'/%3E` +
  `%3Cpath d='M3 3L20 20' stroke='%23e8e0d0' stroke-width='3' stroke-linecap='round' fill='none'/%3E` +
  `%3Cpath d='M15 25L25 15' stroke='%23e0b341' stroke-width='3' stroke-linecap='round' fill='none'/%3E` +
  `%3Cpath d='M22 22L28 28' stroke='%238a3b2e' stroke-width='3' stroke-linecap='round' fill='none'/%3E` +
  `%3C/svg%3E") 3 3, crosshair`

export function TokenDisc({
  token, x, y, radius, active, targeted, opacity = 1, draggable, onSelect, onDragMove, onDragEnd,
}: TokenDiscProps) {
  return (
    <Group
      x={x}
      y={y}
      opacity={opacity}
      draggable={draggable}
      onClick={(e) => {
        if (e.evt.button === 0) onSelect?.()
      }}
      onTap={() => onSelect?.()}
      onMouseEnter={(e) => {
        if (onSelect) e.target.getStage()?.container().style.setProperty('cursor', SWORD_CURSOR)
        else if (draggable) e.target.getStage()?.container().style.setProperty('cursor', 'move')
      }}
      onMouseLeave={(e) => {
        e.target.getStage()?.container().style.removeProperty('cursor')
      }}
      onDragStart={(e) => e.target.getStage()?.container().style.setProperty('cursor', 'grabbing')}
      onDragMove={onDragMove}
      onDragEnd={(e) => {
        const style = e.target.getStage()?.container().style
        if (draggable) style?.setProperty('cursor', 'move')
        else style?.removeProperty('cursor')
        onDragEnd(e)
      }}
    >
      <Circle radius={radius} fill={token.color} />
      {token.imageUrl && <Art url={token.imageUrl} radius={radius} />}
      <Circle radius={radius} stroke="#e8e0d0" strokeWidth={2} />
      {active && <Circle radius={radius + 4} stroke="#e0b341" strokeWidth={Math.max(4, radius * 0.12)} />}
      {targeted && <Circle radius={radius + 4} stroke="#e05a5a" strokeWidth={Math.max(4, radius * 0.12)} dash={[8, 5]} />}
      {!token.isPlayer && token.hp <= 0 && (
        <>
          <Line points={[-radius * 0.6, -radius * 0.6, radius * 0.6, radius * 0.6]} stroke="#1a0808" strokeWidth={Math.max(8, radius * 0.3)} lineCap="round" listening={false} />
          <Line points={[radius * 0.6, -radius * 0.6, -radius * 0.6, radius * 0.6]} stroke="#1a0808" strokeWidth={Math.max(8, radius * 0.3)} lineCap="round" listening={false} />
          <Line points={[-radius * 0.6, -radius * 0.6, radius * 0.6, radius * 0.6]} stroke="#e03a3a" strokeWidth={Math.max(5, radius * 0.18)} lineCap="round" listening={false} />
          <Line points={[radius * 0.6, -radius * 0.6, -radius * 0.6, radius * 0.6]} stroke="#e03a3a" strokeWidth={Math.max(5, radius * 0.18)} lineCap="round" listening={false} />
        </>
      )}
    </Group>
  )
}
