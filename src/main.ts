import './style.css'
import { registerSW } from 'virtual:pwa-register'
import { Gorunum, type Tema } from './viewer'
import { Olcum } from './measure'
import * as depo from './store'
import { Sekmeler, type GorunumKutusu, type Sekme } from './tabs'

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
const sekmeler = new Sekmeler()
// Test ve hata ayiklama icin
const test = { gorunum: null as unknown as Gorunum, olcum: null as unknown as Olcum, biten: 0, sekmeler: { adlar: [] as string[], etkin: null as string | null } }
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

// "Bugün 18:40", "Dün 09:15", aynı yıl "3 Kas 14:20", eski yıl "3 Kas 2025"
function tarihYazi(t: number): string {
  const d = new Date(t)
  const saat = d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
  const gun = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const fark = Math.round((gun(new Date()) - gun(d)) / 86400000)
  if (fark === 0) return `Bugün ${saat}`
  if (fark === 1) return `Dün ${saat}`
  if (d.getFullYear() === new Date().getFullYear())
    return `${d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' })} ${saat}`
  return d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' })
}

const SIL_IKON =
  '<svg class="ikon" viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>'

async function listeyiYenile(): Promise<void> {
  const kayitlar = await depo.listele()
  const ul = $('son-liste')
  ul.replaceChildren()
  $('son-bos').hidden = kayitlar.length > 0
  for (const k of kayitlar) {
    const li = document.createElement('li')
    const ac = document.createElement('button')
    ac.type = 'button'
    ac.className = 'son-oge'
    const dxf = /\.dxf$/i.test(k.ad)
    ac.innerHTML = `<span class="rozet${dxf ? ' dxf' : ''}">${dxf ? 'DXF' : 'DWG'}</span>` +
      '<span class="son-metin"><span class="ad"></span><span class="bilgi"></span></span>'
    ;(ac.querySelector('.ad') as HTMLElement).textContent = k.ad
    ;(ac.querySelector('.bilgi') as HTMLElement).textContent = `${boyutYazi(k.boyut)} · ${tarihYazi(k.tarih)}`
    ac.addEventListener('click', () => sondanAc(k.id))
    const sil = document.createElement('button')
    sil.type = 'button'
    sil.className = 'son-sil'
    sil.innerHTML = SIL_IKON
    sil.setAttribute('aria-label', `${k.ad} kaydını sil`)
    sil.addEventListener('click', async () => {
      await depo.sil(k.id)
      listeyiYenile()
    })
    li.append(ac, sil)
    ul.appendChild(li)
  }
}

const KAYIT_YOK_METNI =
  'Bu dosya artık telefonda okunamıyor, listeden kaldırıldı. "Dosya aç" ile yeniden açarsanız tekrar listeye eklenir.'

function hataGoster(metin = HATA_METNI): void {
  $('hata-metin').textContent = metin
  hataEkrani.hidden = false
}

type Islem = { tur: 'yeni' } | { tur: 'guncelle'; id: string } | { tur: 'gecis'; id: string }

/** Üst çubuk, araçlar ve sekme şeridi gerçek duruma (açık çizim var mı, etkin sekme) uydurulur */
function arayuzuDenetle(): void {
  const acik = gorunum.dosyaAcik
  const ad = acik ? (sekmeler.etkin?.ad ?? '') : ''
  $('dosya-adi').textContent = ad
  $('dosya-adi').title = ad
  document.title = ad ? `${ad} · DWG Görüntüleyici` : 'DWG Görüntüleyici'
  araclar.forEach((b) => (b.disabled = !acik))
  $('app').classList.toggle('dosya-yok', !acik)
  if (!acik && olcum.acikMi) olcum.kapat()
  sekmeleriCiz()
}

