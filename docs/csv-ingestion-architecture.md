# CSV Ingestion / Versioning / Storage / Serving — Teknik Mimari Önerisi

**Tarih:** 2026-04-08
**Hazırlayan:** Solution Architecture
**Proje:** SmartPulse International Cockpit

---

## 1. İhtiyacın Kısa Özeti

SmartPulse ekosisteminde farklı kaynaklardan gelen CSV dosyaları (technical_parameters.csv, DAM_GEN.csv, ileride 4–5 ek dosya) düzenli aralıklarla okunup saklanmalı, ham halleri tarihsel olarak tutulmalı ve en güncel versiyon her zaman bilinmelidir.

**Mevcut durum:** CSV dosyaları SmartPulse Portal FTP üzerinden okunuyor, anlık parse edilip client'a servis ediliyor. Herhangi bir tarihsel saklama, versiyonlama veya periyodik okuma mekanizması yok. `technical_parameters.csv` için çalışan bir akış var — bu bozulmamalı.

**Hedef:** Dosya içeriğine iş anlamı yüklenmeden önce, ortak bir "oku → sakla → versiyonla → servis et" altyapısı kurmak. İş anlamı (parse, transform, domain mapping) bu altyapının üzerine katman olarak eklenir.

---

## 2. Ana Mimari Hedef

```
┌─────────────────────────────────────────────────────────────┐
│  Tek bir ortak CSV ingestion pipeline kurmak:               │
│                                                             │
│  Source (FTP/Disk) → Reader → Raw Store → Version → Serve   │
│                                                             │
│  • Kaynak agnostik (FTP, lokal disk, HTTP)                  │
│  • Dosya agnostik (herhangi bir CSV)                        │
│  • Periyot tanımlanabilir (per-source)                      │
│  • Ham veri korunur, parse ayrı katman                      │
│  • En güncel versiyon her zaman O(1) erişilebilir           │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. Önerilen Mimari Yaklaşım

### 3.1 Genel Akış

```
Settings UI                    CsvIngestionWorker                    PostgreSQL
┌──────────┐                  ┌──────────────────┐                 ┌───────────────┐
│ CSV Source│───tanımla───────▶│  Periyodik Loop  │───oku──────────▶│ CsvSource     │
│ Tanımları │                  │  (per-source)    │                 │ CsvVersion    │
│          │                  │                  │───hash kontrol──▶│ (raw_content) │
│          │◀──durum göster───│  Hata yönetimi   │───yeni ise──────▶│ latest flag   │
└──────────┘                  └──────────────────┘                 └───────────────┘
                                                                          │
                                                                          ▼
                                                                   REST API / WS
                                                                          │
                                                                          ▼
                                                                   Client Modülleri
                                                                   (BatteryParams,
                                                                    DAM, vb.)
