import {
  AcApDocManager,
  AcApI18n,
  AcApSettingManager,
  AcEdOpenMode,
  AcEdViewMode
} from '@mlightcad/cad-simple-viewer'
import {
  AcDbDatabaseConverterManager,
  AcDbFileType,
  AcDbOsnapMode,
  AcGeBox2d,
  acdbOsnapModesToMask
} from '@mlightcad/data-model'
import { AcDbLibreDwgConverter } from '@mlightcad/libredwg-converter'
import { FontManager } from '@mlightcad/mtext-renderer'

/**
 * Çizimdeki yazı tipi bulunamazsa kullanılacak yedekler. Kütüphanenin varsayılanı
 * Çince yazı tipleri (simsun, hztxt) — pakette yoklar, yazılar "?" çıkıyordu.
 * Arial Latin + Türkçe harfleri kapsar; SHX yazılar için simplex/txt yedekte.
 */
const YEDEK_YAZI_TIPLERI = ['arial', 'simplex', 'txt']

export type Tema = 'koyu' | 'acik'

const RENK: Record<Tema, number> = { koyu: 0x000000, acik: 0xffffff }

export interface Nokta {
  x: number
  y: number
}

/** Ölçüm için açık nesne yakalama kipleri (En yakın nokta bilerek yok) */
const YAKALAMA_KIPLERI = [
  AcDbOsnapMode.EndPoint,
  AcDbOsnapMode.MidPoint,
  AcDbOsnapMode.Center,
  AcDbOsnapMode.Intersection,
  AcDbOsnapMode.Quadrant
]

export type YakalamaTuru = 'kose' | 'orta' | 'merkez' | 'kesisim' | 'ceyrek'

const KIP_TUR: Partial<Record<AcDbOsnapMode, YakalamaTuru>> = {
  [AcDbOsnapMode.EndPoint]: 'kose',
  [AcDbOsnapMode.MidPoint]: 'orta',
  [AcDbOsnapMode.Center]: 'merkez',
  [AcDbOsnapMode.Intersection]: 'kesisim',
  [AcDbOsnapMode.Quadrant]: 'ceyrek'
}

export interface Yakalanan extends Nokta {
  tur: YakalamaTuru
}

/** Kütüphane görünümüne ince sarmalayıcı. Arayüzün geri kalanı kütüphaneye doğrudan dokunmaz. */
export class Gorunum {
  private tema: Tema = 'koyu'
  private acik = false

  constructor(private kapsayici: HTMLElement) {}

  baslat(): void {
    try {
      AcApI18n.setCurrentLocale('tr' as never)
    } catch {
      // yoksay
    }
    // Kütüphane arayüz parçalarını kapat
    AcApSettingManager.instance.apply(
      {
        isShowCommandLine: false,
        isShowShortCutToolbar: false,
        isShowToolbar: false,
        isShowRibbon: false,
        isShowCoordinate: false,
        isShowEntityInfo: false,
        isShowLanguageSelector: false,
        isShowStats: false,
        hideTouchPointTutorial: true
      } as never,
      { persist: false }
    )

    AcDbDatabaseConverterManager.instance.register(
      AcDbFileType.DWG,
      new AcDbLibreDwgConverter({
        convertByEntityType: false,
        useWorker: true,
        parserWorkerUrl: './workers/libredwg-parser-worker.js'
      })
    )

    AcApDocManager.createInstance({
      container: this.kapsayici,
      autoResize: true,
      // Yazı tipleri uygulamayla birlikte gelir: <baseUrl>/fonts/
      baseUrl: new URL('./', document.baseURI).href,
      useMainThreadDraw: true,
      builtinOpenFileDialog: false,
      notificationCenter: false,
      disableExport: true,
      webworkerFileUrls: {
        dwgParser: './workers/libredwg-parser-worker.js',
        mtextRender: './workers/mtext-renderer-worker.js'
      }
    } as never)
    // createInstance varsayılanı ('modern' = Çince) kurduğu için ondan sonra ayarlanır
    FontManager.instance.setDefaultFonts(YEDEK_YAZI_TIPLERI)
    this.gorunum.entitySelectionEnabled = false
    try {
      AcApSettingManager.instance.apply(
        { osnapModes: acdbOsnapModesToMask(YAKALAMA_KIPLERI) } as never,
        { persist: false }
      )
    } catch {
      // yakalama kipleri ayarlanamazsa kütüphane varsayılanı kalır
    }
  }

