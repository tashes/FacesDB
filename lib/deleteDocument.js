import { checkCollection, checkDocument } from "../utils/checks";
import { Wrap } from "../utils/errors";
import { deletejsonl, exists, jsonlexists, rm } from "../utils/fs";

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
            let indexes = listCollectionIndexes();
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
        }
    } catch (e) {
        throw Wrap("Cannot run deleteDocument", e);
    }
}
