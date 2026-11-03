import './style.css'
import { registerSW } from 'virtual:pwa-register'
import { Gorunum, type Tema } from './viewer'
import { Olcum } from './measure'
import * as depo from './store'

const HATA_METNI =
  "Bu dosya açılamadı. Çok yeni bir AutoCAD sürümünde kaydedilmiş olabilir. AutoCAD'de DXF olarak kaydedip tekrar deneyin."

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

function depoOku(k: string): string | null {
  try {
    return localStorage.getItem(k)
  } catch {
    return null
  }
}
function depoYaz(k: string, v: string): void {
  try {
    localStorage.setItem(k, v)
  } catch {
    // yoksay
  }
}

const sahne = $('sahne')
const baslangic = $('baslangic')
const yukleniyor = $('yukleniyor')
const hataEkrani = $('hata')
const dosyaGirdi = $<HTMLInputElement>('dosya-girdi')
const araclar = ['btn-sigdir', 'btn-yakin', 'btn-uzak', 'btn-olc'].map((i) => $<HTMLButtonElement>(i))

let gorunum: Gorunum
let olcum: Olcum
let tema: Tema = depoOku('tema') === 'acik' ? 'acik' : 'koyu'
let mesgul = false
// Test ve hata ayiklama icin
const test = { gorunum: null as unknown as Gorunum, olcum: null as unknown as Olcum, biten: 0 }
;(window as unknown as { __dwg: unknown }).__dwg = test

function temaEtiketi(): void {
  $('arkaplan-etiket').textContent = tema === 'koyu' ? 'Koyu' : 'Açık'
  $('btn-arkaplan').setAttribute('aria-label', 'Arka plan: ' + (tema === 'koyu' ? 'Koyu' : 'Açık'))
  sahne.style.background = tema === 'koyu' ? '#000' : '#fff'
}

function baslangicGoster(goster: boolean): void {
  baslangic.hidden = !goster
  $('btn-kapat-baslangic').hidden = !(goster && gorunum?.dosyaAcik)
  if (goster) listeyiYenile()
}

function boyutYazi(b: number): string {
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`
  return `${(b / 1024 / 1024).toFixed(1)} MB`
}

async function listeyiYenile(): Promise<void> {
  const kayitlar = await depo.listele()
  const bolum = $('son-bolum')
  const ul = $('son-liste')
  ul.replaceChildren()
  bolum.hidden = kayitlar.length === 0
  for (const k of kayitlar) {
    const li = document.createElement('li')
    const ac = document.createElement('button')
    ac.type = 'button'
    ac.className = 'son-oge'
    ac.innerHTML = '<span class="ad"></span><span class="bilgi"></span>'
    ;(ac.querySelector('.ad') as HTMLElement).textContent = k.ad
    ;(ac.querySelector('.bilgi') as HTMLElement).textContent =
      `${boyutYazi(k.boyut)} · ${new Date(k.tarih).toLocaleString('tr-TR', { dateStyle: 'medium', timeStyle: 'short' })}`
    ac.addEventListener('click', () => sondanAc(k.id))
    const sil = document.createElement('button')
    sil.type = 'button'
    sil.className = 'son-sil'
    sil.textContent = '×'
    sil.setAttribute('aria-label', `${k.ad} kaydını sil`)
    sil.addEventListener('click', async () => {
      await depo.sil(k.id)
      listeyiYenile()
    })
    li.append(ac, sil)
    ul.appendChild(li)
  }
}

function hataGoster(): void {
  $('hata-metin').textContent = HATA_METNI
  hataEkrani.hidden = false
}

async function cizimAc(ad: string, veri: ArrayBuffer, kaydet: Blob | null): Promise<void> {
  if (mesgul) return
  mesgul = true
  yukleniyor.hidden = false
  hataEkrani.hidden = true
  // Yükleme ekranının boyanması için bir kare bekle
  await new Promise((r) => requestAnimationFrame(() => r(null)))
  try {
    const ok = await gorunum.ac(ad, veri)
    if (!ok) throw new Error('açılamadı')
    olcum.sifirla()
    $('dosya-adi').textContent = ad
    $('dosya-adi').title = ad
    document.title = `${ad} · DWG Görüntüleyici`
    araclar.forEach((b) => (b.disabled = false))
    baslangicGoster(false)
    if (kaydet) {
      await depo.kaydet(ad, kaydet.size, kaydet)
      listeyiYenile()
    }
  } catch (e) {
    console.error('Dosya açılamadı', e)
    if (!gorunum.dosyaAcik) {
      $('dosya-adi').textContent = ''
      araclar.forEach((b) => (b.disabled = true))
      if (olcum.acikMi) olcum.kapat()
    }
    hataGoster()
  } finally {
    yukleniyor.hidden = true
    mesgul = false
    test.biten++
  }
}

async function dosyadanAc(dosya: File): Promise<void> {
  const veri = await dosya.arrayBuffer()
  await cizimAc(dosya.name, veri, dosya)
}

async function sondanAc(id: number): Promise<void> {
  const k = await depo.getir(id)
  if (!k) {
    hataGoster()
    return
  }
  const veri = await k.veri.arrayBuffer()
  await cizimAc(k.ad, veri, null)
  // Listede en üste çıksın
  await depo.kaydet(k.ad, k.boyut, k.veri)
}

function baglantilar(): void {
  const sec = () => dosyaGirdi.click()
  $('btn-ac').addEventListener('click', sec)
  $('btn-ac-buyuk').addEventListener('click', sec)
  dosyaGirdi.addEventListener('change', async () => {
    const f = dosyaGirdi.files?.[0]
    dosyaGirdi.value = ''
    if (f) await dosyadanAc(f)
  })
  $('btn-son').addEventListener('click', () => baslangicGoster(!!baslangic.hidden))
  $('btn-kapat-baslangic').addEventListener('click', () => baslangicGoster(false))
  $('btn-hata-tamam').addEventListener('click', () => {
    hataEkrani.hidden = true
    if (!gorunum.dosyaAcik) baslangicGoster(true)
  })
  $('btn-sigdir').addEventListener('click', () => gorunum.sigdir())
  $('btn-yakin').addEventListener('click', () => gorunum.yaklastir(1.5))
  $('btn-uzak').addEventListener('click', () => gorunum.yaklastir(1 / 1.5))
  $('btn-olc').addEventListener('click', () => (olcum.acikMi ? olcum.kapat() : olcum.ac()))
  $('btn-arkaplan').addEventListener('click', () => {
    tema = tema === 'koyu' ? 'acik' : 'koyu'
    depoYaz('tema', tema)
    temaEtiketi()
    gorunum.temaUygula(tema)
  })
}

function baslat(): void {
  gorunum = new Gorunum($('cad-container'))
  gorunum.baslat()
  gorunum.temaUygula(tema)
  temaEtiketi()
  olcum = new Olcum(gorunum, sahne, (etkin) => {
    const b = $('btn-olc')
    b.classList.toggle('aktif', etkin)
    b.setAttribute('aria-pressed', String(etkin))
  })
  baglantilar()
  baslangicGoster(true)
  test.gorunum = gorunum
  test.olcum = olcum
}

// Safari/Chromium cift dokunma yakinlastirmasini ve sayfa kaydirmasini engelle
document.addEventListener('gesturestart', (e) => e.preventDefault())

baslat()

registerSW({ immediate: true })
