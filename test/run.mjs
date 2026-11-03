// Uçtan uca test: build çıktısını `vite preview` ile sunar, tablet görünümünde sürer,
// ardından ağı kapatıp (offline) aynı akışı tekrarlar. localhost dışı her istek testi düşürür.
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const kok = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const EKRAN = join(kok, 'test', 'ekran')
const ORNEK = join(kok, 'ornekler')
const PORT = 4174
const URL_ = `http://localhost:${PORT}/`

mkdirSync(EKRAN, { recursive: true })
if (!existsSync(join(kok, 'dist', 'index.html'))) {
  console.error('dist yok: once `npm run build` calistirin')
  process.exit(2)
}

const sonuclar = []
function kontrol(ad, ok, detay = '') {
  sonuclar.push({ ad, ok })
  console.log(`${ok ? 'GECTI ' : 'KALDI '} ${ad}${detay ? '  -> ' + detay : ''}`)
}

// ---- sunucu
const sunucu = spawn(process.execPath, [join(kok, 'node_modules/vite/bin/vite.js'), 'preview', '--port', String(PORT), '--strictPort'], {
  cwd: kok,
  stdio: ['ignore', 'pipe', 'pipe']
})
sunucu.stderr.on('data', (d) => process.stderr.write(d))
await new Promise((coz, red) => {
  const t = setTimeout(() => red(new Error('sunucu baslamadi')), 20000)
  sunucu.stdout.on('data', (d) => {
    if (String(d).includes('localhost')) {
      clearTimeout(t)
      coz()
    }
  })
})

const disIstekler = []
const sayfaHatalari = []
const tarayici = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const ctx = await tarayici.newContext({
  viewport: { width: 1280, height: 800 },
  hasTouch: true,
  isMobile: true,
  deviceScaleFactor: 1
})
ctx.on('request', (r) => {
  const u = r.url()
  if (!(u.startsWith(`http://localhost:${PORT}/`) || u.startsWith('blob:') || u.startsWith('data:'))) disIstekler.push(u)
})
const sayfa = await ctx.newPage()
sayfa.on('pageerror', (e) => sayfaHatalari.push(e.message))
sayfa.on('console', (m) => {
  if (m.type() === 'error') console.log('   [konsol hata]', m.text().slice(0, 200))
})

// ---- yardimcilar
async function piksel(png) {
  // PNG'yi tarayıcıda çözüp koyu/açık/renkli piksel sayısını döndür
  const yardimci = await ctx.newPage()
  const r = await yardimci.evaluate(async (b64) => {
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
    const bmp = await createImageBitmap(new Blob([bin], { type: 'image/png' }))
    const c = new OffscreenCanvas(bmp.width, bmp.height)
    const g = c.getContext('2d')
    g.drawImage(bmp, 0, 0)
    const d = g.getImageData(0, 0, bmp.width, bmp.height).data
    let koyu = 0, parlak = 0, renkli = 0
    for (let i = 0; i < d.length; i += 4) {
      const px = (i / 4) % bmp.width, py = Math.floor(i / 4 / bmp.width)
      if (px < 120 && py > bmp.height - 120) continue
      const [R, G, B] = [d[i], d[i + 1], d[i + 2]]
      const mx = Math.max(R, G, B), mn = Math.min(R, G, B)
      if (mx < 70) koyu++
      if (mn > 190) parlak++
      if (mx - mn > 90) renkli++
    }
    return { koyu, parlak, renkli, toplam: d.length / 4 }
  }, png.toString('base64'))
  await yardimci.close()
  return r
}

async function sahneGoruntu() {
  const kutu = await sayfa.locator('#cad-container').boundingBox()
  return sayfa.screenshot({ clip: kutu })
}

async function yuklemeBekle() {
  await sayfa.waitForSelector('#yukleniyor', { state: 'hidden', timeout: 120000 })
}

async function acDosyadan(yolVeyaObje) {
  const once = await sayfa.evaluate(() => window.__dwg.biten)
  await sayfa.setInputFiles('#dosya-girdi', yolVeyaObje)
  await sayfa.waitForFunction((n) => window.__dwg.biten > n, once, { timeout: 120000 })
}

