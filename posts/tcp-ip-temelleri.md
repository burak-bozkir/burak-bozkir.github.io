Ağ güvenliğinin temelinde tek bir soru yatar: **veri bir bilgisayardan diğerine tam olarak nasıl gidiyor?** Bu sorunun cevabı TCP/IP. Bir pentester olarak port taramasından paket analizine kadar her şey bu protokolün üzerine kurulu, o yüzden mantığını oturtmak çok kıymetli. Bu yazıda TCP/IP'yi elimden geldiğince sade anlatmaya çalıştım.

## TCP/IP nedir?

TCP/IP protokolü, verilerin **kesintisiz ve hatasız** bir şekilde iletilmesini sağlar. TCP protokolü tam da bu ihtiyaç için yazılmıştır ve günümüzde kullandığımız birçok protokol — SSH, FTP, POP3, HTTP, HTTPS — verisini TCP aracılığıyla iletir.

UDP ise TCP'ye kıyasla çok daha hızlıdır; ancak verilerin bütünlüğü kontrol edilmez. Aslında hızlı olmasının sebebi de tam olarak budur: TCP'nin yaptığı "geldi mi, sırasında mı, eksik mi" kontrollerini yapmaz, veriyi gönderir ve arkasına bakmaz.

> Kısaca: **TCP = güvenilir ama yavaş, UDP = hızlı ama garantisiz.** Dosya indirirken TCP, canlı video/oyun/DNS gibi hız isteyen yerlerde UDP tercih edilir.

## TCP nasıl çalışır?

TCP'nin çalışma mantığı özünde 3 aşamadan oluşur:

1. **Aşama:** Hedefe bağlantı isteği gönderilir.
2. **Aşama:** Bağlantı onaylanır ve veri transferi başlar.
3. **Aşama:** Veri transferinin tamamlanıp tamamlanmadığı kontrol edilir.

Bir TCP bağlantısı bu aşamalar boyunca farklı durumlardan geçer. Bu durumların her birine **STATE** denir.

## TCP durumları (STATE)

| Durum | Anlamı |
|---|---|
| **LISTEN** | Sunucunun bir TCP bağlantı isteğini beklediği durum. Dinleme modu olarak adlandırılır. |
| **SYN-SENT** | Karşı tarafa bağlantı isteği gönderildikten sonra cevabın beklendiği durum. |
| **SYN-RECEIVED** | SYN ile gelen isteğe sunucunun SYN-ACK ile cevap vermesinden sonraki bekleme durumu. |
| **ESTABLISHED** | Bağlantı kurulmuş, veri transferinin yapıldığı durum. |
| **FIN-WAIT-1** | Bağlantıyı kapatma sürecinin başladığı, taraflardaki bekleme durumu. |
| **FIN-WAIT-2** | Karşı taraftan bağlantının bitirilme isteğinin beklendiği durum. |
| **CLOSE-WAIT** | Bağlantı kapatma talebinin beklendiği durum. |
| **CLOSING** | Karşı tarafa bağlantı bitirme ACK'i gönderildikten sonra bitişin beklendiği durum. |
| **LAST-ACK** | Son ACK'in beklendiği durum. |
| **TIME-WAIT** | Bağlantı kapanmadan önceki son kısa bekleme durumu (gecikmiş paketler için). |
| **CLOSED** | TCP bağlantısının tamamen bittiği durum. |

## Üçlü el sıkışma (3-Way Handshake)

İki bilgisayar TCP üzerinden bağlantı kurmak istediğinde şu sırayla ilerler:

1. **X** bilgisayarı **Y**'ye bir TCP **SYN** mesajı yollar. *(Bağlanmak istiyorum)*
2. **Y** bilgisayarı, isteği aldığına dair bir TCP **SYN+ACK** mesajı yollar. *(Tamam, ben de hazırım)*
3. **X** bilgisayarı **Y**'ye bir TCP **ACK** mesajı yollar. *(Anlaştık, başlıyoruz)*

Sonuçta Y bir ACK alır ve bağlantı **ESTABLISHED** (kurulmuş) duruma geçer. **Üçlü el sıkışma** adı verilen bu yöntem sonucunda TCP bağlantısı açılmış, süreç güvenli bir şekilde sağlanmış olur.

Süreci şöyle görselleştirebiliriz:

```text
İstemci (X)                         Sunucu (Y)
    |                                    |
    |  ---------- SYN --------->         |   "Bağlanmak istiyorum"
    |                                    |
    |  <------ SYN + ACK -------         |   "Tamam, ben de hazırım"
    |                                    |
    |  ---------- ACK --------->         |   "Anlaştık"
    |                                    |
    |   ===== ESTABLISHED / veri =====   |
```

### Ya port kapalıysa?

Eğer istemci, sunucunun **dinlenmeyen (açık olmayan)** bir portuna bağlantı isteği gönderirse — sunucunun o portta LISTEN modunda olması gerekir — SYN-ACK yerine **RST-ACK** paketi döner. Bu noktada sunucu bağlantıyı reddetmiş olur ve bağlantı kurulmaz.

