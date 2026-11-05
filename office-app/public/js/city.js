// The city around the office: a night megacity in haze and rain. It is built by the scenery
// modules in ./scenery/ (the skyline, the big screens, the street, the traffic and the weather),
// which share one context and fit themselves round what the earlier ones built. This file puts
// them together, gives the wet ground the finished city's reflection, and keeps the glowing sign
// helper the office uses for its own banner. Purely scenery: nobody walks here.

import * as THREE from 'three'
import { OUTSIDE } from './layout.js'
import { buildBillboards } from './scenery/billboards.js'
import { buildSkyline } from './scenery/skyline.js'
import { buildStreet } from './scenery/street.js'
import { buildTraffic } from './scenery/traffic.js'
import { buildWeather } from './scenery/weather.js'

const NEON = ['#ff2bd6', '#2bf3ff', '#ffb02b', '#7b5cff', '#ff3b5c', '#3bff9d']

/**
 * The scenery modules in build order. The billboards hang on the skyline's walls, the traffic
 * steers round everything before it, and the weather's searchlights stand on the skyline's roofs
 * and its rain is lit by every light the others list, so each is built after what it reads.
 */
const MODULES = [
  ['skyline', buildSkyline],
  ['billboards', buildBillboards],
  ['street', buildStreet],
  ['traffic', buildTraffic],
  ['weather', buildWeather],
]

/** Real lights (point and spot) the scenery may add in all: each module claims one before adding it. */
const LIGHT_BUDGET = 4
/** The reflection capture: cube face size in pixels, where it is taken from, and how strongly wet ground shows it. */
const REFLECTION_SIZE = 256
const REFLECTION_HEIGHT = 1.5
const REFLECTION_Z = 24
const REFLECTION_INTENSITY = 1.4
/** How far the capture point keeps from any listed light (a lamp head 3 m off would fill a side of the cube), and how far it may step aside for that. */
const REFLECTION_CLEAR = 4.5
const REFLECTION_SHIFT = 6

/** A glowing sign: text on a canvas, drawn bright enough to bloom. */
function neonSign(text, color, { width = 8, height = 3, font = 'bold', vertical = false } = {}) {
  const canvas = document.createElement('canvas')
  canvas.width = vertical ? 128 : 512
  canvas.height = vertical ? 512 : Math.round((512 * height) / width)
  const g = canvas.getContext('2d')
  g.fillStyle = 'rgba(5,6,12,0.82)'
  g.fillRect(0, 0, canvas.width, canvas.height)
  g.strokeStyle = color
  g.lineWidth = 6
  g.shadowColor = color
  g.shadowBlur = 18
  g.strokeRect(8, 8, canvas.width - 16, canvas.height - 16)
  g.fillStyle = color
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  if (vertical) {
    const chars = [...text]
    const step = (canvas.height - 40) / chars.length
    g.font = `${font} ${Math.min(96, step * 0.9)}px "Hiragino Sans", "Avenir Next Condensed", system-ui, sans-serif`
    chars.forEach((c, i) => g.fillText(c, canvas.width / 2, 20 + step * (i + 0.5)))
  } else {
    g.font = `${font} ${canvas.height * 0.5}px "Avenir Next Condensed", "Hiragino Sans", system-ui, sans-serif`
    g.fillText(text, canvas.width / 2, canvas.height / 2 + 4)
  }
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false, side: THREE.DoubleSide }))
  return mesh
}

/** Frees the GPU copies of a group's meshes, for modules that bring no dispose() of their own. */
function disposeGroup(group) {
  group.traverse(object => {
    if (object.isInstancedMesh) object.dispose()
    object.geometry?.dispose()
    const materials = Array.isArray(object.material) ? object.material : object.material ? [object.material] : []
    for (const material of materials) material.dispose()
  })
}

/**
 * What the reflection leaves out, by module. From the weather: the rain and splashes (instanced quads)
 * and the searchlight beams, which move while the reflection stands still, and its point lights (the
 * stars and the searchlights' lamps), sized in screen pixels, which a 256 px cube face would blow up.
 * weather.js does not hand these out, so they are known by their geometry. From the street: the light
 * shapes that turn to face the eye (halos, beams, steam and its own reflections), which would face the
 * cube instead, and the street already draws each lamp's reflection itself.
 */
