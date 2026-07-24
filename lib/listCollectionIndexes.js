import { checkCollection } from "../utils/checks.js";
import { INDEXNAME } from "../utils/constants.js";
import { Wrap } from "../utils/errors.js";
import { isFile, readdir } from "../utils/fs.js";
import { path } from "../utils/fs.js";
import { existsSync } from "fs";

export async function listCollectionIndexes(collection) {
    let collectionError = checkCollection(collection);
    if (collectionError instanceof Error)
        throw Wrap("Cannot start viewCollectionDocuments", collectionError);

    try {
        let documents = readdir(collection);
        return Array.from(
            new Set(
                documents
                    .filter((a) => a.endsWith(".json"))
                    .filter((a) => a.slice(0, -5).match(INDEXNAME))
                    .filter((a) => isFile(collection, a))
                    .map((a) => a.slice(0, -5)),
            ).values(),
        );
    } catch (e) {
        throw Wrap("Cannot run viewCollectionDocuments", e);
    }
}

export function listBuildingIndexes(collection) {
    try {
        return readdir(collection)
            .filter((name) => name.startsWith(".") && name.endsWith(".building.json"))
            .map((name) => name.slice(1, -".building.json".length))
            .filter((name) => name.match(INDEXNAME));
    } catch (_) {
        return [];
    }
}

export function isIndexBuilding(collection, index) {
    try {
        return existsSync(path(collection, `.${index}.building.json`));
    } catch (_) {
        return false;
    }
}