**RST** paketi "reset" olarak tanımlanır ve açık bir bağlantıyı aniden kesmek için de kullanılır.

> Bu, doğrudan **pentest** ile bağlantılı: Nmap gibi araçlar port taraması yaparken tam olarak bu davranışı okur. SYN'e **SYN-ACK** dönerse port **açık**, **RST** dönerse port **kapalı**, hiç cevap gelmezse port muhtemelen **filtrelenmiş** (firewall) demektir.

## IP nedir?

IP, Türkçesiyle **İnternet Protokolü**'nün kısaltmasıdır. Bilgisayarların birbiriyle iletişiminde en kritik nokta olan **ağ adreslemede** kullanılan düzendir. İki bilgisayar arasındaki paketlerin **yönlendirilmesini** sağlayan protokol olarak tanımlanır.

IP'de verinin **niteliği önemli değildir**; veri içeriğiyle ilgilenmez, sadece paketin gideceği adresi belirler. Yani IP'nin tek derdi "bu paket nereye gidecek" sorusudur, içinde ne olduğu onu ilgilendirmez.

## IP nasıl çalışır?

IP, TCP'nin belirlediği verinin izleyeceği yolu belirler. Bu işi yaparken TCP'den gelen veri parçasının önüne kendi **IP başlığını** (hedef ve kaynak adres bilgisi) ekler. Bu paketlenmiş yapıya **datagram** (IP paketi) denir.

Burada önemli bir ayrım var: veri katman katman ilerlerken her katman kendi başlığını ekler. TCP'nin oluşturduğu parçaya **segment**, IP'nin buna kendi başlığını ekleyerek oluşturduğu yapıya **paket/datagram** denir.

IP, veriyi yönlendirirken **hata kontrolü yapmaz** — bu iş bir üst katmanın (TCP'nin) görevidir. Bu yüzden IP, kendi başına çalışabilen bağımsız bir protokoldür. İşte TCP ve IP'nin birlikte anılmasının sebebi budur: IP paketi doğru adrese götürür, TCP de o paketin eksiksiz ve sırayla ulaşmasını garanti eder. İkisi bir ekip gibi çalışır.

## TCP/IP katmanları

TCP/IP modeli 4 katmandan oluşur. Veri gönderilirken en üstten (Uygulama) en alta (Ağ) doğru iner, karşı tarafta ise ters yönde yukarı çıkar. Her katmanın kendi görevi ve o katmanda çalışan protokolleri vardır:

**4. Katman — Uygulama Katmanı (Application)**

Kullanıcının ve uygulamaların doğrudan temas ettiği en üst katmandır. Tarayıcı, e-posta istemcisi, dosya transfer programı gibi uygulamaların ağ üzerinden konuşmasını sağlayan protokoller buradadır. Yani "veri neye benziyor, hangi kurala göre konuşuluyor" burada belirlenir.

- Çalışan protokoller: **HTTP, HTTPS, FTP, SSH, DNS, SMTP, POP3, IMAP, DHCP**

**3. Katman — Taşıma Katmanı (Transport)**

Verinin bir noktadan diğerine taşındığı katmandır. Verinin güvenilir mi yoksa hızlı mı gideceğine burada karar verilir. Port numaraları da bu katmanda devreye girer.

- Çalışan protokoller: **TCP, UDP**

**2. Katman — İnternet Katmanı (Internet)**

Verinin, birbirine bağlı cihazlar arasında kaynak cihazdan hedef cihaza **ulaşmasını** (yönlendirilmesini) sağlayan katmandır. Adresleme ve yönlendirme burada yapılır.

- Çalışan protokoller: **IP, ICMP** (ping bu katmandadır), **ARP**

**1. Katman — Ağ Erişim Katmanı (Network Access / Link)**

Verinin fiziksel olarak — kablolar, Wi-Fi vb. aracılığıyla — kaynaktan hedefe ulaşma sürecidir. Elektrik sinyalleri, MAC adresleri ve fiziksel donanım bu katmanın işidir.

- Çalışan yapılar: **Ethernet, Wi-Fi, MAC adresleri**

> Bu 4 katmanlı yapı, aslında 7 katmanlı **OSI modelinden** referans alınarak oluşturulmuştur. OSI daha teorik ve detaylı bir modeldir; TCP/IP ise pratikte kullanılan, sadeleştirilmiş halidir.

## Özet

Toparlarsak:

- **TCP** güvenilir ve sıralı iletim sağlar (üçlü el sıkışma ile), **UDP** hızlıdır ama garanti vermez.
- **IP** paketi doğru adrese yönlendirir ama içeriğiyle ya da hata kontrolüyle ilgilenmez.
- İkisi birlikte çalışır: **IP yol bulur, TCP paketin eksiksiz gitmesini sağlar.**
- Veri 4 katmandan geçer; her katman kendi başlığını ekleyerek veriyi bir alt katmana teslim eder.

Bir sonraki yazımızda ise OSI modeli ve TCP/IP Modeli ile arasındaki farklara bakacağız.