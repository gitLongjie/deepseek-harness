/** Disposable Three.js preview of saved staging coordinates and camera position. */
import { useEffect, useRef, useState } from 'react'
import { BoxGeometry, GridHelper, Mesh, MeshNormalMaterial, PerspectiveCamera, Scene, WebGLRenderer } from 'three'
import type { StudioDirectorScene } from '@deepseek-ai/dsh-video-workbench'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { NS } from './locales.ts'
import css from './VideoWorkbenchPage.module.css'

type Props = Pick<PropsLocale<typeof NS>, 't'> & { scene: StudioDirectorScene }

/** Draw the scene from its saved camera without mutating authored content.
 * @param props - scene and localized capability failure message.
 * @returns WebGL viewport or a visible failure retaining the editable scene.
 */
export function DirectorViewport({ scene, t }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    const element = canvas.current
    if (element === null) return
    let renderer: WebGLRenderer
    try { renderer = new WebGLRenderer({ canvas: element, antialias: true, alpha: true }) } catch (error) {
      // Unsupported GPU contexts leave the coordinate editor usable.
      console.warn('Director WebGL context unavailable', error)
      setFailed(true)
      return
    }
    setFailed(false)
    const world = new Scene()
    const grid = new GridHelper(20, 20)
    world.add(grid)
    const geometry = new BoxGeometry(1, 1, 1)
    const material = new MeshNormalMaterial()
    for (const object of scene.objects) {
      const mesh = new Mesh(geometry, material)
      mesh.position.set(object.x, object.y, object.z)
      world.add(mesh)
    }
    const view = scene.viewpoint ?? { x: 8, y: 6, z: 8, fov: 45 }
    const camera = new PerspectiveCamera(view.fov, 1, 0.1, 10000)
    camera.position.set(view.x, view.y, view.z)
    camera.lookAt(0, 0, 0)
    const render = (): void => {
      const width = element.clientWidth
      const height = element.clientHeight
      if (width === 0 || height === 0) return
      camera.aspect = width / height
      camera.updateProjectionMatrix()
      renderer.setSize(width, height, false)
      renderer.render(world, camera)
    }
    // WebGL buffers must match their CSS viewport; the observer updates no React state.
    const observer = new ResizeObserver(render)
    observer.observe(element)
    const lost = (event: Event): void => { event.preventDefault(); setFailed(true) }
    element.addEventListener('webglcontextlost', lost)
    render()
    return () => {
      observer.disconnect()
      element.removeEventListener('webglcontextlost', lost)
      geometry.dispose()
      material.dispose()
      grid.geometry.dispose()
      grid.material.dispose()
      renderer.dispose()
    }
  }, [scene])
  return <div>
    {failed && <p role="alert">{t('director.unavailable')}</p>}
    <canvas ref={canvas} className={css.directorViewport} aria-label={t('director.preview')} />
  </div>
}
