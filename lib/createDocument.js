import {
    checkCollection,
    checkDocumentobj,
    isDefined,
} from "../utils/checks.js";
import { appendjsonl, exists, writejson } from "../utils/fs.js";
import { newid } from "../utils/ids.js";
import { listCollectionIndexes } from "./listCollectionIndexes.js";
import { viewIndexConfig } from "./viewIndexConfig.js";
import { Wrap } from "../utils/errors.js";
import { deepcopy } from "../utils/deepcopy.js";

export async function createDocument(collection, documentobj) {
    let collectionError = checkCollection(collection);
    if (collectionError instanceof Error)
        throw Wrap("Cannot start createDocument", collectionError);
    let documentobjError = checkDocumentobj(documentobj);
    if (documentobjError instanceof Error)
        throw Wrap("Cannot start createDocument", documentobjError);

    try {
        // Create ID
        let id = newid();
        if (exists(collection, `${id}.json`) === false) {
            let copy = deepcopy(documentobj);
            copy._id = id;

            // Add to collection
            writejson(copy, collection, `${id}.json`);

            // Run through indexes and add to the correct ones.
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
                        ["_id", id],
                        ...indexConfigKeys.map((indexConfigKey) => [
                            indexConfigKey,
                            copy[indexConfigKey],
                        ]),
                    ]);
                    appendjsonl(indexObj, collection, `${indexName}.jsonl`);
                }
            }

            return copy;
        } else {
            throw Wrap("Document exists");
        }
    } catch (e) {
        throw Wrap("Cannot run createDocument", e);
    }
}