function sekmeleriCiz(): void {
  const liste = $('sekme-liste')
  liste.replaceChildren()
  for (const s of sekmeler.liste) {
    const etkin = s.id === sekmeler.etkinId
    const oge = document.createElement('div')
    oge.className = 'sekme-oge' + (etkin ? ' etkin' : '')
    oge.setAttribute('role', 'presentation')
    const dxf = /\.dxf$/i.test(s.ad)
    const d = document.createElement('button')
    d.type = 'button'
    d.className = 'sekme' + (etkin ? ' etkin' : '')
    d.setAttribute('role', 'tab')
    d.setAttribute('aria-selected', String(etkin))
    d.title = s.ad
    d.innerHTML = `<span class="rozet${dxf ? ' dxf' : ''}">${dxf ? 'DXF' : 'DWG'}</span><span class="sekme-ad"></span>`
    ;(d.querySelector('.sekme-ad') as HTMLElement).textContent = s.ad
    d.addEventListener('click', () => sekmeyeGec(s.id))
    const k = document.createElement('button')
    k.type = 'button'
    k.className = 'sekme-kapat'
    k.innerHTML = SIL_IKON
    k.setAttribute('aria-label', `${s.ad} sekmesini kapat`)
    k.addEventListener('click', () => sekmeKapat(s.id))
    oge.append(d, k)
    liste.appendChild(oge)
  }
  $('sekmeler').hidden = sekmeler.liste.length === 0
  // Etkin sekme görünür alana kaydırılır
  const e = liste.querySelector('.sekme-oge.etkin') as HTMLElement | null
  if (e) {
    if (e.offsetLeft < liste.scrollLeft) liste.scrollLeft = e.offsetLeft
    else if (e.offsetLeft + e.offsetWidth > liste.scrollLeft + liste.clientWidth)
      liste.scrollLeft = e.offsetLeft + e.offsetWidth - liste.clientWidth
  }
  test.sekmeler = { adlar: sekmeler.liste.map((x) => x.ad), etkin: sekmeler.etkin?.ad ?? null }
}

/** Önceki etkin sekmeyi (açılış başarısız olup görüntüleyici boşaldıktan sonra) yeniden açar; başarısızsa sekmeyi listeden çıkarır */
async function sekmeyiGeriYukle(s: Sekme): Promise<void> {
  try {
    const ok = await gorunum.ac(s.ad, s.veri.slice(0))
    if (!ok) throw new Error('açılamadı')
    sekmeler.etkinYap(s.id)
    if (s.gorunum) await gorunumuGeriKoy(s.gorunum)
  } catch (e) {
    console.error('Sekme yeniden açılamadı', e)
    sekmeler.kapat(s.id)
    sekmeler.etkinTemizle()
  }
}

/**
 * Kayıtlı görünümü uygular. Kütüphane açılıştan sonra kendi sığdırmasını biraz geç (yaklaşık 250 ms)
 * yapabildiği için görünüm yerine oturana kadar birkaç kez denenir.
 */
async function gorunumuGeriKoy(k: GorunumKutusu): Promise<void> {
  const gen = k.maxX - k.minX
  await gorunum.isiBitince()
  for (let i = 0; i < 4; i++) {
    await new Promise((r) => setTimeout(r, i === 0 ? 300 : 250))
    gorunum.gorunumKoy(k)
    await new Promise((r) => setTimeout(r, 120))
    const su = gorunum.gorunumAl()
    if (su && Math.abs(su.maxX - su.minX - gen) <= gen * 0.01) return
  }
}

