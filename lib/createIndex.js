import { opendirSync } from 'fs'

import {
    checkCollection,
    checkIndex,
    checkIndexConfig,
    isDefined,
} from "../utils/checks.js";
import { DOCUMENTID } from "../utils/constants.js";
import { Wrap } from "../utils/errors.js";
import { refreshIndexSidecars, removeIndexSidecars } from "./indexSidecar.js";
import {
    atomicwritejson,
    exists,
    openjsonlwriter,
    path,
    readfile,
    rm,
} from "../utils/fs.js";

function documentIds(collection) {
    const directory = opendirSync(path(collection));
    return {
        *[Symbol.iterator]() {
            try {
                let entry;
                while ((entry = directory.readSync()) !== null) {
                    if (entry.isFile() === false || entry.name.endsWith(".json") === false) {
                        continue;
                    }
                    const id = entry.name.slice(0, -5);
                    if (DOCUMENTID.test(id)) yield id;
                }
            } finally {
                directory.closeSync();
            }
        },
    };
}

export async function createIndex(index, config, collection) {
    const indexError = checkIndex(index);
    if (indexError instanceof Error)
        throw Wrap("Cannot start createIndex", indexError);
    const configError = checkIndexConfig(config);
    if (configError instanceof Error)
        throw Wrap("Cannot start createIndex", configError);
    const collectionError = checkCollection(collection);
    if (collectionError instanceof Error)
        throw Wrap("Cannot start createIndex", collectionError);

    let writer;
    try {
        if (exists(collection, `${index}.json`)) throw new Error("Index exists");

        writer = openjsonlwriter(collection, `${index}.jsonl`);
        const configKeys = Object.keys(config);
        for (const document of documentIds(collection)) {
            const documentObj = JSON.parse(
                readfile(collection, `${document}.json`),
            );
            const shouldIndex = configKeys.every((key) => (
                config[key] !== true || isDefined(documentObj[key])
            ));
            if (shouldIndex === false) continue;

            writer.write(Object.fromEntries([
                ["_id", document],
                ...configKeys.map((key) => [key, documentObj[key]]),
            ]));
        }
        writer.commit();
        writer = undefined;
        await refreshIndexSidecars(index, collection);
        atomicwritejson(config, collection, `${index}.json`);
    } catch (err) {
        writer?.abort();
        let configExists = false;
        try {
            configExists = exists(collection, `${index}.json`);
        } catch (_) {}
        if (configExists === false) {
            removeIndexSidecars(index, collection);
            try {
                rm(collection, `${index}.jsonl`);
            } catch (_) {}
        }
        throw Wrap("Cannot run createIndex", err);
    }
}
