Bir sızma testinin ilk adımı neredeyse her zaman aynıdır: **karşımda ne var?** Bu soruya cevap veren araç da çoğu zaman Nmap oluyor. Bu yazıda kendi kullandığım tarama akışını, hangi bayrağı neden kullandığımı anlatıyorum.

> Uyarı: Nmap'i yalnızca sahibi olduğun ya da test için yazılı izin aldığın sistemlere karşı kullan. İzinsiz tarama birçok ülkede suçtur.

## Nmap tam olarak ne yapar?

Nmap, hedefe paket gönderip gelen cevaba bakarak şunları çıkarır:

- Hangi hostlar ayakta
- Hangi portlar açık / kapalı / filtrelenmiş
- O portlarda hangi servis ve sürüm çalışıyor
- Hedefin işletim sistemi ne olabilir

## İlk tarama: hızlı bir bakış

```bash
nmap -sV -sC -oN nmap-initial.txt 10.10.10.5
```

Bayrakların anlamı:

| Bayrak | Ne yapar |
|---|---|
| `-sV` | Açık portlardaki servis sürümünü tespit eder |
| `-sC` | Varsayılan NSE script setini çalıştırır |
| `-oN` | Çıktıyı okunabilir formatta dosyaya yazar |

Çıktıyı **her zaman** dosyaya kaydediyorum. Bir CTF'te ya da gerçek testte "acaba o port neydi" diye taramayı tekrarlamak zaman kaybı.

## Tüm portları taramak

Varsayılan olarak Nmap yalnızca en yaygın 1000 portu tarar. Asıl ilginç servis çoğu zaman 8080, 8443 ya da 27017'de duruyor:

```bash
nmap -p- --min-rate 2000 -oN nmap-allports.txt 10.10.10.5
```

- `-p-` → 1'den 65535'e kadar bütün portlar
- `--min-rate 2000` → saniyede en az 2000 paket, taramayı ciddi hızlandırır

Sonra sadece bulunan portlara derin tarama yapıyorum:

```bash
nmap -p 22,80,8080 -sV -sC -oN nmap-deep.txt 10.10.10.5
```

## Sık kullandığım diğer seçenekler

```bash
# Host keşfi: hangi IP'ler ayakta?
nmap -sn 192.168.1.0/24

# UDP taraması (yavaştır, ilk 100 portla sınırla)
sudo nmap -sU --top-ports 100 10.10.10.5

# Belirli bir NSE script kategorisi
nmap --script vuln 10.10.10.5
```

## Çıktıyı nasıl okuyorum?

Açık port listesini gördükten sonra kendime şunu soruyorum: **bu servis bana ne veriyor?**

- `80/443` → dizin taraması (`ffuf`, `gobuster`), sayfa kaynağı, teknoloji tespiti
- `22` → sürüm notu al, brute-force en son çare
- `445` → `enum4linux`, `smbclient` ile paylaşımlara bak
- Alışılmadık yüksek portlar → `nc` ile bağlanıp banner'a bak

## Özet

Akış basitçe şu: **hızlı tarama → tüm portlar → bulunan portlara derin tarama → servis bazlı enumeration.** Nmap işin sadece kapı listesini çıkaran kısmı; asıl iş o kapıların arkasına bakarken başlıyor.
