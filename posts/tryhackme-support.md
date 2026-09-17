Bu writeup'ta TryHackMe'deki **Support** odasını çözüyorum. Orta seviye, güzel bir web zinciri sunan bir makine: Hydra ile brute-force'tan başlayıp, tema seçicideki bir **LFI**, çerez üzerinden **yetki yükseltme**, bir API'deki **IDOR** ve son olarak "tarih göster" özelliğine gizlenmiş bir **komut enjeksiyonu (RCE)** ile ilerliyoruz.

Her adımda ne yaptığımın yanında **neden** yaptığımı da yazdım. Takıldığım yerleri ve kafa karıştıran bir parola detayını da sakladım — çünkü asıl öğrenilen kısım orası.

> Not: Flag değerlerini bilerek sansürledim. Amaç cevap anahtarı vermek değil, yöntemi göstermek.

## Oda bilgisi

| | |
|---|---|
| Platform | TryHackMe |
| Oda | Support |
| Zorluk | Orta |
| Konular | LFI · IDOR · Cookie Manipülasyonu · RCE |

---

## 1. Keşif: Nmap

Klasik başlangıç:

```bash
sudo nmap -sS -sV <makine-ip>
```

![Nmap taraması](assets/img/ctf/support/nmap.png)

Sadece iki port açık:

- **22/tcp** — SSH (OpenSSH 9.6p1)
- **80/tcp** — Apache 2.4.58

SSH güncel ve ilgi çekici bir şey yok. Bütün iş **80. porttaki web uygulamasında** demektir.

## 2. Dizin taraması

Web'de hangi dosya ve klasörler var, `feroxbuster` ile bakıyorum:

```bash
feroxbuster -u http://<makine-ip> -w /usr/share/wordlists/dirbuster/directory-list-2.3-medium.txt -x php,txt,bak,zip,js
```

![Feroxbuster dizin taraması](assets/img/ctf/support/dir.png)

İlginç çıktılar var: `index.php`, `config.php`, `api.php`, `dashboard.php`, bir `skins/` klasörü (`default.php`, `green.php`, `red.php`, `blue.php`) ve `includes/skin.php`. Ama `dashboard.php` ve `api.php` beni `index.php`'ye yönlendiriyor — yani **önce giriş yapmam gerekiyor.**

## 3. Giriş duvarı: Hydra ile brute-force

Giriş için bir e-posta lazım. Oda bize zaten `help@support.thm` adresini vermiş. Elimde e-posta var ama parola yok. Bir süre başka yol aradım — ve itiraf edeyim, **brute-force en son aklıma geldi.** CTF'lerde Hydra genelde son çare olduğu için refleks olarak atlamışım. Oysa elimde geçerli bir kullanıcı adı varken denemek mantıklıydı:

```bash
hydra -l help@support.thm -P /usr/share/wordlists/rockyou.txt <makine-ip> http-post-form "/:email=^USER^&password=^PASS^:Invalid credentials"
```

![Hydra brute-force](assets/img/ctf/support/hydra.png)

Parola çıktı: **`snoopy`**. `help@support.thm` / `snoopy` ile giriş yaptım ve panele düştüm.

> `http-post-form` sözdizimi üç parçadan oluşur: `/:gönderilen-veri:hata-mesajı`. `^USER^` ve `^PASS^` denenen değerlerle değişir, `Invalid credentials` ise "başarısız giriş" işaretidir — Hydra bu mesajı **görmediği** cevabı doğru parola sayar.

## 4. Tema seçici → LFI ve config.php

Panelde bir **tema seçme** (Select Theme) özelliği var. Temayı değiştirince adres çubuğunda dikkatimi çeken şey oldu:

```
dashboard.php?skin=green
```

Uygulama, seçilen temayı bir dosya olarak dahil ediyor. Aklıma hemen **LFI** geldi ve dizin taramasında bulduğum `config.php`'yi okumayı denedim:

```
dashboard.php?skin=../config
```

![config.php içeriği](assets/img/ctf/support/config.png)

**Küçük ama kritik detay:** Uzantıyı (`.php`) **yazmadım.** Çünkü uygulama dahil ederken zaten sona `.php` ekliyor (`include("skins/" . $_GET['skin'] . ".php")` gibi). `../config.php` yazsaydım sonuç `../config.php.php` olurdu ve bulunamazdı. Doğrusu `../config` — uzantıyı uygulamaya bıraktım. ([File Inclusion yazımda](post.html?p=file-inclusion-path-traversal) bu "uzantı ekleme" davranışına değinmiştim.)

