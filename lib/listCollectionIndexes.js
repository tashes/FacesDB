import { checkCollection } from "../utils/checks.js";
import { INDEXNAME } from "../utils/constants.js";
import { Wrap } from "../utils/errors.js";
import { atomicwritejson, isFile, readfile, readdir } from "../utils/fs.js";
import { path } from "../utils/fs.js";
import { existsSync } from "fs";

export async function listCollectionIndexes(collection) {
    let collectionError = checkCollection(collection);
    if (collectionError instanceof Error)
        throw Wrap("Cannot start viewCollectionDocuments", collectionError);

    try {
        if (existsSync(path(collection, ".index-catalog.json"))) {
            const catalog = JSON.parse(readfile(collection, ".index-catalog.json"));
            return Array.isArray(catalog) ? catalog : catalog.indexes ?? [];
        }
        let documents = readdir(collection);
        const indexes = Array.from(
            new Set(
                documents
                    .filter((a) => a.endsWith(".json"))
                    .filter((a) => a.slice(0, -5).match(INDEXNAME))
                    .filter((a) => isFile(collection, a))
                    .map((a) => a.slice(0, -5)),
            ).values(),
        );
        try { atomicwritejson(indexes, collection, ".index-catalog.json"); } catch (_) {}
        return indexes;
    } catch (e) {
        throw Wrap("Cannot run viewCollectionDocuments", e);
    }
}

function readCatalog(collection) {
    const catalog = JSON.parse(readfile(collection, ".index-catalog.json"));
    return Array.isArray(catalog)
        ? { version: 1, indexes: catalog, building: [] }
        : { version: 1, indexes: catalog.indexes ?? [], building: catalog.building ?? [] };
}

export function writeIndexCatalog(collection, indexes, building) {
    let current = { indexes: [], building: [] };
    try { current = readCatalog(collection); } catch (_) {}
    atomicwritejson({
        version: 1,
        indexes: [...new Set(indexes)].sort(),
        building: [...new Set(building ?? current.building)].sort(),
    }, collection, ".index-catalog.json");
}

export function removeIndexFromCatalog(collection, index) {
    const catalogPath = path(collection, ".index-catalog.json");
    if (existsSync(catalogPath) === false) return;
    const catalog = readCatalog(collection);
    writeIndexCatalog(
        collection,
        catalog.indexes.filter((name) => name !== index),
        catalog.building.filter((name) => name !== index),
    );
}

export function listBuildingIndexes(collection) {
    try {
        if (existsSync(path(collection, ".index-catalog.json"))) {
            return readCatalog(collection).building;
        }
        return readdir(collection)
            .filter((name) => name.startsWith(".") && name.endsWith(".building.json"))
            .map((name) => name.slice(1, -".building.json".length))
            .filter((name) => name.match(INDEXNAME));
    } catch (_) {
        return [];
    }
}


export async function markIndexBuilding(collection, index) {
    const indexes = await listCollectionIndexes(collection);
    let building = [];
    try { building = readCatalog(collection).building; } catch (_) {}
    writeIndexCatalog(collection, indexes, [...building, index]);
}

export function finishIndexBuilding(collection, index) {
    const catalog = readCatalog(collection);
    writeIndexCatalog(
        collection,
        [...catalog.indexes, index],
        catalog.building.filter((name) => name !== index),
    );
}

export function clearIndexBuilding(collection, index) {
    try {
        const catalog = readCatalog(collection);
        writeIndexCatalog(
            collection,
            catalog.indexes,
            catalog.building.filter((name) => name !== index),
        );
    } catch (_) {}
}

export function isIndexBuilding(collection, index) {
    try {
        return existsSync(path(collection, `.${index}.building.json`));
    } catch (_) {
        return false;
    }
}
