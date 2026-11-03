import type { Gorunum, Nokta, YakalamaTuru } from './viewer'

const SVG = 'http://www.w3.org/2000/svg'

/** Parmak ucu için yakalama yarıçapı (CSS px) */
const YAKALAMA_YARICAP = 24
/** Büyüteç: çap (CSS px), büyütme, parmağın üstündeki uzaklık */
const BUYUTEC_CAP = 120
const BUYUTEC_OLCEK = 3
const BUYUTEC_UZAKLIK = 92

const TUR_ETIKET: Record<YakalamaTuru, string> = {
  kose: 'Köşe',
  orta: 'Orta',
  merkez: 'Merkez',
  kesisim: 'Kesişim',
  ceyrek: 'Çeyrek'
}

/** AutoCAD benzeri işaret şekilleri (orijin merkezde, yarım boy s). SVG yolu; Path2D de aynı yolu okur. */
function isaretYolu(tur: YakalamaTuru, s: number): string {
  switch (tur) {
    case 'kose': // kare
      return `M${-s} ${-s}h${2 * s}v${2 * s}h${-2 * s}z`
    case 'orta': // üçgen
      return `M0 ${-s}L${s} ${s}L${-s} ${s}z`
    case 'merkez': // daire
      return `M${s} 0A${s} ${s} 0 1 0 ${-s} 0A${s} ${s} 0 1 0 ${s} 0z`
    case 'kesisim': // X
      return `M${-s} ${-s}L${s} ${s}M${s} ${-s}L${-s} ${s}`
    case 'ceyrek': // baklava
      return `M0 ${-s}L${s} 0L0 ${s}L${-s} 0z`
  }
}

interface OlcumNoktasi {
  p: Nokta
  tur?: YakalamaTuru
}

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

/**
 * Ölçüm modu: A noktasına, sonra B noktasına dokun. Mesafe, ΔX ve ΔY gösterilir.
 * Noktalar köşe/orta/merkez/kesişim/çeyrek noktalarına yakalanır; konulan noktalar tutamaktır,
 * sürüklenerek ayarlanır ve sürüklerken büyüteç açılır.
 * Boş alana dokunma kütüphanenin kaydırma/yakınlaştırmasını engellemeden yakalanır (yakalama aşamasında dinlenir).
 */
export class Olcum {
  private etkin = false
  private noktalar: OlcumNoktasi[] = []
  private yakalama = depoOku('yakalama') !== 'kapali'
  private svg: SVGSVGElement
  private panel: HTMLElement
  private ipucu: HTMLElement
  private sonuc: HTMLElement
  private yakalamaDugme: HTMLButtonElement
  private tutamaklar: HTMLElement[] = []
  private buyutec: HTMLElement
  private buyutecTuval: HTMLCanvasElement
  private goruntu: HTMLCanvasElement | null = null
  private raf = 0
  private aktifDokunus = new Map<number, { x: number; y: number; t: number }>()
  private cokluDokunus = false
  private suruk: { i: number; id: number; ofx: number; ofy: number; px: number; py: number } | null = null

  constructor(
    private g: Gorunum,
    private sahne: HTMLElement,
    private onDegisim: (etkin: boolean) => void
  ) {
    this.svg = document.getElementById('olcum-katman') as unknown as SVGSVGElement
    this.panel = document.getElementById('olcum-panel') as HTMLElement
    this.ipucu = document.getElementById('olcum-ipucu') as HTMLElement
    this.sonuc = document.getElementById('olcum-sonuc') as HTMLElement
    this.yakalamaDugme = document.getElementById('btn-yakalama') as HTMLButtonElement
    this.yakalamaDugme.addEventListener('click', () => {
      this.yakalama = !this.yakalama
      depoYaz('yakalama', this.yakalama ? 'acik' : 'kapali')
      this.dugmeYazisi()
    })
    this.dugmeYazisi()

    const kap = document.getElementById('cad-container') as HTMLElement
    kap.addEventListener('pointerdown', (e) => this.asagi(e), true)
    kap.addEventListener('pointerup', (e) => this.yukari(e), true)
    kap.addEventListener('pointercancel', (e) => this.aktifDokunus.delete(e.pointerId), true)

    for (let i = 0; i < 2; i++) {
      const t = document.createElement('div')
      t.className = 'tutamak'
      t.hidden = true
      t.dataset.nokta = i === 0 ? 'A' : 'B'
      t.innerHTML = `<span class="tutamak-halka"></span><span class="tutamak-etiket">${i === 0 ? 'A' : 'B'}</span>`
      t.addEventListener('pointerdown', (e) => this.tutAsagi(e, i))
      t.addEventListener('pointermove', (e) => this.tutHareket(e, i))
      t.addEventListener('pointerup', (e) => this.tutBitir(e, i))
      t.addEventListener('pointercancel', (e) => this.tutBitir(e, i))
      this.sahne.appendChild(t)
      this.tutamaklar.push(t)
    }

    this.buyutec = document.createElement('div')
    this.buyutec.id = 'olcum-buyutec'
    this.buyutec.hidden = true
    this.buyutecTuval = document.createElement('canvas')
    this.buyutec.appendChild(this.buyutecTuval)
    this.sahne.appendChild(this.buyutec)
  }