const LEFT_OUT = {
  weather: object => Boolean(object.isPoints || object.geometry?.isInstancedBufferGeometry || object.geometry?.attributes?.aBeam),
  street: object => ['street:halos', 'street:cones', 'street:steam', 'street:reflections'].includes(object.name),
}

/**
 * Where the reflection is taken from: on the street in front of the office's middle, stepped sideways
 * (nearest first) to the first place REFLECTION_CLEAR from every light the modules listed, or failing
 * that the clearest place within REFLECTION_SHIFT. The lamp posts stand every 8 m or so, and at some
 * widths one stands right at the middle.
 */
function capturePoint(ctx) {
  const cx = ctx.extent / 2
  const point = new THREE.Vector3()
  let best = null
  for (let step = 0; step <= REFLECTION_SHIFT; step += 0.25) {
    for (const x of step ? [cx - step, cx + step] : [cx]) {
      point.set(x, REFLECTION_HEIGHT, REFLECTION_Z)
      let clear = Infinity
      for (const spot of ctx.lightSpots) if (spot?.position) clear = Math.min(clear, spot.position.distanceTo(point))
      if (clear >= REFLECTION_CLEAR) return point
      if (!best || clear > best.clear) best = { x, clear }
    }
  }
  return point.set(best.x, REFLECTION_HEIGHT, REFLECTION_Z)
}

export class City {
  /** `renderer` and `camera` are the app's: the modules size their glows by the screen and face the eye. */
  constructor(scene, renderer = null, camera = null) {
    this.scene = scene
    this.renderer = renderer
    this.camera = camera
    this.root = new THREE.Group()
    this.root.name = 'city'
    scene.add(this.root)
    /** Where the camera looks (ctx.focus): the rain, the splashes and the lit rain gather round it. */
    this.focus = new THREE.Vector3()
    this.focused = false
    this.ctx = null
    /** One entry per module built: { name, group, update, dispose }. */
    this.modules = []
    /** Real lights the last build claimed, out of LIGHT_BUDGET. */
    this.lightsUsed = 0
    this.time = 0
    /** The wet ground's reflection (a PMREM render target), from captureReflections(). */
    this.reflection = null
    /** Called with a strength (0 to 1) when a far lightning glow starts: main.js plays the thunder. */
    this.onLightning = null
  }

  /** Builds the city around a building `extent` metres wide (x from 0), its front on the street. */
  build(extent) {
    this.clear()
    let lights = 0
    const ctx = {
      extent,
      street: OUTSIDE.z1 + 3.2,
      scene: this.scene,
      renderer: this.renderer,
      camera: this.camera,
      focus: this.focus,
      lightSpots: [],
      wetMaterials: [],
      /** True if the caller may add one real light; the scenery has LIGHT_BUDGET in all. */
      claimLight() {
        if (lights >= LIGHT_BUDGET) return false
        lights += 1
        return true
      },
      onLightning: strength => this.onLightning?.(strength),
    }
    this.ctx = ctx
    // Until the first frame says where the camera looks, it looks where main.js's home view does.
    if (!this.focused) this.focus.set(extent / 2, 0, 9.5)

    for (const [name, build] of MODULES) {
      const group = new THREE.Group()
      group.name = `city:${name}`
      // In the scene before it builds, and the scenery so far handed over too: the modules after it
      // find walls, roofs and obstacles by reading what already stands (traffic reads sceneryRoots).
      this.root.add(group)
      ctx.sceneryRoots = this.modules.map(m => m.group)
      try {
        const made = build(group, ctx) ?? {}
        this.modules.push({
          name,
          group,
          update: typeof made.update === 'function' ? made.update.bind(made) : null,
          dispose: typeof made.dispose === 'function' ? made.dispose.bind(made) : () => disposeGroup(group),
        })
      } catch (error) {
        // A module that fails leaves the rest of the city (and the office) standing.
        console.error(`city.js: the ${name} scenery failed to build`, error)
        disposeGroup(group)
        this.root.remove(group)
      }
    }
    delete ctx.sceneryRoots
    this.lightsUsed = lights
  }

