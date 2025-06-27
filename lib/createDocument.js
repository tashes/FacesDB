import { checkCollection, checkDocumentobj, isDefined } from "../utils/checks";
import { appendjsonl, writejson } from "../utils/fs";
import { newid } from "../utils/ids";
import { listCollectionIndexes } from "./listCollectionIndexes";
import { viewIndexConfig } from "./viewIndexConfig";

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
        let copy = deepcopy(documentobj);
        copy._id = id;

        // Add to collection
        writejson(JSON.stringify(copy), collection, `${id}.json`);

        // Run through indexes and add to the correct ones.
        let indexes = listCollectionIndexes();
        for (let i = 0; i < indexes.length; i++) {
            let indexName = indexes[i];
            let indexConfig = await viewIndexConfig(collection, indexName);
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
                        ["_id", id],
                        ...indexConfigKeys.map((indexConfigKey) => [
                            indexConfigKey,
                            copy[indexConfigKey],
                        ]),
                    ]),
                );
                appendjsonl(indexObjJSON, collection, `${indexName}.jsonl`);
            }
        }
    } catch (e) {
        throw Wrap("Cannot run createDocument", e);
    }
}
