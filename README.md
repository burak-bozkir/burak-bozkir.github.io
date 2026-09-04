# CyberBlog

Siber güvenlik yazıları için statik blog. Kurulum, derleme ya da Node.js gerekmez —
yazıları `posts/` klasörüne **Markdown** olarak eklersin, site kalanını halleder.
Tüm kütüphaneler `assets/vendor/` içinde yerel olarak duruyor; site internetsiz de çalışır.

```
CyberBlog/
├── index.html          # Ana sayfa (yazı listesi, arama, etiket filtresi)
├── post.html           # Tek yazı görüntüleyici
├── assets/
│   ├── css/style.css   # Tüm tasarım — renkler en üstteki değişkenlerde
│   ├── js/app.js       # Liste + Markdown render mantığı
│   ├── vendor/         # marked + highlight.js + DOMPurify (yerel kopya, dokunma)
│   └── img/            # Yazılarda kullanacağın görseller
├── posts/
│   ├── index.json      # YAZI LİSTESİ — her yeni yazıda buraya kayıt eklenir
│   ├── _sablon.md      # Yeni yazı şablonu (kopyala-yapıştır)
│   └── *.md            # Yazıların
└── .nojekyll           # GitHub Pages'in dosyaları olduğu gibi sunması için
```

---

## 1. Siteyi bilgisayarında açmak

⚠️ `index.html`'e **çift tıklama.** Site yazıları `fetch` ile okuduğu için `file://`
üzerinden çalışmaz. Küçük bir yerel sunucu gerekir.

Bu klasörde bir terminal (PowerShell) aç ve şunu çalıştır:

```powershell
python -m http.server 8000
```

Sonra tarayıcıda: **http://localhost:8000**

Durdurmak için terminalde `Ctrl + C`.

> Python kurulu değilse: https://www.python.org/downloads/ — kurulumda
> "Add python.exe to PATH" kutusunu işaretle.

---

## 2. Yeni yazı eklemek (3 adım)

**Adım 1 —** `posts/_sablon.md` dosyasını kopyala, adını yazının kısa adıyla değiştir.
Dosya adı kuralı: sadece küçük harf, rakam ve tire. Türkçe karakter ve boşluk kullanma.

```
posts/burp-suite-kurulumu.md
```

**Adım 2 —** Dosyanın içini yaz. Markdown biliyorsan zaten hazırsın; bilmiyorsan şablon
içindeki örnekler yeterli. Başlığı dosyanın içine yazmana gerek yok — o `index.json`'dan geliyor.

**Adım 3 —** `posts/index.json` dosyasının **en üstüne** yeni kaydı ekle:

```json
[
  {
    "slug": "burp-suite-kurulumu",
    "title": "Burp Suite Kurulumu ve İlk Ayarlar",
    "date": "2026-09-10",
    "summary": "Proxy'yi tarayıcıya bağlamak, sertifika kurmak ve ilk isteği yakalamak.",
    "tags": ["Burp Suite", "Araçlar", "Web Security"]
  },
  ...
]
```

Alanların anlamı:

| Alan | Açıklama |
|---|---|
| `slug` | Dosya adının `.md`'siz hali. **Birebir aynı olmalı.** |
| `title` | Sayfada görünen başlık |
| `date` | `YYYY-AA-GG` formatında. Liste tarihe göre yeniden eskiye sıralanır. |
| `summary` | Kartta görünen 1-2 cümlelik özet |
| `tags` | Etiketler. Ana sayfada otomatik filtre butonu olur. |

⚠️ JSON'da kayıtlar arasına **virgül** koymayı unutma, sonuncudan sonra virgül **olmayacak**.
Sayfa boş geliyorsa ilk şüphelenilecek yer burasıdır.

---

## 3. GitHub Pages'te yayınlamak

### İlk kurulum (bir kez)

1. https://github.com adresinde hesabına gir → sağ üstten **New repository**.
2. Repository adı: **`kullaniciadin.github.io`** (kendi kullanıcı adınla, birebir bu formatta).
3. **Public** seç, başka hiçbir kutuyu işaretleme → **Create repository**.
4. Bilgisayarında bu klasörde terminal aç:

```powershell
git init
git add .
git commit -m "İlk yayın"
git branch -M main
git remote add origin https://github.com/KULLANICIADIN/KULLANICIADIN.github.io.git
git push -u origin main
```

