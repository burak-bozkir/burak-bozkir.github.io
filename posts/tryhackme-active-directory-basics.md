Active Directory (AD), kurumsal Windows ağlarının belkemiğidir. Dünyadaki şirketlerin çok büyük bölümü kullanıcılarını, bilgisayarlarını ve politikalarını AD ile yönetir — ve tam da bu yüzden bir pentester'ın mutlaka anlaması gereken bir konudur. Bu yazı, TryHackMe'nin **Active Directory Basics** odasını bitirdikten sonra öğrendiklerimi kendi cümlelerimle toparladığım bir kavram özeti.

Oda bir "makine hack'i" değil, temelleri oturtan bir okuma odası. O yüzden burada komut avından çok **ne, neden ve nasıl** var. Sonda da her kavramın saldırgan açısından neden önemli olduğuna değiniyorum — çünkü bu temeller olmadan AD saldırıları havada kalır.

## Windows Domain nedir?

Bir **domain**, merkezi olarak yönetilen bir bilgisayar ve kullanıcı topluluğudur. Küçük bir ofiste 5 bilgisayarı tek tek yönetmek kolaydır; ama 500 bilgisayarlı bir kurumda her makineye tek tek kullanıcı açmak, parola sıfırlamak, politika uygulamak imkânsızdır. Domain bu sorunu çözer: **kimlik, yetki ve politika tek merkezden yönetilir.**

Domain'in sağladıkları:

- **Merkezi kimlik yönetimi** — tüm kullanıcılar tek yerde
- **Tek oturum açma (SSO)** — kullanıcı bir kez giriş yapar, tüm kaynaklara erişir
- **Merkezi politika** — parola kuralları, kısıtlamalar her makineye otomatik uygulanır

## Domain Controller (DC)

Bu merkezî yönetimi yapan sunucuya **Domain Controller** denir. DC, **Active Directory Domain Services (AD DS)** rolünü çalıştırır ve domain'deki her şeyin kaydını tutar. Kısaca: DC ele geçirilirse, domain'in tamamı ele geçirilmiş demektir. Saldırganın nihai hedefi neredeyse her zaman DC'dir.

## Active Directory'nin nesneleri

AD DS, domain'deki her şeyi **nesne (object)** olarak tutan bir veritabanıdır. Başlıca nesneler:

- **Kullanıcılar (Users):** Hem gerçek insanlar hem de servislerin kullandığı **servis hesapları**. İkisi de birer kimliktir.
- **Makineler (Machines):** Domain'e katılan her bilgisayarın bir **makine hesabı** vardır (örn. `TOM-PC$`). Bu hesabın da otomatik üretilmiş, çok uzun bir parolası olur ve yerel SYSTEM yetkisine denktir.
- **Güvenlik Grupları (Security Groups):** İzinleri toplu yönetmek için kullanılır. `Domain Admins`, `Backup Operators`, `Server Operators` gibi hazır gruplar kritik yetkiler taşır.
- **Organizational Unit (OU):** Nesneleri düzenlemek ve politika/yetki uygulamak için kullanılan klasör benzeri yapılar.

### OU mu, grup mu? (En çok karıştırılan yer)

- **OU'lar** politika uygulamak ve yönetimi devretmek içindir. Bir nesne **yalnızca bir OU'da** bulunabilir.
- **Gruplar** izin vermek içindir. Bir nesne **birden fazla gruba** üye olabilir.

Kısaca: OU "bu kullanıcı hangi departmanda ve hangi kurala tabi", grup ise "bu kullanıcı neye erişebilir" sorusuna cevap verir.

## Kimlik Doğrulama Yöntemleri

Domain'de kimlik doğrulama iki protokolle olur:

- **Kerberos** — Modern ve varsayılan yöntem. Bilet (ticket) tabanlıdır: kullanıcı önce bir **TGT** (Ticket Granting Ticket) alır, sonra bu biletle erişmek istediği servis için **TGS** biletleri ister. Parola ağ üzerinde sürekli dolaşmaz.
- **NetNTLM** — Eski, geriye dönük uyumluluk için duran yöntem. Soru-cevap (challenge-response) mantığıyla çalışır.

Bu ikisi, AD saldırılarının büyük kısmının dayandığı zemindir — birazdan değineceğim.

## Ağaçlar, Ormanlar ve Güvenler (Trees, Forests, Trusts)

Kurumlar büyüdükçe tek domain yetmez:

