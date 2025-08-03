import {
    checkCollection,
    checkIndex,
    checkIndexConfig,
    isDefined,
} from "../utils/checks.js";
import { Wrap } from "../utils/errors.js";
import { appendjsonl, exists, readfile, writejson } from "../utils/fs.js";
import { listCollectionDocuments } from "./listCollectionDocuments.js";

export async function createIndex(index, config, collection) {
    let indexError = checkIndex(index);
    if (indexError instanceof Error)
        throw Wrap("Cannot start createIndex", indexError);
    let configError = checkIndexConfig(config);
    if (configError instanceof Error)
        throw Wrap("Cannot start createIndex", configError);
    let collectionError = checkCollection(collection);
    if (collectionError instanceof Error)
        throw Wrap("Cannot start createIndex", collectionError);

    try {
        if (exists(collection, `${index}.json`) === false) {
            writejson(config, collection, `${index}.json`);
            writejson("", collection, `${index}.jsonl`);

            let documents = await listCollectionDocuments(collection);
            for (let i = 0; i < documents.length; i++) {
                let document = documents[i];
                let documentObj = JSON.parse(
                    readfile(collection, `${document}.json`),
                );
                let indexConfigKeys = Object.keys(config);
                let shouldGoIntoIndex = indexConfigKeys.every(
                    (indexConfigKey) => {
                        if (config[indexConfigKey] === true) {
                            return (
                                isDefined(documentObj[indexConfigKey]) === true
                            );
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
                            documentObj[indexConfigKey],
                        ]),
                    ]);
                    appendjsonl(indexObj, collection, `${index}.jsonl`);
                }
            }
        } else {
            throw new Error("Index exists");
        }
    } catch (e) {
        throw Wrap("Cannot run createIndex", e);
    }
}
