import {
    checkCollection,
    checkDocument,
    checkDocumentobj,
    isDefined,
} from "../utils/checks";
import { deepcopy } from "../utils/deepcopy";
import {
    appendjsonl,
    deletejsonl,
    editjsonlraw,
    jsonlexists,
} from "../utils/fs";
import { listCollectionIndexes } from "./listCollectionIndexes";

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
        // Ensure object has id
        let copy = deepcopy(documentobj);
        copy._id = document;

        // Overwrite to collection
        writejson(JSON.stringify(copy), collection, `${document}.json`);

        // Run through indexes and add to correct ones
        let indexes = listCollectionIndexes();
        for (let i = 0; i < indexes.length; i++) {
            let indexName = indexes[i];
            let indexConfig = await viewIndexConfig(collection, indexName); //TODO IMPORT
            let indexConfigKeys = Object.keys(indexConfig);
            let shouldGoIntoIndex = indexConfigKeys.every((indexConfigKey) => {
                if (indexConfig[indexConfigKey] === true) {
                    return isDefined(copy[indexConfigKey]) === true;
                } else {
                    return true;
                }
            });
            if (shouldGoIntoIndex === true) {
                let indexObjJSON = JSON.stringify(
                    Object.fromEntries([
                        ["_id", document],
                        ...indexConfigKeys.map((indexConfigKey) => [
                            indexConfigKey,
                            copy[indexConfigKey],
                        ]),
                    ]),
                );
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
                        obj,
                        collection,
                        `${indexName}.jsonl`,
                    );
                } else {
                    appendjsonl(indexObjJSON, collection, `${indexName}.jsonl`);
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
    } catch (e) {
        throw Wrap("Cannot run putDocument", e);
    }
}
