// "Son açılanlar": IndexedDB. Hata olursa özellik sessizce kapanır.
//
// Sürüm 2: liste bilgisi ("son") ile dosya içeriği ("veri") ayrı depolarda.
// - Liste yalnız küçük kayıtları okur; 8 çizimin megabaytlarını belleğe almaz.
// - İçerik ArrayBuffer olarak saklanır. iPhone'da dosya seçiciden gelen File
//   doğrudan saklanınca iOS'un geçici kopyasına bağlı kalıyor, o kopya
//   silinince kayıt okunamıyordu.
export interface SonKayit {
  id: number
  ad: string
  boyut: number
  tarih: number
}

const DB_AD = 'dwg-goruntuleyici'
const DEPO = 'son'
const VERI = 'veri'
const SINIR = 8

let dbSoz: Promise<IDBDatabase> | null = null

// Açılamayan (bozulmuş) veritabanı bir kez silinip yeniden kurulur; içinde
// yalnız "son açılanlar" önbelleği var.
let onarildi = false

function dbAc(): Promise<IDBDatabase> {
  if (!dbSoz) {
    dbSoz = new Promise((coz, red) => {
      if (typeof indexedDB === 'undefined') {
        red(new Error('IndexedDB yok'))
        return
      }
      const istek = indexedDB.open(DB_AD, 2)
      istek.onupgradeneeded = (olay) => {
        const db = istek.result
        if (olay.oldVersion < 1) db.createObjectStore(DEPO, { keyPath: 'id', autoIncrement: true })
        if (olay.oldVersion < 2) {
          const veriDepo = db.createObjectStore(VERI, { keyPath: 'id' })
          if (olay.oldVersion >= 1) {
            // Sürüm 1 kayıtları: içerik (Blob) "veri" deposuna taşınır, listede yalnız bilgi kalır
            const son = istek.transaction!.objectStore(DEPO)
            const imlecIstek = son.openCursor()
            // Eski kayıtlar okunamıyorsa yükseltme düşmesin: liste temizlenir
            imlecIstek.onerror = (e) => {
              e.preventDefault()
              son.clear()
            }
            imlecIstek.onsuccess = (e) => {
              const imlec = (e.target as IDBRequest<IDBCursorWithValue | null>).result
              if (!imlec) return
              const { veri, ...bilgi } = imlec.value as SonKayit & { veri?: Blob }
              if (veri) veriDepo.put({ id: bilgi.id, veri })
              imlec.update(bilgi)
              imlec.continue()
            }
          }
        }
      }
      istek.onsuccess = () => {
        const db = istek.result
        // Başka sekme sürümü yükseltirse bağlantıyı bırak
        db.onversionchange = () => {
          db.close()
          dbSoz = null
        }
        coz(db)
      }
      istek.onerror = () => {
        if (onarildi || istek.error?.name === 'VersionError') {
          red(istek.error)
          return
        }
        onarildi = true
        console.error('Son açılanlar veritabanı açılamadı, yeniden kuruluyor', istek.error)
        const sil = indexedDB.deleteDatabase(DB_AD)
        sil.onsuccess = sil.onerror = () => {
          dbSoz = null
          dbAc().then(coz, red)
        }
      }
      istek.onblocked = () => red(new Error('IndexedDB engellendi'))
    })
    dbSoz.catch(() => {
      dbSoz = null
    })
  }
  return dbSoz
}

function islem<T>(
  depolar: string[],
  mod: IDBTransactionMode,
  fn: (tx: IDBTransaction) => IDBRequest<T> | void
): Promise<T | undefined> {
  return dbAc().then(
    (db) =>
      new Promise<T | undefined>((coz, red) => {
        const tx = db.transaction(depolar, mod)
        const istek = fn(tx)
        tx.oncomplete = () => coz(istek ? istek.result : undefined)
        tx.onerror = () => red(tx.error)
        tx.onabort = () => red(tx.error)
      })
  )
}

function bilgiler(): Promise<SonKayit[]> {
  return islem<SonKayit[]>([DEPO], 'readonly', (tx) => tx.objectStore(DEPO).getAll()).then((h) =>
    (h ?? []).sort((a, b) => b.tarih - a.tarih)
  )
}

function silIc(id: number): Promise<unknown> {
  return islem([DEPO, VERI], 'readwrite', (tx) => {
    tx.objectStore(DEPO).delete(id)
    tx.objectStore(VERI).delete(id)
  })
}

export async function listele(): Promise<SonKayit[]> {
  try {
    return await bilgiler()
  } catch (e) {
    console.error('Son açılanlar okunamadı', e)
    return []
  }
}

export async function kaydet(ad: string, veri: ArrayBuffer): Promise<void> {
  try {
    const boyut = veri.byteLength
    // Aynı ad+boyut varsa eskisini değiştir
    for (const k of (await bilgiler()).filter((m) => m.ad === ad && m.boyut === boyut)) await silIc(k.id)
    await islem([DEPO, VERI], 'readwrite', (tx) => {
      const ekle = tx.objectStore(DEPO).add({ ad, boyut, tarih: Date.now() })
      ekle.onsuccess = () => {
        tx.objectStore(VERI).put({ id: ekle.result as number, veri })
      }
    })
    for (const k of (await bilgiler()).slice(SINIR)) await silIc(k.id)
  } catch (e) {
    console.error('Son açılanlara kaydedilemedi', e)
  }
}

/** Kaydı listenin en üstüne taşır (içeriğe dokunmadan). */
export async function dokun(id: number): Promise<void> {
  try {
    await islem([DEPO], 'readwrite', (tx) => {
      const d = tx.objectStore(DEPO)
      const al = d.get(id)
      al.onsuccess = () => {
        if (al.result) d.put({ ...al.result, tarih: Date.now() })
      }
    })
  } catch {
    // yoksay
  }
}

export async function sil(id: number): Promise<void> {
  try {
    await silIc(id)
  } catch {
    // yoksay
  }
}

/**
 * Kaydın içeriğini getirir. Kayıt yoksa ya da içerik artık okunamıyorsa
 * (ör. iPhone'da eski sürümün sakladığı geçici dosya silinmiş) `undefined`.
 */
export async function getir(id: number): Promise<{ ad: string; veri: ArrayBuffer } | undefined> {
  try {
    const k: { bilgi?: SonKayit; icerik?: { veri: ArrayBuffer | Blob } } = {}
    await islem([DEPO, VERI], 'readonly', (tx) => {
      const a = tx.objectStore(DEPO).get(id)
      a.onsuccess = () => (k.bilgi = a.result)
      const b = tx.objectStore(VERI).get(id)
      b.onsuccess = () => (k.icerik = b.result)
    })
    const { bilgi, icerik } = k
    if (!bilgi || !icerik) return undefined
    const veri = icerik.veri instanceof Blob ? await icerik.veri.arrayBuffer() : icerik.veri
    if (!(veri instanceof ArrayBuffer) || veri.byteLength === 0) return undefined
    if (icerik.veri instanceof Blob) {
      // Eski (Blob) kaydı okunabiliyorken kalıcı kopyaya çevir
      await islem([VERI], 'readwrite', (tx) => {
        tx.objectStore(VERI).put({ id, veri: veri.slice(0) })
      }).catch(() => undefined)
    }
    return { ad: bilgi.ad, veri }
  } catch (e) {
    console.error('Kayıt okunamadı', e)
    return undefined
  }
}