```

### 3.2 CSV Reader / Ingestion Katmanı

**CsvIngestionWorker** — Yeni bir worker (`server/src/workers/csvIngestion.worker.ts`):

- Server başlangıcında aktif CSV source tanımlarını yükler
- Her source için bağımsız bir timer çalıştırır (configurable interval)
- Okuma kaynağı: **FTP** (mevcut `FtpService.readFile()`) veya **lokal disk** (`fs.readFile`)
- Okunan ham içeriğin SHA-256 hash'ini hesaplar
- Hash değişmediyse → skip (idempotent)
- Hash değiştiyse → yeni `CsvVersion` kaydı oluştur

```typescript
// Pseudocode
for (const source of activeSources) {
  const rawContent = await readFromSource(source); // FTP veya disk
  const contentHash = sha256(rawContent);
  
  const existing = await prisma.csvVersion.findFirst({
    where: { sourceId: source.id, contentHash }
  });
  
  if (existing) continue; // Aynı içerik, skip
  
  await prisma.csvVersion.create({
    data: {
      sourceId: source.id,
      rawContent,
      contentHash,
      fetchedAt: new Date(),
      isCurrent: true,
    }
  });
  
  // Önceki current'ı kaldır
  await prisma.csvVersion.updateMany({
    where: { sourceId: source.id, isCurrent: true, NOT: { contentHash } },
    data: { isCurrent: false }
  });
}
```

### 3.3 Raw Storage Yaklaşımı

Ham CSV içeriği **PostgreSQL text kolonu** olarak saklanır. Gerekçe:

| Alternatif | Neden Tercih Edilmedi |
|---|---|
| Dosya sistemi | Yedekleme/replikasyon zorluğu, atomic write garantisi yok |
| S3/Blob | Overengineering — CSV'ler genelde <1MB |
| JSONB parse | İlk aşamada parse zorunlu olmamalı |

**PostgreSQL text kolonu** — transactional, backup'a dahil, retention yönetilebilir, boyut sorunu yok (<1MB dosyalar için ideal).

### 3.4 Versioning Mantığı

Her okuma sonucu (hash değiştiyse) yeni bir `CsvVersion` satırı oluşturur:

- `contentHash` → SHA-256, duplicate detection
- `isCurrent: boolean` → en güncel versiyon flag'i (source başına tek bir `true`)
- `fetchedAt` → okunma zamanı
- `versionNo` → auto-increment per source (opsiyonel, UX kolaylığı için)

**Neden hash-based?** Dosya değişmeden tekrar okunursa gereksiz versiyon oluşmaz. FTP'den aynı dosya 100 kez okunsa bile tek versiyon kalır.

### 3.5 Latest Version Erişimi

İki strateji kombine:

1. **`isCurrent` flag** — O(1) erişim: `WHERE sourceId = X AND isCurrent = true`
2. **`fetchedAt DESC LIMIT 1`** — fallback / doğrulama

Flag yaklaşımı tercih edilir çünkü:
- REST endpoint'lerde hızlı erişim
- WebSocket broadcast'te anında "latest" bilgisi
- Birden fazla modülün aynı anda sorgulamasında consistent

### 3.6 Veriyi Diğer Modüllere Servis Etme

```
GET  /api/csv/:sourceKey/latest          → En güncel raw CSV + metadata
GET  /api/csv/:sourceKey/versions        → Versiyon listesi (paginated)
GET  /api/csv/:sourceKey/version/:id     → Belirli versiyon detayı
GET  /api/csv/:sourceKey/latest/parsed   → Parse edilmiş JSON (domain-specific)
POST /api/csv/:sourceKey/force-read      → Manuel tetikleme
```

**`/latest/parsed` endpoint'i** — domain-specific parser'lar register edilir:

```typescript
// csvParsers registry
const CSV_PARSERS: Record<string, (raw: string) => any> = {
  'technical-parameters': parseMultiBatteryTechParams,
  'dam-gen': parseDamGen,  // ileride eklenecek
};
```

Bu sayede ham veri ve parse edilmiş veri ayrı katmanlarda kalır. Yeni CSV tipi eklemek = yeni parser register etmek.

---

## 4. Mevcut technical_parameters.csv ile Uyumluluk Stratejisi

### 4.1 Mevcut Akış (Korunacak)

```
BatteryParamsPage → ftpApi.readMultiTechParams() → POST /api/ftp/read-multi-tech-params
                                                        │
                                                        ▼
                                                   FtpService.readFile()
                                                        │
                                                        ▼
                                                   Portal FTP API
                                                        │
                                                        ▼
                                                   parseMultiBatteryTechParams()
                                                        │
                                                        ▼
                                                   Response → Client
