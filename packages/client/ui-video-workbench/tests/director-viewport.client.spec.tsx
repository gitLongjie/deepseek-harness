// @vitest-environment jsdom
/** GPU resource ownership and unavailable-context feedback. */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type {} from '../src/client/index.ts'
import type { StudioDirectorScene, StudioId } from '@deepseek-ai/dsh-video-workbench'
import { DirectorViewport } from '../src/client/DirectorViewport.tsx'
import { en } from '../src/client/locales.ts'

const state = vi.hoisted(() => ({
  dispose: vi.fn(), render: vi.fn(), position: vi.fn(), fail: false, disconnect: vi.fn(),
}))
vi.mock('three', () => {
  class Resource { dispose = state.dispose }
  return {
    BoxGeometry: Resource, MeshNormalMaterial: Resource,
    GridHelper: class { geometry = new Resource(); material = new Resource() },
    Mesh: class { position = { set: state.position } },
    Scene: class { add = vi.fn() },
    PerspectiveCamera: class { position = { set: state.position }; lookAt = vi.fn(); updateProjectionMatrix = vi.fn() },
    WebGLRenderer: class {
      constructor() { if (state.fail) throw new Error('No GPU') }
      setSize = vi.fn(); render = state.render; dispose = state.dispose
    },
  }
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.clearAllMocks(); state.fail = false })
const scene: StudioDirectorScene = {
  id: '8a8f72eb-8465-4fc1-992d-1179df263603' as StudioId, name: 'Stage', camera: 'Wide',
  viewpoint: { x: 4, y: 3, z: 5, fov: 50 },
  objects: [{ id: '3b5f51d8-a872-40cc-a6a4-4f62b5457ab8' as StudioId, label: 'Actor', x: 1, y: 2, z: 3 }],
}

it('positions the camera and actors and disposes resources on scene replacement and unmount', () => {
  vi.stubGlobal('ResizeObserver', class { observe = vi.fn(); disconnect = state.disconnect })
  vi.spyOn(HTMLCanvasElement.prototype, 'clientWidth', 'get').mockReturnValue(640)
  vi.spyOn(HTMLCanvasElement.prototype, 'clientHeight', 'get').mockReturnValue(360)
  const view = render(<DirectorViewport scene={scene} t={makeTranslate(en)} />)
  expect(state.position).toHaveBeenCalledWith(4, 3, 5)
  expect(state.position).toHaveBeenCalledWith(1, 2, 3)
  expect(state.render).toHaveBeenCalledOnce()
  view.rerender(<DirectorViewport scene={{ ...scene, objects: [] }} t={makeTranslate(en)} />)
  expect(state.disconnect).toHaveBeenCalledOnce()
  expect(state.dispose).toHaveBeenCalledTimes(5)
  view.unmount()
  expect(state.disconnect).toHaveBeenCalledTimes(2)
  expect(state.dispose).toHaveBeenCalledTimes(10)
})

it('reports unavailable WebGL without claiming the preview rendered', () => {
  state.fail = true
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  render(<DirectorViewport scene={scene} t={makeTranslate(en)} />)
  expect(screen.getByRole('alert').textContent).toBe(en['director.unavailable'])
  expect(state.render).not.toHaveBeenCalled()
})