  get acikMi(): boolean {
    return this.etkin
  }

  private dugmeYazisi(): void {
    this.yakalamaDugme.textContent = this.yakalama ? 'Yakalama: Açık' : 'Yakalama: Kapalı'
    this.yakalamaDugme.setAttribute('aria-pressed', String(this.yakalama))
  }

  ac(): void {
    this.etkin = true
    this.noktalar = []
    this.g.yakalamaTemizle()
    this.panel.hidden = false
    this.render()
    this.onDegisim(true)
    const dongu = () => {
      if (!this.etkin) return
      this.cizim()
      this.raf = requestAnimationFrame(dongu)
    }
    this.raf = requestAnimationFrame(dongu)
  }

  kapat(): void {
    this.etkin = false
    cancelAnimationFrame(this.raf)
    this.noktalar = []
    this.suruk = null
    this.goruntu = null
    this.g.yakalamaTemizle()
    this.panel.hidden = true
    this.svg.replaceChildren()
    this.tutamaklar.forEach((t) => (t.hidden = true))
    this.buyutec.hidden = true
    this.onDegisim(false)
  }

  /** Yeni çizim açılınca eski ölçümü temizle (mod açık kalabilir) */
  sifirla(): void {
    this.noktalar = []
    this.suruk = null
    this.goruntu = null
    this.buyutec.hidden = true
    this.g.yakalamaTemizle()
    if (this.etkin) this.render()
  }

  private tuvalKonum(): DOMRect {
    return this.g.tuval.getBoundingClientRect()
  }

  /** Tuval içi ekran noktasını (CSS px) yakalamayla birlikte çizim noktasına çevirir */
  private coz(sp: Nokta): OlcumNoktasi {
    const s = this.yakalama ? this.g.yakala(sp, YAKALAMA_YARICAP) : undefined
    if (s) return { p: { x: s.x, y: s.y }, tur: s.tur }
    return { p: this.g.ekranDunya(sp) }
  }

  // ---- boş alana dokunma (yeni nokta)

  private asagi(e: PointerEvent): void {
    if (!this.etkin) return
    this.aktifDokunus.set(e.pointerId, { x: e.clientX, y: e.clientY, t: e.timeStamp })
    if (this.aktifDokunus.size > 1) this.cokluDokunus = true
  }

  private yukari(e: PointerEvent): void {
    if (!this.etkin) return
    const bas = this.aktifDokunus.get(e.pointerId)
    this.aktifDokunus.delete(e.pointerId)
    if (!bas) return
    const kalan = this.aktifDokunus.size
    const hareket = Math.hypot(e.clientX - bas.x, e.clientY - bas.y)
    const sure = e.timeStamp - bas.t
    if (kalan === 0) {
      const coklu = this.cokluDokunus
      this.cokluDokunus = false
      if (coklu || hareket > 12 || sure > 700) return
    } else {
      return
    }
    const r = this.tuvalKonum()
    const nokta = this.coz({ x: e.clientX - r.left, y: e.clientY - r.top })
    if (this.noktalar.length >= 2) this.noktalar = []
    this.noktalar.push(nokta)
    this.render()
  }