async function cizimGorunene() {
  // tuvalde yeterince çizgi pikseli olana kadar bekle
  const t0 = Date.now()
  let son
  while (Date.now() - t0 < 30000) {
    son = await piksel(await sahneGoruntu())
    const cizili = Math.min(son.toplam, son.koyu + son.parlak + son.renkli)
    if (son.parlak + son.renkli > 150 || (son.koyu > 150 && son.koyu < son.toplam * 0.9)) return son
    await sayfa.waitForTimeout(500)
  }
  return son
}

async function etiket() {
  return (await sayfa.textContent('#arkaplan-etiket')).trim()
}

async function temaSec(hedef) {
  if ((await etiket()) !== hedef) await sayfa.click('#btn-arkaplan')
  await sayfa.waitForFunction((h) => document.getElementById('arkaplan-etiket').textContent.trim() === h, hedef)
  await sayfa.waitForTimeout(700)
}

function numara(metin) {
  // "1.234,56" -> 1234.56
  return parseFloat(metin.replace(/\./g, '').replace(',', '.'))
}

let sn = 0
async function foto(ad) {
  sn++
  const yol = join(EKRAN, `${String(sn).padStart(2, '0')}-${ad}.png`)
  await sayfa.screenshot({ path: yol })
  console.log('   ekran:', yol)
  return yol
}

// ================= 1) ONLINE: ilk yükleme, service worker
console.log('\n== 1) Ilk yukleme (cevrimici)')
await sayfa.goto(URL_)
await sayfa.waitForSelector('#btn-ac-buyuk')
await sayfa.evaluate(() => navigator.serviceWorker.ready)
await sayfa.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 30000 })
kontrol('service worker aktif ve sayfayı denetliyor', true)
const onbellekAd = await sayfa.evaluate(async () => (await caches.keys()).join(','))
const onbellekSayi = await sayfa.evaluate(async () => {
  const k = await caches.keys()
  let n = 0
  for (const a of k) n += (await (await caches.open(a)).keys()).length
  return n
})
kontrol('precache dolu', onbellekSayi > 80, `${onbellekAd}: ${onbellekSayi} kayit`)
const tipler = await sayfa.evaluate(async () => {
  const yollar = ['workers/libredwg-parser-worker.js', 'workers/libredwg-web.wasm', 'workers/mtext-renderer-worker.js', 'fonts/fonts.json', 'fonts/txt.shx', 'fonts/arial.woff', 'manifest.webmanifest', 'icons/maskable-512.png']
  const o = {}
  for (const y of yollar) { const r = await fetch(y); o[y] = (r.headers.get('content-type') || '') + ' ' + r.status }
  return o
})
kontrol('worker/wasm/font/manifest dosyaları gerçekten sunuluyor (html değil)', Object.values(tipler).every((v) => !v.includes('text/html') && v.endsWith('200')), JSON.stringify(tipler))
await foto('baslangic-bos')

// ================= 2) Örnekleri aç
const ornekler = [
  ['example_2000.dwg', 'dwg-r2000'],
  ['example_2004.dwg', 'dwg-r2004'],
  ['example_2018.dwg', 'dwg-r2018'],
  ['example_2013.dxf', 'dxf-r2013'],
  ['turkce_metin.dxf', 'dxf-turkce']
]
console.log('\n== 2) Ornek dosyalar')
for (const [dosya, kisa] of ornekler) {
  await temaSec('Koyu')
  await acDosyadan(join(ORNEK, dosya))
  const hataVar = !(await sayfa.locator('#hata').isHidden())
  kontrol(`${dosya} açıldı (hata yok)`, !hataVar)
  const ad = (await sayfa.textContent('#dosya-adi')).trim()
  kontrol(`${dosya}: üst çubukta dosya adı`, ad === dosya, ad)
  const koyu = await cizimGorunene()
  await foto(`${kisa}-koyu`)
  kontrol(`${dosya}: koyu zeminde çizim boş değil`, koyu.parlak + koyu.renkli > 150, `parlak=${koyu.parlak} renkli=${koyu.renkli}`)
  await temaSec('Açık')
  const acik = await piksel(await sahneGoruntu())
  await foto(`${kisa}-acik`)
  kontrol(`${dosya}: açık zeminde çizim boş değil`, acik.koyu + acik.renkli > 150, `koyu=${acik.koyu} renkli=${acik.renkli}`)
  if (kisa === 'dxf-turkce') {
    kontrol('ACI 7 çizgiler açık zeminde siyah (koyu piksel var)', acik.koyu > 150, `koyu=${acik.koyu}`)
    kontrol('ACI 7 çizgiler koyu zeminde beyaz (parlak piksel var)', koyu.parlak > 150, `parlak=${koyu.parlak}`)
  }
}

