import { Circle, Group, Image as KonvaImage } from 'react-konva'
import type Konva from 'konva'
import useImage from 'use-image'
import type { Token } from './types'

interface TokenDiscProps {
  token: Token
  x: number
  y: number
  radius: number
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

export function TokenDisc({ token, x, y, radius, onDragMove, onDragEnd }: TokenDiscProps) {
  return (
    <Group x={x} y={y} draggable onDragMove={onDragMove} onDragEnd={onDragEnd}>
      <Circle radius={radius} fill={token.color} />
      {token.imageUrl && <Art url={token.imageUrl} radius={radius} />}
      <Circle radius={radius} stroke="#e8e0d0" strokeWidth={2} />
    </Group>
  )
}
