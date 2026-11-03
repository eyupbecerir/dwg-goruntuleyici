// Basit PNG simgeleri uretir (playwright ile SVG'yi render eder).
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'

const svg = (pad) => `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
<rect width="512" height="512" fill="#111418"/>
<g transform="translate(${pad} ${pad}) scale(${(512 - 2 * pad) / 512})" fill="none" stroke="#4da3ff" stroke-width="22" stroke-linecap="round" stroke-linejoin="round">
<rect x="96" y="96" width="320" height="320" rx="24" stroke="#e8edf3"/>
<path d="M96 352 L224 224 L288 288 L416 160" />
<circle cx="224" cy="224" r="16" fill="#4da3ff"/><circle cx="416" cy="160" r="16" fill="#4da3ff"/>
</g></svg>`

mkdirSync('public/icons', { recursive: true })
const b = await chromium.launch()
const jobs = [['icon-192.png', 192, 0], ['icon-512.png', 512, 0], ['maskable-512.png', 512, 70]]
for (const [name, size, pad] of jobs) {
  const p = await b.newPage({ viewport: { width: size, height: size } })
  await p.setContent(`<body style="margin:0"><div style="width:${size}px;height:${size}px">${svg(pad).replace('width="512" height="512"', `width="${size}" height="${size}"`)}</div></body>`)
  writeFileSync(`public/icons/${name}`, await p.screenshot({ omitBackground: false }))
  await p.close()
}
await b.close()
console.log('simgeler hazir')