  // ---- tutamak sürükleme

  private tutAsagi(e: PointerEvent, i: number): void {
    if (!this.etkin || this.suruk || !this.noktalar[i]) return
    e.preventDefault()
    e.stopPropagation()
    const r = this.tuvalKonum()
    const q = this.g.dunyaEkran(this.noktalar[i].p)
    const px = e.clientX - r.left
    const py = e.clientY - r.top
    this.suruk = { i, id: e.pointerId, ofx: q.x - px, ofy: q.y - py, px: e.clientX, py: e.clientY }
    try {
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    } catch {
      // yoksay
    }
    this.tutamaklar[i].classList.add('suruklenen')
    this.goruntu = null
    this.buyutecGoster()
    void this.g.tuvalGoruntusu().then((c) => {
      if (this.suruk && this.suruk.i === i) {
        this.goruntu = c
        this.buyutecCiz()
      }
    })
  }

  private tutHareket(e: PointerEvent, i: number): void {
    const s = this.suruk
    if (!this.etkin || !s || s.i !== i || e.pointerId !== s.id) return
    e.preventDefault()
    e.stopPropagation()
    s.px = e.clientX
    s.py = e.clientY
    const r = this.tuvalKonum()
    this.noktalar[i] = this.coz({ x: e.clientX - r.left + s.ofx, y: e.clientY - r.top + s.ofy })
    this.render()
    this.buyutecGoster()
  }

  private tutBitir(e: PointerEvent, i: number): void {
    const s = this.suruk
    if (!s || s.i !== i || e.pointerId !== s.id) return
    e.stopPropagation()
    this.suruk = null
    this.goruntu = null
    this.tutamaklar[i].classList.remove('suruklenen')
    this.buyutec.hidden = true
    try {
      ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
    } catch {
      // yoksay
    }
  }

  // ---- büyüteç

  private buyutecGoster(): void {
    const s = this.suruk
    if (!s) return
    const sr = this.sahne.getBoundingClientRect()
    const yar = BUYUTEC_CAP / 2
    let cx = s.px - sr.left
    let cy = s.py - sr.top - BUYUTEC_UZAKLIK
    if (cy - yar < 0) cy = s.py - sr.top + BUYUTEC_UZAKLIK // üst kenara yakınsa parmağın altına çevir
    cx = Math.max(yar + 4, Math.min(sr.width - yar - 4, cx))
    this.buyutec.style.left = `${cx - yar}px`
    this.buyutec.style.top = `${cy - yar}px`
    this.buyutec.hidden = false
    this.buyutecCiz()
  }

  private buyutecCiz(): void {
    const s = this.suruk
    if (!s || this.buyutec.hidden) return
    const dpr = window.devicePixelRatio || 1
    const boyut = Math.round(BUYUTEC_CAP * dpr)
    const cv = this.buyutecTuval
    if (cv.width !== boyut) {
      cv.width = boyut
      cv.height = boyut
    }
    const ctx = cv.getContext('2d')
    if (!ctx) return
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.fillStyle = this.sahne.style.background || '#000'
    ctx.fillRect(0, 0, boyut, boyut)
    const n = this.noktalar[s.i]
    if (!n) return
    const q = this.g.dunyaEkran(n.p) // tuval içi CSS px
    const r = this.tuvalKonum()
    const src = this.goruntu
    if (src && r.width > 0) {
      const k = src.width / r.width
      const kenar = (BUYUTEC_CAP / BUYUTEC_OLCEK) * k
      try {
        ctx.drawImage(src, q.x * k - kenar / 2, q.y * k - kenar / 2, kenar, kenar, 0, 0, boyut, boyut)
      } catch {
        // yoksay
      }
    }
    ctx.scale(dpr, dpr)
    const m = BUYUTEC_CAP / 2
    // artı imleci
    ctx.lineWidth = 3
    ctx.strokeStyle = '#000'
    ctx.beginPath()
    ctx.moveTo(m - 22, m)
    ctx.lineTo(m + 22, m)
    ctx.moveTo(m, m - 22)
    ctx.lineTo(m, m + 22)
    ctx.stroke()
    ctx.lineWidth = 1.2
    ctx.strokeStyle = '#ffd400'
    ctx.stroke()
    if (n.tur) {
      ctx.save()
      ctx.translate(m, m)
      const yol = new Path2D(isaretYolu(n.tur, 9))
      ctx.lineWidth = 4
      ctx.strokeStyle = '#000'
      ctx.stroke(yol)
      ctx.lineWidth = 2
      ctx.strokeStyle = '#00e676'
      ctx.stroke(yol)
      ctx.restore()
      ctx.font = '700 13px system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.lineWidth = 3
      ctx.strokeStyle = '#000'
      ctx.strokeText(TUR_ETIKET[n.tur], m, BUYUTEC_CAP - 10)
      ctx.fillStyle = '#00e676'
      ctx.fillText(TUR_ETIKET[n.tur], m, BUYUTEC_CAP - 10)
    }
  }

