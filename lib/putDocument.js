import {
    checkCollection,
    checkDocument,
    checkDocumentobj,
    isDefined,
} from "../utils/checks.js";
import { deepcopy } from "../utils/deepcopy.js";
import { Wrap } from "../utils/errors.js";
import {
    appendjsonl,
    deletejsonl,
    editjsonlraw,
    exists,
    isFile,
    jsonlexists,
    writejson,
} from "../utils/fs.js";
import { listCollectionIndexes } from "./listCollectionIndexes.js";
import { viewIndexConfig } from "./viewIndexConfig.js";

export async function putDocument(collection, document, documentobj) {
    let collectionError = checkCollection(collection);
    if (collectionError instanceof Error)
        throw Wrap("Cannot start putDocument", collectionError);
    let documentError = checkDocument(document);
    if (documentError instanceof Error)
        throw Wrap("Cannot start putDocument", documentError);
    let documentobjError = checkDocumentobj(documentobj);
    if (documentobjError instanceof Error)
        throw Wrap("Cannot start putDocument", documentobjError);

    try {
        // Check if it exists
        if (
            exists(collection, `${document}.json`) === true &&
            isFile(collection, `${document}.json`)
        ) {
            // Ensure object has id
            let copy = deepcopy(documentobj);
            copy._id = document;

            // Overwrite to collection
            writejson(copy, collection, `${document}.json`);

            // Run through indexes and add to correct ones
            let indexes = await listCollectionIndexes(collection);
            for (let i = 0; i < indexes.length; i++) {
                let indexName = indexes[i];
                let indexConfig = await viewIndexConfig(indexName, collection);
                let indexConfigKeys = Object.keys(indexConfig);
                let shouldGoIntoIndex = indexConfigKeys.every(
                    (indexConfigKey) => {
                        if (indexConfig[indexConfigKey] === true) {
                            return isDefined(copy[indexConfigKey]) === true;
                        } else {
                            return true;
                        }
                    },
                );
                if (shouldGoIntoIndex === true) {
                    let indexObj = Object.fromEntries([
                        ["_id", document],
                        ...indexConfigKeys.map((indexConfigKey) => [
                            indexConfigKey,
                            copy[indexConfigKey],
                        ]),
                    ]);
                    // Replace or add to index
                    if (
                        await jsonlexists(
                            document,
                            collection,
                            `${indexName}.jsonl`,
                        )
                    ) {
                        await editjsonlraw(
                            document,
                            indexObj,
                            collection,
                            `${indexName}.jsonl`,
                        );
                    } else {
                        appendjsonl(indexObj, collection, `${indexName}.jsonl`);
                    }
                } else {
                    // Remove from index
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

            return copy;
        } else {
            throw new Error("Document does not exist");
        }
    } catch (e) {
        throw Wrap("Cannot run putDocument", e);
    }
}
