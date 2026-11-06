import { defineConfig, type Plugin } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import { viteStaticCopy } from 'vite-plugin-static-copy'

/**
 * @mlightcad kütüphane yamaları (mtext-renderer 0.13.7, data-model).
 * Her yama derleme sırasında kaynağa uygulanır. Kalıp bulunamazsa ya da hedef
 * dosya derlemeye hiç girmezse derleme durur (kütüphane güncellenince yama
 * sessizce düşmesin diye).
 */
interface Yama {
  ad: string
  eski: string
  yeni: string
}

const YAMALAR: Record<string, Yama[]> = {
  '@mlightcad/mtext-renderer/dist/index.js': [
    {
      // AutoCAD başlıkları sıkça `{\W8;    }BAŞLIK` biçiminde başa genişletilmiş
      // boşluk koyarak sağa iter. Sola hizalı satır ilk görünen harfin kenarına
      // çekildiği için bu boşluklar yok sayılıyordu. AutoCAD satırı kalem
      // başlangıcından hizalar.
      ad: 'satır başı boşlukları',
      eski: 'const l = Number.isFinite(this.maxLineWidth) ? this._currentLeftMargin - r.min.x : this._currentLeftMargin;',
      yeni: 'const l = this._currentLeftMargin;'
    },
    {
      // Harfler "yükseklik × yazı tipi ölçeği" ile çiziliyor, boşluk ise ölçeksiz
      // yükseklikle ölçülüyordu (Arial'de boşluklar ~%30 dar). Aynı ölçek uygulanır.
      ad: 'boşluk genişliği ölçeği',
      eski: 'calculateBlankWidthForFont(e, n) {\n    const r = this.fontManager.getCharShape(" ", e, n);',
      yeni: 'calculateBlankWidthForFont(e, n) {\n    n = n * (this.fontManager.getFontScaleFactor(e) || 1);\n    const r = this.fontManager.getCharShape(" ", e, n);'
    }
  ],
  '@mlightcad/data-model/lib/base/AcDbDxfStringChunks.js': [
    {
      // DXF metnindeki `\U+nnnn` kaçışları 4-8 hane açgözlü okunuyordu:
      // `D\U+00D6\U+015EEME` (DÖŞEME) içinde `015EE` alınıp Ş yerine anlamsız
      // bir karakter çıkıyor, ardından gelen E yutuluyordu. AutoCAD tam 4 hane
      // yazar; 8 hane yalnız BMP dışı kod noktaları (0001xxxx-0010xxxx) için.
      ad: 'DXF \\U+ kaçışı 4 hane',
      eski: `    return value.replace(/\\\\U\\+([0-9A-Fa-f]{4,8})/gi, function (match, hex) {
        var cp = Number.parseInt(hex, 16);`,
      yeni: `    return value.replace(/\\\\U\\+(?:(000[1-9A-Fa-f][0-9A-Fa-f]{4}|0010[0-9A-Fa-f]{4})|([0-9A-Fa-f]{4}))/gi, function (match, uzun, kisa) {
        var cp = Number.parseInt(uzun || kisa, 16);`
    }
  ],
  '@mlightcad/three-renderer/dist/index.js': [
    {
      // Yazı içi `\C0` (ByBlock) rengi zeminden bağımsız sabit beyaz veriliyordu:
      // açık zeminde beyaz üstüne beyaz, görünmez (VARIOCLIC, CEPHE D gibi
      // başlıklar). AutoCAD model alanında ByBlock'u ACI 7 gibi gösterir, yani
      // zemine göre siyah/beyaz.
      ad: 'yazı içi ByBlock rengi zemine göre',
      eski: 'l = r.isByBlock ? s : 16777215;',
      yeni: 'l = r.isByBlock ? s : Ce(t);'
    },
    {
      // Malzeme önbelleği anahtarı simgesel renk ("ByBlock"); oysa ByBlock'un
      // gerçek rengi zemine göre değişiyor. Koyu zeminde oluşan beyaz malzeme
      // açık zeminde yeniden açılan çizimde de kullanılıyordu. Anahtara zemin eklenir.
      ad: 'ByBlock malzeme önbelleği zemine göre',
      eski: `    const t = e.isColorByLayer, i = e.color.toString();
    return t == null ? i : \`\${i}_\${t ? "bylayer" : "explicit"}\`;`,
      yeni: `    const t = e.isColorByLayer, i = e.color.toString() + (e.color.isByBlock ? "_zemin" + this.options.currentBackgroundColor : "");
    return t == null ? i : \`\${i}_\${t ? "bylayer" : "explicit"}\`;`
    }
  ],
  '@mlightcad/graphic-interface/lib/AcGiContext.js': [
    {
      // Çözülemeyen ByLayer/ByBlock rengi (ör. blok içi ByBlock ölçü ve yazılar)
      // zeminden bağımsız beyaza düşüyordu; açık zeminde görünmüyordu.
      ad: 'ByBlock/ByLayer yedek rengi zemine göre',
      eski: `            backgroundIsDark: !acgiIsLightBackground(backgroundColor),
            fallbackRgb: 0xffffff`,
      yeni: `            backgroundIsDark: !acgiIsLightBackground(backgroundColor),
            fallbackRgb: acgiIsLightBackground(backgroundColor) ? ACGI_LIGHT_THEME_FOREGROUND : ACGI_DARK_THEME_FOREGROUND`
    }
  ],
  '@mlightcad/data-model/lib/entity/AcDbMLeader.js': [
    {
      // Çoklu kılavuzun yatay kırılma çizgisi (dogleg) "içerik başlangıç
      // noktası"na kadar çekiliyordu. Yazı sola doğru uzanınca o nokta yazının
      // öbür ucuna düştüğü için çizgi yazının içinden geçiyordu. AutoCAD çizgiyi
      // dogleg yönü × uzunluğu kadar çizer; o bilgi yoksa eski davranışa dönülür.
      ad: 'kılavuz kırılma çizgisi',
      eski: `        var contentBase = this.contentBasePosition;
        if (contentBase && !contentBase.equals(start)) {
            return [start, contentBase.clone()];
        }
        var vector = (_c = leader.doglegVector) !== null && _c !== void 0 ? _c : this._doglegVector;
        var length = (_d = leader.doglegLength) !== null && _d !== void 0 ? _d : this.getResolvedDoglegLength();
        if (length == null || length === 0 || vector.lengthSq() === 0) {
            return undefined;
        }`,
      yeni: `        var contentBase = this.contentBasePosition;
        var vector = (_c = leader.doglegVector) !== null && _c !== void 0 ? _c : this._doglegVector;
        var length = (_d = leader.doglegLength) !== null && _d !== void 0 ? _d : this.getResolvedDoglegLength();
        if (length == null || length === 0 || !vector || vector.lengthSq() === 0) {
            if (contentBase && !contentBase.equals(start)) {
                return [start, contentBase.clone()];
            }
            return undefined;
        }`
    }
  ]
}