  // ---- gösterim

  private render(): void {
    const n = this.noktalar.length
    if (n === 0) {
      this.ipucu.textContent = 'Ölçüm: A noktasına dokunun'
      this.sonuc.hidden = true
    } else if (n === 1) {
      this.ipucu.textContent = 'Ölçüm: B noktasına dokunun'
      this.sonuc.hidden = true
    } else {
      const [a, b] = this.noktalar
      const dx = b.p.x - a.p.x
      const dy = b.p.y - a.p.y
      const d = Math.hypot(dx, dy)
      this.ipucu.textContent = 'Noktaları sürükleyerek ayarlayın. Yeni ölçüm için boş alana dokunun'
      this.sonuc.hidden = false
      this.sonuc.innerHTML =
        `Mesafe: ${f(d)}<span class="alt-deger">ΔX: ${f(Math.abs(dx))}</span>` +
        `<span class="alt-deger">ΔY: ${f(Math.abs(dy))}</span>`
    }
    this.cizim()
  }

  private cizim(): void {
    if (!this.etkin) return
    const r = this.tuvalKonum()
    const s = this.sahne.getBoundingClientRect()
    const ox = r.left - s.left
    const oy = r.top - s.top
    const e = this.noktalar.map((n) => {
      const q = this.g.dunyaEkran(n.p)
      return { x: q.x + ox, y: q.y + oy, tur: n.tur }
    })
    this.svg.replaceChildren()
    const ekle = (tag: string, at: Record<string, string | number>) => {
      const el = document.createElementNS(SVG, tag)
      for (const k of Object.keys(at)) el.setAttribute(k, String(at[k]))
      this.svg.appendChild(el)
      return el
    }
    if (e.length === 2) {
      ekle('line', { x1: e[0].x, y1: e[0].y, x2: e[1].x, y2: e[1].y, stroke: '#000', 'stroke-width': 5, 'stroke-linecap': 'round' })
      ekle('line', { x1: e[0].x, y1: e[0].y, x2: e[1].x, y2: e[1].y, stroke: '#ffd400', 'stroke-width': 2.5, 'stroke-linecap': 'round' })
    }
    e.forEach((p, i) => {
      const t = this.tutamaklar[i]
      t.hidden = false
      t.style.transform = `translate(${p.x}px, ${p.y}px)`
      if (!p.tur) return
      const yol = isaretYolu(p.tur, 9)
      const tr = `translate(${p.x} ${p.y})`
      ekle('path', { d: yol, transform: tr, fill: 'none', stroke: '#000', 'stroke-width': 5 })
      ekle('path', { d: yol, transform: tr, fill: 'none', stroke: '#00e676', 'stroke-width': 2.5, class: 'yakala-isaret', 'data-tur': p.tur })
      const t2 = ekle('text', {
        x: p.x + 18,
        y: p.y + 30,
        fill: '#00e676',
        stroke: '#000',
        'stroke-width': 3,
        'paint-order': 'stroke',
        'font-size': 15,
        'font-weight': 700,
        class: 'yakala-etiket',
        'data-tur': p.tur
      })
      t2.textContent = TUR_ETIKET[p.tur]
    })
    for (let i = e.length; i < 2; i++) this.tutamaklar[i].hidden = true
  }
}

function f(n: number): string {
  return n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