Config'te bir master parola var: `$MASTER_PASSWORD = 'support@110'`. Aklımda tuttum — ama şu an bunu kullanacağım bir e-posta adresim yok. (Bu değer ilerideki en kafa karıştırıcı kısmın da kaynağı olacak.)

## 5. Çerez manipülasyonu ile yetki yükseltme

Dizin taramasında `api.php` vardı ama beni geri yönlendiriyordu — demek ki yetki gerekiyor. Buraya nasıl ulaşırım diye ararken, tarayıcının depolama sekmesinde çerezlere baktım ve **`isITUser`** adlı çerez dikkatimi çekti. Değeri bir MD5 hash'ine benziyordu:

```
isITUser = 68934a3e9455fa72420237eb05902327
```

CrackStation'a atınca ne olduğu ortaya çıktı:

![MD5 crack — false](assets/img/ctf/support/crackstation.png)

Hash, düz metin **`false`**'un MD5'iydi. Yani uygulama, kullanıcının admin olup olmadığını `md5("true")` / `md5("false")` çerez değeriyle belirliyor — **istemci tarafında, kolayca taklit edilebilir bir şekilde.** O halde `true`'nun MD5'ini üretelim:

![md5("true") üretme](assets/img/ctf/support/md5%20create.png)

```
md5("true") = b326b5062b2f0e69046810717534cb09
```

Bu değeri `isITUser` çerezine yazdım:

![Çerezi değiştirme](assets/img/ctf/support/md5%20put.png)

Sayfayı yenileyince panelde yeni bir kutu belirdi — **IT Admin Panel** ve bir **View API** butonu:

![View API butonu](assets/img/ctf/support/viwe%20api.png)

## 6. API'de IDOR ile admin hesabını bulmak

View API'ye tıklayınca bir iç API karşıma çıktı. "Helpdesk kullanıcısı olarak kendi profilini sorgulayabilirsin: `/user/3`" diyor:

![API /user/3](assets/img/ctf/support/api.php%20fotosu.png)

```
GET /user/3
{
  "email": "help@support.thm",
  "2FA": false,
  "admin": false
}
```

Buradaki açık çok net: API, kullanıcıyı **doğrudan ID ile** getiriyor ve benim sadece kendi ID'me bakabileceğimi kontrol etmiyor. Bu bir **IDOR** (Insecure Direct Object Reference). ID'yi tek tek değiştirip diğer kullanıcıları gezdim. `/user/1`'de aradığımı buldum:

![/user/1 — admin hesabı](assets/img/ctf/support/admin%20mail.png)

```
GET /user/1
{
  "email": "specialadmin@support.thm",
  "2FA": false,
  "admin": true
}
```

`admin: true` olan hesap: **`specialadmin@support.thm`**. Giriş yapacağım hesabı buldum.

## 7. Admin girişi ve `@` gizemi

Elimde admin e-postası var; config'te de `support@110` parolasını görmüştüm. İkisini birleştirip giriş yapmayı denedim — **ama hata verdi.** Burada uzun süre takıldım; parolanın farklı varyasyonlarını, kodlama denemelerini, aklıma gelen her yolu denedim ama bir türlü giremedim. Sonunda internette biraz araştırma yaptıktan sonra doğru parolanın `@` işareti olmadan, düz `support110` olduğunu gördüm ve öyle giriş yaptım.

Peki neden? Açıkçası bu, odanın en tartışmalı kısmı. Topluluğun bir kısmı bunu kasıtlı bir **rabbit hole** (seni oyalamak için konmuş yanıltıcı iz) olarak görüyor; bir kısmı ise `@`'in düşmesinin **tatmin edici bir mantığı olmadığını** düşünüyor. Yani "şu yüzden oldu" diye net bir cevap vermek zor — ve dürüst olmak gerekirse ben de bunu çözerek değil, araştırarak buldum.

En makul teknik açıklama şu: `config.php`'deki `$MASTER_PASSWORD` muhtemelen bir tuzak — giriş kodu parolayı ona göre değil, ayrı bir kullanıcı veritabanına (`db.php` gibi) göre doğruluyor olabilir. O veritabanındaki gerçek değer `@`'siz olduğu için düz `support110` çalışıyor. Ama bunu kesin kanıtlayamadığım için "kesin sebep buydu" demiyorum; pratikte önemli olan, config'te bir değer "yazıyor" diye onu doğru varsaymamak.