// ================= 3) Ölçüm (turkce_metin.dxf: dikdörtgen 0..200 x 0..100)
console.log('\n== 3) Olcum')
await acDosyadan(join(ORNEK, 'turkce_metin.dxf'))
await temaSec('Koyu')
await cizimGorunene()
await sayfa.click('#btn-olc')
kontrol('Ölç modu açıldı', (await sayfa.getAttribute('#btn-olc', 'aria-pressed')) === 'true')
const olcu = async (a, b) => {
  const nok = await sayfa.evaluate(
    ([a, b]) => {
      const g = window.__dwg.gorunum
      const r = g.tuval.getBoundingClientRect()
      const pa = g.dunyaEkran
      const f = (p) => {
        const s = g.dunyaEkran !== undefined ? g.dunyaEkran(p) : null
        return { x: s.x + r.left, y: s.y + r.top }
      }
      return [f(a), f(b)]
    },
    [a, b]
  )
  await sayfa.touchscreen.tap(nok[0].x, nok[0].y)
  await sayfa.waitForTimeout(200)
  await sayfa.touchscreen.tap(nok[1].x, nok[1].y)
  await sayfa.waitForTimeout(400)
}
await olcu({ x: 0, y: 0 }, { x: 200, y: 0 })
const sonucGorunur = await sayfa.locator('#olcum-sonuc').isVisible()
const metin = sonucGorunur ? (await sayfa.textContent('#olcum-sonuc')).trim() : ''
kontrol('ölçüm sonucu etiketi görünüyor', sonucGorunur, metin)
const m = metin.match(/Mesafe:\s*([\d.,]+).*ΔX:\s*([\d.,]+).*ΔY:\s*([\d.,]+)/)
if (m) {
  const [d, dx, dy] = [numara(m[1]), numara(m[2]), numara(m[3])]
  kontrol('mesafe ≈ 200 (0,0 -> 200,0)', Math.abs(d - 200) < 1.5, `mesafe=${d} dx=${dx} dy=${dy}`)
  kontrol('ΔX ≈ 200, ΔY ≈ 0', Math.abs(dx - 200) < 1.5 && dy < 1.5)
} else kontrol('sonuç biçimi', false, metin)
await foto('olcum-yatay-200')
await olcu({ x: 0, y: 0 }, { x: 200, y: 100 })
const metin2 = (await sayfa.textContent('#olcum-sonuc')).trim()
const m2 = metin2.match(/Mesafe:\s*([\d.,]+).*ΔX:\s*([\d.,]+).*ΔY:\s*([\d.,]+)/)
const bek = Math.hypot(200, 100)
kontrol('yeni ölçüm: mesafe ≈ 223,61', !!m2 && Math.abs(numara(m2[1]) - bek) < 2, metin2)
await foto('olcum-capraz')
// ölçüm modunda iki parmakla yakınlaştırma/kaydırma bozulmuyor mu: tek dokunma yeni nokta başlatır, tekrar kontrol
await sayfa.click('#btn-olc')
kontrol('Ölç modu kapandı', (await sayfa.getAttribute('#btn-olc', 'aria-pressed')) === 'false' && (await sayfa.locator('#olcum-panel').isHidden()))

// ================= 4) Araç çubuğu: +, -, Sığdır
console.log('\n== 4) Yakinlastir / Sigdir')
const gorunenGenislik = () =>
  sayfa.evaluate(() => {
    const g = window.__dwg.gorunum
    const r = g.tuval.getBoundingClientRect()
    const a = g.ekranDunya({ x: 0, y: 0 })
    const b = g.ekranDunya({ x: r.width, y: 0 })
    return Math.abs(b.x - a.x)
  })
