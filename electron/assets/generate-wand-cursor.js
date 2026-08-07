/**
 * 生成带真透明通道的粉色魔法棒光标 PNG（32×32 RGBA）
 * 运行: node electron/assets/generate-wand-cursor.js
 */
const fs = require('fs')
const path = require('path')
const zlib = require('zlib')

const SIZE = 32
const HOTSPOT = { x: 5, y: 5 }

// 主题色
const PINK = [255, 126, 182, 255]       // #FF7EB6 杖身
const PINK_DARK = [196, 86, 122, 255]   // #C4567A 手柄
const SPARK = [255, 92, 157, 255]       // #FF5C9D 星芒

function crc32(buf) {
  let c = ~0
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]
    for (let k = 0; k < 8; k++) {
      c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
    }
  }
  return ~c >>> 0
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii')
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([len, typeBuf, data, crcBuf])
}

function encodePng(width, height, rgba) {
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0 // filter none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8  // bit depth
  ihdr[9] = 6  // RGBA
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0
  const idat = zlib.deflateSync(raw, { level: 9 })
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0))
  ])
}

function setPixel(rgba, x, y, color) {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return
  const i = (y * SIZE + x) * 4
  const [r, g, b, a] = color
  // alpha 合成到已有像素上（简单覆盖：取更高不透明度优先保留粉彩）
  if (a >= rgba[i + 3]) {
    rgba[i] = r
    rgba[i + 1] = g
    rgba[i + 2] = b
    rgba[i + 3] = a
  }
}

function fillCircle(rgba, cx, cy, radius, color) {
  const r2 = radius * radius
  const r0 = Math.floor(cx - radius)
  const r1 = Math.ceil(cx + radius)
  for (let y = Math.floor(cy - radius); y <= Math.ceil(cy + radius); y++) {
    for (let x = r0; x <= r1; x++) {
      const dx = x + 0.5 - cx
      const dy = y + 0.5 - cy
      if (dx * dx + dy * dy <= r2) setPixel(rgba, x, y, color)
    }
  }
}

/** 画一段粗线（圆形笔刷） */
function strokeLine(rgba, x0, y0, x1, y1, radius, color) {
  const dx = x1 - x0
  const dy = y1 - y0
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) * 2))
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    fillCircle(rgba, x0 + dx * t, y0 + dy * t, radius, color)
  }
}

/** 四角星 */
function drawSpark(rgba, cx, cy, outer, inner, color) {
  // 十字主轴 + 中心圆，保证 32px 下清晰
  strokeLine(rgba, cx - outer, cy, cx + outer, cy, 1.1, color)
  strokeLine(rgba, cx, cy - outer, cx, cy + outer, 1.1, color)
  strokeLine(rgba, cx - inner, cy - inner, cx + inner, cy + inner, 0.7, color)
  strokeLine(rgba, cx - inner, cy + inner, cx + inner, cy - inner, 0.7, color)
  fillCircle(rgba, cx, cy, 1.4, color)
  // 四周小点
  const dots = [
    [cx, cy - outer - 1.5],
    [cx, cy + outer + 1.5],
    [cx - outer - 1.5, cy],
    [cx + outer + 1.5, cy]
  ]
  for (const [x, y] of dots) fillCircle(rgba, x, y, 0.9, color)
}

function main() {
  const rgba = Buffer.alloc(SIZE * SIZE * 4) // 全 0 = 全透明

  // 杖：从左上星芒附近 → 右下手柄
  // 热点对准星芒中心 (5,5)
  const tipX = HOTSPOT.x
  const tipY = HOTSPOT.y
  const endX = 26
  const endY = 26

  // 杖身（上 2/3）
  strokeLine(rgba, tipX + 2, tipY + 2, 18, 18, 1.6, PINK)
  // 手柄（下 1/3，更深粉）
  strokeLine(rgba, 17, 17, endX, endY, 2.0, PINK_DARK)
  // 手柄末端圆头
  fillCircle(rgba, endX, endY, 2.2, PINK_DARK)

  // 星芒
  drawSpark(rgba, tipX, tipY, 3.2, 1.8, SPARK)

  const png = encodePng(SIZE, SIZE, rgba)
  const out = path.join(__dirname, 'magic-wand-cursor-32.png')
  fs.writeFileSync(out, png)

  // 校验：必须是 RGBA，且角落透明
  const colorType = png[25]
  const cornerA = rgba[3]
  console.log(`wrote ${out}`)
  console.log(`IHDR colorType=${colorType} (expect 6=RGBA), corner alpha=${cornerA}`)
  console.log(`hotspot recommended: ${HOTSPOT.x} ${HOTSPOT.y}`)

  let transparent = 0
  let opaque = 0
  for (let i = 3; i < rgba.length; i += 4) {
    if (rgba[i] === 0) transparent++
    else if (rgba[i] === 255) opaque++
  }
  console.log(`pixels transparent=${transparent} opaque=${opaque} other=${SIZE * SIZE - transparent - opaque}`)
}

main()
