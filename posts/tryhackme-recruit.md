Bu yazıda TryHackMe'deki **Recruit** odasını baştan sona çözüyorum. Oda güzel bir web zinciri sunuyor: dizin taramasında sızan bir log dosyasından başlayıp, `file://` wrapper ile Local File Inclusion (LFI), oradan sızdırılan kimlik bilgileri ve son olarak Union-based SQL Injection ile admin hesabını ele geçirmeye kadar gidiyoruz.

Her adımda sadece "ne yaptığımı" değil, **neden o adımı attığımı** da yazdım — çünkü asıl öğrenilen kısım orası. Yeni başlıyorsan takip etmen kolay olsun diye takıldığım yerleri de sakladım.

> Not: Flag değerlerini ve gerçek parolayı bilerek sansürledim. Amaç cevap anahtarı vermek değil, yöntemi göstermek.

## Oda bilgisi

| | |
|---|---|
| Platform | TryHackMe |
| Oda | Recruit |
| Tema | Web · LFI · SQL Injection |
| Zorluk | Kolay–Orta |

---

## 1. Hazırlık: hedefi /etc/hosts'a ekle

Oda bir alan adı (`recruit.thm`) üzerinden çalışıyor. Tarayıcının ve araçların bu ismi hedef IP'ye çözebilmesi için ilk iş onu `hosts` dosyasına eklemek:

```bash
echo "10.10.X.X  recruit.thm" | sudo tee -a /etc/hosts
```

Artık `recruit.thm` yazdığımda doğrudan makineye gidiyor.

## 2. Keşif (Recon): Nmap

Klasik başlangıç. Açık portlara ve servis sürümlerine bakıyorum:

```bash
nmap -sC -sV -oN nmap.txt recruit.thm
```

![Nmap tarama çıktısı](assets/img/ctf/recruit/nmap.png)

Sonuç:

- **22/tcp** — SSH (OpenSSH 8.2p1)
- **53/tcp** — DNS (ISC BIND 9.16.1)
- **80/tcp** — Apache 2.4.41, sayfa başlığı *Recruit*

Açıkçası Nmap tarafında dikkat çeken bir zafiyet yok. SSH güncel, ilginç bir şey görünmüyor. Bu durumda asıl hedef net: **80. porttaki web uygulaması.**

## 3. Dizin taraması (Enumeration)

Web uygulamasında hangi sayfalar/klasörler var, görelim:

```bash
gobuster dir -u http://recruit.thm -w /usr/share/wordlists/seclists/Discovery/Web-Content/common.txt
```

![Gobuster dizin taraması](assets/img/ctf/recruit/dizin.png)

Bulunanlar arasında birkaç ilginç yer var: `index.php`, `phpmyadmin`, `assets`, `javascript` ve en dikkat çekeni — **`mail`** klasörü. Bir işe alım portalında açıkta duran bir `mail` klasörü kesinlikle bakılması gereken bir yer.

## 4. Sızan log dosyası: mail.log

`mail` klasörüne gittiğimde içeride bir `mail.log` dosyası buldum:

![mail.log içeriği](assets/img/ctf/recruit/mail.png)

Bu log, bir dağıtım (deployment) onay e-postasını gösteriyor ve iki kritik bilgi sızdırıyor:

- **HR kullanıcısı** var (kullanıcı adı: `hr`)
- HR giriş bilgileri, kolaylık olsun diye **`config.php` dosyasının içinde** saklanıyor
- Admin bilgileri ise dosyada değil, veritabanında tutuluyor

Bir şekilde `config.php` dosyasının içeriğini okumam gerekiyor.

## 5. API sayfası ve gizli LFI

Ana sitede gezinirken `api.php` sayfasına denk geldim. Burası bir SSS (FAQ) sayfası ve "Aday CV'sini API ile nasıl çekerim?" sorusunun cevabı çok ilginç:

![api.php — CV çekme endpoint'i](assets/img/ctf/recruit/site1.png)

Cevap şu endpoint'i veriyor:

```
/file.php?cv=<URL>
```

Yani `file.php` bize verdiğimiz bir adresten dosya çekiyor. İlk aklıma gelen normal bir URL denemek oldu ama şu cevabı aldım:

![Only local files are allowed](assets/img/ctf/recruit/api.png)

> **Only local files are allowed** (Sadece yerel dosyalara izin verilir)

## 6. Takıldığım yer: file:// wrapper

İşte tam burada takıldım. "Sadece yerel dosya" diyor ama nasıl bir yerel dosya istiyor? Normal `http://` adresi çalışmadı.

Bir süre uğraştıktan sonra öğrendiğim şey şu oldu: PHP'de yerel bir dosyayı okumak için **`file://` wrapper** kullanılıyor. Uygulama muhtemelen adresin başında `file://` olup olmadığına bakıyor. Yani bu bir **Local File Inclusion (LFI)** zafiyeti.

İkinci takıldığım nokta da şuydu: `config.php` tam olarak nerede? Apache'nin varsayılan web kök dizini `/var/www/html/` — bunu ilk anda düşünemedim. Bir web dosyası genelde orada durur. İkisini birleştirince adresim ortaya çıktı:

```
http://recruit.thm/file.php?cv=file:///var/www/html/config.php
```

> Küçük detay: `file://` + `/var/...` mutlak yolu olduğu için toplam üç slash görüyorsun (`file:///var/...`). Kafa karıştırıcı ama doğrusu bu.

Ve `config.php` karşımızda:

![config.php içeriği — HR parolası](assets/img/ctf/recruit/config.png)

Dosyanın içinde HR kullanıcısının parolası açıkça yazıyor (`$HR_PASSWORD = '...'`). Log dosyasının söylediği şey doğruymuş.

## 7. HR olarak giriş ve ilk flag

Elde ettiğim `hr` kullanıcı adı ve parolayla giriş sayfasından oturum açtım. Karşıma **Candidate Applications** (Aday Başvuruları) paneli çıktı:

![HR dashboard ve ilk flag](assets/img/ctf/recruit/dashboard.png)

Sayfanın üstünde ilk flag duruyor:

```
HR Flag: THM{r3d4ct3d}
```

Panelde bir de **aday arama** kutusu var. Bir arama alanı görünce refleks olarak akla ne gelmeli? SQL Injection. Ama körlemesine denemek yerine, elimde çok güzel bir avantaj var: aynı LFI ile bu sayfanın **kaynak kodunu** da okuyabilirim.

## 8. SQL sorgusunu kaynaktan okumak

`dashboard.php`'yi de aynı LFI tekniğiyle okudum:

```
http://recruit.thm/file.php?cv=file:///var/www/html/dashboard.php
```

![dashboard.php içindeki SQL sorgusu](assets/img/ctf/recruit/search-code.png)

Kod şunu gösteriyor:

```php
$search = $_GET['search'];
$query  = "SELECT * FROM candidates WHERE name LIKE '%$search%'";
```

Kullanıcının girdiği `search` değeri, hiçbir temizleme yapılmadan doğrudan sorgunun içine gömülüyor. Kaynağı görmek işimi çok kolaylaştırdı — kaç sütun olduğunu, tırnakların nasıl kapandığını tahmin etmek zorunda kalmadım. Sorgu tek tırnak (`'`) ile string kuruyor, yani enjeksiyonu tek tırnakla kıracağım.

## 9. Enjeksiyonu doğrulamak

Önce basit bir tek tırnak göndererek sorguyu bilerek bozuyorum:

```
alice'
```

![Tek tırnak ile SQL hatası](assets/img/ctf/recruit/sqli-1.png)

Sayfa güzelce bir MySQL syntax hatası döndürüyor. Bu iki şeyi kanıtlıyor: enjeksiyon çalışıyor **ve** uygulama hataları ekrana basıyor. Yani hem **error-based** hem **union-based** kullanılabilir. Ben union-based ile gittim, çünkü veriyi tablo halinde tek seferde çekmek daha temiz.

## 10. Union-based SQLi ile veri çekme

Kaynaktan sorgunun 4 sütun döndürdüğünü biliyorum (`SELECT *` sonucu tabloda ID / Name / Position / Status olarak 4 kolon görünüyordu). Bu yüzden UNION'ımı da 4 sütunlu kuruyorum.

**Adım 1 — Veritabanı adı:**

```sql
alice' UNION SELECT database(),2,3,4 -- -
```

![Veritabanı adı: recruit_db](assets/img/ctf/recruit/sqli-2.png)

Veritabanı: `recruit_db`. (Sondaki `-- -` sorgunun geri kalanını yoruma alıyor, `2,3,4` ise sadece boş sütunları doldurmak için dolgu değerler.)

**Adım 2 — Tabloları listele:**

```sql
alice' UNION SELECT group_concat(table_name),2,3,4 from information_schema.tables where table_schema='recruit_db' -- -
```

![Tablolar: candidates, users](assets/img/ctf/recruit/sqli-3.png)

İki tablo var: `candidates` ve `users`. Bizi ilgilendiren tabii ki **`users`**.

**Adım 3 — users tablosunun sütunları:**

```sql
alice' UNION SELECT group_concat(column_name),2,3,4 from information_schema.columns where table_name='users' -- -
```

![users tablosunun sütunları](assets/img/ctf/recruit/sqli-4.png)

Aradığım sütunlar burada: `id`, `username`, `password`.

**Adım 4 — Verileri çek:**

```sql
alice' UNION SELECT id,username,password,4 from users -- -
```

![admin kimlik bilgileri](assets/img/ctf/recruit/sqli-5.png)

Ve admin kimlik bilgileri ekranda: kullanıcı adı `admin`, parola da yanında.

## 11. Admin girişi ve son flag

Çektiğim admin bilgileriyle giriş yapınca panel bu sefer **admin** yetkisiyle açılıyor — adayları onaylama/reddetme butonları geldi ve üstte ikinci flag duruyor:

![Admin paneli ve admin flag](assets/img/ctf/recruit/admin.png)

```
ADMIN Flag: THM{r3d4ct3d}
```

Oda tamamlandı.

---

## Çıkarımlar

Bu odada asıl öğrendiğim iki şey vardı:

1. **PHP'de yerel dosya okumak için `file://` wrapper.** "Only local files are allowed" mesajını görünce ne yapacağımı bilemedim; oysa uygulama tam olarak `file://` bekliyordu. Bir daha benzer bir filtre görürsem ilk deneyeceğim şey bu olacak.
2. **Web dosyalarının `/var/www/html/` altında olma ihtimali.** `config.php`'nin nerede olabileceği ilk anda aklıma gelmedi. Apache'nin varsayılan kök dizini bu; bir LFI'de okuyacak dosya ararken artık ilk oraya bakıyorum.

Bir de metodolojik ders: **LFI ile kaynak kodu okuyabiliyorsan, SQLi'yi körlemesine denemek zorunda değilsin.** `dashboard.php`'nin kaynağını görmek sütun sayısını ve tırnak yapısını tahmin etme derdinden kurtardı.

## Savunma tarafında bu nasıl kapatılırdı?

Öğrenmenin diğer yarısı: bu makineyi güvenli hale getirmek isteseydik ne yapardık?

- **Kimlik bilgilerini koda gömme.** `config.php` içindeki düz metin parola en baştaki hata. Sırlar ortam değişkenlerinde ya da uygulama dışı bir secret yöneticisinde tutulmalı.
- **Log ve config dosyalarını web kökünden çıkar.** `mail.log`'un tarayıcıdan okunabilmesi olmamalıydı; bu dosyalar web root dışında durmalı.
- **`file://` gibi wrapper'ları ve kullanıcı girdisini dosya yolu olarak kullanmayı engelle.** Kullanıcının verdiği adresi doğrudan dosya okuma fonksiyonuna geçirmek yerine, izin verilen dosyaların bir  whitelist kullanılmalı.
- **SQL için parametreli sorgu (prepared statement).** `LIKE '%$search%'` yerine bağlı parametreler kullanılsaydı enjeksiyon en baştan mümkün olmazdı.
- **Üretimde hata mesajlarını gösterme.** Ekrana basılan MySQL syntax hatası, saldırgana enjeksiyonu doğrulama ve sütun yapısını çıkarma imkânı verdi.

Kısacası zincirin her halkası aslında bir "kolaylık olsun diye" yapılmış kısayoldu — ve gerçek dünyada saldırganların en sevdiği şey de tam olarak bu kısayollar.