const w0 = await gorunenGenislik()
await sayfa.click('#btn-yakin')
await sayfa.waitForTimeout(500)
const w1 = await gorunenGenislik()
await sayfa.click('#btn-uzak')
await sayfa.click('#btn-uzak')
await sayfa.waitForTimeout(500)
const w2 = await gorunenGenislik()
await sayfa.click('#btn-sigdir')
await sayfa.waitForTimeout(800)
const w3 = await gorunenGenislik()
kontrol('"+" yakınlaştırıyor', w1 < w0 * 0.8, `${w0.toFixed(1)} -> ${w1.toFixed(1)}`)
kontrol('"−" uzaklaştırıyor', w2 > w1 * 1.5, `${w1.toFixed(1)} -> ${w2.toFixed(1)}`)
kontrol('"Sığdır" ilk görünüme dönüyor', Math.abs(w3 - w0) / w0 < 0.05, `${w3.toFixed(1)} vs ${w0.toFixed(1)}`)

// ================= 5) Son açılanlar
console.log('\n== 5) Son acilanlar')
await sayfa.click('#btn-son')
await sayfa.waitForSelector('#son-liste li')
let adlar = await sayfa.$$eval('#son-liste .son-oge .ad', (e) => e.map((x) => x.textContent))
kontrol('liste 5 örneği içeriyor', adlar.length === 5, adlar.join(', '))
kontrol('en son açılan en üstte', adlar[0] === 'turkce_metin.dxf', adlar[0])
await foto('son-acilanlar')
// silme
await sayfa.click('#son-liste li:last-child .son-sil')
await sayfa.waitForFunction(() => document.querySelectorAll('#son-liste li').length === 4)
kontrol('× ile kayıt silinebiliyor', true)
// 8 sınırı: 9 farklı adla küçük dosya ekle
const kucuk = readFileSync(join(ORNEK, 'turkce_metin.dxf'))
for (let i = 1; i <= 9; i++) {
  await acDosyadan({ name: `kopya-${i}.dxf`, mimeType: 'application/octet-stream', buffer: kucuk })
}
await sayfa.click('#btn-son')
await sayfa.waitForSelector('#son-liste li')
adlar = await sayfa.$$eval('#son-liste .son-oge .ad', (e) => e.map((x) => x.textContent))
kontrol('en fazla 8 kayıt tutuluyor', adlar.length === 8, adlar.join(', '))
kontrol('en eski olanlar çıkarıldı, en yeni duruyor', adlar[0] === 'kopya-9.dxf' && !adlar.includes('kopya-1.dxf'), adlar[7])

// Listeyi gerçek örneklerle yeniden doldur (offline testte DWG de olsun)
await sayfa.click('#btn-kapat-baslangic')
await acDosyadan(join(ORNEK, 'example_2018.dwg'))
await acDosyadan(join(ORNEK, 'example_2000.dwg'))

// tercih kalıcılığı
await temaSec('Açık')
await sayfa.reload()
await sayfa.waitForSelector('#btn-ac-buyuk')
kontrol('arka plan tercihi yenilemeden sonra korunuyor', (await etiket()) === 'Açık')
await temaSec('Koyu')

// ================= 6) Bozuk dosya -> hata iletisi
console.log('\n== 6) Hata durumu')
await acDosyadan({ name: 'bozuk.dwg', mimeType: 'application/octet-stream', buffer: Buffer.from('AC1032 bu bir cizim degil') })
await sayfa.waitForSelector('#hata', { state: 'visible', timeout: 20000 })
const hataMetni = (await sayfa.textContent('#hata-metin')).trim()
kontrol(
  'bozuk dosyada Türkçe hata iletisi',
  hataMetni === "Bu dosya açılamadı. Çok yeni bir AutoCAD sürümünde kaydedilmiş olabilir. AutoCAD'de DXF olarak kaydedip tekrar deneyin.",
  hataMetni
)
await foto('hata')
await sayfa.click('#btn-hata-tamam')