```

**Bu akış hiçbir şekilde değiştirilmez.** Mevcut route'lar, parser'lar ve client kodu olduğu gibi kalır.

### 4.2 Adaptasyon Stratejisi: Wrap, Don't Replace

```
Phase 1: Yeni CSV altyapısı kurulur (CsvSource, CsvVersion, Worker)
Phase 2: technical-parameters için CsvSource kaydı oluşturulur
Phase 3: Worker, FtpService üzerinden periyodik okur ve CsvVersion'a yazar
Phase 4: BatteryParamsPage'e "son versiyon tarihi" bilgisi eklenir
Phase 5: İSTEĞE BAĞLI — BatteryParamsPage'in okuma kaynağı yeni API'ye çevrilir
```

**Kritik kural:** Phase 5 tamamlanana kadar BatteryParamsPage mevcut FTP route'unu kullanmaya devam eder. Yeni altyapı **paralel** çalışır, mevcut akışı kesmez.

### 4.3 Geriye Dönük Uyumluluk

| Mevcut Endpoint | Durumu |
|---|---|
| `POST /api/ftp/read-multi-tech-params` | Aynen kalır |
| `POST /api/ftp/write-tech-params` | Aynen kalır (write sonrası yeni CsvVersion oluşturulur) |
| `POST /api/ftp/sync-attributes` | Aynen kalır |
| `parseMultiBatteryTechParams()` | Parser registry'ye de eklenir ama mevcut direct kullanım korunur |

---

## 5. Settings Ekranı Tasarımı Gereksinimleri

### 5.1 CSV Reader Bölümü

Settings sayfasına yeni bir section eklenir: **"CSV Data Sources"**

```
┌──────────────────────────────────────────────────────────────┐
│  📄 CSV Data Sources                              [+ Add]    │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─ technical-parameters ──────────────────────────────────┐ │
│  │  Path: Incoming/technical_parameters.csv                │ │
│  │  Source: FTP (Portal)                                   │ │
│  │  Interval: 10 min        Status: ● Active               │ │
│  │  Last Read: 2026-04-08 14:32   Version: #12             │ │
│  │  Last Hash: a3f2c1...    Content Changed: ✓ Yes          │ │
│  │                                    [⟳ Read Now] [Edit]   │ │
│  └──────────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌─ dam-gen ───────────────────────────────────────────────┐ │
│  │  Path: Incoming/DAM_GEN.csv                             │ │
│  │  Source: FTP (Portal)                                   │ │
│  │  Interval: 5 min         Status: ● Active               │ │
│  │  Last Read: 2026-04-08 14:30   Version: #3              │ │
│  │  Last Hash: b7e4d2...    Content Changed: ✗ No           │ │
│  │                                    [⟳ Read Now] [Edit]   │ │
│  └──────────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌─ (new) ─────────────────────────────────────────────────┐ │
│  │  Key: ____________                                      │ │
│  │  Path: ____________     Source: [FTP ▾]                 │ │
│  │  Interval: [5] min     Direction: [Incoming ▾]          │ │
│  │                                    [Save] [Cancel]      │ │
│  └──────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

### 5.2 Alan Tanımları

| Alan | Tip | Açıklama |
|---|---|---|
| `key` | string (slug) | Benzersiz tanımlayıcı: `technical-parameters`, `dam-gen` |
| `displayName` | string | UI'da gösterilecek isim |
| `filePath` | string | FTP veya disk path'i: `Incoming/DAM_GEN.csv` |
| `sourceType` | enum | `ftp` \| `disk` |
| `ftpDirection` | enum | `incoming` \| `outgoing` (sadece FTP için) |
| `intervalMinutes` | number | Okuma periyodu (minimum: 1, default: 10) |
| `enabled` | boolean | Aktif/pasif durumu |
| `parserKey` | string? | Opsiyonel — hangi parser kullanılacak (`technical-parameters`, `dam-gen`, `null`) |

### 5.3 Yönetimsel Bilgiler (Read-only, otomatik)

| Alan | Açıklama |
|---|---|
| Son okuma zamanı | Worker'ın son fetch attempt'i |
| Son başarılı versiyon | En güncel CsvVersion'ın fetchedAt + versionNo |
| Son hash | Content hash (ilk 8 karakter) |
| İçerik değişti mi | Son okumada hash değişip değişmediği |
| Toplam versiyon sayısı | Kaç tarihsel versiyon var |
| Son hata | Varsa son hata mesajı ve zamanı |

---

## 6. Veri Saklama ve Versiyonlama Kuralları

### 6.1 Ham Dosya Saklama

```
CsvVersion tablosu:
├── rawContent: TEXT       → CSV'nin ham hali, byte-for-byte
├── contentHash: TEXT      → SHA-256 hash
├── sizeBytes: INT         → Dosya boyutu
└── encoding: TEXT         → 'utf-8' (default)
```

**rawContent neden TEXT?** CSV dosyaları tipik olarak 10KB–500KB arasında. PostgreSQL TEXT kolonu 1GB'a kadar destekler. TOAST compression ile disk kullanımı minimal.

### 6.2 Timestamp / Version Mantığı

```
Source: dam-gen
├── Version #1  │ fetchedAt: 2026-04-08 08:00  │ hash: abc123  │ isCurrent: false
├── Version #2  │ fetchedAt: 2026-04-08 08:15  │ hash: def456  │ isCurrent: false
├── Version #3  │ fetchedAt: 2026-04-08 09:00  │ hash: abc123  │ isCurrent: false  ← aynı hash, farklı zaman
└── Version #4  │ fetchedAt: 2026-04-08 10:30  │ hash: ghi789  │ isCurrent: true   ← GÜNCEL
```

**Not:** Aynı hash farklı zamanlarda tekrar gelebilir (dosya geri alınmış olabilir). Bu durumda yeni versiyon **oluşturulmaz** — hash-based dedup aktif. Ancak `lastCheckedAt` güncellenir.

### 6.3 Retention Yaklaşımı

