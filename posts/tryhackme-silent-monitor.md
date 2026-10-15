Bu writeup, TryHackMe'nin **Silent Monitor** odasını (Jr Penetration Tester Challenges) baştan sona çözüyor. Güzel bir zincir: gizli bir iç servisi keşfetmekle başlayıp, **SQL Injection** ile giriş yapıyor, bir ping aracındaki **command injection** ile komut çalıştırıyor, sızdırılan bir parolayla SSH'ye geçiyor ve son olarak bir PackageKit açığıyla (**CVE-2026-41651**) root oluyoruz.

Her adımda ne yaptığımı, neden yaptığımı ve takıldığım yerleri de yazdım — çünkü asıl öğrenilen kısım orası.

> Not: Flag değerlerini bilerek sansürledim. Teknikler yalnızca izinli ortamlarda (THM/HTB, kendi lab'ın) denenmelidir.

## Oda bilgisi

| | |
|---|---|
| Platform | TryHackMe |
| Oda | Silent Monitor |
| Zorluk | Kolay–Orta (Jr Pentester) |
| Konular | SQLi · Command Injection · LinPEAS · CVE (TOCTOU LPE) |

## 1. Keşif: Nmap

Klasik başlangıç:

```bash
nmap -sC -sV <HEDEF_IP>
```

![Nmap taraması](assets/img/ctf/silent/nmap.png)

İki port açık:

- **22/tcp** — SSH (OpenSSH 8.9p1)
- **5050/tcp** — HTTP, **Werkzeug/2.0.2 (Python 3.10.12)** — yani bir **Flask** uygulaması. Başlık: *CorpNet Network Operations Centre*.

Bütün iş 5050'deki web uygulamasında.

## 2. Gizli dizini bulmak (takıldığım yer #1)

Ana sayfa bir "Network Operations Centre" paneli:

![Ana sayfa](assets/img/ctf/silent/main%20page.png)

Dizin taraması yaptım ama **wordlist'te olmasına rağmen hedef dizin çıkmadı.** Bir süre takıldım. Sonra sayfanın sol altındaki **"INTERNAL USE ONLY"** yazısını fark ettim ve dizin adının `internal` olabileceğini tahmin ettim — doğru çıktı.

> Otomatik araçlar her şeyi bulmaz. Sayfadaki metinler, footer'lar, yorumlar çoğu zaman gizli yolları ele verir. Gözle okumak, wordlist'ten güçlüdür.

`/internal` bizi bir operatör giriş paneline (NOC Portal) götürüyor:

![NOC Portal giriş](assets/img/ctf/silent/internal.png)

## 3. SQL Injection ile giriş

Elimizde kullanıcı bilgisi yok, sayfa kaynağında da işe yarar bir şey yok. Bir giriş formu görünce akla gelen klasik: **SQL Injection**. Kullanıcı adı alanına en bilinen payload'ı deniyorum:

```sql
' OR '1'='1'--
```

![SQLi ile giriş](assets/img/ctf/silent/sqli.png)

Sorgu `WHERE username='...' AND password='...'` mantığıyla kuruluyorsa, `' OR '1'='1'--` koşulu her zaman doğru yapıp parola kontrolünü yoruma alıyor. Giriş başarılı — dashboard önümüzde.

## 4. Ping aracı ve Command Injection (takıldığım yer #2)

Dashboard'da bir **host sağlık kontrolü** (ping) aracı var: bir IP/hostname giriyorsun, sunucu `ping` çalıştırıp çıktıyı gösteriyor.

![Ping aracı](assets/img/ctf/silent/ping.png)

Sunucu arka planda şuna benzer bir komut koşuyor:

```bash
ping -c 2 -W 1 <girdi>
```

Kullanıcı girdisi doğrudan bir sistem komutuna gidiyorsa, bu **command injection** demektir. Hemen denedim — ama **klasik yöntemler (`;`, `|`, `&&`) başarısız oldu.** Muhtemelen bu karakterler filtreleniyordu.

Burada ikinci kez takıldım. Pes etmek yerine [PayloadsAllTheThings](https://github.com/swisskyrepo/PayloadsAllTheThings)'in command injection listesini aldım ve **Burp Intruder**'a yükleyip hepsini denettim:

![Burp Intruder ile command injection](assets/img/ctf/silent/burp.png)

Tutan payload **newline (`%0a`) enjeksiyonu** oldu:

```
host=127.0.0.1%0aid%0a
```

Yanıtta `uid=33(www-data) gid=33(www-data)` döndü — komut çalışıyor. `%0a` (satır başı), filtre `;` ve `|`'ı engellese bile kabuğa ayrı bir komut satırı olarak geçiyor; filtreyi bu yüzden atlatıyor.

> Ders: Bir enjeksiyon "çalışmıyor" demek, "mümkün değil" demek değil. Ayırıcı karakter filtreleniyorsa, alternatif ayırıcıları (`%0a`, `%0d`, `$()`, backtick) dene. Hazır payload listeleri + Intruder bu işi otomatikleştirir.

## 5. Kimlik bilgisi sızdırma → SSH

Artık komut çalıştırabildiğimize göre, dosyaları okuyabiliriz. Uygulama dizinindeki config dosyasını çektim:

```
target=127.0.0.1%0acat+secret.config
```

![Config dosyasından SSH kimlik bilgisi](assets/img/ctf/silent/ssh-cred.png)

Config, netops uygulamasının ayarlarını ve bir **servis hesabı** parolasını içeriyordu:

```ini
[backup_agent]
run_as   = sysadmin
password = S3cur3Backup$Acc3ss!
```

Bu kimlik bilgisiyle SSH'ye bağlandım:

```bash
ssh sysadmin@<HEDEF_IP>
```

Ve kullanıcı flag'i:

![user.txt](assets/img/ctf/silent/user.png)

```
THM{r3d4ct3d}
```

## 6. Yetki yükseltme: CVE-2026-41651 (takıldığım yer #3)

Klasik olarak LinPEAS ile taradım. **İlk başta önemli bir şey göremedim ve bu adımı ihmal ettim** — asıl bakmam gereken satırı kaçırdım. Dönüp dikkatlice okuyunca LinPEAS'in işaretlediği açığı gördüm:

![LinPEAS CVE bulgusu](assets/img/ctf/silent/rootpath.png)

**CVE-2026-41651 ("Pack2TheRoot")** — PackageKit'te bir yerel yetki yükseltme açığı. Kurulu sürüm `1.2.5-2ubuntu2`, yamalı sürümün (`1.2.5-2ubuntu3.1`) altında, yani savunmasız.

> Ders: LinPEAS çıktısı uzundur ve asıl bulgu sarı/kırmızı bir satırda kaybolabilir. Çıktıyı dosyaya alıp **sakince, baştan sona** okumak gerekiyor; "hızlıca göz atıp bir şey yok" demek tam da bu tür açıkları kaçırtıyor. Benim ana hatam buydu.

### Açık kısaca ne?

Bu bir **TOCTOU** (Time-Of-Check to Time-Of-Use) yarış koşulu (race condition) açığı. Mantık şu: PackageKit, bir paket kurarken dosyayı önce **kontrol ediyor** (yetki/doğrulama), sonra **kullanıyor** (kuruyor). Bu iki an arasında küçük bir pencere var. Saldırgan tam o pencerede dosyayı değiştirirse, sistem "kontrol ettiğim" dosyayı değil, "sonradan koyduğum" zararlı dosyayı root yetkisiyle işliyor.

Exploit bunu iki `.deb` paketiyle (bir "dummy", bir "payload") yapıyor: iki kurulum işlemini (`InstallFiles`) aynı anda tetikleyip yarışı kazanınca, **SUID bir bash** bırakıyor.

```bash
cd /tmp/CVE-2026-41651
./cve-2026-41651
```

![Exploit → root](assets/img/ctf/silent/root.png)

Çıktıda `SUCCESS — SUID bash` görünüyor; `euid=0(root)`. Root flag:

```
THM{r3d4ct3d}
```

## Çıkarımlar

- **Dizin taraması her şey değil.** `/internal`'ı footer'daki "INTERNAL USE ONLY" ipucundan buldum, wordlist'ten değil. Sayfayı gözle oku.
- **Enjeksiyon filtresi = pes etme sebebi değil.** `;`/`|` tutmayınca `%0a` newline injection işe yaradı; PayloadsAllTheThings + Burp Intruder bu aramayı hızlandırdı.
- **LinPEAS çıktısını dikkatli oku.** Root'a giden CVE baştan oradaydı; ben hızlı geçip kaçırdım. Privesc'te en sık hata, enumeration çıktısını yeterince okumamak.

## Savunma tarafı

- **SQLi:** Parametreli sorgu (prepared statement) kullan; kullanıcı girdisini asla sorguya string olarak gömme.
- **Command injection:** Kullanıcı girdisini kabuğa gönderme. Ping için `subprocess` ile **shell=False** ve argüman listesi kullan; girdiyi geçerli IP/hostname beyaz listesine sık. Kara liste (`;`, `|` silmek) yetmez — `%0a` örneği bunu gösteriyor.
- **Sır yönetimi:** Parolaları düz metin config dosyalarında tutma; web kökünden okunabilir olmasınlar.
- **Yama yönetimi:** PackageKit gibi sistem bileşenlerini güncel tut; CVE-2026-41651 yamalı sürümde kapalıydı.

Bu oda, bir web açığının (SQLi + command injection) nasıl sisteme ilk erişim verdiğini ve oradan bir yerel CVE ile root'a nasıl çıkıldığını gösteren temiz bir Jr Pentester zinciri.
