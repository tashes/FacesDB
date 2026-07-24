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

### Key-Value Store

FacesDB ships with a lightweight, Redis-like key:value store. Every acknowledged change is
durably appended to a checksummed write-ahead log in the FacesDB data directory. Periodic
snapshots keep startup fast, and process-safe key locks serialize changes to the same key while
allowing unrelated keys in separate local Node.js processes to proceed independently.

```javascript
import {
    setKV,
    setManyKV,
    getKV,
    deleteKV,
    deleteManyKV,
    hasKV,
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

await setManyKV([
    ["session:user:42", { userId: 42 }],
    ["session:user:84", { userId: 84 }],
])

const deleted = await deleteManyKV([
    "session:user:42",
    "session:user:84",
]) // [true, true]
```

Values must be JSON-serializable so they can be safely written to disk, and every read returns a defensive copy so callers can mutate results without affecting the underlying store.
Batch mutations validate all inputs before changing the store and persist the entire batch in
one atomic commit.

For inputs too large to retain along with an input-aligned result array, `importManyKV` consumes
an iterable in bounded atomic batches and returns counts instead:

```javascript
import { importManyKV } from "facesdb"

const result = await importManyKV(sourceAsyncIterable, { batchSize: 10_000 })
// { count: 1_000_000, batches: 100 }
```

Each chunk is atomic; a later validation or persistence error does not roll back chunks that were
already committed.

Existing `.kvstore` files are migrated automatically and retained as `.kvstore.legacy`.

Mutations are scheduled in strict arrival order for each key, including across Node.js processes
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

Lock events contain a SHA-256 key hash rather than the raw key or value. The default mutation
timeout is 30 seconds; supported priority labels are `foreground`, `normal`, and `background`.

### Git-friendly segmented collections

For large collections, stream documents into immutable JSONL segments instead of creating one
file per document:

```javascript
import {
    deleteSegmentDocuments,
    importDocuments,
    viewDocument,
} from "facesdb"

await importDocuments("users", sourceAsyncIterable, { nodeId: "worker-a" })
const user = await viewDocument("users", "0123456789abcdef01234567")

await deleteSegmentDocuments("users", ["0123456789abcdef01234567"], {
    nodeId: "worker-a",
})
```

Segment files under `users/segments/` are immutable and intended to be committed to Git. Every
node writes uniquely named segments, so merges add files rather than appending to a shared file.
FacesDB builds hash-sharded byte-offset indexes under `users/.facesdb/`; these indexes are ignored
by Git and rebuilt automatically after a pull or clone. Newer segments override older values, and
deletions are represented by immutable tombstone segments.

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