function kutuphaneYamalari(): Plugin {
  const uygulanan = new Set<string>()
  return {
    name: 'kutuphane-yamalari',
    enforce: 'pre',
    transform(kod, id) {
      const yol = id.replace(/\\/g, '/')
      const hedef = Object.keys(YAMALAR).find((h) => yol.includes(h))
      if (!hedef) return null
      let yeni = kod.replace(/\r\n/g, '\n')
      for (const y of YAMALAR[hedef]) {
        if (!yeni.includes(y.eski)) {
          throw new Error(`Kütüphane yaması uygulanamadı (${y.ad}): kalıp bulunamadı, kütüphane değişmiş olabilir`)
        }
        yeni = yeni.replace(y.eski, y.yeni)
      }
      uygulanan.add(hedef)
      return { code: yeni, map: null }
    },
    buildEnd(hata) {
      if (hata) return
      const eksik = Object.keys(YAMALAR).filter((h) => !uygulanan.has(h))
      if (eksik.length) throw new Error(`Kütüphane yaması hedefi derlemeye girmedi: ${eksik.join(', ')}`)
    }
  }
}

const viewerDist = './node_modules/@mlightcad/cad-simple-viewer/dist'
const dwgDist = './node_modules/@mlightcad/libredwg-converter/dist'

export default defineConfig({
  base: './',
  build: {
    modulePreload: false,
    chunkSizeWarningLimit: 6000
  },
  optimizeDeps: {
    // Yama dev sunucusunda da uygulansın diye önceden paketlenmez
    exclude: ['@mlightcad/mtext-renderer']
  },
  plugins: [
    kutuphaneYamalari(),
    viteStaticCopy({
      targets: [
        { src: `${viewerDist}/mtext-renderer-worker.js`, dest: 'workers', rename: { stripBase: true } },
        { src: `${dwgDist}/libredwg-parser-worker.js`, dest: 'workers', rename: { stripBase: true } },
        { src: `${dwgDist}/libredwg-web.wasm`, dest: 'workers', rename: { stripBase: true } }
      ]
    }),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      manifest: {
        name: 'DWG Görüntüleyici',
        short_name: 'DWG',
        description: 'Çevrimdışı çalışan DWG/DXF görüntüleyici',
        lang: 'tr',
        display: 'standalone',
        orientation: 'any',
        start_url: './',
        scope: './',
        background_color: '#111418',
        theme_color: '#111418',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,wasm,shx,woff,ttf,json,png,svg,webmanifest,ico}'],
        maximumFileSizeToCacheInBytes: 30 * 1024 * 1024,
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true
      }
    })
  ]
})
