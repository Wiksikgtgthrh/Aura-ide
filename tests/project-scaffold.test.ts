import { describe, expect, it } from 'vitest'
import { scaffoldProject, scaffoldStaticSite, sanitizeName } from '../lib/project-scaffold'

describe('scaffoldProject — полный Vite-проект', () => {
  const virtual = { 'src/App.tsx': 'export default function App(){return null}' }

  it('добавляет каркас и не теряет файлы пользователя', () => {
    const out = scaffoldProject(virtual, { name: 'My App', docker: true })
    for (const key of [
      'package.json', 'index.html', 'vite.config.ts', 'tailwind.config.js',
      'tsconfig.json', 'src/main.tsx', 'src/index.css',
      'Dockerfile', 'docker-compose.yml', 'nginx.conf', 'src/App.tsx',
    ]) {
      expect(out[key], key).toBeTruthy()
    }
    expect(out['src/App.tsx']).toBe(virtual['src/App.tsx'])
    expect(JSON.parse(out['package.json']).name).toBe('my-app')
  })

  it('deploy.sh подставляет SSH-параметры', () => {
    const out = scaffoldProject(virtual, {
      name: 'x',
      docker: true,
      ssh: { host: '203.0.113.7', user: 'deploy', port: '2222', path: '/opt/apps/x' },
    })
    expect(out['deploy.sh']).toContain('HOST="203.0.113.7"')
    expect(out['deploy.sh']).toContain('PORT="2222"')
    expect(out['deploy.sh']).toContain('/opt/apps/x')
  })

  it('static-вариант кладёт файлы под site/ и без node-сборки', () => {
    const out = scaffoldStaticSite({ 'index.html': '<h1>hi</h1>' }, { name: 's', docker: true })
    expect(out['site/index.html']).toBe('<h1>hi</h1>')
    expect(out['Dockerfile']).not.toContain('npm run build')
    expect(out['package.json']).toBeUndefined()
  })

  it('sanitizeName нормализует имена', () => {
    expect(sanitizeName('Мой Проект!')).toBe('aura-project')
    expect(sanitizeName('My Cool App 2')).toBe('my-cool-app-2')
  })
})