  private get yonetici(): AcApDocManager {
    return AcApDocManager.instance
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private get gorunum(): any {
    return this.yonetici.curView
  }

  get tuval(): HTMLCanvasElement {
    return this.gorunum.canvas as HTMLCanvasElement
  }

  /** Dosyayı açar. Başarısızlıkta false döner ya da hata fırlatır. */
  async ac(ad: string, veri: ArrayBuffer): Promise<boolean> {
    let ok = false
    try {
      ok = await this.yonetici.openDocument(ad, veri, {
        mode: AcEdOpenMode.Read,
        minimumChunkSize: 1000,
        progressiveRendering: false,
        sysVars: { lwdisplay: false }
      } as never)
    } catch (e) {
      this.acik = false
      throw e
    }
    if (!ok || !this.cizimVarMi()) {
      // Veritabanı temizlenmiş olabilir: açık çizim yok say
      this.acik = false
      return false
    }
    if (ok) {
      this.acik = true
      this.gorunum.entitySelectionEnabled = false
      this.fareKaydirmaKur()
      this.temaUygula(this.tema)
      this.sigdir()
    }
    return ok
  }

  /**
   * Bilgisayarda fareyle kaydırma: kütüphane varsayılanı "seçim" modudur ve
   * kaydırmayı yalnız orta tuşa verir. Programda nesne seçimi olmadığından
   * "kaydırma" moduna geçilir (sol tuşla sürükle), AutoCAD alışkanlığı için orta
   * tuş da kaydırmaya devam eder. Görünüm her dosya açılışında yeniden kurulduğu
   * için her açılışta çağrılır. Dokunmatik hareketleri etkilemez.
   */
  private fareKaydirmaKur(): void {
    try {
      this.gorunum.mode = AcEdViewMode.PAN
      const kontrol = this.gorunum.activeLayoutView?._cameraControls
      if (kontrol) {
        const KAYDIR = 2 // THREE.MOUSE.PAN
        kontrol.mouseButtons = { LEFT: KAYDIR, MIDDLE: KAYDIR }
        kontrol.update?.()
      }
    } catch {
      // yoksay: orta tuşla kaydırma yine çalışır
    }
  }

  /** Bozuk dosyalarda ayrıştırıcı hata vermeden boş veritabanı döndürebilir; boş çizimi başarısız sayarız. */
  private cizimVarMi(): boolean {
    try {
      const db = this.yonetici.curDocument.database
      for (const btr of db.tables.blockTable.newIterator()) {
        for (const _e of btr.newIterator()) return true
      }
      return false
    } catch {
      return true
    }
  }

  get dosyaAcik(): boolean {
    return this.acik
  }

  temaUygula(t: Tema): void {
    this.tema = t
    try {
      this.gorunum.backgroundColor = RENK[t]
    } catch {
      // yoksay
    }
  }

  sigdir(): void {
    this.gorunum.zoomToFitDrawing()
  }

  private gorunenKutu(): AcGeBox2d {
    const v = this.gorunum
    const a = v.screenToWorld({ x: 0, y: 0 })
    const b = v.screenToWorld({ x: v.width, y: v.height })
    return new AcGeBox2d(
      { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y) },
      { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y) }
    )
  }

  yaklastir(carpan: number): void {
    const k = this.gorunenKutu()
    const cx = (k.min.x + k.max.x) / 2
    const cy = (k.min.y + k.max.y) / 2
    const hw = ((k.max.x - k.min.x) / 2) / carpan
    const hh = ((k.max.y - k.min.y) / 2) / carpan
    this.gorunum.zoomTo(new AcGeBox2d({ x: cx - hw, y: cy - hh }, { x: cx + hw, y: cy + hh }), 1)
  }

  /** Tuval içi (CSS px) nokta -> çizim koordinatı */
  ekranDunya(p: Nokta): Nokta {
    const w = this.gorunum.screenToWorld(p)
    return { x: w.x, y: w.y }
  }

  dunyaEkran(p: Nokta): Nokta {
    const s = this.gorunum.worldToScreen(p)
    return { x: s.x, y: s.y }
  }

  /**
   * Tuval içi (CSS px) noktanın yakınındaki yakalama noktası. Çözücü yoksa ya da hata verirse
   * undefined döner (ölçüm ham noktayla sürer).
   */
  yakala(ekran: Nokta, yaricapPx: number): Yakalanan | undefined {
    try {
      const cozucu = this.gorunum.osnapResolver
      if (!cozucu || typeof cozucu.resolve !== 'function') return undefined
      const w = this.ekranDunya(ekran)
      const r = cozucu.resolve({ cursorWcs: { x: w.x, y: w.y }, hitRadiusPx: yaricapPx })
      if (!r) return undefined
      const tur = KIP_TUR[r.type as AcDbOsnapMode]
      if (!tur) return undefined
      return { x: r.x, y: r.y, tur }
    } catch {
      return undefined
    }
  }

  /** Daire merkezi için "elde edilen" izleri temizler */
  yakalamaTemizle(): void {
    try {
      this.gorunum.osnapResolver?.clearAcquiredCenters?.()
    } catch {
      // yoksay
    }
  }

  /**
   * Çizimin anlık görüntüsü (büyüteç için). WebGL tamponu sunumdan sonra boşaldığı için bir kare
   * çizdirilir ve kopya, aynı görevin mikro görev kuyruğunda (tampon hâlâ doluyken) alınır.
   */
  tuvalGoruntusu(): Promise<HTMLCanvasElement | null> {
    return new Promise((coz) => {
      let bitti = false
      const v = this.gorunum
      const son = (c: HTMLCanvasElement | null) => {
        if (bitti) return
        bitti = true
        coz(c)
      }
      try {
        const olay = v.events.renderFrame
        const isle = () => {
          olay.removeEventListener(isle)
          queueMicrotask(() => {
            try {
              const kaynak = this.tuval
              const c = document.createElement('canvas')
              c.width = kaynak.width
              c.height = kaynak.height
              c.getContext('2d')!.drawImage(kaynak, 0, 0)
              son(c)
            } catch {
              son(null)
            }
          })
        }
        olay.addEventListener(isle)
        v.isDirty = true
        setTimeout(() => {
          try {
            olay.removeEventListener(isle)
          } catch {
            // yoksay
          }
          son(null)
        }, 1000)
      } catch {
        son(null)
      }
    })
  }
}
