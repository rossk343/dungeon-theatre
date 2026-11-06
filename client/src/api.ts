import type { Chapter, Scene, Session, Token } from './types'

async function request<T>(url: string, method: string, body?: FormData, json?: unknown): Promise<T> {
  const res = await fetch(
    url,
    json === undefined
      ? { method, body }
      : { method, body: JSON.stringify(json), headers: { 'Content-Type': 'application/json' } },
  )
  if (res.status === 204) return undefined as T
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`)
  return data as T
}

const id = encodeURIComponent

export interface AuthStatus {
  hasUsers: boolean
}

async function authRequest<T>(path: string, method: string, body?: unknown): Promise<T> {
  return request<T>(path, method, undefined, body)
}

export function getAuthStatus(): Promise<AuthStatus> {
  return request('/api/auth/status', 'GET')
}

export async function getSession(): Promise<Session | null> {
  const res = await fetch('/api/auth/me')
  if (res.status === 401) return null
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`)
  return data as Session
}

export function login(username: string, password: string): Promise<Session> {
  return authRequest('/api/auth/login', 'POST', { username, password })
}

export function register(
  username: string,
  password: string,
  displayName: string,
  inviteCode: string,
): Promise<Session> {
  return authRequest('/api/auth/register', 'POST', { username, password, displayName, inviteCode })
}

export function joinAsGuest(displayName: string, inviteCode: string): Promise<Session> {
  return authRequest('/api/auth/guest', 'POST', { displayName, inviteCode })
}

export function logout(): Promise<void> {
  return request('/api/auth/logout', 'POST')
}

export async function regenerateInvite(): Promise<string> {
  const result = await authRequest<{ inviteCode: string }>('/api/auth/invite', 'POST')
  return result.inviteCode
}

export function createChapter(name: string): Promise<Chapter> {
  return request('/api/chapters', 'POST', undefined, { name })
}

export function renameChapter(chapterId: string, name: string): Promise<Chapter> {
  return request(`/api/chapters/${id(chapterId)}`, 'PUT', undefined, { name })
}

export function deleteChapter(chapterId: string): Promise<void> {
  return request(`/api/chapters/${id(chapterId)}`, 'DELETE')
}

export function moveScene(sceneId: string, chapterId: string): Promise<Scene> {
  return request(`/api/scenes/${id(sceneId)}/chapter`, 'PUT', undefined, { chapterId })
}

export function createScene(chapterId: string, name: string, file: File): Promise<Scene> {
  const form = new FormData()
  form.append('chapterId', chapterId)
  form.append('name', name)
  form.append('file', file)
  return request('/api/scenes', 'POST', form)
}

export function replaceSceneImage(sceneId: string, file: File): Promise<Scene> {
  const form = new FormData()
  form.append('file', file)
  return request(`/api/scenes/${id(sceneId)}/image`, 'PUT', form)
}

export function deleteScene(sceneId: string): Promise<void> {
  return request(`/api/scenes/${id(sceneId)}`, 'DELETE')
}

export function createToken(
  name: string,
  color: string,
  maxHp: number,
  speedFeet: number,
  armorClass: number,
  visionFeet: number,
  lightFeet: number,
  isPlayer: boolean,
  isItem: boolean,
  file: File | null,
): Promise<Token> {
  const form = new FormData()
  form.append('name', name)
  form.append('color', color)
  form.append('maxHp', String(maxHp))
  form.append('speedFeet', String(speedFeet))
  form.append('armorClass', String(armorClass))
  form.append('visionFeet', String(visionFeet))
  form.append('lightFeet', String(lightFeet))
  form.append('isPlayer', String(isPlayer))
  form.append('isItem', String(isItem))
  if (file) form.append('file', file)
  return request('/api/tokens', 'POST', form)
}

export function setTokenImage(tokenId: string, file: File): Promise<Token> {
  const form = new FormData()
  form.append('file', file)
  return request(`/api/tokens/${id(tokenId)}/image`, 'PUT', form)
}

export function deleteToken(tokenId: string): Promise<void> {
  return request(`/api/tokens/${id(tokenId)}`, 'DELETE')
}
