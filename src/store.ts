// "Son açılanlar": IndexedDB. Hata olursa özellik sessizce kapanır.
export interface SonKayit {
  id: number
  ad: string
  boyut: number
  tarih: number
  veri: Blob
}

const DB_AD = 'dwg-goruntuleyici'
const DEPO = 'son'
const SINIR = 8

let dbSoz: Promise<IDBDatabase> | null = null

function dbAc(): Promise<IDBDatabase> {
  if (!dbSoz) {
    dbSoz = new Promise((coz, red) => {
      if (typeof indexedDB === 'undefined') {
        red(new Error('IndexedDB yok'))
        return
      }
      const istek = indexedDB.open(DB_AD, 1)
      istek.onupgradeneeded = () => {
        istek.result.createObjectStore(DEPO, { keyPath: 'id', autoIncrement: true })
      }
      istek.onsuccess = () => coz(istek.result)
      istek.onerror = () => red(istek.error)
      istek.onblocked = () => red(new Error('IndexedDB engellendi'))
    })
    dbSoz.catch(() => {
      dbSoz = null
    })
  }
  return dbSoz
}

function islem<T>(mod: IDBTransactionMode, fn: (depo: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return dbAc().then(
    (db) =>
      new Promise<T>((coz, red) => {
        const tx = db.transaction(DEPO, mod)
        const istek = fn(tx.objectStore(DEPO))
        tx.oncomplete = () => coz(istek.result)
        tx.onerror = () => red(tx.error)
        tx.onabort = () => red(tx.error)
      })
  )
}

export async function listele(): Promise<SonKayit[]> {
  try {
    const hepsi = (await islem('readonly', (d) => d.getAll())) as SonKayit[]
    return hepsi.sort((a, b) => b.tarih - a.tarih)
  } catch {
    return []
  }
}

export async function kaydet(ad: string, boyut: number, veri: Blob): Promise<void> {
  try {
    const mevcut = await listele()
    // Ayni ad+boyut varsa eskisini degistir
    for (const k of mevcut.filter((m) => m.ad === ad && m.boyut === boyut)) {
      await islem('readwrite', (d) => d.delete(k.id))
    }
    await islem('readwrite', (d) => d.add({ ad, boyut, tarih: Date.now(), veri }))
    const guncel = await listele()
    for (const k of guncel.slice(SINIR)) {
      await islem('readwrite', (d) => d.delete(k.id))
    }
  } catch {
    // Kayıt başarısız: özellik sessizce atlanır
  }
}

export async function sil(id: number): Promise<void> {
  try {
    await islem('readwrite', (d) => d.delete(id))
  } catch {
    // yoksay
  }
}

export async function getir(id: number): Promise<SonKayit | undefined> {
  try {
    return (await islem('readonly', (d) => d.get(id))) as SonKayit | undefined
  } catch {
    return undefined
  }
}
