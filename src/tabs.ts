// Sekme mantığı: DOM'dan bağımsız, yalnız bellekte durur ("Son açılanlar"dan ayrıdır).

export const EN_FAZLA_SEKME = 5

/** Görünen dünya kutusu */
export interface GorunumKutusu {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export interface Sekme {
  id: string
  ad: string
  boyut: number
  veri: ArrayBuffer
  /** Sekmeden ayrılırken kaydedilen görünüm; null ise açılışta sığdırılır */
  gorunum: GorunumKutusu | null
  /** Son etkin olma sırası (büyük = daha yeni) */
  son: number
}

export function sekmeKimligi(ad: string, boyut: number): string {
  return `${ad}\u0000${boyut}`
}

export class Sekmeler {
  private _liste: Sekme[] = []
  private _etkinId: string | null = null
  private sayac = 0

  get liste(): readonly Sekme[] {
    return this._liste
  }

  get etkinId(): string | null {
    return this._etkinId
  }

  get etkin(): Sekme | null {
    return this.al(this._etkinId)
  }

  al(id: string | null): Sekme | null {
    return id === null ? null : (this._liste.find((s) => s.id === id) ?? null)
  }

  bul(ad: string, boyut: number): Sekme | null {
    return this.al(sekmeKimligi(ad, boyut))
  }

  /**
   * Yeni sekme ekler ve etkin yapar. Doluysa en uzun süredir bakılmayan (etkin olmayan) sekme düşer;
   * düşen sekme döndürülür.
   */
  ekle(ad: string, veri: ArrayBuffer): { sekme: Sekme; dusen: Sekme | null } {
    const id = sekmeKimligi(ad, veri.byteLength)
    const mevcut = this.al(id)
    if (mevcut) {
      this.guncelle(id, veri)
      return { sekme: mevcut, dusen: null }
    }
    let dusen: Sekme | null = null
    if (this._liste.length >= EN_FAZLA_SEKME) {
      const adaylar = this._liste.filter((s) => s.id !== this._etkinId)
      adaylar.sort((a, b) => a.son - b.son)
      dusen = adaylar[0] ?? null
      if (dusen) this._liste = this._liste.filter((s) => s !== dusen)
    }
    const sekme: Sekme = { id, ad, boyut: veri.byteLength, veri, gorunum: null, son: ++this.sayac }
    this._liste.push(sekme)
    this._etkinId = id
    return { sekme, dusen }
  }

  /** Aynı kimlikli sekmenin içeriğini değiştirir, görünümü sıfırlar ve etkin yapar */
  guncelle(id: string, veri: ArrayBuffer): void {
    const s = this.al(id)
    if (!s) return
    s.veri = veri
    s.gorunum = null
    this.etkinYap(id)
  }

  etkinYap(id: string): void {
    const s = this.al(id)
    if (!s) return
    s.son = ++this.sayac
    this._etkinId = id
  }

  /** Etkin sekme yok sayılır (ör. açılış başarısız oldu, hiçbir çizim açık değil) */
  etkinTemizle(): void {
    this._etkinId = null
  }

  /**
   * Sekmeyi listeden çıkarır. Etkin sekme çıkarıldıysa etkin boşalır ve geçilecek sekmenin
   * kimliği döner (soldaki komşu, yoksa sağdaki); etkin olmayan sekme çıkarsa null döner.
   */
  kapat(id: string): string | null {
    const i = this._liste.findIndex((s) => s.id === id)
    if (i < 0) return null
    const etkinydi = this._etkinId === id
    this._liste.splice(i, 1)
    if (!etkinydi) return null
    this._etkinId = null
    const komsu = this._liste[i - 1] ?? this._liste[i] ?? null
    return komsu ? komsu.id : null
  }
}