| Kural | Değer | Gerekçe |
|---|---|---|
| Son N versiyon her zaman tutulur | 50 | Kısa vadeli debug/rollback |
| N'den eski versiyonlar | 90 gün sonra silinir | Disk tasarrufu |
| Current versiyon | Asla silinmez | Sistem bütünlüğü |
| rawContent temizleme | 90 gün sonra null yapılır, metadata kalır | Uzun vadeli audit trail |

Retention job: Günde 1 kez çalışan basit bir cleanup query.

---

## 7. Servis Davranışı

### 7.1 Periyodik Okuma Akışı

```
CsvIngestionWorker.start()
│
├── loadActiveSources()  → DB'den enabled=true source'ları al
│
├── for each source:
│   ├── setInterval(source.intervalMinutes * 60_000)
│   │
│   └── tick():
│       ├── readFromSource(source)
│       │   ├── sourceType === 'ftp' → FtpService.readFile(path, direction)
│       │   └── sourceType === 'disk' → fs.readFile(path, 'utf-8')
│       │
│       ├── contentHash = sha256(rawContent)
│       │
│       ├── lastVersion = findCurrent(sourceId)
│       │   ├── hash aynı → updateLastCheckedAt() → DONE
│       │   └── hash farklı → createNewVersion() → markAsCurrent()
│       │
│       ├── emit('csv:updated', { sourceKey, versionId })  → WebSocket
│       │
│       └── updateSourceStatus({ lastReadAt, lastError: null })
│
└── on source config change → restart affected timer
```

### 7.2 Hata Yönetimi

| Senaryo | Davranış |
|---|---|
| FTP bağlantı hatası | Log + `lastError` güncelle, sonraki periyotta tekrar dene |
| Dosya bulunamadı | Log + `lastError` güncelle, source'u disable etme |
| Parse hatası (parsed endpoint) | Raw versiyon yine de saklanır, parse error ayrı loglanır |
| DB yazma hatası | Retry 1x, başarısızsa log + skip |
| Worker crash | Server restart'ta otomatik yeniden başlar |

### 7.3 Dosya Değişmediyse

- Hash karşılaştırması ile tespit
- Yeni versiyon oluşturulmaz
- `CsvSource.lastCheckedAt` güncellenir (sağlık göstergesi)
- Log: `[CsvIngestion] dam-gen: no change (hash: abc123)`

### 7.4 Yeni Dosya Geldiğinde

- Yeni `CsvVersion` oluşturulur (`isCurrent: true`)
- Önceki current'ın `isCurrent` flag'i `false` yapılır
- WebSocket event: `csv:updated` (ilgili client modülleri reactive güncelleme alır)
- Log: `[CsvIngestion] dam-gen: new version #5 (hash: xyz999, 42KB)`

---

## 8. Önerilen Veri Modeli

### 8.1 Prisma Schema

```prisma
model CsvSource {
  id                Int          @id @default(autoincrement())
  key               String       @unique          // "technical-parameters", "dam-gen"
  displayName       String                        // "Technical Parameters"
  filePath          String                        // "Incoming/technical_parameters.csv"
  sourceType        String       @default("ftp")  // "ftp" | "disk"
  ftpDirection      String?                       // "incoming" | "outgoing"
  intervalMinutes   Int          @default(10)
  enabled           Boolean      @default(true)
  parserKey         String?                       // opsiyonel domain parser
  groupId           String                        // hangi gruba ait

  lastCheckedAt     DateTime?
  lastError         String?

  versions          CsvVersion[]
  createdAt         DateTime     @default(now())
  updatedAt         DateTime     @updatedAt

  @@index([groupId, enabled])
}

model CsvVersion {
  id            Int       @id @default(autoincrement())
  sourceId      Int
  versionNo     Int                              // source başına auto-increment
  rawContent    String                           // ham CSV içeriği (TEXT)
  contentHash   String                           // SHA-256
  sizeBytes     Int
  isCurrent     Boolean   @default(false)
  fetchedAt     DateTime  @default(now())

  source        CsvSource @relation(fields: [sourceId], references: [id], onDelete: Cascade)

  @@unique([sourceId, contentHash])              // aynı içerik tekrar saklanmaz
  @@index([sourceId, isCurrent])                 // latest erişimi O(1)
  @@index([sourceId, fetchedAt(sort: Desc)])     // tarihsel sorgular
}
```

### 8.2 Entity İlişki Diyagramı

