# File Ingestion Pipeline — Spec

**Tarih:** 2026-04-08
**Durum:** Onaylandi

## Amac

SmartPulse Portal FTP'deki dosyalari (CSV, JSON, XML) periyodik olarak okuyup PostgreSQL'de versiyonlayan, en guncel veriyi aninda servis eden, Settings UI'dan yeni dosya tanimlari eklemeye izin veren ortak bir altyapi.

## Veri Akisi

```
Settings UI → FileSource tanimi (direction, filename, interval)
FileIngestionWorker → periyodik FTP okuma → hash kontrol → FileVersion yazma → WS broadcast
REST API → latest/parsed, versions, force-read, save-back, test
Client → useFileSource hook (DB aninda + FTP arka plan + WS reactive)
```

## Prisma Modeli

### FileSource

| Alan | Tip | Aciklama |
|---|---|---|
| id | Int @id | Auto-increment |
| key | String | Benzersiz slug: "technical-parameters", "dam-gen" |
| displayName | String | UI'da gorunen isim |
| filename | String | FTP dosya adi: "Technical_Parameters.csv" |
| direction | String | "incoming" \| "outgoing" |
| fileType | String? | "csv" \| "json" \| "xml" \| null (auto-detect from extension) |
| intervalMinutes | Int | Okuma periyodu (default: 10) |
| enabled | Boolean | Aktif/pasif (default: true) |
| parserKey | String? | Domain-specific parser key (opsiyonel) |
| groupId | String | Hangi gruba ait |
| lastCheckedAt | DateTime? | Son kontrol zamani |
| lastError | String? | Son hata mesaji |

Constraints: `@@unique([groupId, key])`, `@@index([groupId, enabled])`

### FileVersion

| Alan | Tip | Aciklama |
|---|---|---|
| id | Int @id | Auto-increment |
| sourceId | Int | FK → FileSource |
| versionNo | Int | Source basina auto-increment |
| rawContent | String | Ham dosya icerigi (TEXT) |
| contentHash | String | SHA-256 |
| sizeBytes | Int | Dosya boyutu |
| isCurrent | Boolean | En guncel versiyon flag'i |
| fetchedAt | DateTime | Okunma zamani |

Constraints: `@@unique([sourceId, contentHash])`, `@@index([sourceId, isCurrent])`

## REST API Endpoints

| Method | Path | Aciklama |
|---|---|---|
| GET | /api/files/sources | Tum source tanimlari (group bazli) |
| POST | /api/files/sources | Yeni source ekle |
| PUT | /api/files/sources/:id | Source guncelle |
| DELETE | /api/files/sources/:id | Source sil |
| GET | /api/files/:key/latest | En guncel versiyon (raw + metadata) |
| GET | /api/files/:key/latest/parsed | Parse edilmis versiyon (parser varsa) |
| GET | /api/files/:key/versions | Tarihsel liste (paginated) |
| POST | /api/files/:key/force-read | FTP'den aninda oku, yeni versiyon varsa yaz |
| POST | /api/files/:key/force-read-and-sync | Force-read + attribute sync (tech-params icin) |
| POST | /api/files/:key/test | Tek seferlik FTP oku + icerik don (preview icin) |
| POST | /api/files/:key/save | FTP'ye geri yaz |

## FileIngestionWorker

- Server basligicinda aktif source'lari yukler
- Her source icin bagimsiz setInterval (intervalMinutes)
- FtpService.readFile() ile okur
- SHA-256 hash hesaplar
- Hash ayni → lastCheckedAt guncelle, skip
- Hash farkli → yeni FileVersion yaz, isCurrent flag guncelle
- WebSocket "file:updated" event broadcast
- Hata → lastError guncelle, diger source'lari etkilemez

## useFileSource Hook

```typescript
interface UseFileSourceResult<T> {
  raw: string | null;           // ham icerik
  parsed: T | null;             // parse edilmis (parser varsa)
  loading: boolean;             // ilk yukleme
  refreshing: boolean;          // arka plan FTP refresh
  versionNo: number | null;
  fetchedAt: string | null;
  refresh: () => Promise<void>;           // DB + arka plan FTP
  forceReadAndSync: () => Promise<void>;  // FTP bekle + sync
}
```

