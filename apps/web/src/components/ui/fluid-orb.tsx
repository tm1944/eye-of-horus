'use client'

import React, { useEffect, useRef } from 'react'

// Fluid Orb by Rare UI — https://rareui.com
// Copyright (c) 2026 Swami Malode. MIT + Commons Clause + Attribution.
// See docs/licenses/rare-ui-LICENSE.txt. Adapted for plain CSS, bounded
// rendering cost, dynamic reduced motion, and hidden-tab suspension.

export type FluidOrbProps = React.ComponentProps<'div'> & {
  size?: number
  color?: string
  topColor?: string
  maxFps?: number
  maxPixelRatio?: number
}

const VERT = `
attribute vec2 a_pos;
void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`

const FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform vec2 u_resolution;
uniform float u_time;
uniform vec3 u_color;
uniform vec3 u_topColor;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i + vec2(0.0, 0.0)), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.6;
  for (int i = 0; i < 3; i++) {
    v += a * noise(p);
    p *= 2.0;
    a *= 0.5;
  }
  return v;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution.xy;
  float t = u_time * 0.22;

  vec2 drift = vec2(
    sin(t) + 0.6 * sin(t * 1.7 + 1.3),
    cos(t * 0.8) + 0.6 * cos(t * 1.3 + 2.1)
  );

  vec2 p = vec2(uv.x * 1.8, uv.y * 1.0) + drift * 0.7;

  vec2 q = vec2(fbm(p + drift), fbm(p + vec2(3.2, 1.5) - drift));
  float f = fbm(p + 1.2 * q);

  float g = clamp(1.0 - uv.y, 0.0, 1.0);
  // Pin both ends of the vertical gradient; let the fluid drift in the middle.
  float anchor = 4.0 * g * (1.0 - g);
  float shade = clamp(g + (f - 0.5) * 0.35 * anchor, 0.0, 1.0);
  vec3 col = mix(u_topColor, u_color, smoothstep(0.0, 1.0, shade));

  float edge = 1.0 - smoothstep(0.49, 0.5, distance(uv, vec2(0.5)));

  gl_FragColor = vec4(col * edge, edge);
}
`

function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace('#', '').trim()
  if (h.length === 3) {
    h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
  }
  const n = parseInt(h, 16)
  if (h.length !== 6 || Number.isNaN(n)) return [0.1, 0.45, 0.95]
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

function compile(gl: WebGLRenderingContext, type: number, src: string) {
  const shader = gl.createShader(type)
  if (!shader) return null
  gl.shaderSource(shader, src)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error(gl.getShaderInfoLog(shader))
    gl.deleteShader(shader)
    return null
  }
  return shader
}

const FluidOrb = ({
  size = 240,
  color = '#083568',
  topColor = '#9edbff',
  maxFps = 30,
  maxPixelRatio = 1.25,
  className,
  style,
  ...props
}: FluidOrbProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const gl = canvas.getContext('webgl', { antialias: true, alpha: true })
    if (!gl) return

    const program = gl.createProgram()
    const vert = compile(gl, gl.VERTEX_SHADER, VERT)
    const frag = compile(gl, gl.FRAGMENT_SHADER, FRAG)
    if (!program || !vert || !frag) {
      if (program) gl.deleteProgram(program)
      if (vert) gl.deleteShader(vert)
      if (frag) gl.deleteShader(frag)
      return
    }

    gl.attachShader(program, vert)
    gl.attachShader(program, frag)
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error(gl.getProgramInfoLog(program))
      gl.deleteProgram(program)
      gl.deleteShader(vert)
      gl.deleteShader(frag)
      return
    }
    gl.useProgram(program)

    const buffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    )
    const aPos = gl.getAttribLocation(program, 'a_pos')
    gl.enableVertexAttribArray(aPos)
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0)

    const uResolution = gl.getUniformLocation(program, 'u_resolution')
    const uTime = gl.getUniformLocation(program, 'u_time')
    gl.uniform3f(gl.getUniformLocation(program, 'u_color'), ...hexToRgb(color))
    gl.uniform3f(gl.getUniformLocation(program, 'u_topColor'), ...hexToRgb(topColor))

    const dpr = Math.min(window.devicePixelRatio || 1, maxPixelRatio)
    const px = Math.round(size * dpr)
    canvas.width = px
    canvas.height = px
    gl.viewport(0, 0, px, px)
    gl.uniform2f(uResolution, px, px)

    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const start = performance.now()
    let raf = 0
    let lastDraw = -Infinity
    const render = (now: number) => {
      if (document.hidden) return
      if (now - lastDraw >= 1000 / maxFps || motion.matches) {
        gl.uniform1f(uTime, motion.matches ? 0 : (now - start) / 1000)
        gl.drawArrays(gl.TRIANGLES, 0, 6)
        lastDraw = now
      }
      if (!motion.matches) raf = requestAnimationFrame(render)
    }
    const resume = () => {
      cancelAnimationFrame(raf)
      lastDraw = -Infinity
      render(performance.now())
    }
    motion.addEventListener('change', resume)
    document.addEventListener('visibilitychange', resume)
    render(start)

    return () => {
      cancelAnimationFrame(raf)
      motion.removeEventListener('change', resume)
      document.removeEventListener('visibilitychange', resume)
      gl.deleteProgram(program)
      gl.deleteShader(vert)
      gl.deleteShader(frag)
      gl.deleteBuffer(buffer)
    }
  }, [size, color, topColor, maxFps, maxPixelRatio])

  return (
    <div
      data-slot="fluid-orb"
      className={["fluid-orb", className].filter(Boolean).join(" ")}
      style={{
        width: size,
        height: size,
        background: `linear-gradient(${topColor}, ${color})`,
        ...style,
      }}
      {...props}
    >
      <canvas ref={canvasRef} className="fluid-orb-canvas" />
    </div>
  )
}

export default FluidOrb
