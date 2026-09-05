Bu yazıda web dünyasının en klasik açıklarından ikisine bakıyoruz: **Path Traversal** ve **File Inclusion (özellikle LFI)**. İkisi de aynı kökten beslenir: uygulama, **kullanıcının verdiği girdiyi doğrudan bir dosya yolu olarak** kullanıyor ve gereken kontrolü yapmıyor.

Bu konu bana yabancı değil — [TryHackMe Recruit writeup'ında](post.html?p=tryhackme-recruit) `file://` wrapper ile tam olarak bir LFI zincirini sömürmüştük. Orada "nasıl yaptık"a bakmıştık; bu yazıda "neden oluyor ve başka nasıl istismar edilir"e iniyoruz.

## Path Traversal nedir?

Path Traversal (dizin geçişi), saldırganın web uygulamasının erişmesi gereken klasörün **dışına çıkıp** sunucudaki başka dosyaları okumasıdır. İşin sırrı `../` ifadesinde: bu, dosya sisteminde **bir üst dizine çık** demektir.

Diyelim uygulama `/var/www/html/` altında çalışıyor ve dosyaları şöyle okuyor:

```
http://hedef.com/index.php?page=hakkimizda.php
```

Eğer `page` parametresi hiç kontrol edilmiyorsa, araya `../` dizileri koyup kök dizine kadar geri çıkabiliriz:

```
http://hedef.com/index.php?page=../../../etc/passwd
```

`/var/www/html/`'den başlarsak:

```
../          → /var/www
../../       → /var
../../../    → /   (kök dizin)
../../../etc/passwd → /etc/passwd
```

Not: buradaki `/etc/passwd` bir **klasör değil, dosyadır** — Linux'ta sistemdeki kullanıcıların listelendiği metin dosyası. Okuma yetkisi herkese açık olduğu için Path Traversal / LFI testlerinde "kanıt dosyası" olarak kullanılır. Kaç tane `../` gerektiğini tam bilmesen de sorun değil; fazladan koymak zarar vermez, çünkü kök dizinin (`/`) üstüne çıkamazsın — `../` orada durur.

## File Inclusion: LFI vs RFI

**File Inclusion**, uygulamanın çalışma zamanında başka bir dosyayı "dahil etmesi"dir. İki türü var:

- **LFI (Local File Inclusion):** Sunucudaki **yerel** bir dosya dahil edilir.
- **RFI (Remote File Inclusion):** **Uzaktan** (örneğin saldırganın sunucusundan) bir dosya çekilip dahil edilir.

Bu yazıda LFI'ye odaklanıyoruz; **RFI'yi ayrı bir yazıda detaylıca ele alacağım.**

## LFI neden oluşur?

LFI, çoğunlukla PHP'nin dosya işleyen fonksiyonlarının kullanıcı girdisiyle **kontrolsüz** beslenmesinden doğar. Başlıca suçlular:

```php
include($_GET['page']);
require($_GET['page']);
include_once(...);  require_once(...);
file_get_contents($_GET['file']);
readfile(...);  fopen(...);
```

Kritik fark şu: `include` ve `require`, dahil ettikleri dosyanın içindeki **PHP kodunu çalıştırır**. `file_get_contents` / `readfile` ise dosyayı sadece **okur**. Bu ayrım ileride "LFI → RCE" kısmında önemli olacak.

Örneğin şöyle bir kod:

```php
<?php
  $page = $_GET['page'];
  include($page);   // hiçbir kontrol yok!
?>
```

Burada `page` parametresine ne verirsek, PHP onu dosya yolu sanıp açmaya çalışır. Kontrol olmadığı için sunucudaki (yetkimizin yettiği) dosyalara ulaşabiliriz.

## LFI'yi sömürme ve filtre atlatma (bypass)

Geliştiriciler bu açığı bilir ve önlem almaya çalışır. Ama zayıf önlemler kolayca atlatılır. İşte en yaygın bypass teknikleri:

### 1. `../` filtreleniyorsa → iç içe (nested) kullan

Basit bir savunma, girdideki `../` ifadesini silmektir. Ama bu silme işlemi çoğu zaman **tek seferlik ve özyinelemesiz** yapılır — yani metni bir kez tarar, bulduğu `../`'leri çıkarır ve durur. Bunu şöyle atlatırız:

```
....//
```

Filtre ortadaki `../`'yi silince, geriye yine bir `../` kalır:

```
....//   →  (filtre "../" siler)  →  ../
```

Aynı mantıkla `..././` gibi varyasyonlar da iş görür. Kilit fikir: **filtre bir kez temizliyorsa, temizlik sonrası yeni bir `../` ortaya çıkacak şekilde payload kur.**

### 2. Dosya uzantısı zorla ekleniyorsa → null byte (`%00`)

Bazı uygulamalar girdinin sonuna zorla bir uzantı ekler:

```php
include($_GET['page'] . ".php");   // sona .php ekliyor
```

Bu durumda `/etc/passwd` istesek bile sunucu `/etc/passwd.php` arar ve bulamaz. Eski PHP sürümlerinde (**5.3.4 öncesi**) bunu **null byte** ile atlatabiliyorduk:

```
../../../etc/passwd%00
```

`%00` (null byte), C dilinde string sonu demektir; sunucu onu görünce sonrasını (`.php`) yok sayar ve `/etc/passwd`'i açar. **Önemli uyarı:** Bu açık modern PHP'de kapatıldı, artık çalışmaz. Ama eski/CTF sistemlerinde hâlâ karşına çıkabilir, o yüzden bilmekte fayda var.

### 3. Yol/uzantı takılırsa → path truncation ve sondaki `/.`

Bir başka eski teknik **path truncation** (yol kırpma). PHP'nin yol uzunluğu sınırından faydalanıp, sona eklenen uzantıyı işlevsiz bırakmaktır. Bunu, yolun sonuna anlamsız ama geçerli parçalar ekleyerek yaparız:

```
../../../etc/passwd/.
../../../etc/passwd/./././././  ... (çok sayıda)
../../../etc/passwd\0
```

Sondaki `/.` "aynı dizin" anlamına gelir ve yolu değiştirmez ama bazı normalizasyon/uzantı kontrollerini şaşırtır. Çok sayıda `/./` ile yol, sistemin sınırını aşınca sona eklenen `.php` "taşar" ve devre dışı kalır. Bu da yine **eski PHP'ye özgü** bir davranıştır; modern sistemlerde büyük ölçüde kapalıdır.

### 4. Kaynak kodu okumak → `php://filter`

LFI'nin en güçlü kullanımlarından biri, `.php` dosyalarının **kaynak kodunu** çalıştırmadan okumaktır. Normalde `include` bir PHP dosyasını çalıştırır, içeriğini göremezsin. `php://filter` wrapper'ı ile dosyayı base64'e çevirip okuyabilirsin:

```
php://filter/convert.base64-encode/resource=dashboard.php
```

Dönen base64'ü decode edince kaynak kodu elde edersin. (Recruit odasında `dashboard.php`'nin içindeki SQL sorgusunu görmek işimizi ne kadar kolaylaştırmıştı — aynı mantık.)

