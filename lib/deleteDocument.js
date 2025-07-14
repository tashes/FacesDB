import { checkCollection, checkDocument } from "../utils/checks.js";
import { Wrap } from "../utils/errors.js";
import { deletejsonl, exists, jsonlexists, rm } from "../utils/fs.js";
import { listCollectionIndexes } from "./listCollectionIndexes.js";

export async function deleteDocument(collection, document) {
    let collectionError = checkCollection(collection);
    if (collectionError instanceof Error)
        throw Wrap("Cannot start deleteDocument", collectionError);
    let documentError = checkDocument(document);
    if (documentError instanceof Error)
        throw Wrap("Cannot start deleteDocument", documentError);

    try {
        // Check if document exists
        if (exists(collection, `${document}.json`)) {
            // Remove document
            rm(collection, `${document}.json`);

            // Run through indexes and add to the correct ones
            let indexes = await listCollectionIndexes(collection);
            for (let i = 0; i < indexes.length; i++) {
                let indexName = indexes[i];
                if (
                    await jsonlexists(
                        document,
                        collection,
                        `${indexName}.jsonl`,
                    )
                ) {
                    await deletejsonl(
                        document,
                        collection,
                        `${indexName}.jsonl`,
                    );
                }
            }
        } else {
            throw new Error("Document does not exist");
        }
    } catch (e) {
        throw Wrap("Cannot run deleteDocument", e);
    }
}
