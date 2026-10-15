[AD Breaching yazısında](post.html?p=tryhackme-intro-to-ad-breaching) bir domain'e ilk adımı nasıl atacağımızı gördük. Peki ilk hesabı aldıktan sonra ne oluyor? Bu writeup tam da o sorunun cevabı: elimizdeki **yerel yönetici** erişimini, kimlik bilgisi toplayarak (credential harvesting) adım adım **Domain Admin**'e çeviriyoruz. Üstelik tek bir exploit kullanmadan — sadece Windows'un kimlik bilgilerini sakladığı yerleri boşaltarak.

Lab topolojisi şöyle: **AttackBox** → **Workstation (WRK, 10.220.10.20)** → **Domain Controller (DC, 10.220.10.10)**. Başlangıç noktamız WRK üzerinde yerel admin; hedefimiz DC'de domain admin'in masaüstündeki flag.

> Uyarı: Bu teknikler yalnızca izinli ortamlarda (kendi lab'ın, THM, HTB) denenmelidir. Parola ve flag değerlerini sansürledim.

## Windows kimlik bilgilerini nerede saklar?

Saldırıya geçmeden önce "neyi nereden toplayacağız" sorusunu netleştirelim. Windows ve AD, kimlik bilgilerini farklı amaçlarla farklı yerlerde tutar — her biri ayrı bir toplama fırsatı:

| Depo | Ne tutar | Neden var | Erişim |
|---|---|---|---|
| **LSASS Belleği** | NTLM hash, Kerberos bileti, bazen düz metin parola | Servisler arası sorunsuz oturum (SSO) | `lsass.exe` belleğini dökmek (SYSTEM) |
| **SAM + SYSTEM** | Yerel hesap hash'leri | Yerel oturum açma (örn. yerel admin) | Registry hive'larını dışa aktar + BootKey |
| **LSA Secrets** | Cache'lenmiş domain creds, servis parolaları | Çevrimdışı oturum, zamanlanmış görev parolaları | LSARPC / registry (SYSTEM) |
| **DPAPI Vault** | Uygulama parolaları (RDP, tarayıcı, Wi-Fi) | Kullanıcı bazında güvenli saklama | Kullanıcı token'ı / master key |
| **NTDS.dit** (sadece DC) | Tüm domain: kullanıcılar, NTLM + Kerberos anahtarları | Domain kimlik doğrulama & replikasyon | DRSUAPI (DCSync) / çevrimdışı dosya |

En kıymetlisi tabii ki **NTDS.dit** — tüm domain'in kimlik doğrulama otoritesi. Ona ulaşmak, domain'deki herkesi taklit etmek demek. Yolculuğumuz da oraya doğru.

---

## 1. Mimikatz ile credential harvesting

Mimikatz, Windows'ta kimlik bilgisi toplamanın en güçlü aracı: canlı bellekten, registry hive'larından ve şifreli depolardan credential çeker. WRK'da yerel admin olduğumuz için (ve Defender'ı kapattığımız için) mimikatz'ı yönetici olarak çalıştırıyoruz.

### DPAPI Vault

DPAPI, kaydedilmiş RDP/tarayıcı/Wi-Fi parolalarını kullanıcı bazında şifreler. Vault'ları listele ve dışa aktar:

```
mimikatz # vault::list
mimikatz # vault::cred /export
```

Yerel admin olduğumuz için kullanıcı profil dosyalarına (DPAPI master key + vault) erişebiliyoruz; mimikatz bunları çözüp web credential'ları (örn. kayıtlı bir Gmail parolası) gösterebiliyor. Ama **servis hesaplarının** (örn. `svc-app`) vault sırları, o hesabın kendi context'ine bağlı DPAPI anahtarlarıyla korunur — o kullanıcı olarak çalışmadan çözülemez.

### SAM + SYSTEM hive'ları

Yerel hesap hash'lerini çıkarmak için önce iki hive'ı kaydet:

```powershell
reg save HKLM\SAM C:\Users\Administrator\Desktop\SAM
reg save HKLM\SYSTEM C:\Users\Administrator\Desktop\SYSTEM
```

Sonra mimikatz ile çöz:

```
mimikatz # lsadump::sam /sam:"...\SAM" /system:"...\SYSTEM"
```

SYSTEM hive'ındaki BootKey, SAM'daki şifreli hash'leri çözmek için gerekli anahtarı verir. Çıkan NTLM hash'lerini çevrimdışı kırabilir ya da **pass-the-hash** ile yeniden kullanabiliriz.

### LSASS belleği

Canlı oturumların credential'ları için:

```
mimikatz # privilege::debug
mimikatz # sekurlsa::logonpasswords
```

- `privilege::debug` → bellek okumak için gereken `SeDebugPrivilege`'ı açar
- `sekurlsa::logonpasswords` → LSASS belleğindeki tüm aktif oturumları (kullanıcı adı, NTLM/SHA1, bazen düz metin parola) döker

> Önemli ayrıntı: Domain kullanıcılarının credential'ı LSASS'te **yoksa**, o kullanıcının WRK'da aktif oturumu yok demektir. LSASS yalnızca canlı oturumları tutar; eski girişler bellekte kalmaz.

### LSA Secrets (cache'lenmiş domain creds)

Token'ımızı SYSTEM'e yükseltip çevrimdışı domain oturum cache'ini (MSCacheV2) okuyabiliriz:

```
mimikatz # privilege::debug
mimikatz # token::elevate
mimikatz # lsadump::cache
```

`token::elevate` SYSTEM token'ını çalar, `lsadump::cache` diskteki LSA cache'ini okur — domain kullanıcılarının çevrimdışı oturum için saklanmış hash'leri. (Aynı işi bir sonraki adımda `secretsdump.py` ile uzaktan yapacağız.)

Bu adımların sonunda elimizde domain kullanıcısı `svc-app` için düz metin bir parola ve yerel `ElonTusk` için web credential var — ama henüz **domain admin** yok.

---

## 2. Secretsdump ile uzaktan hash toplama

Impacket'in `secretsdump.py`'si, kimlik bilgilerini native Windows servisleri üzerinden **uzaktan** (DCE/RPC) çeker — hedefe binary yüklemeden, dosyalara dokunmadan. Daha sessiz ve pratik.

### Yerel admin ile dökme

AttackBox'tan WRK'yı hedefliyoruz:

```bash
secretsdump.py WRK/Administrator:'<PAROLA>'@10.220.10.20 -output local_dump
```

Format: `Host/User:Parola@Hedef_IP`. Çıktıda yerel SAM hash'leri **ve** cache'lenmiş domain oturum bilgileri (DCC2) gelir:

```
TRYHACKME.LOC/drgonzo:$DCC2$10240#drgonzo#a98704b0...
```

**DCC2 (MS-Cache v2)** hash'leri, makinede yerel saklanan domain cache credential'larıdır — laptop ağa bağlı değilken çevrimdışı giriş için. Yerel admin olarak, daha önce bu makineye giriş yapmış bir domain admin'in DCC2 hash'ini dökebiliriz.

### DCC2'yi kırmak

Kritik nokta: **DCC2 hash'leri pass-the-hash için kullanılamaz** — sadece çevrimdışı kırılabilir. `drgonzo`'nun hash'ini bir dosyaya koyup John ile kıralım:

```bash
john --format=mscash2 dc2_hash.txt --wordlist=/usr/share/wordlists/rockyou.txt
```

- `--format=mscash2` → DCC2 formatı
- Birkaç saniyede `drgonzo`'nun parolası çıkar. (Not: drgonzo DC'ye RDP yapabiliyor ama domain admin masaüstündeki flag'i okuyamıyor — henüz yeterli yetki yok.)

### Domain admin ile DCSync

`drgonzo` domain admin olunca, bu kez doğrudan DC'yi hedefleyip tüm domain veritabanını çekeriz:

```bash
secretsdump.py TRYHACKME/drgonzo:'<PAROLA>'@10.220.10.10 -just-dc -output dc_dump
```

`-just-dc`, yerel hive dökümünü atlar ve **DRSUAPI ("DCSync")** ile NTDS.dit sırlarını çeker. Bu aslında bir domain controller'ın kimlik bilgilerini replike etme (senkronize etme) protokolü — biz onu domain admin yetkisiyle kötüye kullanıyoruz. Dönen şey: **tüm domain kullanıcılarının NTLM hash'leri** ve Kerberos anahtarları. Format: `kullanıcı:RID:LM:NT:::`

### Pass-the-Hash ile domain'i devralmak

Artık domain admin'in NTLM hash'i elimizde — düz metin parolayı bilmeye gerek yok. Windows'un pass-the-hash desteği sayesinde doğrudan hash'le kimlik doğrularız:

```bash
psexec.py 'TRYHACKME/Administrator@10.220.10.10' -hashes :<NT_HASH>
```

```
C:\Windows\system32> whoami
nt authority\system
```

Ve işte bu kadar — tek bir exploit kullanmadan, sadece kimlik bilgilerini toplayıp yeniden kullanarak Domain Admin'e, oradan da DC üzerinde SYSTEM'e çıktık.

---

## Önemli ayrımlar (kafa karışmasın)

- **NTLM hash** → pass-the-hash yapılabilir (parolayı bilmeden kimlik doğrulanır).
- **DCC2 (MSCacheV2) hash** → pass-the-hash **yapılamaz**, sadece çevrimdışı kırılır.
- **DCSync**, bir zafiyet değil; domain admin yetkisiyle meşru replikasyon protokolünün (DRSUAPI) kötüye kullanılması.
- **LSASS** sadece canlı oturumları tutar; eski girişler orada olmaz.

## Savunma tarafı: bu nasıl zorlaştırılır?

- **LSASS korumasını aç.** Credential Guard ve LSA Protection (RunAsPPL), LSASS belleğinin dökülmesini ciddi şekilde zorlaştırır.
- **Yerel admin'i kıs.** LAPS ile her makinede benzersiz, rastgele yerel admin parolası; aynı yerel admin parolasını her yerde kullanma (pass-the-hash yayılımını durdurur).
- **Ayrıcalıklı hesapları ayır.** Domain admin'ler iş istasyonlarına **giriş yapmasın** — yoksa credential'ı o makinenin LSASS'ine/cache'ine düşer. Tiered admin modeli kullan.
- **Güçlü parolalar.** DCC2 ancak zayıf parolada kırılır; uzun parola bunu pratikte imkânsızlaştırır. Servis hesapları için gMSA (yönetilen hesap) kullan.
- **DCSync'i izle.** Beklenmedik kaynaklardan gelen replikasyon isteklerini (DRSUAPI) ve Event ID 4662'yi izle; replikasyon yetkisini yalnızca DC'lere ver.
- **Defender'ı kapatmayı zorlaştır.** Tamper Protection açık olsun; bu lab'da ilk iş onu kapatmaktı — gerçek ortamda bu bir alarm olmalı.

## Toparlarken

Bu writeup'ın ana dersi şu: **modern AD saldırılarının çoğu "hack" değil, kimlik bilgisi toplayıp yeniden kullanmaktır.** Bir makinede yerel admin olmak, oradaki cache'lenmiş ve bellekteki credential'lar sayesinde çoğu zaman tüm domain'e açılan bir kapıdır. Zincir netti: yerel admin → mimikatz/secretsdump ile harvest → kırılan domain admin parolası → DCSync ile NTDS.dit → pass-the-hash ile DC'de SYSTEM.

AD serisinde bundan sonrası enumeration tarafını derinleştirmek — **BloodHound** ile bu tür saldırı yollarını daha büyük ortamlarda otomatik bulmak ve **Kerberoasting** gibi tekniklerle servis hesaplarını hedeflemek. Onlara da geleceğim.
