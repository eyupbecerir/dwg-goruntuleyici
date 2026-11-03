import {
  AcApDocManager,
  AcApI18n,
  AcApSettingManager,
  AcEdOpenMode
} from '@mlightcad/cad-simple-viewer'
import { AcDbDatabaseConverterManager, AcDbFileType, AcGeBox2d } from '@mlightcad/data-model'
import { AcDbLibreDwgConverter } from '@mlightcad/libredwg-converter'

export type Tema = 'koyu' | 'acik'

const RENK: Record<Tema, number> = { koyu: 0x000000, acik: 0xffffff }

export interface Nokta {
  x: number
  y: number
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
    this.gorunum.entitySelectionEnabled = false
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
      this.temaUygula(this.tema)
      this.sigdir()
    }
    return ok
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
}
