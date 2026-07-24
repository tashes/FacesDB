# FacesDB

FacesDB is a local-first database designed to make managing and syncing data seamless and efficient. With a focus on user-friendly operations and robust synchronization capabilities, FacesDB enables developers to create, update, and manage local collections of data with ease, while ensuring that data remains consistent across different environments. This project is ideal for applications that require offline-first capabilities with reliable syncing to a central source once connectivity is established.

## Main Features

- **Local-First Design:** Prioritizes local data storage to ensure accessibility and performance regardless of network conditions.
- **Efficient Synchronization:** Automatically syncs data with a central database when connectivity is restored, ensuring consistency.
- **User-Friendly API:** Simplifies tasks like creating, updating, and retrieving data with clear and intuitive functions.
- **Cross-Environment Consistency:** Maintains data uniformity across various platforms and devices.
- **Offline Capability:** Enables applications to function effectively without an internet connection and sync updates once online.

## Installation

```bash
npm install facesdb
```

## Usage

```javascript
import {createCollection, createDocument, putDocument} from "facesdb";

// Create a collection
await createCollection("collectionname");

// Create a document
let document = await createDocument("collectionname", {
    item: 1,
    thing: 2
});
console.log(document)

// {
//     "_id": "A3CA8CE2EAffa8aae9Cd5A67",
//     "item": 1,
//     "thing": 2
// }

// View a document
let samedocument = await viewDocument("collectionname", "A3CA8CE2EAffa8aae9Cd5A67");
console.log(samedocument)

// {
//     "_id": "A3CA8CE2EAffa8aae9Cd5A67",
//     "item": 1,
//     "thing": 2
// }

// Update a document
let updateddocument = await putDocument("collectionname", "A3CA8CE2EAffa8aae9Cd5A67", {
    boo: "foo",
    example: true
});
console.log(updateddocument);

// {
//     "_id": "A3CA8CE2EAffa8aae9Cd5A67",
//     "boo": "foo",
//     "example": true
// }

// Delete a document
await deleteDocument("collectionname", "A3CA8CE2EAffa8aae9Cd5A67");
```

### Ranked Indexes

Use `rankIndex` to reorder every entry in an existing index. An optional exclusion
callback removes matching entries before the remaining entries are sorted.

```javascript
import { rankIndex } from "facesdb"

await rankIndex(
    "scores",
    "players",
    (a, b) => b.score - a.score,
    (player) => player.disqualified === true,
)
```

Ranking replaces the index atomically. If reading, filtering, sorting, or writing
fails, the existing index is left in place.

Indexes keep their JSONL source alongside three rebuildable calculated sidecars:

```text
players/
├── <document-id>.json
├── scores.json
├── scores.jsonl
├── scores.offsets
├── scores.lookup
└── scores.lookup.delta
```

`scores.offsets` stores one 8-byte position per JSONL row, so page `n` can seek directly to
`32 + n × 8` without reading earlier entries. `scores.lookup` stores fixed-width document-ID,
offset, and length records for binary-search lookup; newly appended documents are recorded in the
bounded delta until the sidecar is rebuilt. These files are derived, ignored by Git, rebuilt when
stale, and never replace the JSON documents or JSONL index as the source of truth.

```javascript
import { findIndexEntry } from "facesdb"

const indexed = await findIndexEntry(
    "scores",
    "players",
    "0123456789abcdef01234567",
)
```

### Key-Value Store

FacesDB ships with a restart-persistent, rebuildable key:value cache. Cache data lives in the
Git-ignored `.kvstore-cache` directory and is divided into calculated lookup partitions. Each
Node.js process owns its append-only writer logs, so normal operations never take a partition-wide
lock. Cross-process FIFO locks are scoped to the individual key: reads wait for an active write to
that key while unrelated keys proceed concurrently.

```text
.kvstore-cache/
├── manifest.json
└── partitions/
    └── 7f/
        ├── CURRENT
        ├── base-<generation>.jsonl
        ├── base-<generation>.lookup
        └── writers/
            ├── <next-process>.active.jsonl
            └── <worker-process>.active.jsonl
```

Partitions are storage divisions, not lock scopes. Each process writes only to its own log.
Compaction publishes immutable base generations and retires old logs after a grace period.

