import * as THREE from 'three';

/**
 * Sky, sun, image-based lighting and the sun's shadows for the outdoor sites.
 *
 * One sun, two shadow maps. A big map covers the whole site (trees, houses, billboards). A small, very sharp map
 * follows the helicopter, so the model's own shadow (the best height cue a pilot has when landing) is crisp to under
 * a millimetre, rotor disc included. Both maps belong to directional lights pointing the same way; a patched
 * lighting chunk multiplies the two shadow terms onto every directional light, so the result is exactly one sun with
 * one shadow. The helicopter is kept out of the big map (excludeFromSiteShadow) so it is never shadowed twice.
 *
 * Notes on three r170 that shaped this: the shadow pass filters objects by the main camera's layers (not the shadow
 * camera's), and it copies alphaMap/alphaTest from an object's visible material into its custom depth material.
 */

/** Render layers: the heli on its own layer (the lake reflection includes it), grass kept out of reflections. */
export const LAYER_HELI = 1;
export const LAYER_GRASS = 2;

export type TimeOfDay = 'morning' | 'noon' | 'evening';

interface Preset {
  /** Sun elevation and azimuth (deg). Azimuth 0 = straight ahead of the pilot (-z), 90 = to the pilot's right (+x). */
  elevation: number;
  azimuth: number;
  sunColor: number;
  sunIntensity: number;
  zenith: number;
  horizon: number;
  /** Colour of the haze low on the horizon and of the distance fog. */
  haze: number;
  glow: number;
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  envIntensity: number;
  exposure: number;
}

const PRESETS: Record<TimeOfDay, Preset> = {
  // Low sun ahead-right: soft light, long-ish shadows towards the pilot's left.
  morning: {
    elevation: 24, azimuth: 56, sunColor: 0xffe2bd, sunIntensity: 2.6,
    zenith: 0x4a84d0, horizon: 0xdfe8ef, haze: 0xd9e2ea, glow: 0xfff0d8,
    hemiSky: 0xe4ecf6, hemiGround: 0x76784f, hemiIntensity: 0.5, envIntensity: 0.7, exposure: 1.05,
  },
  // High summer sun ahead-left of the pilot.
  noon: {
    elevation: 52, azimuth: -52, sunColor: 0xfff1dc, sunIntensity: 2.6,
    zenith: 0x2f6fd0, horizon: 0xbcd8f2, haze: 0xcfe0ef, glow: 0xfff4de,
    hemiSky: 0xe2ebf5, hemiGround: 0x7a7c55, hemiIntensity: 0.5, envIntensity: 0.65, exposure: 1.0,
  },
  // Golden hour, sun low on the left and slightly behind: long shadows across the field, the lake turns to gold,
  // and the model reads as a silhouette when it flies towards the sun.
  evening: {
    elevation: 12, azimuth: -106, sunColor: 0xffb878, sunIntensity: 3.4,
    zenith: 0x3a68a8, horizon: 0xf6cfa2, haze: 0xeccaa6, glow: 0xffc27a,
    hemiSky: 0xc4d3ec, hemiGround: 0x6b5a35, hemiIntensity: 0.45, envIntensity: 1.0, exposure: 1.3,
  },
};

const isMobile = typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0 && window.innerWidth < 1100;

let envRenderer: THREE.WebGLRenderer | null = null;
/** The renderer used to pre-filter the sky into an environment map. Set once at start-up, before any scene. */
export function setEnvironmentRenderer(r: THREE.WebGLRenderer): void {
  envRenderer = r;
}