```
GroupProfile (1) ──── (N) CsvSource (1) ──── (N) CsvVersion
                          │                       │
                          ├── key (unique)         ├── rawContent
                          ├── filePath             ├── contentHash
                          ├── intervalMinutes      ├── isCurrent ←── latest pointer
                          ├── enabled              └── fetchedAt
                          └── lastCheckedAt
```

---

## 9. Aşamalı Geçiş Planı

### Phase 1 — Ortak Altyapı (Tahmini: 2-3 gün)

```
1. Prisma schema'ya CsvSource + CsvVersion ekle, migration çalıştır
2. CsvIngestionWorker yaz (periyodik loop, hash-check, version create)
3. REST API endpoint'leri ekle (/api/csv/...)
4. Settings UI'a "CSV Data Sources" bölümü ekle
5. Manuel "Read Now" butonu ile end-to-end test
```

**Çıktı:** Herhangi bir CSV path tanımlanıp okunabilir, ham hali saklanır, versiyonlanır.

### Phase 2 — technical_parameters.csv Entegrasyonu (Tahmini: 1 gün)

```
1. Seed: technical-parameters CsvSource kaydı oluştur
2. Worker FTP üzerinden periyodik okumaya başlar
3. Parser registry'ye parseMultiBatteryTechParams ekle
4. BatteryParamsPage'e "son versiyon" bilgisi göster (read-only)
5. Mevcut FTP route'ları AYNEN çalışmaya devam eder
```

**Çıktı:** Tech params hem eski yoldan hem yeni altyapıdan okunur. Eski akış bozulmaz.

### Phase 3 — DAM_GEN.csv Eklenmesi (Tahmini: 1-2 gün)

```
1. Settings'ten dam-gen source tanımla
2. DAM_GEN parser yaz ve registry'ye ekle
3. DAM sayfası/widget'ı yeni API'den veri çeker
4. WebSocket ile reactive güncelleme
```

### Phase 4 — Eski Akışın Migrasyonu (Opsiyonel, Tahmini: 1 gün)

```
1. BatteryParamsPage'i yeni /api/csv/technical-parameters/latest/parsed endpoint'ine çevir
2. Eski FTP read-tech-params route'unu deprecate et (hemen silme)
3. 2 hafta paralel çalıştır, sonra eski route'u kaldır
```

### Phase 5 — Yeni CSV'lerin Eklenmesi (İleride)

```
Her yeni CSV için:
1. Settings UI'dan source tanımla
2. Parser yaz (gerekiyorsa)
3. İlgili sayfada /api/csv/:key/latest kullan
```

---

## 10. Kabul Kriterleri

### AK-1: Yeni CSV Source Tanımlama
**Given** kullanıcı Settings > CSV Data Sources bölümündeyken
**When** yeni bir CSV source tanımlar (key: `dam-gen`, path: `Incoming/DAM_GEN.csv`, interval: 5 min)
**Then** kayıt veritabanına yazılır ve worker bir sonraki periyotta okumaya başlar

### AK-2: Periyodik Okuma ve Versiyonlama
**Given** aktif bir CSV source tanımı varken (`enabled: true`, `intervalMinutes: 5`)
**When** worker periyodik okuma yapar ve dosya içeriği öncekinden farklıysa
**Then** yeni bir CsvVersion kaydı oluşturulur, `isCurrent: true` olarak işaretlenir ve önceki current'ın flag'i `false` yapılır

### AK-3: Hash-Based Deduplication
**Given** worker bir CSV source'u okuduğunda
**When** hesaplanan SHA-256 hash mevcut current version ile aynıysa
**Then** yeni versiyon oluşturulmaz, yalnızca `lastCheckedAt` güncellenir

### AK-4: En Güncel Versiyona Erişim
**Given** bir CSV source için en az bir versiyon mevcutken
**When** `GET /api/csv/:sourceKey/latest` endpoint'i çağrıldığında
**Then** `isCurrent: true` olan versiyonun rawContent'i ve metadata'sı döner

### AK-5: Tarihsel Versiyonlara Erişim
**Given** bir CSV source için birden fazla versiyon mevcutken
**When** `GET /api/csv/:sourceKey/versions` endpoint'i çağrıldığında
**Then** tüm versiyonlar fetchedAt DESC sıralı, paginated olarak döner

### AK-6: Mevcut technical_parameters.csv Akışının Korunması
**Given** yeni CSV altyapısı devreye alındığında
**When** BatteryParamsPage mevcut `POST /api/ftp/read-multi-tech-params` endpoint'ini çağırdığında
**Then** mevcut akış aynen çalışır, hiçbir breaking change olmaz

