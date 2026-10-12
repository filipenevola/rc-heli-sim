import * as THREE from 'three';

/**
 * Sky, sun, image-based lighting and the sun's shadows.
 *
 * One sun, two shadow maps. A big static map covers the whole field (trees, houses, billboards) and is baked once per
 * lighting change with the helicopter hidden (see bakeStaticShadow). A small, very sharp map follows the helicopter, so
 * the model's own shadow (the best height cue a pilot has when landing) is crisp to under a millimetre, rotor disc
 * included. Both maps are cast by directional lights pointing the same way; a patched lighting chunk multiplies the two
 * shadow terms onto every directional light, so the result is exactly one sun with one shadow.
 *
 * Note: three's shadow pass filters objects by the main camera's layers, not the shadow camera's, which is why the
 * static bake hides the model instead of relying on layers.
 */

/** Render layers: the heli on its own layer (so the lake reflection can include it), grass kept out of reflections. */
export const LAYER_HELI = 1;
export const LAYER_GRASS = 2;

export type TimeOfDay = 'day' | 'golden';
export const TIME_OF_DAY_LABELS: Record<TimeOfDay, string> = { day: 'Midday', golden: 'Golden hour' };

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
  // High summer sun ahead-left of the pilot, like the original field lighting.
  day: {
    elevation: 52, azimuth: -52, sunColor: 0xfff1dc, sunIntensity: 2.6,
    zenith: 0x2f6fd0, horizon: 0xbcd8f2, haze: 0xcfe0ef, glow: 0xfff4de,
    hemiSky: 0xe2ebf5, hemiGround: 0x7a7c55, hemiIntensity: 0.5, envIntensity: 0.65, exposure: 1.0,
  },
  // Low warm sun from the left: long shadows across the field and the lake turns to gold.
  golden: {
    elevation: 15, azimuth: -70, sunColor: 0xffb878, sunIntensity: 3.4,
    zenith: 0x3a68a8, horizon: 0xf6cfa2, haze: 0xeccaa6, glow: 0xffc27a,
    hemiSky: 0xc4d3ec, hemiGround: 0x6b5a35, hemiIntensity: 0.45, envIntensity: 1.0, exposure: 1.3,
  },
};

const isMobile = typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0 && window.innerWidth < 1100;

/** Patch three's lighting so every directional light gets the product of all directional shadow maps (one sun, two maps). */
function patchSharedSunShadow(): void {
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
  // The sun disc itself (HDR so bloom and the lens flare pick it up).
  col += sunColor * smoothstep(0.99985, 0.99995, c) * sunDisc;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export interface EnvironmentHandles {
  sun: THREE.DirectionalLight;
  /** Direction towards the sun (unit). */
  sunDir: THREE.Vector3;
  sunColor: THREE.Color;
  /** Ambient-ish sky colour, for shaders that do their own lighting (water). */
  skyColor: THREE.Color;
  hazeColor: THREE.Color;
  timeOfDay: TimeOfDay;
  setTimeOfDay(t: TimeOfDay): void;
  /** Keep the sharp shadow box on the helicopter. Call every frame. */
  followHeli(pos: THREE.Vector3, rotorRadius: number): void;
  /** Re-render the static field shadow (after moving scenery). */
  refreshStaticShadow(): void;
  /**
   * If the static map is due, render it now in an off-screen pass with `hide` (the helicopter, particles) invisible, so
   * nothing that moves gets baked into it. Call before the frame's main render.
   */
  bakeStaticShadow(camera: THREE.Camera, hide: THREE.Object3D[]): void;
}

export function createEnvironment(scene: THREE.Scene, renderer: THREE.WebGLRenderer): EnvironmentHandles {
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

  // Static sun: the light the scene is actually lit by, with the field-wide shadow map.
  const sun = new THREE.DirectionalLight(0xffffff, 2.5);
  sun.castShadow = true;
  const big = isMobile ? 2048 : 4096;
  sun.shadow.mapSize.set(big, big);
  const s = 130;
  Object.assign(sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 1, far: 600 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  sun.shadow.autoUpdate = false;
  scene.add(sun, sun.target);

  // Heli sun: same direction, zero intensity, exists only to own the sharp shadow map around the model.
  const heliSun = new THREE.DirectionalLight(0xffffff, 0);
  heliSun.castShadow = true;
  const small = isMobile ? 1024 : 2048;
  heliSun.shadow.mapSize.set(small, small);
  heliSun.shadow.bias = -0.0002;
  heliSun.shadow.normalBias = 0.004;
  scene.add(heliSun, heliSun.target);

  const pmrem = new THREE.PMREMGenerator(renderer);
  let envRT: THREE.WebGLRenderTarget | null = null;

  const handles: EnvironmentHandles = {
    sun,
    sunDir: new THREE.Vector3(),
    sunColor: new THREE.Color(),
    skyColor: new THREE.Color(),
    hazeColor: new THREE.Color(),
    timeOfDay: 'day',
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
      sun.target.position.set(0, 0, -10);
      sun.target.updateMatrixWorld();
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
      renderer.toneMappingExposure = p.exposure;

      // Image-based lighting from this sky: soft skylight on everything and real reflections on the canopy.
      const envScene = new THREE.Scene();
      const envSky = new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), skyMat.clone());
      (envSky.material as THREE.ShaderMaterial).uniforms.sunDisc.value = 4; // no blinding hotspot in the IBL
      envScene.add(envSky);
      // A ground hemisphere so reflections show the field below the horizon, not more sky.
      const groundCol = new THREE.Color(p.hemiGround).multiplyScalar(0.9);
      const envGround = new THREE.Mesh(new THREE.SphereGeometry(9, 32, 16, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), new THREE.MeshBasicMaterial({ color: groundCol, side: THREE.BackSide }));
      envScene.add(envGround);
      envRT?.dispose();
      envRT = pmrem.fromScene(envScene, 0.02);
      scene.environment = envRT.texture;
      scene.environmentIntensity = p.envIntensity;
      envSky.geometry.dispose();
      envGround.geometry.dispose();
      handles.refreshStaticShadow();
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
    },
    refreshStaticShadow() {
      sun.shadow.needsUpdate = true;
    },
    bakeStaticShadow(camera, hide) {
      if (!sun.shadow.needsUpdate) return;
      const was = hide.map((o) => o.visible);
      for (const o of hide) o.visible = false;
      const prev = renderer.getRenderTarget();
      renderer.setRenderTarget(bakeTarget);
      renderer.render(scene, camera);
      renderer.setRenderTarget(prev);
      hide.forEach((o, i) => (o.visible = was[i]));
    },
  };
  const bakeTarget = new THREE.WebGLRenderTarget(4, 4);
  handles.setTimeOfDay('day');
  return handles;
}