5. GitHub'da repo sayfasında **Settings → Pages** → Source: **Deploy from a branch**,
   Branch: **main / (root)** → **Save**.
6. 1-2 dakika sonra sitesi yayında: **https://kullaniciadin.github.io**

> Git kurulu değilse: https://git-scm.com/downloads

### Her yeni yazıdan sonra

```powershell
git add .
git commit -m "Yeni yazı: Burp Suite kurulumu"
git push
```

Push'tan ~1 dakika sonra site kendini günceller.

---

## 4. Kişiselleştirme

| Ne | Nerede |
|---|---|
| Site adı, hero yazısı, "Hakkında" metni | `index.html` |
| Renkler (açık + koyu tema) | `assets/css/style.css` en üstteki `:root` ve `[data-theme="dark"]` blokları |
| Vurgu rengi | `--accent` değişkeni — tek satır değiştirince tüm site değişir |
| Varsayılan tema | `index.html` ve `post.html` içindeki `<html lang="tr" data-theme="dark">` |
| Favicon / sekme ikonu | Aynı satırlardaki `<link rel="icon" ...>` — emojiyi değiştir |

---

## Sorun giderme

| Belirti | Sebep |
|---|---|
| "Yazılar yüklenemedi" | Siteyi yerel sunucu olmadan açtın (bkz. bölüm 1) veya `index.json` bozuk |
| Yazıya tıklayınca "yazı yüklenemedi" | `slug` ile `.md` dosya adı birebir aynı değil |
| Tarih yanlış görünüyor | `date` alanı `YYYY-AA-GG` formatında değil |
| GitHub Pages'te sayfa boş | Repo adı `kullaniciadin.github.io` değil ya da Pages ayarı kaydedilmemiş |

---

## 5. SEO ve arama motorları

Site temel SEO için hazır: `sitemap.xml`, `robots.txt`, Open Graph etiketleri ve her yazıya özel başlık/açıklama var.

### Yeni yazı eklerken sitemap'i güncelle

`sitemap.xml` dosyasını aç, mevcut bir `<url>` bloğunu kopyalayıp yeni yazının bilgileriyle doldur:

```xml
  <url>
    <loc>https://burak-bozkir.github.io/post.html?p=YENI-SLUG</loc>
    <lastmod>2026-09-10</lastmod>
    <priority>0.8</priority>
  </url>
```

`YENI-SLUG` = yazının `index.json`'daki slug'ı. (Zorunlu değil ama Google yeni yazıyı daha hızlı bulur.)

### Google Search Console'a ekleme (trafik + indeksleme takibi)

1. https://search.google.com/search-console adresine Google hesabınla gir
2. **URL prefix** seç → `https://burak-bozkir.github.io/` yaz
3. Doğrulama yöntemi: **HTML tag** seç → sana bir `<meta name="google-site-verification" ...>` satırı verir
4. O satırdaki `content` kodunu kopyala, `index.html` içindeki şu yorumlu satıra yapıştır ve yorumu (`<!--` ve `-->`) kaldır:

```html
<meta name="google-site-verification" content="BURAYA_KODUN">
```

5. Push at, sonra Search Console'da **Verify**'a bas
6. Doğrulandıktan sonra: **Sitemaps** menüsüne git → `sitemap.xml` yaz → Submit

Birkaç gün içinde hangi aramalarda çıktığını, kaç tıklama aldığını görürsün.

---

## 6. Ziyaretçi sayacı (GoatCounter — ücretsiz, gizlilik dostu)

Kaç kişi geldiğini, hangi sayfanın popüler olduğunu görmek için:

1. https://www.goatcounter.com/ → ücretsiz hesap aç, bir kod (site adı) belirle (örn. `cyberblog`)
2. Sana verdiği script satırını `index.html` ve `post.html` dosyalarında `</body>`'den hemen önce ekle:

```html
<script data-goatcounter="https://SENIN-KODUN.goatcounter.com/count"
        async src="//gc.zgo.at/count.js"></script>
```

3. Push at. Panelinden ziyaretleri canlı izlersin.

> Not: GoatCounter çerez kullanmaz, KVKK/GDPR uyumludur — çerez uyarısı eklemene gerek kalmaz. Google Analytics'e göre çok daha basit.