/** Patch three's lighting so every directional light gets the product of all directional shadow maps (one sun, two maps). */
export function patchSharedSunShadow(): void {
  const chunk = THREE.ShaderChunk.lights_fragment_begin;
  if (chunk.includes('sharedSunShadow')) return;
  const start = chunk.indexOf('#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )');
  const end = chunk.indexOf('#endif', chunk.indexOf('#pragma unroll_loop_end', start)) + '#endif'.length;
  if (start < 0 || end < start) throw new Error('three.js lights chunk changed: update patchSharedSunShadow');
  const replacement = /* glsl */ `
#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )
	DirectionalLight directionalLight;
	float sharedSunShadow = 1.0;
	#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
	DirectionalLightShadow directionalLightShadow;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i ++ ) {
		directionalLightShadow = directionalLightShadows[ i ];
		sharedSunShadow *= receiveShadow ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_DIR_LIGHTS; i ++ ) {
		directionalLight = directionalLights[ i ];
		getDirectionalLightInfo( directionalLight, directLight );
		directLight.color *= sharedSunShadow;
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif`;
  THREE.ShaderChunk.lights_fragment_begin = chunk.slice(0, start) + replacement + chunk.slice(end);
}

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize((modelMatrix * vec4(position, 1.0)).xyz - cameraPosition);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww; // always on the far plane
}`;

const SKY_FRAG = /* glsl */ `
uniform vec3 zenith; uniform vec3 horizon; uniform vec3 haze; uniform vec3 glow; uniform vec3 sunDir; uniform vec3 sunColor;
uniform float sunDisc;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  // Sky gradient: deep blue overhead, pale at the horizon; under the horizon the haze (the ground is there anyway).
  vec3 col = mix(horizon, zenith, pow(clamp(h, 0.0, 1.0), 0.5));
  col = mix(col, haze, exp(-max(h, 0.0) * 14.0) * 0.85);
  if (h < 0.0) col = haze;
  float c = max(dot(d, sunDir), 0.0);
  // Mie forward scattering around the sun and a wide aureole.
  col += glow * (pow(c, 8.0) * 0.35 + pow(c, 64.0) * 0.6);
  // The sun disc itself (HDR, so the bloom picks it up as glare).
  col += sunColor * smoothstep(0.99985, 0.99995, c) * sunDisc;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export interface EnvironmentHandles {
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  /** Direction towards the sun (unit). */
  sunDir: THREE.Vector3;
  sunColor: THREE.Color;
  /** Ambient-ish sky colour and the horizon haze, for shaders that do their own lighting (water). */
  skyColor: THREE.Color;
  hazeColor: THREE.Color;
  timeOfDay: TimeOfDay;
  setTimeOfDay(t: TimeOfDay): void;
  /** Keep the sharp shadow box on the helicopter. Call every frame. */
  followHeli(pos: THREE.Vector3, rotorRadius: number): void;
  /** Keep a moving model out of the site-wide shadow map (it casts into the sharp one instead). */
  excludeFromSiteShadow(root: THREE.Object3D): void;
}