### 5. `file://` wrapper

Yerel bir dosyayı mutlak yolla okumak için:

```
file:///var/www/html/config.php
```

Recruit writeup'ında `config.php` içindeki HR parolasını tam olarak böyle çekmiştik. Uygulama "sadece yerel dosya" diyorsa, çoğu zaman beklediği şey budur.

## LFI'den RCE'ye (kod çalıştırma)

Burada önemli bir terim inceliği var: LFI ile dosya yüklemenin birleşmesi çoğu zaman **RFI ile karıştırılır**, ama bu aslında **LFI → RCE** senaryosudur ve RFI'dan farklıdır.

Site bir şekilde **dosya yüklemeye izin veriyorsa** (örneğin profil resmi yüklenen bir alan) ve içine PHP kodu gömülü bir dosya (örneğin sahte bir `.jpg`) yüklenebiliyorsa, ardından LFI ile **o dosya `include` edildiğinde** içindeki PHP kodu sunucuda çalışır. İşte bu noktada okuma açığı, **komut çalıştırmaya (RCE)** dönüşür.

Bunun RFI'dan farkı şu: RFI'da dosya **uzaktan** çekilir; burada ise dosya zaten **sunucuya yüklenmiş yerel** bir dosyadır ve LFI onu çalıştırır. İkisi de RCE'ye götürebilir ama izledikleri yol farklıdır. Klasik LFI→RCE yöntemleri — dosya upload, log poisoning, `/proc/self/environ` — ayrı bir yazının konusu olacak.

## Path Traversal ile LFI farkı

İkisi çok karıştırılır, netleştirelim:

| | Amaç | Sonuç |
|---|---|---|
| **Path Traversal** | Dizin dışına çıkıp dosya **okumak** | Hassas dosya içeriği ifşa olur |
| **LFI** | Dosyayı uygulamaya **dahil etmek** | İçerik okunur *ve* (PHP ise) çalıştırılabilir |

Kabaca: **Path Traversal okur, LFI dahil eder/çalıştırır.** LFI çoğu zaman Path Traversal'ı da içinde barındırır (dosyaya ulaşmak için `../` kullanır).

## Nasıl test edilir?

Şüphelenilecek parametreler, bir dosya adı taşıyor gibi görünenlerdir:

```
?page=      ?file=      ?path=      ?doc=
?template=  ?lang=      ?include=   ?view=
```

Test yaklaşımı:

1. Önce zararsız bir dosyayla dene (`?page=hakkimizda.php` gibi normal davranışı gör)
2. `../../../etc/passwd` gönder → içerik gelirse açık var
3. Gelmiyorsa bypass'ları sırayla dene (`....//`, `%00`, `php://filter`, `file://`)
4. Kaynak kod okuyabiliyorsan `php://filter` ile config/dashboard dosyalarını çek

## Nasıl savunulur?

- **Kullanıcı girdisini asla doğrudan dosya yolu yapma.** En temel kural bu.
- **Beyaz liste (whitelist) kullan.** Kullanıcı serbest dosya adı yazmasın; izin verilen dosyaların sabit bir listesinden seçsin (örn. `1 → hakkimizda.php`).
- **`basename()` uygula.** Girdideki dizin bilgisini temizler, sadece dosya adını bırakır.
- **Kara liste ile filtreleme yetmez.** Sadece `../` silmek atlatılır (yukarıda gördük). Doğru çözüm beyaz listedir.
- **Wrapper'ları kapat.** `allow_url_include` ve `allow_url_fopen` kapalı olsun (RFI ve uzak wrapper'ları engeller).
- **Yetki ve izolasyon.** Web sunucusu, ihtiyacı olmayan dosyalara erişememeli (open_basedir, en az yetki prensibi).

## Özet

Path Traversal ve LFI, aynı hatanın iki yüzü: **güvenilmeyen girdinin dosya yolu olarak kullanılması.** Test ederken "girdim bir dosya yoluna mı dönüşüyor" sorusuna, savunurken "bu girdiyi neden serbest bırakıyorum" sorusuna odaklan.

Bir sonraki yazıda **RFI'yi** detaylıca ele alacağım — uzaktan dosya dahil etmenin nasıl doğrudan komut çalıştırmaya gittiğinden bahsedeceğiz.