### AK-7: Settings UI'da Durum Görüntüleme
**Given** tanımlı CSV source'lar varken
**When** kullanıcı Settings > CSV Data Sources bölümünü görüntülediğinde
**Then** her source için son okuma zamanı, son versiyon numarası, aktif/pasif durumu ve varsa son hata mesajı görüntülenir

### AK-8: Manuel Tetikleme
**Given** tanımlı bir CSV source varken
**When** kullanıcı "Read Now" butonuna tıkladığında
**Then** worker periyodu beklenmeden anında okuma yapılır ve sonuç UI'a yansır

### AK-9: Hata Durumunda Sistem Stabilitesi
**Given** CSV source'un FTP bağlantısı başarısız olduğunda
**When** worker periyodik okuma yapar
**Then** hata loglanır, `lastError` güncellenir, diğer source'ların okuması etkilenmez ve bir sonraki periyotta tekrar denenir

### AK-10: WebSocket Bildirimi
**Given** bir CSV source'un yeni versiyonu oluşturulduğunda
**When** içerik değişikliği tespit edilip yeni versiyon yazıldığında
**Then** `csv:updated` WebSocket event'i ilgili group'taki tüm bağlı client'lara broadcast edilir

---

## 11. Riskler ve Açık Noktalar

### Riskler

| Risk | Etki | Mitigasyon |
|---|---|---|
| Büyük CSV dosyaları (>10MB) | DB bloat, yavaş sorgular | İlk aşamada 5MB limit koy, ihtiyaç olursa blob storage'a geç |
| FTP bağlantı instabilitesi | Periyodik okuma başarısız olabilir | Retry mekanizması + exponential backoff |
| Concurrent version write | Race condition | `@@unique([sourceId, contentHash])` constraint + DB transaction |
| Retention job eksikliği | Disk dolması | Phase 1'de basit retention query implement et |

### Açık Noktalar / Varsayımlar

| # | Açık Nokta | Varsayım |
|---|---|---|
| 1 | CSV encoding standardı nedir? | UTF-8 varsayıldı. Farklı encoding varsa source tanımına `encoding` alanı eklenmeli |
| 2 | Disk-based source'lar hangi path'ten okunacak? | `server/data/csv/` altı varsayıldı. Absolute path de desteklenebilir |
| 3 | CSV parse hataları nasıl handle edilecek? | Raw content her zaman saklanır, parse hatası ayrı loglanır — veri kaybı olmaz |
| 4 | Multi-group senaryoda her group kendi source'larını mı tanımlayacak? | Evet varsayıldı — `CsvSource.groupId` ile izole |
| 5 | Write-back (CSV'ye yazma) yeni altyapıdan mı yapılacak? | Hayır — write işlemleri mevcut FTP route'larından devam eder. Yeni altyapı read-only |
| 6 | DAM_GEN.csv'nin parse formatı nedir? | Henüz bilinmiyor — Phase 3'te tanımlanacak |
| 7 | İleride gelecek 4-5 CSV'nin listesi ve formatları | Henüz bilinmiyor — altyapı format-agnostik tasarlandı |

---

## 12. Teknik Ekibe Final Öneri

**Mevcut yapıyı bozmadan, ölçeklenebilir bir CSV ingestion pipeline kuruyoruz.**

Temel prensip: **"Read → Hash → Store → Serve"** döngüsü. Her CSV dosyası bir `CsvSource` kaydıyla tanımlanır, periyodik olarak okunur, ham hali `CsvVersion` tablosunda saklanır, hash-based dedup ile gereksiz kopya önlenir, `isCurrent` flag ile en güncel versiyon O(1) erişilir.

Mevcut `technical_parameters.csv` akışı (FTP route → parse → BatteryParamsPage) **aynen korunur**. Yeni altyapı paralel çalışır. Adaptasyon opsiyonel ve aşamalıdır.

Settings UI'dan yeni CSV tanımı eklemek, periyot ayarlamak ve durumu izlemek mümkündür. Her yeni CSV tipi için sadece source tanımı + (opsiyonel) parser eklenmesi yeterlidir.

**Uygulama sırası:** Önce altyapı (schema + worker + API + UI), sonra technical_parameters entegrasyonu (paralel), sonra DAM_GEN, sonra diğer CSV'ler. Her aşama bağımsız deploy edilebilir, rollback riski minimal.

Tahmini toplam efor: **5-7 geliştirici günü** (Phase 1-3 dahil).