  /** Takes down the last build: frees what it made on the GPU and removes its groups. */
  clear() {
    this.disposeReflection()
    for (const m of this.modules) {
      try {
        m.dispose()
      } catch (error) {
        console.error(`city.js: the ${m.name} scenery failed to dispose`, error)
      }
      this.root.remove(m.group)
    }
    this.modules = []
    this.ctx = null
  }

  /**
   * Gives the wet ground (every ctx.wetMaterials entry) the finished city's reflection: the scene,
   * office included, rendered once into a cube from the street in front of the office, then blurred
   * into an environment map. The sky is moved onto the capture point first (it rides on the camera,
   * so seen from elsewhere part of it lies past the far plane), and what LEFT_OUT names is hidden for
   * it. Call after build(). If it fails the ground simply stays without it.
   */
  captureReflections() {
    try {
      this.capture()
    } catch (error) {
      console.error('city.js: the reflection capture failed', error)
    }
  }

  /** The capture itself (see captureReflections). */
  capture() {
    const ctx = this.ctx
    const renderer = this.renderer
    if (!ctx || !renderer || !ctx.wetMaterials.length) return
    this.disposeReflection()
    const target = new THREE.WebGLCubeRenderTarget(REFLECTION_SIZE, { type: THREE.HalfFloatType })
    const pmrem = new THREE.PMREMGenerator(renderer)
    try {
      this.renderCube(target)
      this.reflection = pmrem.fromCubemap(target.texture)
    } finally {
      pmrem.dispose()
      target.dispose()
    }
    for (const material of ctx.wetMaterials) {
      material.envMap = this.reflection.texture
      material.envMapIntensity = REFLECTION_INTENSITY
      material.needsUpdate = true
    }
  }

  /** Renders the scene into `target`'s six faces from the capture point, the sky round it and LEFT_OUT hidden. */
  renderCube(target) {
    const ctx = this.ctx
    const renderer = this.renderer
    const cube = new THREE.CubeCamera(1, 600, target)
    cube.position.copy(capturePoint(ctx))
    cube.updateMatrixWorld(true)
    const weather = this.modules.find(m => m.name === 'weather')
    const hidden = []
    try {
      if (weather?.update) {
        // The weather places its sky round ctx.camera: for a moment that is an eye at the capture point.
        const eye = new THREE.PerspectiveCamera(90, 1, 1, 600)
        eye.position.copy(cube.position)
        eye.lookAt(cube.position.x, cube.position.y, cube.position.z - 1)
        eye.updateMatrixWorld(true)
        ctx.camera = eye
        try {
          weather.update(0, this.time)
        } finally {
          ctx.camera = this.camera
        }
      }
      for (const m of this.modules) {
        const leftOut = LEFT_OUT[m.name]
        if (!leftOut) continue
        m.group.traverse(object => {
          if (object.visible && leftOut(object)) {
            object.visible = false
            hidden.push(object)
          }
        })
      }
      // The moonlight's shadows are drawn for the first face and kept for the other five.
      const shadows = renderer.shadowMap
      const autoShadows = shadows.autoUpdate
      shadows.autoUpdate = false
      shadows.needsUpdate = true
      try {
        cube.update(renderer, this.scene)
      } finally {
        shadows.autoUpdate = autoShadows
      }
    } finally {
      for (const object of hidden) object.visible = true
      // Back round the app's camera (the next frame would do it too).
      if (weather?.update && this.camera) weather.update(0, this.time)
    }
  }

  /** Frees the last reflection capture and takes it off the wet ground. */
  disposeReflection() {
    if (!this.reflection) return
    for (const material of this.ctx?.wetMaterials ?? []) {
      if (material.envMap === this.reflection.texture) {
        material.envMap = null
        material.needsUpdate = true
      }
    }
    this.reflection.dispose()
    this.reflection = null
  }

  /** Per frame: every module moves on, the rain and the lit rain gathering round `focus` (where the camera looks). */
  update(dt, t, focus) {
    if (focus) {
      this.focus.copy(focus)
      this.focused = true
    }
    this.time = t
    for (const m of this.modules) {
      if (!m.update) continue
      try {
        m.update(dt, t)
      } catch (error) {
        // Said once, then that module stands still: one broken piece of scenery must not stop the frame loop.
        console.error(`city.js: the ${m.name} scenery failed to update and is now still`, error)
        m.update = null
      }
    }
  }
}

export { neonSign, NEON }