Davranis:
1. Mount → GET /latest/parsed (DB'den aninda)
2. Mount → POST /force-read (arka plan, beklemez)
3. WS "file:updated" dinler → otomatik re-fetch
4. refresh() → ayni mekanizma (1+2)
5. forceReadAndSync() → POST /force-read-and-sync bekler, sonra re-fetch

## Settings UI — File Sources

Kart listesi: her source icin direction, filename, interval, durum, son okuma, versiyon no.
[+ Add] butonu ile yeni source formu: key, direction, filename, interval, enabled.
[Test] butonu → POST /test → modal popup acilir.
[Read Now] → POST /force-read.
[Edit] → inline edit formu.

## Preview Popup (Test)

Uzantiya gore viewer secimi:
- .csv, .tsv → HTML table
- .json → JSON tree viewer (collapsible)
- .xml → XML syntax highlighted
- Diger → Raw text (monospace, line numbers)

Alt kisimda [Save Back to FTP] butonu (POST /save endpoint'i).

## BatteryParamsPage Entegrasyonu

Mevcut: ftpApi.readMultiTechParams() → FTP → parse → goster
Yeni: useFileSource('technical-parameters', { parser: 'tech-params', autoRefresh: true })

- Sayfa acilis → DB'den aninda goster + arka plan FTP refresh
- Refresh butonu → refresh()
- Sync Attributes → forceReadAndSync()

Mevcut FTP route'lari (read-multi-tech-params, write-tech-params) kalir, silinmez.

## Seed Data

technical-parameters source'u migration/seed ile olusturulur:
- key: "technical-parameters"
- displayName: "Technical Parameters"
- filename: profile.assetMapping.ftpFilename ?? "Technical_Parameters.csv"
- direction: profile.assetMapping.ftpDirection ?? "incoming"
- intervalMinutes: 10
- parserKey: "tech-params"

## Parser Registry

```typescript
const FILE_PARSERS: Record<string, (raw: string) => unknown> = {
  'tech-params': parseMultiBatteryTechParams,
  // ileride: 'dam-gen': parseDamGen
};
```

## Kabul Kriterleri

AK-1: Given Settings'te yeni file source eklendiginde, When direction=incoming, filename=DAM_GEN.csv, interval=5 secildiginde, Then DB'ye FileSource kaydi yazilir ve worker bir sonraki periyotta okumaya baslar.

AK-2: Given aktif bir file source varken, When worker periyodik okuma yapar ve dosya icerigi oncekinden farkliysa, Then yeni FileVersion olusturulur ve WebSocket event broadcast edilir.

AK-3: Given worker bir dosya okudugunda, When SHA-256 hash mevcut current ile ayniysa, Then yeni versiyon olusturulmaz.

AK-4: Given BatteryParamsPage acildiginda, When useFileSource hook mount edildiginde, Then DB'den son versiyon aninda gosterilir VE arka planda FTP refresh tetiklenir.

AK-5: Given BatteryParamsPage'de Refresh butonuna basildiginda, When refresh() cagrildiginda, Then ayni mekanizma calisir (DB aninda + FTP arka plan).

AK-6: Given Sync Attributes butonuna basildiginda, When forceReadAndSync() cagrildiginda, Then once FTP'den taze veri cekilir, sonra attribute sync yapilir, sonra UI guncellenir.

AK-7: Given Settings'te [Test] butonuna basildiginda, When FTP'den dosya basariyla okundugunda, Then dosya tipi otomatik algilanir ve uygun viewer ile modal popup'ta gosterilir.

AK-8: Given preview popup'ta [Save Back to FTP] butonuna basildiginda, When icerik FTP'ye basariyla yazildiginda, Then basari mesaji gosterilir.

AK-9: Given mevcut BatteryParamsPage FTP route'lari varken, When yeni file ingestion altyapisi devreye alindiginda, Then eski route'lar calismaya devam eder.

AK-10: Given bir file source'un FTP baglantisi basarisiz oldugunda, When worker periyodik okuma yapar, Then hata loglanir, lastError guncellenir, diger source'lar etkilenmez.
