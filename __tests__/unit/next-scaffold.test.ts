import { describe, expect, it } from 'vitest'
import { ensureNextScaffold } from '@/lib/devfactory/next-scaffold'

describe('ensureNextScaffold', () => {
  it('adds missing bare-import dependencies to package.json', () => {
    const result = ensureNextScaffold([
      { path: 'app/api/leads/route.ts', content: `import { z } from 'zod'\nexport async function POST() {}` },
      { path: 'lib/supabase.ts', content: `import { createClient } from '@supabase/supabase-js'` },
    ])
    const pkg = JSON.parse(result.find(f => f.path === 'package.json')!.content)
    expect(pkg.dependencies.zod).toBeDefined()
    expect(pkg.dependencies['@supabase/supabase-js']).toBeDefined()
  })

  it('prepends "use client" to components using hooks when missing', () => {
    const result = ensureNextScaffold([
      { path: 'app/page.tsx', content: `import { useState } from 'react'\nexport default function Page() { useState(0); return null }` },
    ])
    const page = result.find(f => f.path === 'app/page.tsx')!
    expect(page.content.trimStart().startsWith("'use client'")).toBe(true)
  })

  it('does not duplicate "use client" when already present', () => {
    const result = ensureNextScaffold([
      { path: 'app/page.tsx', content: `'use client'\nimport { useState } from 'react'\nexport default function Page() { useState(0); return null }` },
    ])
    const page = result.find(f => f.path === 'app/page.tsx')!
    expect(page.content.match(/use client/g)?.length).toBe(1)
  })

  it('adds app/globals.css when referenced but missing', () => {
    const result = ensureNextScaffold([
      { path: 'app/layout.tsx', content: `import './globals.css'\nexport default function RootLayout({ children }: any) { return children }` },
    ])
    expect(result.some(f => f.path === 'app/globals.css')).toBe(true)
  })

  it('does not treat the "@/" tsconfig path alias as an npm package', () => {
    const result = ensureNextScaffold([
      { path: 'app/page.tsx', content: `import { supabase } from '@/lib/supabase'\nexport default function Page() { return null }` },
    ])
    const pkg = JSON.parse(result.find(f => f.path === 'package.json')!.content)
    expect(pkg.dependencies['@/lib']).toBeUndefined()
    expect(pkg.dependencies['@/lib/supabase']).toBeUndefined()
  })

  it('never overwrites an AI-provided package.json field it did not need to touch', () => {
    const result = ensureNextScaffold([
      { path: 'package.json', content: JSON.stringify({ name: 'my-custom-app', dependencies: { next: '15.1.0' } }) },
    ])
    const pkg = JSON.parse(result.find(f => f.path === 'package.json')!.content)
    expect(pkg.name).toBe('my-custom-app')
    expect(pkg.dependencies.next).toBe('15.1.0')
  })
})