`specialadmin@support.thm` / `support110` ile giriş yapınca admin flag'i karşımda:

![Admin flag](assets/img/ctf/support/admin_panel.png)

```
Administrator Access Confirmed
THM{r3d4ct3d}
```

## 8. Date özelliği → Komut Enjeksiyonu (RCE)

Admin panelinde bir de **Date** açılır menüsü var. Seçince sunucunun o anki tarihini gösteriyor:

![Date çıktısı](assets/img/ctf/support/date.png)

Bu bende hemen bir alarm çaldı: eğer sunucu bu tarihi göstermek için gerçekten `date` **komutunu çalıştırıyorsa**, araya kendi komutumu sokabilirim. İsteği Burp ile yakalayıp `sys` parametresine bir komut zinciri ekledim:

![Burp — komut enjeksiyonu](assets/img/ctf/support/burp.png)

```
sys=date;cat /home/ubuntu/user.txt
```

Buradaki `;` mantığı basit: kabuk (shell) `date` komutunu çalıştırır, ardından `;` ile ayrılan ikinci komutu — `cat /home/ubuntu/user.txt` — da çalıştırır. Uygulama girdiyi hiç temizlemediği için ikinci komut sorunsuz koştu ve `user.txt` içeriği cevap içinde geldi:

```
Thu Sep 17 16:45:48 UTC 2026
THM{r3d4ct3d}
```

İki flag de elimizde. Oda tamamlandı.

## Çıkarımlar

Bu odada çıkardığım dersler:

- **LFI her zaman tam dosya adıyla olmaz.** Uygulama uzantıyı kendisi ekliyorsa, dosyayı **uzantısız** vermen gerekir (`../config`, `../config.php` değil). Bu detayı kaçırırsan çalışan bir LFI'yi "çalışmıyor" sanabilirsin.
- **Çerezlere daha dikkatli bakmalıyım.** `isITUser` çerezini fark etmek beni en çok uğraştıran adımdı. İstemci tarafında tutulan yetki bilgisi neredeyse her zaman manipüle edilebilir — çereze, gizli form alanına, yerel depolamaya bakmayı alışkanlık haline getirmeliyim.
- **Hydra'yı erken ele almalıyım.** "Brute-force son çaredir" alışkanlığı yüzünden, elimde geçerli bir kullanıcı adı varken denemeyi geciktirdim. Bazen doğru cevap gerçekten budur.
- **`@` gizemi ve rabbit hole'lar:** Bu kısmı çözemedim, araştırarak buldum — ve topluluk da bunu büyük ölçüde kasıtlı bir yanıltma (rabbit hole) olarak görüyor. Ders şu: bazen bir iz seni oyalamak için oradadır ve saatlerce üstünde durmanın anlamı yoktur. `config.php`'de bir parola "yazıyor" diye onu doğru varsaymak yerine, gerçekten hangi kodun neyi kontrol ettiğine bakmak — ve bir noktada takılınca geri çekilip başka yolu denemek — daha sağlıklı.

## Savunma tarafında bu nasıl kapatılırdı?

- **LFI:** Kullanıcı girdisini dosya yoluna koyma. Temaları bir beyaz listeden seç (`green`, `red`... dışında hiçbir değer kabul edilmesin), `../` gibi dizin geçişlerini engelle.
- **Yetki bilgisini istemciye bırakma.** Admin olup olmama, `md5("true")` gibi tahmin edilebilir bir çerezle değil, **sunucu tarafındaki oturumla** belirlenmeli. Kullanıcının değiştirebildiği hiçbir veri yetki kaynağı olamaz.
- **IDOR:** API, sadece ID'ye bakıp veri döndürmemeli; isteği yapan kullanıcının o kaydı görmeye **yetkisi olup olmadığını** kontrol etmeli.
- **Komut enjeksiyonu:** Kullanıcı girdisini asla doğrudan kabuğa gönderme. Tarih göstermek için sistem komutu çağırmak yerine dilin kendi tarih fonksiyonunu kullan; illa komut gerekiyorsa girdiyi katı bir beyaz listeye sık.
- **Sırları koda gömme.** `config.php`/`db.php` içindeki düz metin parolalar en baştaki hata; tuzak bile olsa, sırlar kaynak dosyalarda durmamalı.

Zincirin her halkası "kolaylık olsun diye" alınmış bir kısayoldu — ve saldırganların en sevdiği şey tam olarak bu kısayollar.
