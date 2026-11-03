import type { Gorunum, Nokta } from './viewer'

const SVG = 'http://www.w3.org/2000/svg'

/**
 * Ölçüm modu: A noktasına, sonra B noktasına dokun. Mesafe, ΔX ve ΔY gösterilir.
 * Dokunma, kütüphanenin kaydırma/yakınlaştırmasını engellemeden yakalanır (yakalama aşamasında dinlenir).
 */
export class Olcum {
  private etkin = false
  private noktalar: Nokta[] = []
  private svg: SVGSVGElement
  private panel: HTMLElement
  private ipucu: HTMLElement
  private sonuc: HTMLElement
  private raf = 0
  private aktifDokunus = new Map<number, { x: number; y: number; t: number }>()
  private cokluDokunus = false

  constructor(
    private g: Gorunum,
    private sahne: HTMLElement,
    private onDegisim: (etkin: boolean) => void
  ) {
    this.svg = document.getElementById('olcum-katman') as unknown as SVGSVGElement
    this.panel = document.getElementById('olcum-panel') as HTMLElement
    this.ipucu = document.getElementById('olcum-ipucu') as HTMLElement
    this.sonuc = document.getElementById('olcum-sonuc') as HTMLElement
    const kap = document.getElementById('cad-container') as HTMLElement
    kap.addEventListener('pointerdown', (e) => this.asagi(e), true)
    kap.addEventListener('pointerup', (e) => this.yukari(e), true)
    kap.addEventListener('pointercancel', (e) => this.aktifDokunus.delete(e.pointerId), true)
  }

  get acikMi(): boolean {
    return this.etkin
  }

  ac(): void {
    this.etkin = true
    this.noktalar = []
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
    this.panel.hidden = true
    this.svg.replaceChildren()
    this.onDegisim(false)
  }

  /** Yeni çizim açılınca eski ölçümü temizle (mod açık kalabilir) */
  sifirla(): void {
    this.noktalar = []
    if (this.etkin) this.render()
  }

  private asagi(e: PointerEvent): void {
    if (!this.etkin) return
    this.aktifDokunus.set(e.pointerId, { x: e.clientX, y: e.clientY, t: performance.now() })
    if (this.aktifDokunus.size > 1) this.cokluDokunus = true
  }

  private yukari(e: PointerEvent): void {
    if (!this.etkin) return
    const bas = this.aktifDokunus.get(e.pointerId)
    this.aktifDokunus.delete(e.pointerId)
    if (!bas) return
    const kalan = this.aktifDokunus.size
    const hareket = Math.hypot(e.clientX - bas.x, e.clientY - bas.y)
    const sure = performance.now() - bas.t
    if (kalan === 0) {
      const coklu = this.cokluDokunus
      this.cokluDokunus = false
      if (coklu || hareket > 12 || sure > 700) return
    } else {
      return
    }
    const r = this.g.tuval.getBoundingClientRect()
    const dunya = this.g.ekranDunya({ x: e.clientX - r.left, y: e.clientY - r.top })
    if (this.noktalar.length >= 2) this.noktalar = []
    this.noktalar.push(dunya)
    this.render()
  }

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
      const dx = b.x - a.x
      const dy = b.y - a.y
      const d = Math.hypot(dx, dy)
      this.ipucu.textContent = 'Yeni ölçüm için tekrar dokunun'
      this.sonuc.hidden = false
      this.sonuc.innerHTML =
        `Mesafe: ${f(d)}<span class="alt-deger">ΔX: ${f(Math.abs(dx))}</span>` +
        `<span class="alt-deger">ΔY: ${f(Math.abs(dy))}</span>`
    }
    this.cizim()
  }

  private cizim(): void {
    if (!this.etkin) return
    const r = this.g.tuval.getBoundingClientRect()
    const s = this.sahne.getBoundingClientRect()
    const ox = r.left - s.left
    const oy = r.top - s.top
    const e = this.noktalar.map((p) => {
      const q = this.g.dunyaEkran(p)
      return { x: q.x + ox, y: q.y + oy }
    })
    this.svg.replaceChildren()
    const ekle = (tag: string, at: Record<string, string | number>) => {
      const el = document.createElementNS(SVG, tag)
      for (const k of Object.keys(at)) el.setAttribute(k, String(at[k]))
      this.svg.appendChild(el)
    }
    if (e.length === 2) {
      ekle('line', { x1: e[0].x, y1: e[0].y, x2: e[1].x, y2: e[1].y, stroke: '#000', 'stroke-width': 5, 'stroke-linecap': 'round' })
      ekle('line', { x1: e[0].x, y1: e[0].y, x2: e[1].x, y2: e[1].y, stroke: '#ffd400', 'stroke-width': 2.5, 'stroke-linecap': 'round' })
    }
    e.forEach((p, i) => {
      ekle('circle', { cx: p.x, cy: p.y, r: 11, fill: 'none', stroke: '#000', 'stroke-width': 5 })
      ekle('circle', { cx: p.x, cy: p.y, r: 11, fill: 'rgba(255,212,0,0.25)', stroke: '#ffd400', 'stroke-width': 2.5 })
      const t = document.createElementNS(SVG, 'text')
      t.setAttribute('x', String(p.x + 16))
      t.setAttribute('y', String(p.y - 14))
      t.setAttribute('fill', '#ffd400')
      t.setAttribute('stroke', '#000')
      t.setAttribute('stroke-width', '3')
      t.setAttribute('paint-order', 'stroke')
      t.setAttribute('font-size', '18')
      t.setAttribute('font-weight', '700')
      t.textContent = i === 0 ? 'A' : 'B'
      this.svg.appendChild(t)
    })
  }
}

function f(n: number): string {
  return n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
