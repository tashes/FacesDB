import { checkCollection, checkIndex, checkIndexConfig } from "../utils/checks";
import { Wrap } from "../utils/errors";
import { appendjsonl, exists, readfile } from "../utils/fs";

export async function createIndex(index, config, collection) {
    let indexError = checkIndex(index);
    if (indexError instanceof Error)
        throw Wrap("Cannot start createIndex", indexError);
    let configError = checkIndexConfig(config);
    if (configError instanceof Error)
        throw Wrap("Cannot start createIndex", configError);
    let collectionError = checkCollection(collection);
    if (collectionError instanceof Error)
        throw Wrap("Cannot start createIndex", collection);

    try {
        if (exists(collection, `${index}.json`) === false) {
            let documents = await listCollectionDocuments(collection);
            for (let i = 0; i < documents.length; i++) {
                let document = documents[i];
                let documentObj = JSON.parse(readfile(collection, document));
                let indexConfigKeys = Object.keys(config);
                let shouldGoIntoIndex = indexConfigKeys.every(
                    (indexConfigKey) => {
                        if (indexConfig[indexConfigKey] === true) {
                            return (
                                isDefined(documentObj[indexConfigKey]) === true
                            );
                        } else {
                            return true;
                        }
                    },
                );
                if (shouldGoIntoIndex === true) {
                    let indexObjJSON = JSON.stringify(
                        Object.fromEntries([
                            ["_id", document],
                            ...indexConfigKeys.map((indexConfigKey) => [
                                indexConfigKey,
                                documentObj[indexConfigKey],
                            ]),
                        ]),
                    );
                    appendjsonl(indexObjJSON, collection, `${index}.json`);
                }
            }
        }
    } catch (e) {
        throw Wrap("Cannot run createIndex", e);
    }
}