// ================= 7) OFFLINE
console.log('\n== 7) OFFLINE (ag kapali)')
await ctx.setOffline(true)
const cevrimdisiMi = await sayfa.evaluate(() => navigator.onLine)
kontrol('tarayıcı çevrimdışı', cevrimdisiMi === false)
await sayfa.reload()
await sayfa.waitForSelector('#btn-ac-buyuk', { timeout: 20000 })
kontrol('çevrimdışı yenileme: uygulama açıldı', true)
await foto('offline-baslangic')
await acDosyadan(join(ORNEK, 'example_2018.dwg'))
let hataVar = !(await sayfa.locator('#hata').isHidden())
kontrol('offline: DWG (R2018) dosya seçiciden açıldı', !hataVar)
let o = await cizimGorunene()
kontrol('offline: DWG çizimi boş değil', o.parlak + o.renkli > 150, `parlak=${o.parlak} renkli=${o.renkli}`)
await foto('offline-dwg-r2018')
await acDosyadan(join(ORNEK, 'turkce_metin.dxf'))
o = await cizimGorunene()
kontrol('offline: Türkçe metinli DXF (yazı tipleri) açıldı', o.parlak + o.renkli > 150)
await foto('offline-dxf-turkce')

// Son açılanlardan aç (offline)
await sayfa.click('#btn-son')
await sayfa.waitForSelector('#son-liste li')
adlar = await sayfa.$$eval('#son-liste .son-oge .ad', (e) => e.map((x) => x.textContent))
console.log('   son acilanlar:', adlar.join(', '))
const hedef = adlar.findIndex((a) => a === 'example_2000.dwg')
kontrol('offline: Son açılanlar listesi görünüyor', adlar.length > 0 && hedef >= 0)
const bitenOnce = await sayfa.evaluate(() => window.__dwg.biten)
await sayfa.locator('#son-liste .son-oge').nth(hedef).click()
await sayfa.waitForFunction((n) => window.__dwg.biten > n, bitenOnce, { timeout: 120000 })
hataVar = !(await sayfa.locator('#hata').isHidden())
kontrol('offline: Son açılanlardan DWG (R2000) açıldı', !hataVar && (await sayfa.textContent('#dosya-adi')).trim() === 'example_2000.dwg')
o = await cizimGorunene()
kontrol('offline: Son açılanlardan çizim boş değil', o.parlak + o.renkli > 150, `parlak=${o.parlak} renkli=${o.renkli}`)
await foto('offline-sondan-dwg-r2000-koyu')
await temaSec('Açık')
await foto('offline-sondan-dwg-r2000-acik')
await temaSec('Koyu')
// çevrimdışı ölçüm
await sayfa.click('#btn-olc')
const kut = await sayfa.locator('#cad-container').boundingBox()
await sayfa.touchscreen.tap(kut.x + kut.width * 0.35, kut.y + kut.height * 0.4)
await sayfa.touchscreen.tap(kut.x + kut.width * 0.65, kut.y + kut.height * 0.6)
await sayfa.waitForTimeout(400)
const mo = (await sayfa.locator('#olcum-sonuc').isVisible()) ? (await sayfa.textContent('#olcum-sonuc')).trim() : ''
kontrol('offline: ölçüm sonucu görünüyor', /Mesafe/.test(mo), mo)
await foto('offline-olcum')

// dikey yönelim
await sayfa.click('#btn-olc')
await sayfa.setViewportSize({ width: 800, height: 1280 })
await sayfa.waitForTimeout(1200)
await sayfa.click('#btn-sigdir')
await sayfa.waitForTimeout(800)
await foto('dikey-cizim')
const tasma = await sayfa.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
kontrol('dikey yönelimde yatay taşma yok', !tasma)
const kucukDugme = await sayfa.$$eval('#ust-cubuk .btn', (b) => b.filter((x) => x.getBoundingClientRect().height < 48 || x.getBoundingClientRect().width < 48).length)
kontrol('üst çubuk düğmeleri en az 48px', kucukDugme === 0)

// ================= 8) Dış istek yok
console.log('\n== 8) Dis ag istegi')
kontrol('localhost dışına hiç istek gitmedi', disIstekler.length === 0, disIstekler.slice(0, 5).join(' | '))
kontrol('yakalanmamış sayfa hatası yok', sayfaHatalari.length === 0, sayfaHatalari.slice(0, 3).join(' | '))

await tarayici.close()
sunucu.kill()

const kalan = sonuclar.filter((s) => !s.ok)
console.log(`\nOZET: ${sonuclar.length - kalan.length}/${sonuclar.length} kontrol gecti`)
if (kalan.length) {
  console.log('KALANLAR:\n - ' + kalan.map((k) => k.ad).join('\n - '))
  process.exit(1)
}
