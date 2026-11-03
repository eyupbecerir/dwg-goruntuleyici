# DWG Görüntüleyici

Çevrimdışı çalışan, dokunmatik ekran için tasarlanmış DWG/DXF görüntüleyici (PWA).
Dosyalar yalnızca tarayıcıda açılır, hiçbir yere gönderilmez. Reklam, analitik ve
çalışma anında dış ağ isteği yoktur.

## Özellikler

- Dosya aç (`.dwg`, `.dxf`), tek parmakla kaydırma, iki parmakla yakınlaştırma
- Sığdır, +, − düğmeleri
- Ölç: A ve B noktasına dokunun; mesafe, ΔX ve ΔY gösterilir
- Koyu / Açık arka plan (açıkta beyaz renkli nesneler siyah görünür), tercih hatırlanır
- Son açılanlar: son 8 dosya cihazda (IndexedDB) saklanır, dosya seçici olmadan yeniden açılır

## Tablete kurulum

1. Siteyi internet varken bir kez açın.
2. Tarayıcı menüsünden "Ana ekrana ekle" deyin.
3. Bundan sonra internet olmadan da çalışır (tüm dosyalar, yazı tipleri ve DWG çözücü önbelleğe alınır).

## Geliştirme

```
npm install
npm run dev        # geliştirme sunucusu
npm run build      # dist/ klasörüne üretim derlemesi
npm run preview    # dist/ klasörünü 4173 portunda sunar
npm run test       # uçtan uca test (önce build gerekir), ekran görüntüleri test/ekran/ altına
```

Test ilk kez çalışmadan önce: `npx playwright install chromium`

Kod `base: './'` ile derlenir, yani GitHub Pages gibi bir alt yola konabilir.

## Yapı

- `src/` uygulama kodu (düz TypeScript, çerçevesiz)
- `public/fonts/` yazı tipleri (SHX ve Arial/Tahoma/Verdana WOFF). Çok büyük Çince TTF/WOFF yazı tipleri dahil değildir
- `ornekler/` test için örnek çizimler (derlemeye girmez)
- `test/run.mjs` Playwright testi

## Lisans

Bu proje GPL-3.0 ile lisanslıdır (`LICENSE`). DWG okumak için GPL lisanslı
LibreDWG tabanlı `@mlightcad/libredwg-converter` kullanılır. Görüntüleme çekirdeği
`@mlightcad/cad-simple-viewer` MIT lisanslıdır. Yazı tipleri
`mlightcad/cad-data` deposundan alınmıştır.
