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

The full docs can be found at: [TODO]()

## Contributing

Contributions are welcome! Feel free to open issues or submit pull requests. For major changes, please open an issue to discuss the proposed modifications.

## License

FacesDB is licensed under the MIT License.
