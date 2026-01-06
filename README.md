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

### Key-Value Store

FacesDB ships with a lightweight, Redis-like key:value store that keeps data in memory for fast access while persisting every change to the FacesDB data directory.

```javascript
import { setKV, getKV, deleteKV, hasKV } from "facesdb"

await setKV("session:user:42", { userId: 42, flags: ["beta"] })

const session = await getKV("session:user:42")
// { userId: 42, flags: ["beta"] }

const isCached = await hasKV("session:user:42") // true
await deleteKV("session:user:42")
```

Values must be JSON-serializable so they can be safely written to disk, and every read returns a defensive copy so callers can mutate results without affecting the underlying store.

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