- **Tree (Ağaç):** Aynı isim alanını paylaşan domain'ler. Örneğin `thm.local` ana domain'ken `uk.thm.local` ve `us.thm.local` alt domain'ler olabilir. Aralarında otomatik güven ilişkisi vardır.
- **Forest (Orman):** Birden fazla ağacın bir araya gelmesi. Farklı isim alanlarına sahip domain'leri (örn. `thm.local` ve `mht.local`) bir arada tutar.
- **Trust (Güven):** İki domain/forest arasında, birinin kullanıcılarının diğerinin kaynaklarına erişmesini sağlayan ilişki. Güvenler **yönlüdür** — tek yönlü ya da çift yönlü olabilir. Şirket birleşmelerinde iki ayrı ormanı bağlamak için **foreign forest trust** kurulur.

## Kullanıcı ve Bilgisayar Yönetimi

- **Kullanıcı yönetimi:** Yöneticiler "Active Directory Users and Computers" (dsa.msc) konsoluyla kullanıcı açar, gruplara ekler, parola sıfırlar.
- **Yetki devri (Delegation):** Bir OU'nun yönetimi başka bir kullanıcıya devredilebilir — örneğin IT destek personeline "sadece şu departmanın parolalarını sıfırlama" yetkisi vermek gibi. Güçlü ama yanlış yapılandırılırsa tehlikeli bir özellik.
- **Domain'e katılma:** Bir bilgisayar domain'e katıldığında AD'de bir makine hesabı oluşur ve o makine artık merkezî politikalara tabi olur.

## Group Policy (GPO)

**Group Policy Objects (GPO)**, ayarları merkezî olarak dağıtmanın yoludur: parola politikaları, masaüstü kısıtlamaları, yazılım kurulumları, betikler... "Group Policy Management" konsolunda hazırlanır, **OU'lara bağlanır** (link) ve o OU'daki tüm nesnelere uygulanır.

GPO'lar makinelere **SYSVOL** adlı paylaşılan bir klasör üzerinden dağıtılır ve belirli aralıklarla yenilenir (elle yenilemek için `gpupdate /force`). Bir GPO'yu değiştirme yetkisi olan, aslında ona bağlı tüm makinelerde kod çalıştırma gücüne yakın bir şeye sahiptir — bu yüzden GPO izinleri kritiktir.

---

## Saldırgan gözüyle: bu temeller neden önemli?

Bu oda saldırı öğretmiyor ama öğrettiği her kavram, bir saldırı yüzeyinin kapısı:

- **Domain Controller** = elmas değerinde. Tüm AD saldırılarının nihai hedefi burayı ele geçirmek (örn. DCSync ile tüm parola hash'lerini çekmek).
- **Kerberos** → **Kerberoasting** ve **AS-REP Roasting** saldırılarının temeli. Servis hesaplarının biletlerini isteyip çevrimdışı kırmaya dayanır.
- **NetNTLM** → **Pass-the-Hash** ve **NTLM relay** saldırılarının zemini. Parolayı bilmeden hash ile kimlik doğrulamak buradan gelir.
- **Makine hesapları** ve **servis hesapları** → çoğu zaman aşırı yetkili ve parolaları zayıf; yanal hareketin (lateral movement) sık kullanılan yolu.
- **Güvenlik grupları** → `Domain Admins`, `Account Operators` gibi gruplara ulaşmak, yetki yükseltmenin klasik hedefi.
- **GPO ve delegation** → yanlış yapılandırılmış bir GPO yazma izni ya da aşırı cömert bir yetki devri, doğrudan domain ele geçirmeye gidebilir.
- **Trusts** → iki orman arasındaki yanlış yapılandırılmış güven, bir ormandan diğerine sıçramanın yoludur.

## Toparlarken

Active Directory, "tek merkezden yönet" fikrinin devasa bir uygulaması. Bu kolaylık, aynı zamanda saldırganlar için zengin bir hedef demek: tek bir yanlış yapılandırma (zayıf bir servis hesabı, cömert bir grup üyeliği, yazılabilir bir GPO) koca bir kurumu düşürebilir.

Bu yazı temelleri kurdu. Sıradaki adım, bu kavramların üzerine gerçek saldırıları koymak — **BloodHound ile saldırı yollarını görselleştirmek**, **Kerberoasting** ve **AS-REP Roasting** gibi teknikleri tek tek ele almak. AD tarafında ilerledikçe bunları da yazacağım.