export function createEnvironment(scene: THREE.Scene, shadowExtent: number): EnvironmentHandles {
  patchSharedSunShadow();

  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      zenith: { value: new THREE.Color() },
      horizon: { value: new THREE.Color() },
      haze: { value: new THREE.Color() },
      glow: { value: new THREE.Color() },
      sunDir: { value: new THREE.Vector3() },
      sunColor: { value: new THREE.Color() },
      sunDisc: { value: 40 },
    },
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1000, 48, 24), skyMat);
  sky.frustumCulled = false;
  sky.renderOrder = -1;
  sky.layers.enableAll();
  scene.add(sky);

  const hemi = new THREE.HemisphereLight(0xffffff, 0xffffff, 0.4);
  scene.add(hemi);

  // The sun the scene is lit by, with the site-wide shadow map.
  const sun = new THREE.DirectionalLight(0xffffff, 2.5);
  sun.castShadow = true;
  const big = isMobile ? 2048 : 4096;
  sun.shadow.mapSize.set(big, big);
  Object.assign(sun.shadow.camera, { left: -shadowExtent, right: shadowExtent, top: shadowExtent, bottom: -shadowExtent, near: 1, far: 600 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  scene.add(sun, sun.target);

  // Same direction, zero intensity: exists only to own the sharp shadow map around the model.
  const heliSun = new THREE.DirectionalLight(0xffffff, 0);
  heliSun.castShadow = true;
  const small = isMobile ? 1024 : 2048;
  heliSun.shadow.mapSize.set(small, small);
  heliSun.shadow.bias = -0.0002;
  heliSun.shadow.normalBias = 0.004;
  scene.add(heliSun, heliSun.target);

  // Depth materials that discard while the site-wide map renders (and only then).
  const skipUniform = { value: 0 };
  const patched = new WeakSet<THREE.Material>();
  const addSkip = (m: THREE.MeshDepthMaterial) => {
    if (patched.has(m)) return;
    patched.add(m);
    const prev = m.onBeforeCompile;
    m.onBeforeCompile = (shader, r) => {
      prev.call(m, shader, r);
      shader.uniforms.skipSiteShadow = skipUniform;
      shader.fragmentShader = shader.fragmentShader
        .replace('void main() {', 'uniform float skipSiteShadow;\nvoid main() {\n\tif ( skipSiteShadow > 0.5 ) discard;');
    };
    m.customProgramCacheKey = () => 'skipSiteShadow';
    m.needsUpdate = true;
  };
  const sharedDepth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  addSkip(sharedDepth);

  let envRT: THREE.WebGLRenderTarget | null = null;
  const pmrem = envRenderer ? new THREE.PMREMGenerator(envRenderer) : null;

  const handles: EnvironmentHandles = {
    sun,
    hemi,
    sunDir: new THREE.Vector3(),
    sunColor: new THREE.Color(),
    skyColor: new THREE.Color(),
    hazeColor: new THREE.Color(),
    timeOfDay: 'noon',
    setTimeOfDay(t) {
      const p = PRESETS[t];
      handles.timeOfDay = t;
      const el = THREE.MathUtils.degToRad(p.elevation);
      const az = THREE.MathUtils.degToRad(p.azimuth);
      handles.sunDir.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
      handles.sunColor.set(p.sunColor).multiplyScalar(p.sunIntensity);
      handles.skyColor.set(p.hemiSky);
      handles.hazeColor.set(p.haze);
      sun.color.set(p.sunColor);
      sun.intensity = p.sunIntensity;
      sun.position.copy(handles.sunDir).multiplyScalar(300);
      // Grazing light needs more normal bias or the ground shadows itself (acne).
      sun.shadow.normalBias = 0.04 / Math.max(0.3, Math.sin(el));
      hemi.color.set(p.hemiSky);
      hemi.groundColor.set(p.hemiGround);
      hemi.intensity = p.hemiIntensity;
      const u = skyMat.uniforms;
      u.zenith.value.set(p.zenith);
      u.horizon.value.set(p.horizon);
      u.haze.value.set(p.haze);
      u.glow.value.set(p.glow);
      u.sunDir.value.copy(handles.sunDir);
      u.sunColor.value.set(p.sunColor);
      scene.fog = new THREE.Fog(p.haze, 160, 900);
      scene.background = new THREE.Color(p.haze);
      if (envRenderer) envRenderer.toneMappingExposure = p.exposure;

      // Image-based lighting from this sky: soft skylight on everything and real reflections on the canopy.
      if (pmrem) {
        const envScene = new THREE.Scene();
        const envSkyMat = skyMat.clone();
        envSkyMat.uniforms.sunDisc.value = 4; // no blinding hotspot in the IBL
        const envSky = new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), envSkyMat);
        envScene.add(envSky);
        // A ground hemisphere so reflections show the field below the horizon, not more sky.
        const envGround = new THREE.Mesh(
          new THREE.SphereGeometry(9, 32, 16, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
          new THREE.MeshBasicMaterial({ color: new THREE.Color(p.hemiGround).multiplyScalar(0.9), side: THREE.BackSide }),
        );
        envScene.add(envGround);
        envRT?.dispose();
        envRT = pmrem.fromScene(envScene, 0.02);
        scene.environment = envRT.texture;
        scene.environmentIntensity = p.envIntensity;
        envSky.geometry.dispose();
        envGround.geometry.dispose();
        envSkyMat.dispose();
      }
    },
    followHeli(pos, rotorRadius) {
      // Box just big enough for the rotor; the light looks down the sun direction from well above the model.
      const half = rotorRadius * 1.5 + 0.25;
      const cam = heliSun.shadow.camera;
      if (cam.right !== half) {
        Object.assign(cam, { left: -half, right: half, top: half, bottom: -half, near: 0.5, far: 400 });
        cam.updateProjectionMatrix();
      }
      heliSun.position.copy(pos).addScaledVector(handles.sunDir, 60);
      heliSun.target.position.copy(pos);
      heliSun.target.updateMatrixWorld();
      sun.target.position.set(pos.x * 0, 0, -10);
      sun.target.updateMatrixWorld();
    },
    excludeFromSiteShadow(root) {
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh || !m.castShadow) return;
        const dm = (m.customDepthMaterial as THREE.MeshDepthMaterial | undefined) ?? sharedDepth;
        addSkip(dm);
        m.customDepthMaterial = dm;
        m.onBeforeShadow = (_r, _o, _c, shadowCamera) => {
          skipUniform.value = shadowCamera === sun.shadow.camera ? 1 : 0;
        };
      });
    },
  };
  handles.setTimeOfDay('noon');
  return handles;
}
