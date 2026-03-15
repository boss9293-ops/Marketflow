import { NextResponse } from 'next/server'
import path from 'path'
import { promises as fs } from 'fs'

type Params = {
  params: {
    slug: string
  }
}

export async function GET(_request: Request, { params }: Params) {
  const slug = params.slug
  if (!/^[a-z0-9-]+$/i.test(slug)) {
    return NextResponse.json({ error: 'invalid slug' }, { status: 400 })
  }

  const filePath = path.resolve(process.cwd(), '..', 'content', 'playback-events', `${slug}.md`)
  try {
    const markdown = await fs.readFile(filePath, 'utf-8')
    return new NextResponse(markdown, {
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    })
  } catch {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }
}
