import type { Scene } from './types'

async function send(url: string, method: string, body: FormData): Promise<Scene> {
  const res = await fetch(url, { method, body })
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error(data?.error ?? `Upload failed (${res.status})`)
  return data as Scene
}

export function createScene(name: string, file: File): Promise<Scene> {
  const form = new FormData()
  form.append('name', name)
  form.append('file', file)
  return send('/api/scenes', 'POST', form)
}

export function replaceSceneImage(sceneId: string, file: File): Promise<Scene> {
  const form = new FormData()
  form.append('file', file)
  return send(`/api/scenes/${encodeURIComponent(sceneId)}/image`, 'PUT', form)
}
