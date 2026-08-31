import { headers } from 'next/headers'
import { getSession } from '@/lib/session'

export const maxDuration = 30

export async function GET(req: Request) {
  const session = await getSession()
  if (!session?.user) return new Response('Unauthorized', { status: 401 })

  const { searchParams } = new URL(req.url)
  const fileKey = searchParams.get('fileKey')
  const nodeId = searchParams.get('nodeId')

  if (!fileKey) return new Response('fileKey required', { status: 400 })

  const incomingHeaders = await headers()
  const figmaToken = incomingHeaders.get('x-figma-token')
  if (!figmaToken) return new Response('x-figma-token header required', { status: 400 })

  const endpoint = nodeId
    ? `https://api.figma.com/v1/files/${fileKey}/nodes?ids=${encodeURIComponent(nodeId)}`
    : `https://api.figma.com/v1/files/${fileKey}?depth=3`

  const res = await fetch(endpoint, {
    headers: { 'X-Figma-Token': figmaToken },
  })

  if (!res.ok) {
    const text = await res.text()
    return new Response(text || 'Figma API error', { status: res.status })
  }

  const data = await res.json()

  // Return only the essentials to keep payload small
  const simplified = nodeId
    ? { nodes: data.nodes }
    : { name: data.name, document: data.document }

  return Response.json(simplified)
}