async function cizimAc(ad: string, veri: ArrayBuffer, kaydet: ArrayBuffer | null, islem: Islem = { tur: 'yeni' }): Promise<void> {
  if (mesgul) return
  mesgul = true
  yukleniyor.hidden = false
  hataEkrani.hidden = true
  // Yükleme ekranının boyanması için bir kare bekle
  await new Promise((r) => requestAnimationFrame(() => r(null)))
  // Tampon açma sırasında işçiye devredilebilir: sekmeye saklanacak kopya önceden alınır
  const sakla = islem.tur === 'gecis' ? null : veri.slice(0)
  // Mevcut sekmenin görünümü, çizim değişmeden önce saklanır
  const onceki = sekmeler.etkin
  if (onceki && gorunum.dosyaAcik) onceki.gorunum = gorunum.gorunumAl()
  const sahneYukseklik = sahne.clientHeight
  try {
    const ok = await gorunum.ac(ad, veri)
    if (!ok) throw new Error('açılamadı')
    olcum.sifirla()
    let hedef: Sekme | null
    if (islem.tur === 'gecis') {
      if (olcum.acikMi) olcum.kapat()
      sekmeler.etkinYap(islem.id)
      hedef = sekmeler.al(islem.id)
    } else if (islem.tur === 'guncelle') {
      sekmeler.guncelle(islem.id, sakla!)
      hedef = sekmeler.al(islem.id)
    } else {
      hedef = sekmeler.ekle(ad, sakla!).sekme
    }
    arayuzuDenetle()
    baslangicGoster(false)
    // Şerit/üst çubuk görününce tuval yeniden boyutlanır: görünüm yeni boyuta göre ayarlanır
    const boyutDegisti = sahne.clientHeight !== sahneYukseklik
    if (islem.tur === 'gecis' && hedef?.gorunum) await gorunumuGeriKoy(hedef.gorunum)
    else if (boyutDegisti) {
      await new Promise((r) => setTimeout(r, 150))
      gorunum.sigdir()
    }
    if (hedef) hedef.gorunum = null
    if (kaydet) {
      await depo.kaydet(ad, kaydet)
      listeyiYenile()
    }
  } catch (e) {
    console.error('Dosya açılamadı', e)
    if (islem.tur === 'gecis') sekmeler.kapat(islem.id)
    // Başarısız açılış görüntüleyiciyi boşaltır: önceki sekme varsa yeniden açılır
    const geri = sekmeler.al(onceki?.id ?? null)
    if (geri) await sekmeyiGeriYukle(geri)
    else sekmeler.etkinTemizle()
    arayuzuDenetle()
    hataGoster()
  } finally {
    yukleniyor.hidden = true
    mesgul = false
    test.biten++
  }
}

async function dosyadanAc(dosya: File): Promise<void> {
  const veri = await dosya.arrayBuffer()
  const mevcut = sekmeler.bul(dosya.name, veri.byteLength)
  // Kalıcı kopya: açma sırasında tampon işçiye devredilebilir
  await cizimAc(dosya.name, veri, veri.slice(0), mevcut ? { tur: 'guncelle', id: mevcut.id } : { tur: 'yeni' })
}

async function sekmeyeGec(id: string): Promise<void> {
  if (mesgul || id === sekmeler.etkinId) return
  const s = sekmeler.al(id)
  if (!s) return
  await cizimAc(s.ad, s.veri.slice(0), null, { tur: 'gecis', id })
}

async function sekmeKapat(id: string): Promise<void> {
  if (mesgul) return
  const etkinydi = id === sekmeler.etkinId
  const sonraki = sekmeler.kapat(id)
  if (!etkinydi) {
    sekmeleriCiz()
    return
  }
  if (sonraki) {
    await sekmeyeGec(sonraki)
    return
  }
  // Son sekme kapandı: dosya yok durumuna dön
  gorunum.kapat()
  arayuzuDenetle()
  baslangicGoster(true)
}

async function sondanAc(id: number): Promise<void> {
  if (mesgul) return
  const k = await depo.getir(id)
  if (!k) {
    await depo.sil(id)
    listeyiYenile()
    hataGoster(KAYIT_YOK_METNI)
    return
  }
  const mevcut = sekmeler.bul(k.ad, k.veri.byteLength)
  if (mevcut) {
    // Zaten açık: yeni sekme açılmaz, o sekmeye geçilir
    if (mevcut.id !== sekmeler.etkinId || !gorunum.dosyaAcik) await sekmeyeGec(mevcut.id)
    if (gorunum.dosyaAcik) baslangicGoster(false)
  } else {
    await cizimAc(k.ad, k.veri, null)
  }
  // Listede en üste çıksın
  await depo.dokun(id)
  listeyiYenile()
}

function baglantilar(): void {
  const sec = () => dosyaGirdi.click()
  $('btn-ac').addEventListener('click', sec)
  $('btn-ac-buyuk').addEventListener('click', sec)
  $('btn-sekme-ekle').addEventListener('click', sec)
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
  $('btn-arkaplan').addEventListener('click', async () => {
    if (mesgul) return
    tema = tema === 'koyu' ? 'acik' : 'koyu'
    depoYaz('tema', tema)
    temaEtiketi()
    gorunum.temaUygula(tema)
    // Kütüphane bazı yazı renklerini (ByBlock) çizim anındaki zemine göre sabitliyor;
    // zemin değişince açık çizim aynı görünümde yeniden çizilir.
    const s = sekmeler.etkin
    if (s && gorunum.dosyaAcik) await cizimAc(s.ad, s.veri.slice(0), null, { tur: 'gecis', id: s.id })
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