```javascript
import {
    setKV,
    setManyKV,
    getKV,
    getManyKV,
    deleteKV,
    deleteManyKV,
    hasKV,
    hasManyKV,
    updateKV,
} from "facesdb"

await setKV("session:user:42", { userId: 42, flags: ["beta"] })

const session = await getKV("session:user:42")
// { userId: 42, flags: ["beta"] }

const isCached = await hasKV("session:user:42") // true
await deleteKV("session:user:42")

// Mutations wait up to 30 seconds by default. Override the bounded wait when needed.
await setKV("cache:homepage", { generatedAt: Date.now() }, {
    timeoutMs: 5_000,
    namespace: "cache",
})

// Buffered persistence is the cache-oriented default. Request an fsync when required.
await setKV("important-cache-key", { retained: true }, { durability: "sync" })

await setManyKV([
    ["session:user:42", { userId: 42 }],
    ["session:user:84", { userId: 84 }],
])

const deleted = await deleteManyKV([
    "session:user:42",
    "session:user:84",
]) // [true, true]

const cached = await getManyKV(["session:user:42", "missing"])
// [{ userId: 42 }, undefined]

await updateKV("article:42:views", (views = 0) => views + 1)
```

`updateKV` and `updateDocument` callbacks must be synchronous and quick. Perform expensive work
first; use `getVersionedKV` and `compareAndSetKV` when a calculated result must be rejected if the
state it was based on has changed.

Values must be JSON-serializable so they can be safely written to disk, and every read returns a defensive copy so callers can mutate results without affecting the underlying store.
Batch mutations validate all inputs before changing the cache, lock unique keys in deterministic
order, and preserve input-aligned results. Atomicity is per key/partition rather than a global
cache transaction.

For inputs too large to retain along with an input-aligned result array, `importManyKV` consumes
an iterable in bounded atomic batches and returns counts instead:

```javascript
import { importManyKV } from "facesdb"

const result = await importManyKV(sourceAsyncIterable, { batchSize: 10_000 })
// { count: 1_000_000, batches: 100 }
```

Each key update is atomic; a later validation or persistence error does not roll back chunks that
were already written. A batch spanning partitions is deliberately not a global transaction.

Existing `.kvstore`, snapshot, and WAL caches are migrated automatically and retained as legacy
backups. Cache writer logs are checksummed; incomplete or corrupt cache records are ignored as
misses because cache values are rebuildable.

Operations are scheduled in strict arrival order for each key, including across Node.js processes
on the same host and local filesystem. Network filesystems are outside this guarantee. Priority is
optional diagnostic metadata and does not change that ordering:

```javascript
import { observeKVLocks, setKV } from "facesdb"

const stopObserving = observeKVLocks((event) => console.log(event))
await setKV("session:user:42", { active: true }, {
    priority: "foreground",
    timeoutMs: 5_000,
    namespace: "sessions",
})
stopObserving()
```

Lock events contain a SHA-256 resource hash rather than the raw key or value. The default operation
timeout is 30 seconds; supported priority labels are `foreground`, `normal`, and `background`.

Documents, indexes, buckets, and collection lifecycle operations use the same shared-read and
exclusive-write resource locks. Use `updateDocument(collection, id, updater)` for an atomic
read-modify-write; `putDocument` remains an explicit last-write-wins replacement.

### Migrations

FacesDB can enforce a consistent document shape across an entire collection with the `migrate` helper. Pass the collection name and a callback that receives each document and returns its new shape.

```javascript
import { migrate } from "facesdb"

await migrate("users", (user) => ({
    ...user,
    isActive: true,
}))
```

Rules for migrations:

- The callback must return an object that contains the **same `_id`** as the incoming document.
- Only documents whose contents change are rewritten; untouched documents are left as-is.
- Updates are transactional: FacesDB writes all new versions to a temporary folder, swaps them into place, rebuilds indexes, and removes the folder. Any error restores the original files.

The full docs can be found [here](https://github.com/tashes/FacesDB/wiki)

## Contributing

Contributions are welcome! Feel free to open issues or submit pull requests. For major changes, please open an issue to discuss the proposed modifications.

## License

FacesDB is licensed under the MIT License.
